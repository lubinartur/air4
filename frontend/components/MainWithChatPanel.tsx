"use client";

import { usePathname } from "next/navigation";
import { ChatSidebar } from "@/components/ChatSidebar";

function showChatSidebarForPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/timeline") ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/hypotheses") ||
    pathname.startsWith("/dilemmas") ||
    pathname.startsWith("/interview") ||
    pathname.startsWith("/events") ||
    pathname.startsWith("/facts") ||
    pathname.startsWith("/profile")
  );
}

export function MainWithChatPanel({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const showSidebar = showChatSidebarForPath(pathname);

  if (!showSidebar) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-950">
        <div className="mx-auto w-full max-w-6xl flex-1 bg-zinc-950 px-6 py-8">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-zinc-950">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </div>
      <aside className="sticky top-0 flex h-[calc(100vh-56px)] w-[380px] shrink-0 flex-col self-start overflow-hidden border-l border-white/5 bg-zinc-950/30 backdrop-blur-3xl">
        <ChatSidebar />
      </aside>
    </div>
  );
}
