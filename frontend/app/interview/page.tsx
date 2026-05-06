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
    <div className="grid gap-6">
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Интервью
        </h1>
        <p className="mt-2 text-sm text-zinc-500">AIR4 хочет узнать тебя лучше</p>
      </div>

      <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Вопросы
          </h2>
          <div className="text-xs text-zinc-500">{progressLabel}</div>
        </div>

        {qError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {qError}
          </div>
        ) : null}

        {qLoading ? (
          <div className="text-sm text-zinc-600">Загружаю…</div>
        ) : done ? (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-6">
            <div className="text-base font-semibold text-zinc-900">
              Готово! AIR4 стал лучше понимать тебя.
            </div>
            <button
              type="button"
              onClick={() => void loadQuestions()}
              className="mt-4 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              Следующие вопросы
            </button>
          </div>
        ) : current ? (
          <div className="grid gap-4">
            <div className="text-base font-medium text-zinc-900">{current}</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-400 focus:ring-0 focus:outline-none"
              placeholder="Твой ответ..."
              disabled={saving}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={saving || text.trim().length === 0}
                className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Сохраняю…" : "Ответить"}
              </button>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                disabled={saving}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 disabled:opacity-60"
              >
                Обновить вопросы
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-600">Вопросов нет.</div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Прошлые ответы
        </h2>

        {aError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {aError}
          </div>
        ) : null}

        {aLoading ? (
          <div className="text-sm text-zinc-600">Загружаю…</div>
        ) : answers.length === 0 ? (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-8 text-center text-sm text-zinc-700">
            Ответов пока нет.
          </div>
        ) : (
          <div className="grid gap-3">
            {answers.map((x) => (
              <div
                key={x.id}
                className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm"
              >
                <div className="text-xs text-zinc-500">{formatDateRu(x.created_at)}</div>
                <div className="mt-2 text-sm font-medium text-zinc-900">
                  Q: {x.question}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
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

