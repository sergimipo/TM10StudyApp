"use client";
import { useEffect, useRef, useState } from "react";
import {
  ALL_TYPES,
  MAX_CHARS,
  TYPE_LABEL,
  type Level,
  type QType,
  type Question,
  type Result,
} from "@/lib/types";

type Screen = "setup" | "loading" | "quiz" | "grading" | "results";
type Answer = number | boolean | string | null;

const TYPE_CHIPS: { type: QType; label: string }[] = [
  { type: "test", label: "Tipo test" },
  { type: "vf", label: "Verdadero / Falso" },
  { type: "corta", label: "Respuesta corta" },
  { type: "abierta", label: "Respuesta abierta" },
];

const LEVELS: { value: Level; label: string }[] = [
  { value: "fácil", label: "Fácil" },
  { value: "media", label: "Media" },
  { value: "difícil", label: "Difícil" },
];

const letter = (i: number) => String.fromCharCode(65 + i);

function correctText(q: Question): string {
  if (q.type === "test") return `${letter(q.answer as number)}) ${q.options![q.answer as number]}`;
  if (q.type === "vf") return q.answer ? "Verdadero" : "Falso";
  return String(q.answer);
}

function verdictOf(score: number) {
  if (score >= 1) return { cls: "ok", text: "¡Correcto!", label: "Correcta" };
  if (score > 0) return { cls: "mid", text: "Parcialmente correcto", label: "Parcial" };
  return { cls: "bad", text: "Incorrecto", label: "Incorrecta" };
}

async function postJSON<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Algo falló. Inténtalo de nuevo.");
  return data as T;
}

export default function Page() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [topic, setTopic] = useState("");
  const [types, setTypes] = useState<QType[]>(ALL_TYPES);
  const [level, setLevel] = useState<Level>("media");
  const [count, setCount] = useState(8);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<(Result | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Answer>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const ctl = useRef<AbortController | null>(null);
  const previous = useRef<string[]>([]);
  const pendingRef = useRef(0); // Ref para trackear pendientes sin problemas de closure

  useEffect(() => {
    try {
      const saved = localStorage.getItem("estudia_topic");
      if (saved) setTopic(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("estudia_topic", topic);
    } catch {}
  }, [topic]);

  const allTypes = types.length === ALL_TYPES.length;

  function toggleType(t: QType | "all") {
    if (t === "all") return setTypes(ALL_TYPES);
    if (allTypes) return setTypes([t]);
    if (types.includes(t)) {
      if (types.length > 1) setTypes(types.filter((x) => x !== t));
    } else {
      setTypes([...types, t]);
    }
  }

  function goTo(s: Screen) {
    setScreen(s);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }

  async function generate() {
    setError(null);
    if (topic.trim().length < 80) {
      setError("Pega un tema un poco más largo (al menos un par de párrafos) para poder generar buenas preguntas.");
      return;
    }
    goTo("loading");
    const c = new AbortController();
    ctl.current = c;
    try {
      const data = await postJSON<{ questions: Question[] }>(
        "/api/generate",
        { topic: topic.slice(0, MAX_CHARS), types, count, level, previous: previous.current },
        c.signal
      );
      previous.current.push(...data.questions.map((q) => q.question));
      setQuestions(data.questions);
      setResults(new Array(data.questions.length).fill(null));
      setIdx(0);
      setSelected(null);
      setChecked(false);
      setPendingCount(0);
      pendingRef.current = 0;
      goTo("quiz");
    } catch (e) {
      goTo("setup");
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  }

  // Marca el resultado de una pregunta (síncrono o asíncrono)
  function markResult(i: number, r: Result) {
    setResults((prev) => {
      const n = [...prev];
      n[i] = r;
      return n;
    });
  }

  // Lanza la corrección en segundo plano
  function gradeInBackground(qIndex: number, userAnswer: string, q: Question) {
    pendingRef.current += 1;
    setPendingCount(pendingRef.current);

    // Marcamos como pendiente inmediatamente para que se vea en resultados
    markResult(qIndex, {
      score: -1,
      user: userAnswer,
      correct: String(q.answer),
      feedback: "Corrigiendo...",
    });

    const c = new AbortController();
    ctl.current = c;

    postJSON<{ score: number; feedback: string }>(
      "/api/grade",
      { question: q.question, answer: q.answer, keyPoints: q.keyPoints, userAnswer },
      c.signal
    )
      .then((data) => {
        markResult(qIndex, {
          score: data.score,
          user: userAnswer,
          correct: String(q.answer),
          feedback: data.feedback,
        });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          markResult(qIndex, {
            score: 0,
            user: userAnswer,
            correct: String(q.answer),
            feedback: "Error al corregir. Inténtalo de nuevo.",
          });
        }
      })
      .finally(() => {
        pendingRef.current -= 1;
        setPendingCount(pendingRef.current);
      });
  }

  async function check() {
    const q = questions[idx];
    if (checked || selected === null) return;

    // Test y V/F: corrección instantánea (síncrona)
    if (q.type === "test" || q.type === "vf") {
      const user =
        q.type === "test"
          ? `${letter(selected as number)}) ${q.options![selected as number]}`
          : selected
          ? "Verdadero"
          : "Falso";
      markResult(idx, { score: selected === q.answer ? 1 : 0, user, correct: correctText(q) });
      setChecked(true);
      return;
    }

    // Corta / Abierta: avanzamos inmediatamente y corregimos en background
    const userAnswer = String(selected).trim();
    if (!userAnswer) return;

    markResult(idx, {
      score: -1,
      user: userAnswer,
      correct: String(q.answer),
      feedback: "Corrigiendo...",
    });

    // Avanzamos inmediatamente
    setChecked(true);

    // Lanzamos la corrección en background
    gradeInBackground(idx, userAnswer, q);
  }

  function next() {
    setError(null);
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
      setSelected(null);
      setChecked(false);
    } else {
      // Si hay correcciones pendientes, vamos a la pantalla de "Corrigiendo..."
      if (pendingRef.current > 0) {
        goTo("grading");
      } else {
        goTo("results");
      }
    }
  }

  // Efecto: cuando todas las correcciones terminen, pasar a resultados
  useEffect(() => {
    if (screen === "grading" && pendingCount === 0 && questions.length > 0) {
      // Pequeño delay para que se vea la transición
      const t = setTimeout(() => goTo("results"), 400);
      return () => clearTimeout(t);
    }
  }, [screen, pendingCount, questions.length]);

  function newTopic() {
    ctl.current?.abort();
    previous.current = [];
    setError(null);
    setPendingCount(0);
    pendingRef.current = 0;
    goTo("setup");
  }

  const q = questions[idx];
  const r = results[idx];
  const canCheck = !selected === null && !(typeof selected === "string" && !String(selected).trim());
  const total = results.reduce((a, x) => a + (x && x.score >= 0 ? x.score : 0), 0);
  const answeredCount = results.filter((x) => x !== null).length;
  const pct = questions.length ? Math.round((total / questions.length) * 100) : 0;
  const finalMsg =
    pct >= 90
      ? "¡Excelente! Dominas este tema."
      : pct >= 70
      ? "Muy bien, vas por buen camino."
      : pct >= 50
      ? "Aprobado justo. Repasa los fallos y vuelve a intentarlo."
      : "Aún te falta. Repasa el tema y prueba otra ronda.";

  return (
    <div className="wrap">
      <header>
        <h1>
          Estudia <span>con IA</span>
        </h1>
        {screen !== "setup" && (
          <button className="btn ghost small" onClick={newTopic}>
            Nuevo tema
          </button>
        )}
      </header>

      {/* PANTALLA 1: configuración */}
      {screen === "setup" && (
        <section>
          <div className="card">
            <label className="lbl" htmlFor="topic">
              Pega aquí el tema que quieres estudiar
            </label>
            <p className="hint">Apuntes, un resumen, un capítulo… Cuanto más completo, mejores preguntas.</p>
            <textarea
              id="topic"
              className="big"
              placeholder="Pega tus apuntes aquí…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <div className="counter">
              {topic.length.toLocaleString("es-ES")} caracteres
              {topic.length > MAX_CHARS && ` (se usarán los primeros ${MAX_CHARS.toLocaleString("es-ES")})`}
            </div>
          </div>
          <div className="card">
            <span className="lbl">Tipo de preguntas</span>
            <div className="chips">
              <button className="chip" aria-pressed={allTypes} onClick={() => toggleType("all")}>
                Todo
              </button>
              {TYPE_CHIPS.map((c) => (
                <button
                  key={c.type}
                  className="chip"
                  aria-pressed={!allTypes && types.includes(c.type)}
                  onClick={() => toggleType(c.type)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="hint mt10">Pulsa uno para elegir solo ese; pulsa más para combinarlos.</p>
            <label className="lbl mt14" htmlFor="count">
              Número de preguntas
            </label>
            <div className="row">
              <input
                type="range"
                id="count"
                min={3}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              <span className="num">{count}</span>
            </div>
            <span className="lbl mt18">Dificultad</span>
            <div className="chips">
              {LEVELS.map((l) => (
                <button key={l.value} className="chip" aria-pressed={level === l.value} onClick={() => setLevel(l.value)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn full" onClick={generate}>
            Generar preguntas
          </button>
          {error && <div className="err">{error}</div>}
        </section>
      )}

      {/* PANTALLA 2: cargando */}
      {screen === "loading" && (
        <section>
          <div className="card loading">
            <div className="spinner" />
            <div>Leyendo tu tema y preparando las preguntas…</div>
            <div className="actions center">
              <button className="btn ghost small" onClick={() => ctl.current?.abort()}>
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* PANTALLA 3: cuestionario */}
      {screen === "quiz" && q && (
        <section>
          <div className="progress">
            <div style={{ width: `${((idx + 1) / questions.length) * 100}%` }} />
          </div>
          <div className="card" key={idx}>
            <div className="meta">
              <span>
                Pregunta {idx + 1} de {questions.length}
              </span>
              <span className="tag">{TYPE_LABEL[q.type]}</span>
            </div>
            <p className="q">{q.question}</p>

            {q.type === "test" &&
              q.options!.map((o, i) => {
                let cls = "opt";
                if (checked) {
                  if (i === q.answer) cls += " right";
                  else if (i === selected) cls += " wrong";
                } else if (i === selected) cls += " sel";
                return (
                  <button key={i} className={cls} disabled={checked} onClick={() => setSelected(i)}>
                    <span className="k">{letter(i)}</span>
                    <span>{o}</span>
                  </button>
                );
              })}

            {q.type === "vf" &&
              [true, false].map((val) => {
                let cls = "opt";
                if (checked) {
                  if (val === q.answer) cls += " right";
                  else if (val === selected) cls += " wrong";
                } else if (val === selected) cls += " sel";
                return (
                  <button key={String(val)} className={cls} disabled={checked} onClick={() => setSelected(val)}>
                    <span className="k">{val ? "V" : "F"}</span>
                    <span>{val ? "Verdadero" : "Falso"}</span>
                  </button>
                );
              })}

            {q.type === "corta" && (
              <input
                type="text"
                placeholder="Tu respuesta…"
                autoComplete="off"
                disabled={checked}
                value={typeof selected === "string" ? selected : ""}
                onChange={(e) => setSelected(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canCheck && check()}
              />
            )}

            {q.type === "abierta" && (
              <textarea
                rows={6}
                placeholder="Desarrolla tu respuesta…"
                disabled={checked}
                value={typeof selected === "string" ? selected : ""}
                onChange={(e) => setSelected(e.target.value)}
              />
            )}

            {/* Feedback inmediato solo para test/vf */}
            {checked && r && (q.type === "test" || q.type === "vf") && (() => {
              const v = verdictOf(r.score);
              return (
                <div className={`feedback ${v.cls}`}>
                  <div className="verdict">{v.text}</div>
                  {r.score < 1 && (
                    <p>
                      <span className="lab">Respuesta correcta: </span>
                      {r.correct}
                    </p>
                  )}
                  {q.explanation && (
                    <p>
                      <span className="lab">Explicación: </span>
                      {q.explanation}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Indicador de corrección en background para corta/abierta */}
            {checked && q.type !== "test" && q.type !== "vf" && (
              <div className="feedback mid">
                <div className="verdict">✓ Respuesta registrada</div>
                <p className="muted">La IA está corrigiendo en segundo plano. Sigue con la siguiente pregunta.</p>
              </div>
            )}

            <div className="actions">
              {!checked ? (
                <button className="btn" disabled={!canCheck} onClick={check}>
                  Comprobar
                </button>
              ) : (
                <button className="btn" onClick={next}>
                  {idx === questions.length - 1 ? "Ver resultados" : "Siguiente"}
                </button>
              )}
            </div>
            {error && <div className="err">{error}</div>}
          </div>
        </section>
      )}

      {/* PANTALLA 3.5: corrigiendo respuestas en background */}
      {screen === "grading" && (
        <section>
          <div className="card loading">
            <div className="spinner" />
            <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
              Corrigiendo respuestas…
            </div>
            <div className="muted">
              {pendingCount} {pendingCount === 1 ? "respuesta pendiente" : "respuestas pendientes"}
            </div>
          </div>
        </section>
      )}

      {/* PANTALLA 4: resultados */}
      {screen === "results" && (
        <section>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="score">
              {(Math.round(total * 10) / 10).toString().replace(".", ",")} / {questions.length}
            </div>
            <p className="hint mt10">
              {pct}% · {finalMsg}
            </p>
            <div className="actions center">
              <button className="btn" onClick={generate}>
                Otras preguntas del mismo tema
              </button>
              <button className="btn ghost" onClick={newTopic}>
                Nuevo tema
              </button>
            </div>
          </div>
          <div className="card">
            <h2>Repaso</h2>
            {questions.map((qq, i) => {
              const rr = results[i];
              if (!rr) return null;
              const isPending = rr.score === -1;
              const v = isPending ? { cls: "mid", label: "Pendiente" } : verdictOf(rr.score);
              return (
                <div className="review-item" key={i}>
                  <div className={`st ${v.cls}`}>
                    {i + 1}. {v.label} · {TYPE_LABEL[qq.type]}
                  </div>
                  <p className="qq">{qq.question}</p>
                  <p>Tu respuesta: {rr.user || "—"}</p>
                  {!isPending && rr.score < 1 && <p>Correcta: {rr.correct}</p>}
                  {rr.feedback && rr.feedback !== "Corrigiendo..." && <p className="muted">{rr.feedback}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}