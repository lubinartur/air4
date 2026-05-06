"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FACTS_UPDATED_EVENT,
  getFacts,
  getProfile,
  PROFILE_UPDATED_EVENT,
} from "@/lib/api";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 text-sm transition-colors ${
        active
          ? "font-medium text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900"
      }`}
    >
      {children}
    </Link>
  );
}

function SoonBadge() {
  return (
    <span className="rounded bg-zinc-100 px-1.5 text-xs font-medium text-zinc-400">
      Soon
    </span>
  );
}

function DropdownItem({
  href,
  label,
  badge,
  onSelect,
}: {
  href: string;
  label: string;
  badge?: number;
  onSelect: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onSelect}
      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
        active ? "bg-zinc-50 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <span className={active ? "font-medium" : undefined}>{label}</span>
      {badge != null && badge > 0 ? (
        <span className="rounded bg-zinc-900 px-1.5 text-xs font-medium text-white tabular-nums">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function SiteHeader() {
  const [brand, setBrand] = useState("AIR4");
  const [factsCount, setFactsCount] = useState(0);
  const pathname = usePathname();
  const [open, setOpen] = useState<null | "finance" | "projects" | "life">(null);
  const financeRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const lifeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const p = await getProfile();
        const n = p.name?.trim();
        setBrand(n ? `AIR4 — ${n}` : "AIR4");
      } catch {
        setBrand("AIR4");
      }
    }
    void load();
    const onUpdate = () => void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    async function loadFactsCount() {
      try {
        const facts = await getFacts();
        setFactsCount(facts.length);
      } catch {
        setFactsCount(0);
      }
    }
    void loadFactsCount();
    const onFacts = () => void loadFactsCount();
    window.addEventListener(FACTS_UPDATED_EVENT, onFacts);
    return () => window.removeEventListener(FACTS_UPDATED_EVENT, onFacts);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (financeRef.current?.contains(t)) return;
      if (projectsRef.current?.contains(t)) return;
      if (lifeRef.current?.contains(t)) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  const financeActive =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/timeline") ||
    pathname.startsWith("/upload");
  const projectsActive = pathname.startsWith("/projects");
  const lifeActive = pathname.startsWith("/events") || pathname.startsWith("/facts");

  return (
    <header className="border-b border-zinc-100 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <div className="font-semibold text-zinc-900">{brand}</div>
        <nav className="flex items-center gap-6">
          <NavLink href="/">Overview</NavLink>

          <div className="relative" ref={financeRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => (v === "finance" ? null : "finance"))}
              className={`inline-flex items-center gap-2 text-sm transition-colors ${
                financeActive
                  ? "font-medium text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
              aria-expanded={open === "finance"}
            >
              <span>Finance</span>
              <span className="text-xs text-zinc-400">▾</span>
            </button>
            {open === "finance" ? (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-zinc-100 bg-white p-2 shadow-lg">
                <DropdownItem
                  href="/dashboard"
                  label="Dashboard"
                  onSelect={() => setOpen(null)}
                />
                <DropdownItem
                  href="/timeline"
                  label="Timeline"
                  onSelect={() => setOpen(null)}
                />
                <DropdownItem
                  href="/upload"
                  label="Upload"
                  onSelect={() => setOpen(null)}
                />
              </div>
            ) : null}
          </div>

          <div
            className="inline-flex items-center gap-2 text-sm text-zinc-300"
            title="Coming soon"
          >
            <span className="cursor-not-allowed">Health</span>
            <SoonBadge />
          </div>

          <div className="relative" ref={projectsRef}>
            <button
              type="button"
              onClick={() =>
                setOpen((v) => (v === "projects" ? null : "projects"))
              }
              className={`inline-flex items-center gap-2 text-sm transition-colors ${
                projectsActive
                  ? "font-medium text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
              aria-expanded={open === "projects"}
            >
              <span>Projects</span>
              <span className="text-xs text-zinc-400">▾</span>
            </button>
            {open === "projects" ? (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-zinc-100 bg-white p-2 shadow-lg">
                <DropdownItem
                  href="/projects"
                  label="All Projects"
                  onSelect={() => setOpen(null)}
                />
              </div>
            ) : null}
          </div>

          <div className="relative" ref={lifeRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => (v === "life" ? null : "life"))}
              className={`inline-flex items-center gap-2 text-sm transition-colors ${
                lifeActive
                  ? "font-medium text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
              aria-expanded={open === "life"}
            >
              <span>Life</span>
              <span className="text-xs text-zinc-400">▾</span>
            </button>
            {open === "life" ? (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-zinc-100 bg-white p-2 shadow-lg">
                <DropdownItem
                  href="/events"
                  label="Events"
                  onSelect={() => setOpen(null)}
                />
                <DropdownItem
                  href="/facts"
                  label="Facts"
                  badge={factsCount}
                  onSelect={() => setOpen(null)}
                />
              </div>
            ) : null}
          </div>

          <NavLink href="/profile">Profile</NavLink>
        </nav>
      </div>
    </header>
  );
}
