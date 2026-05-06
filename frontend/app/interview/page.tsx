"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getInterviewAnswers,
  getInterviewQuestions,
  saveInterviewAnswer,
  type InterviewAnswer,
  type InterviewQuestion,
} from "@/lib/api";

function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return "—";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InterviewPage() {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [qLoading, setQLoading] = useState(true);
  const [qError, setQError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [aLoading, setALoading] = useState(true);
  const [aError, setAError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function loadAnswers() {
    setALoading(true);
    setAError(null);
    try {
      const res = await getInterviewAnswers();
      setAnswers(res || []);
    } catch (e) {
      setAError(e instanceof Error ? e.message : "Не удалось загрузить ответы");
    } finally {
      setALoading(false);
    }
  }

  async function loadQuestions() {
    setQLoading(true);
    setQError(null);
    try {
      const res = await getInterviewQuestions();
      setQuestions(res.questions || []);
      setStep(0);
      setText("");
      setDone(false);
    } catch (e) {
      setQError(e instanceof Error ? e.message : "Не удалось получить вопросы");
      setQuestions([]);
    } finally {
      setQLoading(false);
    }
  }

  useEffect(() => {
    void loadQuestions();
    void loadAnswers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = questions[step]?.question || null;
  const total = questions.length || 3;

  const progressLabel = useMemo(() => {
    if (done) return "Готово";
    if (!current) return "—";
    return `Вопрос ${Math.min(step + 1, total)} / ${total}`;
  }, [current, done, step, total]);

  async function onSubmit() {
    if (!current) return;
    const a = text.trim();
    if (!a) return;
    setSaving(true);
    setQError(null);
    try {
      const saved = await saveInterviewAnswer(current, a);
      setAnswers((prev) => [saved, ...prev]);
      setText("");
      if (step >= (questions.length || 3) - 1) {
        setDone(true);
      } else {
        setStep((s) => s + 1);
      }
    } catch (e) {
      setQError(e instanceof Error ? e.message : "Не удалось сохранить ответ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="glass-card p-8">
        <div className="mono-label mb-2 text-zinc-500">Deep context</div>
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">
          Интервью
        </h1>
        <p className="mt-3 text-sm font-light text-zinc-500">
          AIR4 хочет узнать тебя лучше
        </p>
      </header>

      <section className="glass-card p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="mono-label text-zinc-300">Вопросы</h2>
          <div className="text-xs font-mono text-zinc-600">{progressLabel}</div>
        </div>

        {qError ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {qError}
          </div>
        ) : null}

        {qLoading ? (
          <div className="text-sm text-zinc-500">Загружаю…</div>
        ) : done ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="text-base font-medium text-zinc-100">
              Готово! AIR4 стал лучше понимать тебя.
            </div>
            <button
              type="button"
              onClick={() => void loadQuestions()}
              className="btn-primary mt-4"
            >
              Следующие вопросы
            </button>
          </div>
        ) : current ? (
          <div className="grid gap-4">
            <div className="text-base font-medium text-zinc-100">{current}</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:ring-0 focus:outline-none"
              placeholder="Твой ответ..."
              disabled={saving}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={saving || text.trim().length === 0}
                className="btn-primary disabled:opacity-60"
              >
                {saving ? "Сохраняю…" : "Ответить"}
              </button>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                disabled={saving}
                className="btn-ghost disabled:opacity-60"
              >
                Обновить вопросы
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">Вопросов нет.</div>
        )}
      </section>

      <section className="glass-card p-8">
        <h2 className="mono-label mb-6 text-zinc-300">Прошлые ответы</h2>

        {aError ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {aError}
          </div>
        ) : null}

        {aLoading ? (
          <div className="text-sm text-zinc-500">Загружаю…</div>
        ) : answers.length === 0 ? (
          <div className="glass-card border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
            Ответов пока нет.
          </div>
        ) : (
          <div className="grid gap-3">
            {answers.map((x) => (
              <div key={x.id} className="glass-card p-6">
                <div className="text-xs font-mono text-zinc-600">
                  {formatDateRu(x.created_at)}
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-100">
                  Q: {x.question}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                  A: {x.answer}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

