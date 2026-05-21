import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  Bell,
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
  type HealthCheckupGroup,
  type HealthMarker,
} from "../lib/api";

const StatusDot = ({ color = "#ef4444" }: { color?: string }) => (
  <div className="absolute top-3 right-3 w-4 h-4 flex items-center justify-center pointer-events-none">
    <div className="absolute w-4 h-4 rounded-full opacity-50 animate-ping" style={{ backgroundColor: color }} />
    <div className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </div>
);

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
    category: "CBC (Complete Blood Count)",
    desc: "Measures oxygen delivery, hematological status, and immunological baseline levels.",
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
    category: "Biochemistry",
    desc: "Evaluates standard kidney efficiency, liver status, and core cellular health.",
    color: "amber",
    keywords: ["creatinine", "egfr", "crp", "alt", "ast", "ggt"],
  },
  {
    category: "Lipids",
    desc: "Lipoprotein lipid concentration ratios indicating baseline cardiovascular profile health.",
    color: "orange",
    keywords: ["hdl", "ldl", "cholesterol", "triglycerides"],
  },
  {
    category: "Hormones",
    desc: "Endocrine messengers steering master metabolism, tissue synthesis, and recovery.",
    color: "violet",
    keywords: ["testosterone", "estradiol", "shbg", "fsh", "lh", "cortisol"],
  },
];

const OTHER_CATEGORY: Pick<MarkerCategory, "category" | "desc" | "color"> = {
  category: "Other",
  desc: "Markers not yet mapped to a category — review individually.",
  color: "gray",
};

const CATEGORY_DOT: Record<string, string> = {
  rose: "bg-red-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  violet: "bg-violet-500",
  gray: "bg-gray-400",
};

const MARKER_INFO: Record<string, string> = {
  hemoglobin:
    "Elevated hemoglobin can reflect training stress, dehydration, or hormonal pressure on erythropoiesis.",
  hematocrit:
    "High hematocrit raises blood viscosity. Strict hydration matters; consider donating blood if persistent.",
  rbc: "Total erythrocyte count. Supports oxygen delivery and recovery capacity.",
  wbc: "Leukocyte baseline — stable counts indicate no active infection.",
  platelets:
    "Thrombocyte count within nominal range ensures healthy clotting and vascular repair.",
  neutrophils:
    "Acute-response immune cells. Stable counts indicate no bacterial infection.",
  lymphocytes:
    "Adaptive immune cells — counts reflect chronic immune state and viral load.",
  eosinophils:
    "Allergy / parasite responders. Mild elevation can indicate allergic activity.",
  creatinine:
    "Muscle-derived metabolite; reflects muscle mass and kidney filtration capacity.",
  egfr:
    "Estimated glomerular filtration rate — below 90 suggests reduced kidney filtration.",
  crp: "C-Reactive Protein, a marker of systemic inflammation. Low = good.",
  alt: "Alanine aminotransferase — primary liver enzyme. Normal = no acute hepatic stress.",
  ast: "Aspartate aminotransferase — liver/muscle enzyme. Combined with ALT gives liver picture.",
  ggt: "Gamma-glutamyl transferase — sensitive to cholestatic liver stress, alcohol, medications.",
  hdl:
    "Cardio-protective high-density lipoprotein. Often suppressed by elevated androgens or low aerobic load.",
  ldl: "Low-density lipoprotein — primary atherogenic carrier; target depends on cardiovascular risk.",
  cholesterol:
    "Total cholesterol — interpret alongside HDL/LDL split and triglycerides.",
  triglycerides:
    "Plasma lipid energy reserve. High triglycerides reflect refined-carb load and insulin pressure.",
  testosterone:
    "Primary androgen — supraphysiological values drive muscle synthesis but elevate downstream estrogen via aromatase.",
  estradiol:
    "Estrogenic conversion of testosterone. Elevated E2 can drive water retention and mood instability.",
  shbg:
    "Sex Hormone-Binding Globulin — low SHBG increases the free, bioavailable androgen and estrogen fraction.",
  fsh:
    "Follicle-stimulating hormone — pituitary signal to gonads. Suppressed FSH often reflects exogenous androgen use.",
  lh:
    "Luteinizing hormone — pituitary signal driving endogenous testosterone production.",
  cortisol:
    "Primary stress hormone. Chronically elevated cortisol erodes muscle, sleep, and immune resilience.",
};

const MARKER_INTERVENTION: Record<string, string> = {
  hdl: "Focus on cardiovascular zone-2 stamina training to push HDL up. Include clean omega marine fat sources.",
  hemoglobin:
    "High red cell activity correlates with cardiac load. Elevate your water ingestion to 4L daily.",
  hematocrit:
    "High red cell activity correlates with cardiac load. Elevate your water ingestion to 4L daily.",
  egfr:
    "Increase direct fluid intake immediately. Review creatine dosing protocol (reduce to maintenance of 3g or cycle off).",
  testosterone:
    "Highly estrogenic conversions. Monitor water bloating. Consider cycle mitigation or aromatisation reduction strategies.",
  estradiol:
    "Highly estrogenic conversions. Monitor water bloating. Consider cycle mitigation or aromatisation reduction strategies.",
  shbg:
    "Low SHBG amplifies free hormone fractions. Re-test cycle endpoints to rule out endogenous suppression.",
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
      "Reference data captured from your blood test. Discuss interpretation with your provider.",
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
    return "Marker is safely within healthy limits. Maintain your current lifestyle vector.";
  }
  return (
    lookupBy(marker.name, MARKER_INTERVENTION) ??
    "Outside reference range — discuss this marker with your physician and re-test in 4–8 weeks."
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
          setError(e instanceof Error ? e.message : "Failed to load checkups");
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
              <Heart size={22} className="fill-rose-100" />
            </div>
            <div>
              <h1 className={t.pageTitle}>
                Health Analytics & Labs
              </h1>
              <p className={cn(t.pageSub, "mt-0.5")}>
                Biomarkers, Clinical Reports & Laboratory Overviews
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100 px-3.5 py-1.5 rounded-xl">
          <Activity size={14} className="text-indigo-600" />
          <span className="text-xs font-bold text-indigo-700">
            Medical Record Standard
          </span>
        </div>
      </div>

      {/* Date selector */}
      {checkups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest pr-1">
            <CalendarDays size={12} />
            Test date
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
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                    : "bg-white text-gray-500 border border-gray-100 hover:text-gray-900 hover:border-gray-200"
                )}
              >
                <span className="font-mono">{c.date}</span>
                <span
                  className={cn(
                    "text-[9px] font-mono",
                    active ? "text-white/80" : "text-gray-400"
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
        <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
          <p className="text-[14px] text-[#9ca3af]">Loading lab data…</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-white p-6 rounded-[20px] shadow-sm border border-red-100">
          <p className="text-[13px] text-red-500">{error}</p>
        </div>
      )}

      {!loading && !error && checkups.length === 0 && (
        <div className="bg-white p-12 rounded-[20px] shadow-sm border border-gray-100 text-center flex flex-col items-center justify-center gap-2">
          <Info size={36} className="text-gray-300" />
          <p className="text-sm font-bold text-gray-900">No lab data yet</p>
          <p className="text-xs text-gray-400 max-w-sm">
            Import a blood test (e.g. via <span className="font-mono">python3 import_health_checkup.py</span>) and reload — markers will appear here.
          </p>
        </div>
      )}

      {/* Main grid — only when we have an active checkup */}
      {!loading && !error && activeGroup && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: directory + categories */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-5 rounded-[20px] shadow-sm border border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Lab Diagnostic Directory
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Blood chemistry reports uploaded from clinical tests.
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Coming soon"
                  className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <FileUp size={14} />
                  Import Labs
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    placeholder="Search markers or profiles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-800"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex gap-1 bg-gray-50 p-1 rounded-lg border border-gray-100">
                  <button
                    onClick={() => setStatusFilter("ALL")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors",
                      statusFilter === "ALL"
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    All ({totalOutCount + totalNormalCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter("OUT_OF_RANGE")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1",
                      statusFilter === "OUT_OF_RANGE"
                        ? "bg-red-50 text-red-600 shadow-sm"
                        : "text-gray-400 hover:text-red-500"
                    )}
                  >
                    Out of range ({totalOutCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter("NORMAL")}
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-colors",
                      statusFilter === "NORMAL"
                        ? "bg-green-50 text-green-600 shadow-sm"
                        : "text-gray-400 hover:text-green-500"
                    )}
                  >
                    Normal ({totalNormalCount})
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {filteredCategories.length > 0 ? (
                filteredCategories.map((group) => (
                  <div
                    key={group.category}
                    className="bg-white rounded-[20px] p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-[13px] font-black text-gray-900 uppercase tracking-widest flex items-center gap-1.5">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              CATEGORY_DOT[group.color] ?? "bg-gray-400"
                            )}
                          />
                          {group.category}
                        </h2>
                        <p className="text-xs text-gray-400 mt-1 font-medium">
                          {group.desc}
                        </p>
                      </div>
                    </div>

                    <div className="divide-y divide-gray-50">
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
                            className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/40 px-3 -mx-3 rounded-xl transition-colors group"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[14px] font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">
                                  {marker.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider",
                                    isHigh
                                      ? "bg-red-50 text-red-600"
                                      : isLow
                                        ? "bg-amber-50 text-amber-600"
                                        : "bg-green-50 text-green-600"
                                  )}
                                >
                                  {marker.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                Reference limits: {marker.range}
                              </p>
                            </div>

                            <div className="flex items-center gap-6 min-w-[200px]">
                              <div className="text-right">
                                <span className="font-mono text-[15px] font-bold text-gray-800">
                                  {formatNumber(marker.value)}
                                </span>
                                {marker.unit && (
                                  <span className="text-[10px] text-gray-400 ml-1 font-medium">
                                    {marker.unit}
                                  </span>
                                )}
                              </div>

                              <div className="w-28 h-6 flex flex-col justify-center relative">
                                <div className="h-1.5 w-full bg-gray-100 rounded-full flex overflow-hidden relative">
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
                                className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-white p-12 text-center rounded-[20px] border border-gray-100 shadow-sm text-gray-400 flex flex-col items-center justify-center">
                  <Info size={36} className="text-gray-300 mb-3" />
                  <p className="text-sm font-semibold">
                    No lab profiles match selection.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try adjusting directory filters or enter a different search keyword.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right side */}
          <div className="space-y-6">
            <div className="bg-[#1a1a2e] rounded-[20px] p-6 shadow-sm border border-slate-800 text-white relative">
              {totalOutCount > 0 && <StatusDot color="#f59e0b" />}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-md">
                  <Bell size={16} />
                </div>
                <div>
                  <h4 className="text-[11px] font-black tracking-widest text-[#9ca3af] uppercase">
                    AIR4 Clinical Scanner
                  </h4>
                  <p className="text-[13px] leading-relaxed font-bold mt-2 text-indigo-100">
                    {totalOutCount === 0
                      ? `"All ${totalNormalCount} markers in range — no immediate flags for ${activeGroup.date}."`
                      : `"${totalOutCount} of ${
                          totalOutCount + totalNormalCount
                        } markers are out of range for ${activeGroup.date}. Click each to inspect."`}
                  </p>
                </div>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {selectedMarker ? (
                <motion.div
                  key={selectedMarker.name}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white p-6 rounded-[20px] shadow-sm border-[1.5px] border-indigo-100 relative"
                >
                  <button
                    onClick={() => setSelectedMarker(null)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 p-1.5 rounded-full"
                  >
                    <X size={14} />
                  </button>

                  <div className="flex items-center gap-2.5 mb-4">
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
                    <h3 className="text-base font-black text-gray-900">
                      {selectedMarker.name} Analysis
                    </h3>
                  </div>

                  <div className="bg-gray-50/50 p-4 rounded-xl mb-4 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Recorded Level</span>
                      <span className="font-mono font-bold text-gray-800">
                        {formatNumber(selectedMarker.value)} {selectedMarker.unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Reference Band</span>
                      <span className="font-mono text-gray-600">
                        {selectedMarker.range}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Diagnostic Status</span>
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
                        {selectedMarker.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed italic mb-4">
                    "{selectedMarker.info}"
                  </p>

                  <div className="pt-4 border-t border-gray-100">
                    <h4 className="text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-2">
                      AIR4 Intervention Advice
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      {interventionFor(selectedMarker)}
                    </p>
                  </div>
                </motion.div>
              ) : (
                <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100 text-center py-10 flex flex-col items-center justify-center">
                  <Info size={32} className="text-indigo-200 mb-3" />
                  <h3 className="text-xs font-bold text-gray-800">
                    Biomarker Insight Panel
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed max-w-[200px]">
                    Click on any specific lab marker to view in-depth physiological
                    explanation and recommended protocol.
                  </p>
                </div>
              )}
            </AnimatePresence>

            {(testo || e2 || shbg) && (
              <div className="bg-white p-6 rounded-[20px] shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={16} className="text-violet-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                    Aromatization & Active Free Hormones
                  </h3>
                </div>

                <p className="text-xs text-gray-500 leading-relaxed mb-4">
                  {testo && (
                    <>
                      Your active Testosterone is{" "}
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
                      Your Estradiol is{" "}
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
                      Your SHBG is{" "}
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

                <div className="space-y-3 text-[11px] text-gray-400">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 shrink-0" />
                    <p>
                      <span className="text-gray-600 font-semibold">
                        Estrogenic Conversion:
                      </span>{" "}
                      Peripheral aromatization can be tracked across visits — compare E2 across test dates.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 shrink-0" />
                    <p>
                      <span className="text-gray-600 font-semibold">
                        Low Carrier Glycoprotein:
                      </span>{" "}
                      SHBG modulates the free, bioavailable steroid state. Low SHBG amplifies both androgen and estrogen activity.
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
