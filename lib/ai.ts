import { NextResponse } from "next/server";

//  Lista de modelos en orden de preferencia (fallback automático)
// Si el primero falla, prueba el siguiente, y así sucesivamente.
const MODEL_FALLBACK = [
  "gemini-2.0-flash",       // El más moderno y rápido (2025+)
  "gemini-1.5-flash",       // Muy estable y rápido
  "gemini-1.5-pro",         // Más potente, un poco más lento
  "gemini-2.0-flash-lite",  // Último recurso, muy ligero
];

// Cache de modelos que ya sabemos que NO funcionan (para no volver a probarlos)
const failedModels = new Set<string>();

/** Devuelve el siguiente modelo disponible que no haya fallado antes */
function getNextModel(preferred?: string): string | null {
  const list = preferred ? [preferred, ...MODEL_FALLBACK] : MODEL_FALLBACK;
  return list.find((m) => !failedModels.has(m)) ?? null;
}

const apiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
}

/** Extrae el primer array/objeto JSON de un texto (tolera ```json ... ```) */
function extractJSON(text: string): unknown {
  const clean = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    /* sigue */
  }
  const firstArr = clean.indexOf("[");
  const firstObj = clean.indexOf("{");
  let start = -1;
  let endChar = "";
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    endChar = "]";
  } else if (firstObj !== -1) {
    start = firstObj;
    endChar = "}";
  }
  const end = clean.lastIndexOf(endChar);
  if (start === -1 || end <= start) {
    throw new HttpError(502, "La IA no devolvió un resultado válido. Inténtalo de nuevo.");
  }
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "La IA devolvió un JSON incompleto. Inténtalo de nuevo.");
  }
}

/**
 * Llama a la API de Google con fallback automático entre modelos.
 * Si el modelo preferido falla, prueba los siguientes de la lista.
 */
export async function askJSON(
  prompt: string,
  preferredModel?: string,
  maxTokens: number = 16000
): Promise<unknown> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new HttpError(500, "Falta GOOGLE_API_KEY. Crea el archivo .env.local (mira .env.example).");
  }

  const tried: string[] = [];
  let lastError: HttpError | null = null;

  // Intenta con cada modelo hasta que uno funcione
  for (const model of MODEL_FALLBACK) {
    if (failedModels.has(model)) continue;

    tried.push(model);

    try {
      const res = await fetch(apiUrl(model), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: maxTokens,
            temperature: 0.7,
          },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[Modelo: ${model}] Google API error`, res.status, detail);

        // Si el modelo NO existe o NO tenemos acceso, lo marcamos como fallido y probamos el siguiente
        if (res.status === 404 || res.status === 403 || /API_KEY_INVALID|API key not valid|not available/i.test(detail)) {
          failedModels.add(model);
          console.warn(`[Fallback] Modelo "${model}" no disponible. Probando siguiente...`);
          continue; // ⬅️ pasa al siguiente modelo
        }

        // Otros errores (429, 500...) los propagamos directamente
        if (res.status === 429) throw new HttpError(429, "Límite de uso alcanzado. Espera un poco y reintenta.");
        if (res.status === 401) throw new HttpError(500, "La clave de API de Google no es válida.");
        throw new HttpError(502, "Error al hablar con la IA. Inténtalo de nuevo.");
      }

      // ✅ Éxito: parseamos la respuesta
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };

      if (data.promptFeedback?.blockReason) {
        throw new HttpError(400, "La IA rechazó el contenido del tema. Prueba con otro texto.");
      }

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");

      if (!text.trim()) throw new HttpError(502, "La IA no devolvió respuesta. Inténtalo de nuevo.");

      console.log(`[IA] Usando modelo: ${model} (intentos previos: ${tried.slice(0, -1).join(", ") || "ninguno"})`);
      return extractJSON(text);
    } catch (e) {
      // Si es un HttpError que NO es de modelo no disponible, lo propagamos
      if (e instanceof HttpError && ![404, 403].includes(e.status)) {
        throw e;
      }
      lastError = e as HttpError;
    }
  }

  // Si llegamos aquí, todos los modelos fallaron
  throw new HttpError(
    500,
    `Ningún modelo de IA está disponible (intentados: ${tried.join(", ")}). Revisa tu API Key o espera unos minutos.`
  );
}