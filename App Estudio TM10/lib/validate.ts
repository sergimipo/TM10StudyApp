import { ALL_TYPES, type QType, type Question } from "./types";

const norm = (s: unknown) => String(s ?? "").trim();

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function validateQuestion(raw: any): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type as QType;
  if (!ALL_TYPES.includes(type) || !norm(raw.question)) return null;

  const base = { type, question: norm(raw.question), explanation: norm(raw.explanation) };

  if (type === "test") {
    if (!Array.isArray(raw.options) || raw.options.length < 2) return null;
    const opts: string[] = raw.options.map(norm);
    const ans = Number(raw.answer);
    if (!(ans >= 0 && ans < opts.length)) return null;
    // Barajamos aquí para que la posición de la correcta sea aleatoria
    const tagged = shuffle(opts.map((o, i) => ({ o, ok: i === ans })));
    return {
      ...base,
      options: tagged.map((x) => x.o),
      answer: tagged.findIndex((x) => x.ok),
    };
  }

  if (type === "vf") {
    let a = raw.answer;
    if (typeof a === "string") {
      const l = a.toLowerCase();
      a = l.startsWith("verd") || l === "true";
    }
    return { ...base, answer: !!a };
  }

  if (!norm(raw.answer)) return null;
  return {
    ...base,
    answer: norm(raw.answer),
    keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints.map(norm).filter(Boolean) : [],
  };
}
