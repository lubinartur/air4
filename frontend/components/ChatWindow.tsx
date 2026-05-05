"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { chat, type ChatMessage, type UserFact } from "@/lib/api";
import { chatPageContext } from "@/lib/pageContext";

type ChatLine =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      /** Set when backend saved a life event from this reply */
      rememberedTitle?: string | null;
      /** Facts learned from the user message for this turn */
      learnedFacts?: UserFact[];
    };

export function ChatWindow() {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pageCtx = chatPageContext(pathname);
  const history = useMemo((): ChatMessage[] => {
    return messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [messages]);

  async function onSend() {
    const msg = text.trim();
    if (!msg || busy) return;

    setText("");
    setBusy(true);
    const next: ChatLine[] = [...messages, { role: "user", content: msg }];
    setMessages(next);

    try {
      const res = await chat(msg, history, { currentPage: pageCtx });
      const learned =
        res.facts_saved && res.facts_saved.length > 0
          ? res.facts_saved
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.response,
          rememberedTitle: res.event_saved?.title ?? null,
          learnedFacts: learned,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            e instanceof Error
              ? `Error: ${e.message}`
              : "Error: failed to contact backend",
          rememberedTitle: null,
          learnedFacts: undefined,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-6 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          Ask about your spending
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          The assistant automatically uses your current spending summary as context.
        </p>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="text-sm text-zinc-500">
            Try: “What was my biggest category?” or “Any obvious subscriptions?”
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div
                  key={idx}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2.5 text-sm font-medium leading-6 text-white"
                >
                  {m.content}
                </div>
              ) : (
                <div key={idx} className="mr-auto max-w-[85%]">
                  <div className="rounded-2xl rounded-bl-sm border border-zinc-100 bg-zinc-50 px-4 py-2.5 text-sm leading-6 text-zinc-900">
                    {m.content}
                  </div>
                  {m.rememberedTitle ? (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      ✓ Remembered: {m.rememberedTitle}
                    </div>
                  ) : null}
                  {m.learnedFacts?.map((fact) => (
                    <div
                      key={fact.id}
                      className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
                    >
                      ✓ Learned: {fact.value}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-100 px-6 py-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSend();
          }}
          placeholder="Type your question…"
          className="min-h-[40px] flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-zinc-300 focus:bg-white focus:outline-none focus:ring-0"
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={busy || text.trim().length === 0}
          className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
