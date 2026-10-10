export type QType = "test" | "vf" | "corta" | "abierta";
export type Level = "fácil" | "media" | "difícil";

export interface Question {
  type: QType;
  question: string;
  explanation: string;
  /** test: índice de la opción correcta · vf: true/false · corta/abierta: respuesta modelo */
  answer: number | boolean | string;
  options?: string[];
  keyPoints?: string[];
}

export interface Result {
  /** 1 = correcta, 0.5 = parcial, 0 = incorrecta */
  score: number;
  user: string;
  correct: string;
  feedback?: string;
}

export const ALL_TYPES: QType[] = ["test", "vf", "corta", "abierta"];

export const TYPE_LABEL: Record<QType, string> = {
  test: "Tipo test",
  vf: "Verdadero / Falso",
  corta: "Respuesta corta",
  abierta: "Respuesta abierta",
};

export const MAX_CHARS = 60000;
