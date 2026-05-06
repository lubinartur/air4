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
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/20 focus:ring-0";

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
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить профиль"
          );
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
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-8">
        <div className="mono-label mb-2 text-zinc-500">Профиль</div>
        <h1 className="text-4xl font-light tracking-tight text-zinc-100">
          Профиль
        </h1>
        <p className="mt-3 text-sm font-light text-zinc-500">
          Расскажи AIR4 о себе — это используется в чате и инсайтах.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-zinc-500">Загружаю…</p>
      ) : (
        <div className="glass-card grid gap-5 p-8">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Имя
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Город
            </span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="например: Tallinn"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Профессия
            </span>
            <input
              type="text"
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
              placeholder="например: дизайнер"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Месячный доход
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
              placeholder="примерно, EUR"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Главные цели
            </span>
            <textarea
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              rows={3}
              placeholder="например: закрыть кредит, накопить на квартиру"
              className={`${inputClass} resize-y`}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Транспорт
            </span>
            <input
              type="text"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="e.g. BMW G15, Ducati Panigale V4, Bolt"
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              О себе
            </span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={4}
              placeholder="всё, что ты хочешь, чтобы AIR4 знал"
              className={`${inputClass} resize-y`}
            />
          </label>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="btn-primary w-full disabled:opacity-60"
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            {saved ? (
              <p className="mt-3 text-center text-sm font-medium text-emerald-400">
                Сохранено ✓
              </p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
