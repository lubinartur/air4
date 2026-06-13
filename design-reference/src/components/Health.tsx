import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CalendarDays,
  ChevronRight,
  FileUp,
  Heart,
  Info,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/typography";
import {
  fetchHealthCheckups,
  fetchMarkerHistory,
  type HealthCheckupGroup,
  type HealthMarker,
  type HealthMarkerHistory,
} from "../lib/api";
import { MarkerTrendChart, MarkerTrendLegend } from "./MarkerTrendChart";

type MarkerStatus = "HIGH" | "LOW" | "NORMAL";

interface BloodMarker {
  name: string;
  value: number;
  unit: string;
  status: MarkerStatus;
  range: string;
  minNormal: number | null;
  maxNormal: number | null;
  info: string;
}

interface MarkerCategory {
  category: string;
  desc: string;
  color: string;
  markers: BloodMarker[];
}

type CategoryDef = {
  category: string;
  desc: string;
  color: string;
  keywords: string[];
};

const CATEGORY_DEFINITIONS: CategoryDef[] = [
  {
    category: "ОАК (Общий анализ крови)",
    desc: "Оценивает доставку кислорода, гематологический статус и базовый уровень иммунитета.",
    color: "rose",
    keywords: [
      "hemoglobin",
      "hematocrit",
      "rbc",
      "wbc",
      "platelets",
      "neutrophils",
      "lymphocytes",
      "eosinophils",
      "basophils",
      "monocytes",
    ],
  },
  {
    category: "Биохимия",
    desc: "Показатели работы почек, печени и общего клеточного здоровья.",
    color: "amber",
    keywords: ["creatinine", "egfr", "crp", "alt", "ast", "ggt"],
  },
  {
    category: "Липиды",
    desc: "Соотношение липопротеинов — базовый профиль сердечно-сосудистого риска.",
    color: "orange",
    keywords: ["hdl", "ldl", "cholesterol", "triglycerides"],
  },
  {
    category: "Гормоны",
    desc: "Эндокринные сигналы, управляющие метаболизмом, синтезом тканей и восстановлением.",
    color: "violet",
    keywords: ["testosterone", "estradiol", "shbg", "fsh", "lh", "cortisol"],
  },
];

const OTHER_CATEGORY: Pick<MarkerCategory, "category" | "desc" | "color"> = {
  category: "Прочее",
  desc: "Маркеры, пока не отнесённые к категории — смотрите по отдельности.",
  color: "gray",
};

const CATEGORY_DOT: Record<string, string> = {
  rose: "bg-red-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  violet: "bg-[#f97316]",
  gray: "bg-gray-400",
};

const MARKER_INFO: Record<string, string> = {
  hemoglobin:
    "Повышенный гемоглобин может отражать тренировочный стресс, обезвоживание или гормональное давление на эритропоэз.",
  hematocrit:
    "Высокий гематокрит повышает вязкость крови. Важна строгая гидратация; при стойком повышении — рассмотрите донорство.",
  rbc: "Общий счёт эритроцитов. Обеспечивает доставку кислорода и восстановление.",
  wbc: "Базовый уровень лейкоцитов — стабильные значения говорят об отсутствии активной инфекции.",
  platelets:
    "Тромбоциты в норме обеспечивают здоровое свёртывание и восстановление сосудов.",
  neutrophils:
    "Клетки острого иммунного ответа. Стабильные значения — нет бактериальной инфекции.",
  lymphocytes:
    "Адаптивный иммунитет — отражает хроническое иммунное состояние и вирусную нагрузку.",
  eosinophils:
    "Реакция на аллергены и паразитов. Умеренное повышение может говорить об аллергии.",
  creatinine:
    "Мышечный метаболит; отражает мышечную массу и фильтрационную способность почек.",
  egfr:
    "Расчётная скорость клубочковой фильтрации — значения ниже 90 говорят о сниженной работе почек.",
  crp: "С-реактивный белок — маркер системного воспаления. Низкий = хорошо.",
  alt: "АЛТ — основной печёночный фермент. Норма = нет острого стресса печени.",
  ast: "АСТ — фермент печени и мышц. В паре с АЛТ даёт картину состояния печени.",
  ggt: "ГГТ — чувствителен к холестатическому стрессу печени, алкоголю и лекарствам.",
  hdl:
    "Кардиопротективный «хороший» холестерин. Часто снижен при высоких андрогенах или малой аэробной нагрузке.",
  ldl: "Липопротеины низкой плотности — главный атерогенный переносчик; цель зависит от сердечно-сосудистого риска.",
  cholesterol:
    "Общий холестерин — интерпретируйте вместе с HDL/LDL и триглицеридами.",
  triglycerides:
    "Энергетический резерв в виде липидов. Высокие триглицериды отражают нагрузку быстрыми углеводами и давление инсулина.",
  testosterone:
    "Главный андроген — супрафизиологические значения ускоряют синтез мышц, но повышают уровень эстрогенов через ароматазу.",
  estradiol:
    "Эстроген, образованный из тестостерона. Повышенный E2 может вызывать задержку воды и эмоциональные колебания.",
  shbg:
    "Глобулин, связывающий половые гормоны — низкий SHBG увеличивает свободную, биодоступную фракцию андрогенов и эстрогенов.",
  fsh:
    "Фолликулостимулирующий гормон — сигнал гипофиза к гонадам. Подавление FSH часто говорит об использовании внешних андрогенов.",
  lh:
    "Лютеинизирующий гормон — сигнал гипофиза, запускающий выработку собственного тестостерона.",
  cortisol:
    "Главный гормон стресса. Хронически повышенный кортизол разрушает мышцы, сон и иммунитет.",
};

const MARKER_INTERVENTION: Record<string, string> = {
  hdl: "Сделайте упор на zone-2 кардио, чтобы поднять HDL. Включите чистые источники омега-3 из морской рыбы.",
  hemoglobin:
    "Высокая активность эритроцитов коррелирует с нагрузкой на сердце. Поднимите потребление воды до 4 л/день.",
  hematocrit:
    "Высокая активность эритроцитов коррелирует с нагрузкой на сердце. Поднимите потребление воды до 4 л/день.",
  egfr:
    "Сразу увеличьте приём жидкости. Пересмотрите протокол креатина (снизьте до поддерживающих 3 г или сделайте паузу).",
  testosterone:
    "Высокая ароматизация в эстрогены. Следите за задержкой воды. Рассмотрите стратегии смягчения цикла или снижения ароматизации.",
  estradiol:
    "Высокая ароматизация в эстрогены. Следите за задержкой воды. Рассмотрите стратегии смягчения цикла или снижения ароматизации.",
  shbg:
    "Низкий SHBG усиливает фракцию свободных гормонов. Пересдайте анализы в конце цикла, чтобы исключить эндогенное подавление.",
};

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function formatRange(
  min: number | null,
  max: number | null,
  unit: string | null
): string {
  const u = unit ? ` ${unit}` : "";
  if (min != null && max != null) {
    return `${formatNumber(min)} - ${formatNumber(max)}${u}`;
  }
  if (min != null) return `> ${formatNumber(min)}${u}`;
  if (max != null) return `< ${formatNumber(max)}${u}`;
  return "—";
}

function normalizeStatus(raw: string): MarkerStatus {
  const s = (raw || "").toUpperCase();
  if (s === "HIGH" || s === "LOW") return s;
  return "NORMAL";
}

function findCategoryDef(markerName: string): CategoryDef | null {
  const lower = markerName.toLowerCase().trim();
  for (const def of CATEGORY_DEFINITIONS) {
    if (def.keywords.some((kw) => lower.startsWith(kw))) return def;
  }
  return null;
}

function lookupBy(markerName: string, dict: Record<string, string>): string | null {
  const lower = markerName.toLowerCase().trim();
  for (const key of Object.keys(dict)) {
    if (lower.startsWith(key)) return dict[key];
  }
  return null;
}

function toBloodMarker(api: HealthMarker): BloodMarker {
  const status = normalizeStatus(api.status);
  return {
    name: api.marker_name,
    value: api.value,
    unit: api.unit ?? "",
    status,
    range: formatRange(api.reference_min, api.reference_max, api.unit),
    minNormal: api.reference_min,
    maxNormal: api.reference_max,
    info:
      lookupBy(api.marker_name, MARKER_INFO) ??
      "Данные с вашего анализа крови. Интерпретацию обсудите с врачом.",
  };
}

function groupMarkersByCategory(markers: HealthMarker[]): MarkerCategory[] {
  const bucketByCategory = new Map<string, BloodMarker[]>();

  for (const m of markers) {
    const def = findCategoryDef(m.marker_name);
    const key = def?.category ?? OTHER_CATEGORY.category;
    if (!bucketByCategory.has(key)) bucketByCategory.set(key, []);
    bucketByCategory.get(key)!.push(toBloodMarker(m));
  }

  const ordered: MarkerCategory[] = [];
  for (const def of CATEGORY_DEFINITIONS) {
    const items = bucketByCategory.get(def.category);
    if (!items?.length) continue;
    ordered.push({
      category: def.category,
      desc: def.desc,
      color: def.color,
      markers: items,
    });
  }
  const otherItems = bucketByCategory.get(OTHER_CATEGORY.category);
  if (otherItems?.length) {
    ordered.push({ ...OTHER_CATEGORY, markers: otherItems });
  }
  return ordered;
}

function interventionFor(marker: BloodMarker): string {
  if (marker.status === "NORMAL") {
    return "Маркер в безопасных пределах. Сохраняйте текущий режим.";
  }
  return (
    lookupBy(marker.name, MARKER_INTERVENTION) ??
    "Вне референсного диапазона — обсудите с врачом и пересдайте через 4–8 недель."
  );
}

export function Health() {
  const [checkups, setCheckups] = useState<HealthCheckupGroup[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OUT_OF_RANGE" | "NORMAL">("ALL");
  const [selectedMarker, setSelectedMarker] = useState<BloodMarker | null>(null);
  const [detailTab, setDetailTab] = useState<"value" | "trend">("value");
  const [markerHistory, setMarkerHistory] = useState<HealthMarkerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Hidden file input for importing lab-report PDFs. The button in the
  // page header just opens the native picker; actual import processing is
  // handled elsewhere (backend pipeline), so this only wires the open.
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchHealthCheckups();
        if (cancelled) return;
        setCheckups(data);
        if (data.length > 0) setSelectedDate(data[0].date);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить чек-апы");
          setCheckups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedMarker(null);
  }, [selectedDate]);

  // Reset to the "value" tab whenever the user opens a new marker —
  // landing on a stale "trend" view from a previous marker would be
  // confusing on the brief flash before the new history loads.
  useEffect(() => {
    setDetailTab("value");
    setMarkerHistory(null);
    setHistoryError(null);
  }, [selectedMarker?.name]);

  // Lazy-load history only when the user actually switches to the
  // trend tab. Cached per-marker via `markerHistory` so toggling
  // back and forth doesn't re-fetch.
  useEffect(() => {
    if (detailTab !== "trend" || !selectedMarker) return;
    if (markerHistory?.marker_name?.toLowerCase() === selectedMarker.name.toLowerCase()) {
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void fetchMarkerHistory(selectedMarker.name)
      .then((data) => {
        if (cancelled) return;
        setMarkerHistory(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setHistoryError(
          e instanceof Error ? e.message : "Не удалось загрузить историю"
        );
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailTab, selectedMarker, markerHistory]);

  const activeGroup = useMemo(
    () =>
      selectedDate
        ? checkups.find((c) => c.date === selectedDate) ?? null
        : null,
    [checkups, selectedDate]
  );

  const categoryGroups = useMemo(
    () => (activeGroup ? groupMarkersByCategory(activeGroup.markers) : []),
    [activeGroup]
  );

  const totalOutCount = useMemo(
    () =>
      categoryGroups
        .flatMap((c) => c.markers)
        .filter((m) => m.status !== "NORMAL").length,
    [categoryGroups]
  );
  const totalNormalCount = useMemo(
    () =>
      categoryGroups
        .flatMap((c) => c.markers)
        .filter((m) => m.status === "NORMAL").length,
    [categoryGroups]
  );

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return categoryGroups
      .map((cat) => {
        const markers = cat.markers.filter((m) => {
          const matchesSearch =
            !q ||
            m.name.toLowerCase().includes(q) ||
            cat.category.toLowerCase().includes(q);
          const matchesStatus =
            statusFilter === "ALL" ||
            (statusFilter === "OUT_OF_RANGE" && m.status !== "NORMAL") ||
            (statusFilter === "NORMAL" && m.status === "NORMAL");
          return matchesSearch && matchesStatus;
        });
        return { ...cat, markers };
      })
      .filter((cat) => cat.markers.length > 0);
  }, [categoryGroups, searchQuery, statusFilter]);

  // Hero/banner numbers for the right-hand summary
  const testo = activeGroup?.markers.find((m) =>
    m.marker_name.toLowerCase().startsWith("testosterone")
  );
  const e2 = activeGroup?.markers.find((m) =>
    m.marker_name.toLowerCase().startsWith("estradiol")
  );
  const shbg = activeGroup?.markers.find((m) =>
    m.marker_name.toLowerCase().startsWith("shbg")
  );

  return (
    <div className="flex flex-col gap-6 pb-12 select-none font-sans">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in-up animate-delay-1">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] rounded-xl">
              <Heart size={22} />
            </div>
            <div>
              <h1 className={t.pageTitle}>
                Аналитика здоровья и анализы
              </h1>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Биомаркеры, клинические отчёты и обзоры лабораторных исследований
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={importInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-2 bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] px-4 py-2 rounded-[10px] font-bold text-[12px] hover:bg-[#f97316]/25 transition-all uppercase tracking-wider"
          >
            <FileUp size={14} />
            Импорт анализов
          </button>
        </div>
      </div>

      {/* Date selector */}
      {checkups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest pr-1">
            <CalendarDays size={12} />
            Дата анализа
          </div>
          {checkups.map((c) => {
            const active = c.date === selectedDate;
            return (
              <button
                key={c.date}
                type="button"
                onClick={() => setSelectedDate(c.date)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors inline-flex items-center gap-2",
                  active
                    ? "bg-[#f97316] text-white shadow-md shadow-[#f97316]/20"
                    : "bg-[#13131f] text-[#94a3b8] border border-white/5 hover:text-[#f1f5f9] hover:border-white/5"
                )}
              >
                <span className="font-mono">{c.date}</span>
                <span
                  className={cn(
                    "text-[9px] font-mono",
                    active ? "text-white/80" : "text-[#94a3b8]"
                  )}
                >
                  {c.markers.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading / empty / error */}
      {loading && (
        <div className="bg-[#13131f] p-6 rounded-[20px] shadow-sm border border-white/5 card-hover">
          <p className="text-[14px] text-[#94a3b8]">Загрузка данных…</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-[#13131f] p-6 rounded-[20px] shadow-sm border border-red-100 card-hover">
          <p className="text-[13px] text-red-500">{error}</p>
        </div>
      )}

      {!loading && !error && checkups.length === 0 && (
        <div className="bg-[#13131f] p-12 rounded-[20px] shadow-sm border border-white/5 text-center flex flex-col items-center justify-center gap-2 card-hover">
          <Info size={36} className="text-[#64748b]" />
          <p className="text-sm font-bold text-[#f1f5f9]">Данных анализов пока нет</p>
          <p className="text-xs text-[#94a3b8] max-w-sm">
            Импортируйте анализ крови (например, через <span className="font-mono">python3 import_health_checkup.py</span>) и обновите страницу — маркеры появятся здесь.
          </p>
        </div>
      )}

      {/* Main grid — only when we have an active checkup */}
      {!loading && !error && activeGroup && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: directory + categories */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#13131f] p-5 rounded-[20px] shadow-sm border border-white/5 space-y-4 animate-fade-in-up animate-delay-2 card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-[#f1f5f9]">
                    Каталог анализов
                  </h3>
                  <p className="text-[11px] text-[#94a3b8] mt-0.5">
                    Результаты клинических анализов крови.
                  </p>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]"
                  />
                  <input
                    type="text"
                    placeholder="Поиск маркеров или профилей..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[#13131f] border border-white/10 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#f97316]/50 transition-all text-[#f1f5f9]"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#cbd5e1]"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5">
                  <button
                    onClick={() => setStatusFilter("ALL")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors",
                      statusFilter === "ALL"
                        ? "bg-[#13131f] text-[#f1f5f9] shadow-sm"
                        : "text-[#94a3b8] hover:text-[#cbd5e1]"
                    )}
                  >
                    Все ({totalOutCount + totalNormalCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter("OUT_OF_RANGE")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1",
                      statusFilter === "OUT_OF_RANGE"
                        ? "bg-red-50 text-red-600 shadow-sm"
                        : "text-[#94a3b8] hover:text-red-500"
                    )}
                  >
                    Вне нормы ({totalOutCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter("NORMAL")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors",
                      statusFilter === "NORMAL"
                        ? "bg-green-50 text-green-600 shadow-sm"
                        : "text-[#94a3b8] hover:text-green-500"
                    )}
                  >
                    В норме ({totalNormalCount})
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {filteredCategories.length > 0 ? (
                filteredCategories.map((group) => (
                  <div
                    key={group.category}
                    className="bg-[#13131f] rounded-[20px] p-6 shadow-sm border border-white/5 hover:shadow-md transition-shadow card-hover"
                  >
                    {/* Group header — matches Finance card titles
                        (text-lg font-extrabold gray-900). Colored
                        category dot is preserved as the lightweight
                        visual hook this page leans on instead of the
                        tinted icon-square pattern used elsewhere. */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-extrabold text-[#f1f5f9] flex items-center gap-2">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              CATEGORY_DOT[group.color] ?? "bg-gray-400"
                            )}
                          />
                          {group.category}
                        </h2>
                        <p className="text-[11px] text-[#94a3b8] mt-1">
                          {group.desc}
                        </p>
                      </div>
                    </div>

                    <div className="divide-y divide-white/5">
                      {group.markers.map((marker) => {
                        const isHigh = marker.status === "HIGH";
                        const isLow = marker.status === "LOW";

                        let pct = 50;
                        if (isLow) pct = 15;
                        if (isHigh) pct = 85;

                        return (
                          <div
                            key={marker.name}
                            onClick={() => setSelectedMarker(marker)}
                            className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-white/5 px-3 -mx-3 rounded-xl transition-colors group card-hover"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[14px] font-bold text-[#f1f5f9] group-hover:text-[#f97316] transition-colors">
                                  {marker.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider border",
                                    isHigh
                                      ? "bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30"
                                      : isLow
                                        ? "bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30"
                                        : "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30"
                                  )}
                                >
                                  {marker.status === "HIGH"
                                    ? "ВЫШЕ"
                                    : marker.status === "LOW"
                                    ? "НИЖЕ"
                                    : "НОРМА"}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#94a3b8] mt-0.5">
                                Референс: {marker.range}
                              </p>
                            </div>

                            <div className="flex items-center gap-6 min-w-[200px]">
                              <div className="text-right">
                                <span className="font-mono text-[15px] font-bold text-[#f1f5f9]">
                                  {formatNumber(marker.value)}
                                </span>
                                {marker.unit && (
                                  <span className="text-[10px] text-[#94a3b8] ml-1 font-medium">
                                    {marker.unit}
                                  </span>
                                )}
                              </div>

                              <div className="w-28 h-6 flex flex-col justify-center relative">
                                <div className="h-1.5 w-full bg-white/10 rounded-full flex overflow-hidden relative">
                                  <div className="absolute left-[25%] right-[25%] top-0 bottom-0 bg-green-100/60 rounded" />
                                </div>

                                <motion.div
                                  initial={{ left: "50%" }}
                                  animate={{ left: `${pct}%` }}
                                  className={cn(
                                    "absolute -mt-0.5 w-3.5 h-3.5 rounded-full border-[2.5px] border-white shadow-sm -translate-x-1/2",
                                    isHigh
                                      ? "bg-red-500 shadow-red-200"
                                      : isLow
                                        ? "bg-amber-500 shadow-amber-200"
                                        : "bg-green-500 shadow-green-200"
                                  )}
                                />
                              </div>

                              <ChevronRight
                                size={14}
                                className="text-[#64748b] group-hover:text-[#94a3b8] group-hover:translate-x-0.5 transition-all"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-[#13131f] p-12 text-center rounded-[20px] border border-white/5 shadow-sm text-[#94a3b8] flex flex-col items-center justify-center card-hover">
                  <Info size={36} className="text-[#64748b] mb-3" />
                  <p className="text-sm font-semibold">
                    Под выбранные фильтры ничего не нашлось.
                  </p>
                  <p className="text-xs text-[#94a3b8] mt-1">
                    Попробуйте другие фильтры или другой поисковый запрос.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right side — opens with the unified AIR4 advisor card
              (shared shape with Sport, Projects, Goals, Finance) and
              then drops into the biomarker detail panel + hormone
              card. Advisor copy is derived from the same biomarker
              stats already computed in scope (`totalOutCount`,
              `totalNormalCount`, `activeGroup.date`). */}
          <div className="space-y-6">
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#1a0a00_0%,#0f0f14_100%)] border border-[#f97316]/30 rounded-2xl p-5 shadow-xl animate-fade-in-up animate-delay-3 card-hover">
              <Heart
                size={100}
                strokeWidth={1.5}
                className="absolute -top-3 -right-3 text-white/10 pointer-events-none"
              />
              <div className="relative space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full bg-green-400 animate-pulse"
                  />
                  <span className="text-[11px] font-black text-white/80 uppercase tracking-widest">
                    AIR4 ADVISOR
                  </span>
                  <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                    Здоровье
                  </span>
                </div>
                <p className="text-[14px] font-medium text-white leading-relaxed pr-12">
                  {totalOutCount === 0
                    ? `«Все ${totalNormalCount} маркеров в норме на ${activeGroup.date}. Ни одного флага — держите режим.»`
                    : `«${totalOutCount} из ${totalOutCount + totalNormalCount} маркеров вне нормы на ${activeGroup.date}. Кликните по любому, чтобы открыть разбор и план.»`}
                </p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {selectedMarker ? (
                <motion.div
                  key={selectedMarker.name}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-[#13131f] p-6 rounded-[20px] shadow-sm border-[1.5px] border-[#f97316]/30 relative card-hover"
                >
                  <button
                    onClick={() => setSelectedMarker(null)}
                    className="absolute top-4 right-4 text-[#94a3b8] hover:text-[#cbd5e1] bg-white/5 hover:bg-white/5 p-1.5 rounded-full"
                  >
                    <X size={14} />
                  </button>

                  <div className="flex items-center gap-2.5 mb-4 pr-8">
                    <span
                      className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        selectedMarker.status === "HIGH"
                          ? "bg-red-500 animate-pulse"
                          : selectedMarker.status === "LOW"
                            ? "bg-amber-500"
                            : "bg-green-500"
                      )}
                    />
                    <h3 className="text-base font-black text-[#f1f5f9]">
                      {selectedMarker.name} · Разбор
                    </h3>
                  </div>

                  {/* Tab toggle — "Значение" (current value + AIR4
                      protocol, existing content) vs "Динамика" (line
                      chart over all checkup dates). Lazy-loads the
                      history endpoint only on first switch to trend. */}
                  <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-wider mb-4 border-b border-white/5">
                    <button
                      type="button"
                      onClick={() => setDetailTab("value")}
                      className={cn(
                        "pb-2 -mb-px border-b-2 transition-colors",
                      detailTab === "value"
                        ? "border-[#f97316] text-[#f97316]"
                          : "border-transparent text-[#94a3b8] hover:text-[#cbd5e1]"
                      )}
                    >
                      Значение
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab("trend")}
                      className={cn(
                        "pb-2 -mb-px border-b-2 transition-colors",
                      detailTab === "trend"
                        ? "border-[#f97316] text-[#f97316]"
                          : "border-transparent text-[#94a3b8] hover:text-[#cbd5e1]"
                      )}
                    >
                      Динамика
                    </button>
                  </div>

                  {detailTab === "value" ? (
                    <>
                      {/* Label/value rows are flush with the card's
                          p-6 padding — no nested gray box that would
                          double the left inset. Each row is a flex split
                          so the label hugs the card's left edge and the
                          value snaps to the right edge, regardless of
                          label length. */}
                      <div className="mb-4 space-y-2">
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[#94a3b8]">Ваше значение</span>
                          <span className="font-mono font-bold text-[#f1f5f9]">
                            {formatNumber(selectedMarker.value)} {selectedMarker.unit}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[#94a3b8]">Референс</span>
                          <span className="font-mono text-[#cbd5e1]">
                            {selectedMarker.range}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[#94a3b8]">Статус</span>
                          <span
                            className={cn(
                              "font-bold uppercase tracking-wider text-[10px]",
                              selectedMarker.status === "HIGH"
                                ? "text-red-500"
                                : selectedMarker.status === "LOW"
                                  ? "text-amber-500"
                                  : "text-green-500"
                            )}
                          >
                            {selectedMarker.status === "HIGH"
                              ? "ВЫШЕ"
                              : selectedMarker.status === "LOW"
                              ? "НИЖЕ"
                              : "НОРМА"}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-[#94a3b8] leading-relaxed italic mb-4">
                        "{selectedMarker.info}"
                      </p>

                      <div className="pt-4 border-t border-white/5">
                        <h4 className="text-[10px] font-black text-[#f97316] uppercase tracking-wider mb-2">
                          Рекомендация AIR4
                        </h4>
                        <p className="text-[11px] text-[#94a3b8] leading-snug">
                          {interventionFor(selectedMarker)}
                        </p>
                      </div>
                    </>
                  ) : historyLoading ? (
                    <div className="h-[160px] flex items-center justify-center text-[11px] text-[#94a3b8]">
                      Загрузка истории…
                    </div>
                  ) : historyError ? (
                    <div className="h-[160px] flex items-center justify-center text-[11px] text-red-500 text-center px-3">
                      {historyError}
                    </div>
                  ) : markerHistory ? (
                    <div className="space-y-3">
                      <MarkerTrendChart history={markerHistory} />
                      <MarkerTrendLegend
                        refMin={
                          markerHistory.points.find(
                            (p) => p.reference_min != null
                          )?.reference_min ?? null
                        }
                        refMax={
                          markerHistory.points.find(
                            (p) => p.reference_max != null
                          )?.reference_max ?? null
                        }
                        unit={
                          markerHistory.points.find((p) => p.unit)?.unit ?? null
                        }
                      />
                      <p className="text-[10px] text-[#94a3b8] uppercase tracking-wider pt-2 border-t border-white/5">
                        {markerHistory.points.length} измерений ·{" "}
                        {markerHistory.points[0]?.date} —{" "}
                        {
                          markerHistory.points[markerHistory.points.length - 1]
                            ?.date
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="h-[160px] flex items-center justify-center text-[11px] text-[#94a3b8]">
                      Готовлю график…
                    </div>
                  )}
                </motion.div>
              ) : (
                <div className="bg-[#13131f] p-6 rounded-[20px] shadow-sm border border-white/5 text-center py-10 flex flex-col items-center justify-center card-hover">
                  <Info size={32} className="text-[#f97316] mb-3" />
                  <h3 className="text-xs font-bold text-[#f1f5f9]">
                    Панель биомаркера
                  </h3>
                  <p className="text-[11px] text-[#94a3b8] mt-1 leading-relaxed max-w-[200px]">
                    Кликните по любому маркеру, чтобы увидеть подробное физиологическое
                    объяснение и рекомендуемый протокол.
                  </p>
                </div>
              )}
            </AnimatePresence>

            {(testo || e2 || shbg) && (
              <div className="bg-[#13131f] p-6 rounded-[20px] shadow-sm border border-white/5 animate-fade-in-up animate-delay-4 card-hover">
                {/* Title matches the Finance card-title family but
                    one step smaller (`text-base`) because this card
                    lives in the narrow right column and shares space
                    with the biomarker detail panel — `text-lg` would
                    feel oversized here. */}
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={16} className="text-[#f97316]" />
                  <h3 className="text-base font-extrabold text-[#f1f5f9]">
                    Ароматизация и свободные гормоны
                  </h3>
                </div>

                <p className="text-[13px] text-[#cbd5e1] leading-relaxed mb-4">
                  {testo && (
                    <>
                      Ваш тестостерон —{" "}
                      <span
                        className={cn(
                          "font-bold",
                          normalizeStatus(testo.status) === "HIGH"
                            ? "text-red-500"
                            : normalizeStatus(testo.status) === "LOW"
                              ? "text-amber-500"
                              : "text-green-600"
                        )}
                      >
                        {formatNumber(testo.value)} {testo.unit ?? ""}
                      </span>
                      .{" "}
                    </>
                  )}
                  {e2 && (
                    <>
                      Ваш эстрадиол —{" "}
                      <span
                        className={cn(
                          "font-bold",
                          normalizeStatus(e2.status) === "HIGH"
                            ? "text-red-500"
                            : normalizeStatus(e2.status) === "LOW"
                              ? "text-amber-500"
                              : "text-green-600"
                        )}
                      >
                        {formatNumber(e2.value)} {e2.unit ?? ""}
                      </span>
                      .{" "}
                    </>
                  )}
                  {shbg && (
                    <>
                      Ваш SHBG —{" "}
                      <span
                        className={cn(
                          "font-bold",
                          normalizeStatus(shbg.status) === "HIGH"
                            ? "text-red-500"
                            : normalizeStatus(shbg.status) === "LOW"
                              ? "text-amber-500"
                              : "text-green-600"
                        )}
                      >
                        {formatNumber(shbg.value)} {shbg.unit ?? ""}
                      </span>
                      .
                    </>
                  )}
                </p>

                {/* Bullet list — parent sets size + body color
                    (text-[12px] text-[#cbd5e1]). The label spans bump
                    contrast to gray-800 and add font-semibold; size is
                    re-declared on the spans so the typography intent
                    reads explicitly at each label. */}
                <div className="space-y-3 text-[12px] text-[#cbd5e1]">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 shrink-0" />
                    <p>
                      <span className="text-[12px] font-semibold text-[#f1f5f9]">
                        Ароматизация в эстрогены:
                      </span>{" "}
                      Периферическую ароматизацию можно отслеживать между визитами — сравните E2 в разных датах.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 shrink-0" />
                    <p>
                      <span className="text-[12px] font-semibold text-[#f1f5f9]">
                        Низкий гликопротеин-переносчик:
                      </span>{" "}
                      SHBG регулирует фракцию свободных биодоступных стероидов. Низкий SHBG усиливает действие и андрогенов, и эстрогенов.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
