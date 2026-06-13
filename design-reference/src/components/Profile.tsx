import { useEffect, useState } from "react";
import { Sparkles, User } from "lucide-react";
import { fetchProfile, formatEuro, type ProfileBundle } from "../lib/api";
import { formatConfidencePercent, formatFactKey } from "../lib/format";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const empty = value == null || value === "";
  return (
    <div className="flex justify-between items-baseline gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-[11px] font-black text-[#94a3b8] uppercase shrink-0">{label}</span>
      {empty ? (
        <span className="text-[13px] font-medium text-[#f97316] text-right">Расскажите AIR4 в чате</span>
      ) : (
        <span className="text-[14px] font-bold text-[#f1f5f9] text-right">{value}</span>
      )}
    </div>
  );
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, confidence)) * 5);
  return (
    <div className="flex items-center gap-2 shrink-0" title={formatConfidencePercent(confidence)}>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              i < filled ? "bg-[#f97316]" : "bg-white/10"
            )}
          />
        ))}
      </div>
      <span className="text-[10px] font-mono font-bold text-[#94a3b8]">
        {formatConfidencePercent(confidence)}
      </span>
    </div>
  );
}

export function Profile() {
  const [data, setData] = useState<ProfileBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const bundle = await fetchProfile();
        if (!cancelled) setData(bundle);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить профиль");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-[#f97316]/15 text-[#f97316] rounded-xl">
          <User size={22} className="fill-[#f97316]/20" />
        </div>
        <div>
          <h1 className={t.pageTitle}>
            Ваш профиль
          </h1>
          <p className={cn(t.pageSub, "mt-0.5")}>
            Кто вы и что знает о вас AIR4
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-[#f97316]/15 border border-[#f97316]/30 px-3.5 py-1.5 rounded-xl">
        <Sparkles size={14} className="text-[#f97316]" />
        <span className="text-xs font-bold text-[#f97316]">Личность</span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-[#94a3b8]">Загрузка…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-red-500">{error ?? "Не удалось загрузить профиль"}</p>
      </div>
    );
  }

  const { profile, facts, stats } = data;
  const showIncome =
    profile.monthly_income != null && profile.monthly_income > 0;

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <ProfileField label="Имя" value={profile.name} />
          <ProfileField label="Город" value={profile.city} />
          <ProfileField label="Профессия" value={profile.profession} />
          {showIncome && (
            <ProfileField
              label="Доход"
              value={formatEuro(profile.monthly_income!)}
            />
          )}
          {profile.goals.length > 0 && (
            <div className="pt-4 mt-2 border-t border-white/5">
              <p className="text-[11px] font-black text-[#94a3b8] uppercase mb-2">Цели</p>
              <ul className="space-y-1">
                {profile.goals.map((g) => (
                  <li key={g} className="text-[14px] font-medium text-[#f1f5f9]">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.context && (
            <p className="text-[13px] text-[#94a3b8] mt-4 leading-relaxed">{profile.context}</p>
          )}
        </div>

        <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
            Статистика
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white/5 rounded-2xl">
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase mb-1">Транзакции</p>
              <p className="font-mono text-2xl font-black text-[#f1f5f9]">
                {stats.total_transactions}
              </p>
              <p className="text-[11px] text-[#94a3b8] mt-1">загружено</p>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl">
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase mb-1">События</p>
              <p className="font-mono text-2xl font-black text-[#f1f5f9]">{stats.total_events}</p>
              <p className="text-[11px] text-[#94a3b8] mt-1">записано</p>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl">
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase mb-1">Факты</p>
              <p className="font-mono text-2xl font-black text-[#f1f5f9]">{stats.facts_count}</p>
              <p className="text-[11px] text-[#94a3b8] mt-1">известно</p>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl">
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase mb-1">С нами с</p>
              <p className="font-mono text-lg font-black text-[#f1f5f9]">
                {stats.member_since ?? "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-lg font-extrabold text-[#f1f5f9] mb-6">
          Что AIR4 знает о вас
        </h2>
        {facts.length === 0 ? (
          <p className="text-[14px] text-[#94a3b8] text-center py-8">
            Продолжайте общаться — AIR4 запомнит.
          </p>
        ) : (
          <div className="space-y-4">
            {facts.map((fact) => (
              <div
                key={fact.key}
                className="p-4 rounded-2xl border border-white/5 bg-white/5"
              >
                <div className="flex justify-between items-start gap-4 mb-2">
                  <h3 className="text-[14px] font-bold text-[#f1f5f9]">
                    {formatFactKey(fact.key)}
                  </h3>
                  <ConfidenceDots confidence={fact.confidence} />
                </div>
                <p className="text-[14px] text-[#cbd5e1] leading-relaxed">{fact.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
