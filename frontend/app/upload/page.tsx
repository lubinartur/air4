import { FileUpload } from "@/components/FileUpload";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-lg">
      <header className="glass-card mb-8 p-8 text-center">
        <div className="mono-label mb-2 text-zinc-500">Ingest</div>
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">
          Загрузить выписку
        </h1>
        <p className="mt-3 text-sm font-light leading-relaxed text-zinc-500">
          AIR4 парсит CSV из Swedbank, автоматически находит внутренние переводы,
          категоризирует транзакции через Ollama и строит дашборд + чат.
        </p>
      </header>
      <FileUpload />
    </div>
  );
}
