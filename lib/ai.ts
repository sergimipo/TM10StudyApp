import { NextResponse } from "next/server";

const MODEL = "openrouter/free";

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
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new HttpError(500, "Falta OPENROUTER_API_KEY en las variables de entorno de Vercel.");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": "https://tm-10-study-app.vercel.app",
      "X-Title": "TM10 Study App",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[OpenRouter] Error ${res.status}:`, detail);
    
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(500, "La clave de OpenRouter no es válida.");
    }
    if (res.status === 429) {
      throw new HttpError(429, "Límite de uso alcanzado. Espera un momento.");
    }
    throw new HttpError(502, "Error al hablar con la IA. Inténtalo de nuevo.");
  }

  const data = await res.json() as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new HttpError(502, `Error de OpenRouter: ${data.error.message}`);
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new HttpError(502, "La IA no devolvió respuesta. Inténtalo de nuevo.");
  }

  return extractJSON(text);
}