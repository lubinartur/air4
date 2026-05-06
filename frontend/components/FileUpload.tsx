"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadCsv } from "@/lib/api";

type UploadPhase = "idle" | "uploading" | "categorizing" | "done";

function formatFetchErrorMessage(raw: string): string {
  const t = raw.trim();
  if (!t) return "Не удалось загрузить";
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x) =>
          typeof x === "object" && x !== null && "msg" in x
            ? String((x as { msg: unknown }).msg)
            : JSON.stringify(x)
        )
        .join("; ");
    }
  } catch {
    /* not JSON */
  }
  return t;
}

export function FileUpload() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [longWait, setLongWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestActiveRef = useRef(false);

  const canUpload = useMemo(() => files.length >= 1 && files.length <= 2, [files]);
  const busy =
    phase === "uploading" || phase === "categorizing" || phase === "done";

  async function onSubmit() {
    setError(null);
    if (!canUpload) {
      setError("Выбери один или два CSV файла.");
      return;
    }

    requestActiveRef.current = true;
    setLongWait(false);
    setPhase("uploading");

    const toCategorizing = window.setTimeout(() => {
      if (requestActiveRef.current) setPhase("categorizing");
    }, 2000);
    const toLongWait = window.setTimeout(() => {
      if (requestActiveRef.current) setLongWait(true);
    }, 30000);

    try {
      await uploadCsv(files);
      requestActiveRef.current = false;
      window.clearTimeout(toCategorizing);
      window.clearTimeout(toLongWait);
      setLongWait(false);
      setPhase("done");
      await new Promise((r) => setTimeout(r, 1000));
      router.push("/dashboard");
    } catch (e) {
      requestActiveRef.current = false;
      window.clearTimeout(toCategorizing);
      window.clearTimeout(toLongWait);
      setLongWait(false);
      const msg =
        e instanceof Error
          ? formatFetchErrorMessage(e.message)
          : "Не удалось загрузить";
      setError(msg);
      setPhase("idle");
    }
  }

  function statusMessage(): string | null {
    switch (phase) {
      case "uploading":
        return "Загружаю файлы...";
      case "categorizing":
        return "Категоризирую транзакции с AI... это займёт 2-3 минуты";
      case "done":
        return "Готово! Перехожу к финансам...";
      default:
        return null;
    }
  }

  const msg = statusMessage();

  return (
    <div>
      <label className={`block ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center transition-colors hover:border-zinc-400">
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              setFiles(list.slice(0, 2));
              setError(null);
            }}
          />
          <p className="text-sm font-medium text-zinc-900">
            Перетащи CSV Swedbank или нажми для выбора
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Один или два файла выписки
          </p>
        </div>
      </label>

      <div className="mt-4 text-center text-sm">
        {files.length === 0 ? (
          <span className="text-zinc-400">Файл не выбран</span>
        ) : (
          <ul className="inline-block list-none text-left text-zinc-700">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`}>{f.name}</li>
            ))}
          </ul>
        )}
      </div>

      {msg ? (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
          <p className="font-medium text-zinc-900">{msg}</p>
          {longWait && (phase === "uploading" || phase === "categorizing") ? (
            <p className="mt-2 text-sm text-zinc-600">
              Ещё работаю... Ollama обрабатывает транзакции
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void onSubmit()}
        disabled={!canUpload || busy}
        className="mt-6 w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-opacity disabled:opacity-50"
      >
        {busy
          ? phase === "done"
            ? "Перехожу…"
            : "Обрабатываю…"
          : "Загрузить"}
      </button>
    </div>
  );
}
