/** Value sent to the API for AIR4 system prompt (e.g. "User is on the upload page"). */
export function chatPageContext(pathname: string | null | undefined): string {
  const p = pathname || "/";
  if (p === "/" || p === "") return "overview";
  if (p.startsWith("/upload")) return "upload";
  if (p.startsWith("/dashboard")) return "dashboard";
  if (p.startsWith("/timeline")) return "timeline";
  if (p.startsWith("/projects")) return "projects";
  if (p.startsWith("/hypotheses")) return "hypotheses";
  if (p.startsWith("/dilemmas")) return "dilemmas";
  if (p.startsWith("/interview")) return "interview";
  if (p.startsWith("/events")) return "events";
  if (p.startsWith("/facts")) return "facts";
  if (p.startsWith("/profile")) return "profile";
  if (p.startsWith("/chat")) return "chat";
  return "other";
}

/** Subtitle shown under "AIR4" in the chat sidebar header. */
export function sidebarSubtitle(pathname: string | null | undefined): string {
  const p = pathname || "/";
  if (p === "/" || p === "") return "Обзор";
  if (p.startsWith("/upload")) return "Готов к анализу";
  if (p.startsWith("/dashboard")) return "Анализ твоих трат";
  if (p.startsWith("/timeline")) return "Траты по времени";
  if (p.startsWith("/projects")) return "Твои активные проекты";
  if (p.startsWith("/hypotheses")) return "Паттерны AIR4";
  if (p.startsWith("/dilemmas")) return "Разбор решений";
  if (p.startsWith("/interview")) return "Узнаём тебя лучше";
  if (p.startsWith("/events")) return "Твои события";
  if (p.startsWith("/facts")) return "Что AIR4 знает о тебе";
  if (p.startsWith("/profile")) return "Твой профиль";
  if (p.startsWith("/chat")) return "Полный диалог";
  return "AIR4";
}
