/** Value sent to the API for AIR4 system prompt (e.g. "User is on the upload page"). */
export function chatPageContext(pathname: string | null | undefined): string {
  const p = pathname || "/";
  if (p === "/" || p === "") return "overview";
  if (p.startsWith("/upload")) return "upload";
  if (p.startsWith("/dashboard")) return "dashboard";
  if (p.startsWith("/timeline")) return "timeline";
  if (p.startsWith("/projects")) return "projects";
  if (p.startsWith("/events")) return "events";
  if (p.startsWith("/facts")) return "facts";
  if (p.startsWith("/profile")) return "profile";
  if (p.startsWith("/chat")) return "chat";
  return "other";
}

/** Subtitle shown under "AIR4" in the chat sidebar header. */
export function sidebarSubtitle(pathname: string | null | undefined): string {
  const p = pathname || "/";
  if (p === "/" || p === "") return "Overview";
  if (p.startsWith("/upload")) return "Ready to analyze";
  if (p.startsWith("/dashboard")) return "Analyzing your spending";
  if (p.startsWith("/timeline")) return "Spending over time";
  if (p.startsWith("/projects")) return "Your active projects";
  if (p.startsWith("/events")) return "Your life events";
  if (p.startsWith("/facts")) return "What AIR4 knows about you";
  if (p.startsWith("/profile")) return "Your profile";
  if (p.startsWith("/chat")) return "Full conversation";
  return "AIR4 assistant";
}
