"use client";

import { useEffect, useState } from "react";
import {
  getProfile,
  notifyProfileUpdated,
  updateProfile,
  type UserProfile,
} from "@/lib/api";

function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [profession, setProfession] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [goals, setGoals] = useState("");
  const [transport, setTransport] = useState("");
  const [about, setAbout] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      setLoading(true);
      try {
        const p: UserProfile = await getProfile();
        if (cancelled) return;
        setName(p.name ?? "");
        setCity(p.city ?? "");
        setProfession(p.profession ?? "");
        setMonthlyIncome(
          p.monthly_income != null ? String(p.monthly_income) : ""
        );
        setGoals(p.goals ?? "");
        setTransport(p.transport ?? "");
        setAbout(p.context ?? "");
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const incomeRaw = monthlyIncome.trim();
      let monthly_income: number | null = null;
      if (incomeRaw !== "") {
        const n = Number.parseFloat(incomeRaw.replace(",", "."));
        monthly_income = Number.isFinite(n) ? n : null;
      }
      await updateProfile({
        name: emptyToNull(name),
        city: emptyToNull(city),
        profession: emptyToNull(profession),
        monthly_income,
        goals: emptyToNull(goals),
        transport: emptyToNull(transport),
        context: emptyToNull(about),
      });
      setSaved(true);
      notifyProfileUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Profile
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Tell AIR4 about yourself — this context is used in chat and insights.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid gap-5 rounded-2xl border border-zinc-100 bg-white p-8 shadow-sm">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">City</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Tallinn"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Profession</span>
            <input
              type="text"
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
              placeholder="e.g. Web Designer"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">
              Monthly income
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
              placeholder="approximate, EUR"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Main goals</span>
            <textarea
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              rows={3}
              placeholder="e.g. pay off motorcycle loan, save for apartment"
              className={`${inputClass} resize-y`}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">Transport</span>
            <input
              type="text"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="e.g. BMW G15, Ducati Panigale V4, Bolt"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-zinc-700">About me</span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={4}
              placeholder="anything you want AIR4 to know about you"
              className={`${inputClass} resize-y`}
            />
          </label>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved ? (
              <p className="mt-3 text-center text-sm font-medium text-emerald-700">
                Saved ✓
              </p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
