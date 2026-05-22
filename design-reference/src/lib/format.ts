export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 999;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const t = Date.parse(normalized);
  if (Number.isNaN(t)) return 999;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function formatRelativeActivity(updatedAt?: string | null): string {
  if (!updatedAt) return "no recent activity";
  const days = daysSince(updatedAt);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** "2 minutes ago" / "2 hours ago" / "yesterday" / "3 days ago" */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function formatProjectStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export function formatWorkoutType(type?: string | null): string {
  if (!type) return "Workout";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** snake_case fact key → readable label */
export function formatFactKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatConfidencePercent(confidence: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  return `${pct}%`;
}

export function domainIcon(domain: string): string {
  switch (domain) {
    case "health":
      return "💪";
    case "finance":
      return "💰";
    case "projects":
      return "🚀";
    case "life":
      return "⭐";
    case "personal":
      return "👤";
    default:
      return "📌";
  }
}

export function formatDomainLabel(domain: string): string {
  return domain.replace(/_/g, " ");
}
