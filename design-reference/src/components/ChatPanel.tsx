import { useState, useRef, useEffect, useMemo } from "react";
import { RefreshCw, Send } from "lucide-react";
import { Message, Page } from "../types";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import type { Observation } from "../lib/api";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";

interface ChatPanelProps {
  currentPage: Page;
  observation?: Observation | null;
  observationsRefreshing?: boolean;
  onRefreshObservations?: () => void;
  onMessageSent?: () => void;
  pendingMessage?: string | null;
  onPendingMessageConsumed?: () => void;
}

export function ChatPanel({
  currentPage,
  observation = null,
  observationsRefreshing = false,
  onRefreshObservations,
  onMessageSent,
  pendingMessage,
  onPendingMessageConsumed,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (!pendingMessage) return;
    setInput(pendingMessage);
    onPendingMessageConsumed?.();
  }, [pendingMessage, onPendingMessageConsumed]);

  const previewBubble = useMemo((): Message | null => {
    if (messages.length > 0) return null;
    const body = observation?.body?.trim();
    if (!body) return null;
    return { role: "assistant", content: body };
  }, [messages.length, observation?.body]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const text = input.trim();
    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatHistory: messages,
          currentPage,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? data.response ?? "" },
      ]);
      onMessageSent?.();
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "AIR4 offline. Connection failed." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderBubble = (msg: Message, key: string | number) => (
    <div
      key={key}
      className={cn("flex flex-col gap-1.5", msg.role === "user" ? "items-end" : "items-start")}
    >
      {msg.role === "assistant" && (
        <span className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider ml-1">
          AIR4
        </span>
      )}
      <div
        className={cn(
          "max-w-[90%] px-4 py-2.5 rounded-[12px] text-[14px] leading-relaxed shadow-sm transition-all",
          msg.role === "user"
            ? "bg-[#f3f4f6] text-[#374151]"
            : "bg-white border-l-[4px] border-l-indigo-600 text-[#111827]"
        )}
      >
        <div className="prose prose-sm prose-slate break-words">
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );

  return (
    <aside className="w-80 h-screen bg-chat border-l border-gray-100 shadow-[-10px_0_30px_rgba(0,0,0,0.02)] flex flex-col shrink-0">
      <header className="p-5 border-b border-gray-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-20" />
          </div>
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#9ca3af] truncate">
            AIR4 Advisor
          </span>
        </div>
        {onRefreshObservations && (
          <button
            type="button"
            onClick={onRefreshObservations}
            disabled={observationsRefreshing}
            className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] hover:text-indigo-600 disabled:opacity-40 transition-colors"
            title="Сгенерировать наблюдения"
          >
            <RefreshCw
              size={12}
              className={cn(observationsRefreshing && "animate-spin")}
            />
            Refresh
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
        {messages.map((msg, i) => renderBubble(msg, i))}
        {previewBubble && renderBubble(previewBubble, "preview")}
        {isLoading && (
          <div className="flex gap-1 px-1">
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" />
          </div>
        )}
      </div>

      <div className="p-5 bg-chat border-t border-gray-100">
        <div className="relative group">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Talk to AIR4..."
            className="w-full bg-white border border-gray-100 rounded-[24px] py-3 px-5 pr-12 text-sm focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 transition-all shadow-sm"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-4 top-2 text-gray-400 hover:text-accent disabled:opacity-30 transition-colors h-8 w-8 flex items-center justify-center rounded-full hover:bg-gray-50"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-center text-[#9ca3af] mt-4 uppercase tracking-[0.1em] font-bold">
          Speak truth. Help decide.
        </p>
      </div>
    </aside>
  );
}
