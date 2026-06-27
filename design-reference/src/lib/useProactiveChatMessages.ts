import { useCallback, useEffect, useState } from "react";
import type { Message } from "../types";
import { fetchMorningBrief, fetchObserverNudge } from "./api";
import { CHAT_REFRESH_EVENT } from "./chatEvents";
import {
  appendAssistantIfNew,
  hasSeenBrief,
  hasShownNudge,
  markBriefSeen,
  markNudgeShown,
  minutesSinceLastUserMessage,
} from "./proactiveChat";

const NUDGE_POLL_MS = 15 * 60 * 1000;
const NUDGE_INACTIVITY_MINUTES = 30;

export function useProactiveChatMessages(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  enabled = true,
) {
  const [morningBriefText, setMorningBriefText] = useState<string | null>(null);

  const tryShowMorningBrief = useCallback(async () => {
    try {
      const data = await fetchMorningBrief();
      if (!data.has_brief || !data.message?.trim()) return;
      const text = data.message.trim();
      if (hasSeenBrief(text)) return;
      markBriefSeen(text);
      setMorningBriefText(text);
      setMessages((prev) => appendAssistantIfNew(prev, text));
    } catch {
      /* brief is optional */
    }
  }, [setMessages]);

  const tryShowObserverNudge = useCallback(async () => {
    if (minutesSinceLastUserMessage() < NUDGE_INACTIVITY_MINUTES) return;
    try {
      const data = await fetchObserverNudge();
      if (!data.has_nudge || !data.content.trim()) return;
      const text = data.content.trim();
      if (hasShownNudge(text)) return;
      markNudgeShown(text);
      setMessages((prev) => appendAssistantIfNew(prev, text));
    } catch {
      /* nudge is optional */
    }
  }, [setMessages]);

  useEffect(() => {
    if (!enabled) return;
    void tryShowMorningBrief();
    const onRefresh = () => {
      void tryShowMorningBrief();
    };
    window.addEventListener(CHAT_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(CHAT_REFRESH_EVENT, onRefresh);
  }, [tryShowMorningBrief, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void tryShowObserverNudge();
    const id = window.setInterval(() => {
      void tryShowObserverNudge();
    }, NUDGE_POLL_MS);
    return () => window.clearInterval(id);
  }, [tryShowObserverNudge, enabled]);

  return { morningBriefText };
}
