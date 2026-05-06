import { FileUpload } from "@/components/FileUpload";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Загрузить выписку
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          AIR4 парсит CSV из Swedbank, автоматически находит внутренние переводы,
          категоризирует транзакции через Ollama и строит дашборд + чат.
        </p>
      </div>
      <FileUpload />
    </div>
  );
}
