import { useState, useRef, useEffect } from "react";
import { Send, ArrowLeft, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import { loadChatHistory, saveChatHistory } from "../lib/chatStorage";
import type { Message } from "../types";

interface FullscreenChatProps {
  onBack: () => void;
}

export function FullscreenChat({ onBack }: FullscreenChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, chatHistory: messages }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? data.response ?? "" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "AIR4 offline. Connection failed." },
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f5f7] overflow-hidden">
      <header className="px-8 py-6 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <MessageSquare size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none uppercase">
              AIR4
            </h1>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-1">
              Master Agent
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 border-[1.5px] border-[#6366f1] text-[#6366f1] px-5 py-2.5 rounded-[10px] font-bold text-[13px] uppercase tracking-wider hover:bg-indigo-50 transition-all shadow-sm bg-white"
        >
          <ArrowLeft size={16} />
          Back to Overview
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="w-[30%] border-r border-gray-100 bg-white/50 p-8 overflow-y-auto">
          <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-4">
              Context
            </h2>
            <p className="text-[13px] text-gray-500 leading-relaxed">
              Context from your data loads automatically when you chat from the sidebar on
              Overview.
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 py-10 space-y-10">
            {messages.length === 0 ? (
              <p className="text-[14px] text-[#9ca3af] text-center mt-20">
                No messages yet. Start a conversation with AIR4.
              </p>
            ) : (
              messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex flex-col gap-2 max-w-[80%]",
                    msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  {msg.role === "assistant" && (
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em]">
                      AIR4
                    </span>
                  )}
                  <div
                    className={cn(
                      "px-6 py-4 rounded-[12px] text-[15px] leading-relaxed shadow-sm",
                      msg.role === "user"
                        ? "bg-[#f3f4f6] text-[#374151]"
                        : "bg-white border-l-[4px] border-l-indigo-600 text-[#111827]"
                    )}
                  >
                    <div className="prose prose-slate max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          <div className="px-12 py-8 bg-white border-t border-gray-100">
            <div className="relative group max-w-4xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSend();
                }}
                placeholder="Talk to AIR4..."
                className="w-full bg-gray-50 border-2 border-transparent rounded-full py-4 px-8 pr-16 text-[16px] focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-8 focus:ring-indigo-600/5 transition-all shadow-inner"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                className="absolute right-3 top-2 bottom-2 aspect-square rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 transition-all shadow-md shadow-indigo-500/20"
              >
                <Send size={20} className="ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
