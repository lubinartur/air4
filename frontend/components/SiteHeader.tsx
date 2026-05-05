"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FACTS_UPDATED_EVENT,
  getFacts,
  getProfile,
  PROFILE_UPDATED_EVENT,
} from "@/lib/api";

function NavLink({
  href,
  children,
  uploadSection,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  /** Active on / and /upload (both entry points for CSV upload). */
  uploadSection?: boolean;
  /** Optional count badge (hidden when 0 or undefined). */
  badge?: number;
}) {
  const pathname = usePathname();
  const active = uploadSection
    ? pathname === "/" || pathname === "/upload"
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
        active
          ? "font-medium text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900"
      }`}
    >
      <span>{children}</span>
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

  return (
    <header className="border-b border-zinc-100 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <div className="font-semibold text-zinc-900">{brand}</div>
        <nav className="flex items-center gap-6">
          <NavLink href="/upload" uploadSection>
            Upload
          </NavLink>
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/events">Events</NavLink>
          <NavLink href="/facts" badge={factsCount}>
            Facts
          </NavLink>
          <NavLink href="/profile">Profile</NavLink>
        </nav>
      </div>
    </header>
  );
}
