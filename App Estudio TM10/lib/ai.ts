import { NextResponse } from "next/server";

// Modelos de Google (se pueden cambiar en .env.local)
export const GEN_MODEL = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
export const GRADE_MODEL = process.env.GOOGLE_GRADE_MODEL || "gemini-2.5-flash";

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

/** Extrae el primer array/objeto JSON de un texto (tolera ```json ... ```). */
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

export async function askJSON(prompt: string, model: string, maxTokens: number): Promise<unknown> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new HttpError(500, "Falta GOOGLE_API_KEY. Crea el archivo .env.local (mira .env.example).");
  }

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
    console.error("Google API error", res.status, detail);
    if (res.status === 429) throw new HttpError(429, "Límite de uso alcanzado. Espera un poco y reintenta.");
    if (res.status === 404) throw new HttpError(500, `El modelo "${model}" no existe o no tienes acceso.`);
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
      throw new HttpError(500, "La clave de API de Google no es válida o no tiene permisos.");
    }
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
  return extractJSON(text);
}
