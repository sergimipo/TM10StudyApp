import { NextResponse } from "next/server";

// Modelos gratuitos y disponibles en 2026 (ordenados por preferencia)
const MODELOS_DISPONIBLES = [
  "gemini-3.8-flash",      // El más reciente, estable y recomendado por Google
  "gemini-3.5-flash-lite", // Alternativa ligera y rápida
  "gemini-3.1-flash-lite", // Otra opción ligera gratuita
  "gemini-2.5-flash"       // Último recurso
];

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

function extractJSON(text: string): unknown {
  const clean = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // sigue
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

export async function askJSON(prompt: string, maxTokens: number = 16000): Promise<unknown> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new HttpError(500, "Falta GOOGLE_API_KEY. Revisa las variables de entorno en Vercel.");
  }

  let lastError: HttpError | null = null;

  // BUCLE DE FALLBACK: Prueba cada modelo hasta que uno funcione
  for (const model of MODELOS_DISPONIBLES) {
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

        // Si el modelo no existe, no está disponible o no tenemos acceso, probamos el siguiente
        if (res.status === 404 || res.status === 403 || /API_KEY_INVALID|API key not valid|no longer available|not found/i.test(detail)) {
          console.warn(`[Fallback] Modelo "${model}" no disponible. Probando siguiente...`);
          continue; // ⬅️ Pasa al siguiente modelo de la lista
        }

        if (res.status === 429) throw new HttpError(429, "Límite de uso alcanzado. Espera un poco y reintenta.");
        if (res.status === 401) throw new HttpError(500, "La clave de API de Google no es válida.");
        throw new HttpError(502, "Error al hablar con la IA. Inténtalo de nuevo.");
      }

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

      console.log(`[IA] Éxito usando modelo: ${model}`);
      return extractJSON(text);
    } catch (e) {
      if (e instanceof HttpError && ![404, 403].includes(e.status)) {
        throw e; // Si es un error grave, no seguimos probando
      }
      lastError = e as HttpError;
    }
  }

  throw new HttpError(
    500,
    `Ningún modelo de IA está disponible. Revisa tu API Key en Vercel.`
  );
}