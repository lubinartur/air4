import { Page } from "../types";

const PAGE_TO_PATH: Record<Page, string> = {
  Overview: "/",
  Finance: "/finance",
  Health: "/health",
  Sport: "/sport",
  Projects: "/projects",
  Goals: "/goals",
  Patterns: "/patterns",
  Dilemmas: "/dilemmas",
  Memory: "/memory",
  Observer: "/observer",
  Profile: "/profile",
  Settings: "/settings",
  Chat: "/chat",
  CSVUpload: "/csv-upload",
  EmptyStates: "/empty-states",
  Toasts: "/toasts",
};

const PATH_TO_PAGE = new Map<string, Page>(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page as Page]),
);

/** Resolve a `Page` from the browser pathname (unknown paths → Overview). */
export function pageFromPath(pathname: string): Page {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname || "/";
  return PATH_TO_PAGE.get(normalized) ?? "Overview";
}

/** URL path for a given `Page`. */
export function pathFromPage(page: Page): string {
  return PAGE_TO_PATH[page] ?? "/";
}
