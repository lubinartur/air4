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
      <div className="flex items-center gap-4 mb-2 animate-fade-in-up animate-delay-1">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-white/5 text-[#94a3b8] transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#f1f5f9] tracking-tight">
            Загрузка выписки
          </h1>
          <p className="text-[11px] font-bold text-[#64748b] uppercase tracking-[0.2em] mt-0.5">
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
            "w-full bg-[#13131f] border border-white/5 rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center text-center transition-all cursor-pointer relative overflow-hidden card-hover animate-fade-in-up animate-delay-2",
            dragOver && "ring-2 ring-[#f97316]"
          )}
        >
          <div
            className={cn(
              "absolute inset-0 border-2 border-dashed rounded-[20px] transition-colors pointer-events-none",
              dragOver ? "border-[#f97316]" : "border-[#f97316]/30"
            )}
          />
          <div className="w-16 h-16 rounded-2xl bg-[#f97316]/15 flex items-center justify-center text-[#f97316] mb-6 relative z-10">
            <Upload size={32} />
          </div>
          <h3 className="text-[18px] font-bold text-[#f1f5f9] relative z-10">
            Перетащите CSV Swedbank сюда
          </h3>
          <p className="text-[14px] text-[#94a3b8] mt-1 font-medium relative z-10">
            или нажмите, чтобы выбрать файл
          </p>
          <div className="mt-8 pt-8 border-t border-white/5 flex gap-4 text-[11px] font-bold text-[#64748b] uppercase tracking-widest leading-none relative z-10">
            <span>Формат: CSV</span>
            <div className="w-1 h-1 rounded-full bg-white/20 mt-1" />
            <span>Swedbank Estonia</span>
          </div>
        </button>
      )}

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 rounded-[20px] p-5 flex gap-3 text-red-400">
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
              className="mt-3 text-[12px] font-bold uppercase tracking-wider text-red-400 hover:underline"
            >
              Повторить
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && selectedFile && (
        <div className="bg-[#13131f] border border-white/5 rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-6 card-hover">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#94a3b8]">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#f1f5f9]">{selectedFile.name}</p>
              <p className="text-[11px] text-[#94a3b8] font-bold uppercase tracking-wider">
                Загрузка и категоризация…
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[14px] font-bold text-[#f97316]">
            <Loader2 size={18} className="animate-spin" />
            <span>AIR4 обрабатывает выписку…</span>
          </div>
        </div>
      )}

      {phase === "success" && result && (
        <>
          <div className="bg-[#13131f] border border-white/5 rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] space-y-6 card-hover">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={24} className="text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[16px] font-bold text-[#f1f5f9]">Загрузка завершена</p>
                <p className="text-[13px] text-[#94a3b8] mt-1">{result.filename}</p>
                {result.period_start && result.period_end && (
                  <p className="text-[11px] text-[#64748b] font-mono mt-2">
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
                <h2 className="text-[11px] font-bold text-[#64748b] uppercase tracking-[0.1em] mb-4">
                  Категории
                </h2>
                <ul className="space-y-2">
                  {categoryRows.map(([key, count]) => (
                    <li
                      key={key}
                      className="flex justify-between items-center text-[13px] py-2 px-3 rounded-lg bg-[#1e1e2e]"
                    >
                      <span className="font-medium text-[#cbd5e1] capitalize">
                        {formatCategoryLabel(key)}
                      </span>
                      <span className="font-mono font-bold text-[#f1f5f9]">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onViewFinance}
            className="w-full py-4 rounded-[12px] bg-[#f97316] text-white font-bold text-[14px] uppercase tracking-wider shadow-lg shadow-[#f97316]/20 hover:bg-[#ea6a06] transition-colors"
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
            className="w-full py-3 text-[13px] font-bold text-[#94a3b8] hover:text-[#f97316] transition-colors"
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
    <div className="bg-[#1e1e2e] rounded-xl p-4">
      <p className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">{label}</p>
      <p className="text-[18px] font-black text-[#f1f5f9] mt-1 font-mono">{value}</p>
    </div>
  );
}
