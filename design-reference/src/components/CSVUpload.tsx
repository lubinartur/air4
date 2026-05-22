import { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  formatCategoryLabel,
  uploadStatement,
  type UploadResult,
} from "../lib/api";

interface CSVUploadProps {
  onBack: () => void;
  onViewFinance: () => void;
}

type Phase = "idle" | "uploading" | "success" | "error";

export function CSVUpload({ onBack, onViewFinance }: CSVUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const runUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Выберите CSV-файл.");
      setPhase("error");
      return;
    }

    setSelectedFile(file);
    setResult(null);
    setError(null);
    setPhase("uploading");

    try {
      const data = await uploadStatement(file);
      setResult(data);
      setPhase("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить файл");
      setPhase("error");
    }
  }, []);

  const onFileChosen = (file: File | undefined) => {
    if (!file) return;
    void runUpload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onFileChosen(e.dataTransfer.files[0]);
  };

  const categoryRows = result
    ? Object.entries(result.categories).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="max-w-[640px] mx-auto pb-20 space-y-8">
      <div className="flex items-center gap-4 mb-2">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">
            Загрузка выписки
          </h1>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-0.5">
            Финансовые данные
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />

      {(phase === "idle" || phase === "error") && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "w-full bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center text-center transition-all cursor-pointer relative overflow-hidden",
            dragOver && "ring-2 ring-indigo-400"
          )}
        >
          <div
            className={cn(
              "absolute inset-0 border-2 border-dashed rounded-[20px] transition-colors pointer-events-none",
              dragOver ? "border-indigo-400" : "border-indigo-100"
            )}
          />
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-6 relative z-10">
            <Upload size={32} />
          </div>
          <h3 className="text-[18px] font-bold text-[#111827] relative z-10">
            Перетащите CSV Swedbank сюда
          </h3>
          <p className="text-[14px] text-[#6b7280] mt-1 font-medium relative z-10">
            или нажмите, чтобы выбрать файл
          </p>
          <div className="mt-8 pt-8 border-t border-gray-50 flex gap-4 text-[11px] font-bold text-[#9ca3af] uppercase tracking-widest leading-none relative z-10">
            <span>Формат: CSV</span>
            <div className="w-1 h-1 rounded-full bg-gray-200 mt-1" />
            <span>Swedbank Estonia</span>
          </div>
        </button>
      )}

      {error && (
        <div className="bg-red-50 rounded-[20px] p-5 flex gap-3 text-red-700">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold">Не удалось загрузить файл</p>
            <p className="text-[13px] mt-1">{error}</p>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setError(null);
                setSelectedFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="mt-3 text-[12px] font-bold uppercase tracking-wider text-red-600 hover:underline"
            >
              Повторить
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && selectedFile && (
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-[#9ca3af]">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#111827]">{selectedFile.name}</p>
              <p className="text-[11px] text-[#9ca3af] font-bold uppercase tracking-wider">
                Загрузка и категоризация…
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[14px] font-bold text-indigo-600">
            <Loader2 size={18} className="animate-spin" />
            <span>AIR4 обрабатывает выписку…</span>
          </div>
        </div>
      )}

      {phase === "success" && result && (
        <>
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={24} className="text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[16px] font-bold text-[#111827]">Загрузка завершена</p>
                <p className="text-[13px] text-[#6b7280] mt-1">{result.filename}</p>
                {result.period_start && result.period_end && (
                  <p className="text-[11px] text-[#9ca3af] font-mono mt-2">
                    {result.period_start} — {result.period_end}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Stat label="ID загрузки" value={`#${result.upload_id}`} />
              <Stat label="Всего в файле" value={String(result.total_transactions)} />
              <Stat label="Новых транзакций" value={String(result.new_transactions)} />
              <Stat label="Дубликатов пропущено" value={String(result.skipped_duplicates)} />
            </div>

            {categoryRows.length > 0 && (
              <div>
                <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
                  Категории
                </h2>
                <ul className="space-y-2">
                  {categoryRows.map(([key, count]) => (
                    <li
                      key={key}
                      className="flex justify-between items-center text-[13px] py-2 px-3 rounded-lg bg-gray-50"
                    >
                      <span className="font-medium text-gray-700 capitalize">
                        {formatCategoryLabel(key)}
                      </span>
                      <span className="font-mono font-bold text-gray-900">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onViewFinance}
            className="w-full py-4 rounded-[12px] bg-[#6366f1] text-white font-bold text-[14px] uppercase tracking-wider shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-colors"
          >
            Открыть финансы
          </button>

          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setResult(null);
              setSelectedFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="w-full py-3 text-[13px] font-bold text-[#6b7280] hover:text-indigo-600 transition-colors"
          >
            Загрузить ещё файл
          </button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <p className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider">{label}</p>
      <p className="text-[18px] font-black text-[#111827] mt-1 font-mono">{value}</p>
    </div>
  );
}
