"use client";

import Link from "next/link";
import { ChatWindow } from "@/components/ChatWindow";

export default function ChatPage() {
  return (
    <div className="space-y-8">
      <header className="glass-card flex flex-wrap items-start justify-between gap-6 p-8">
        <div>
          <div className="mono-label mb-2 text-zinc-500">Conversation</div>
          <h1 className="text-4xl font-light tracking-tight text-zinc-100">Chat</h1>
          <p className="mt-3 text-sm font-light text-zinc-500">
            Ask questions like “Where am I overspending?” or “Any unusual spikes?”
          </p>
        </div>
        <Link href="/dashboard" className="btn-ghost self-start">
          Back to dashboard
        </Link>
      </header>

      <ChatWindow />
    </div>
  );
}

