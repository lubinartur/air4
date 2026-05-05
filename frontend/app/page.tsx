import { FileUpload } from "@/components/FileUpload";

export default function Home() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Upload your statements
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          AIR4 parses Swedbank CSV exports, auto-detects internal transfers,
          categorizes transactions using Ollama, and builds a spending dashboard
          + chat.
        </p>
      </div>
      <FileUpload />
    </div>
  );
}
