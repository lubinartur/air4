"use client";

import Link from "next/link";
import { ChatWindow } from "@/components/ChatWindow";

export default function ChatPage() {
  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Chat</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Ask questions like “Where am I overspending?” or “Any unusual spikes?”
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900"
        >
          Back to dashboard
        </Link>
      </div>

      <ChatWindow />
    </div>
  );
}

