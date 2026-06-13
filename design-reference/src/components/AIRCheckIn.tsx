import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles } from "lucide-react";
import { fetchInterviewQuestion, submitInterviewAnswer } from "../lib/api";

type Status = "loading" | "ready" | "skip";

type Props = {
  /** Called when user picks "Tell in chat" — parent typically prefills the chat input. */
  onTellInChat?: (question: string) => void;
  /** Fires for any answer (after the API call attempt). */
  onAnswered?: (question: string, answer: string) => void;
};

const OPTIONS = ["Да", "Нет", "Рассказать в чате"] as const;

export function AIRCheckIn({ onTellInChat, onAnswered }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [question, setQuestion] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchInterviewQuestion()
      .then((res) => {
        if (cancelled) return;
        if (res.has_question && res.question) {
          setQuestion(res.question);
          setDomain(res.domain ?? null);
          setStatus("ready");
        } else {
          setStatus("skip");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("skip");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handle = (opt: string) => {
    if (!question || answer) return;
    setAnswer(opt);

    if (opt === "Рассказать в чате") {
      onTellInChat?.(question);
    } else {
      void submitInterviewAnswer(question, opt).catch(() => {
        // swallow — user gets visual confirmation either way
      });
    }
    onAnswered?.(question, opt);
    window.setTimeout(() => setHidden(true), 1600);
  };

  // No question available (cooldown / error) — don't render anything.
  if (status !== "ready" || !question) {
    return null;
  }

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="bg-[#f97316] rounded-[20px] p-6 shadow-xl"
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white">
              <Sparkles size={16} />
            </div>

            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">
                    AIR4 спрашивает
                  </p>
                  {domain && (
                    <span className="text-[9px] font-black text-white/90 bg-white/15 border border-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {domain}
                    </span>
                  )}
                </div>
                <p className="text-[16px] font-bold text-white mt-1 leading-snug">
                  {answer ? `Принято: ${answer}` : question}
                </p>
              </div>

              {!answer && (
                <div className="flex flex-wrap gap-2">
                  {OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handle(opt)}
                      className="text-[11px] font-black bg-white/20 hover:bg-white/30 text-white border border-white/30 px-3.5 py-1.5 rounded-xl uppercase tracking-wider transition-all"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
