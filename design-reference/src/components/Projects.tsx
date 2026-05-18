import { useEffect, useState } from "react";
import { Clock, FolderKanban } from "lucide-react";
import { getProjects, type Project } from "../lib/api";
import { formatProjectStatus, formatRelativeActivity } from "../lib/format";
import { cn } from "../lib/utils";
import { PageEmptyState } from "./PageEmptyState";

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getProjects();
        if (!cancelled) setProjects(data);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const header = (
    <div>
      <h1 className="text-4xl font-black text-gray-900 tracking-tight">Projects</h1>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">
        Project Advisor
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <p className="text-[14px] text-[#9ca3af]">Loading…</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col gap-8 pb-10">
        {header}
        <PageEmptyState
          icon={FolderKanban}
          title="No projects yet"
          subtext="Add a project via chat — tell AIR4 what you're working on."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      {header}

      <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-[0.1em] mb-6">
          Projects
        </h2>
        <div className="space-y-4">
          {projects.map((p) => {
            const activity = formatRelativeActivity(p.updated_at);
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-4 p-4 bg-gray-50/30 rounded-2xl border border-gray-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[15px] font-bold text-gray-900">{p.name}</span>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter",
                        p.status === "active"
                          ? "bg-green-50 text-green-600"
                          : p.status === "stalled"
                            ? "bg-red-50 text-red-600"
                            : "bg-gray-100 text-gray-500"
                      )}
                    >
                      {formatProjectStatus(p.status)}
                    </span>
                  </div>
                  {p.description && (
                    <p className="text-[13px] text-gray-500 mt-1 line-clamp-2">{p.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 mt-2">
                    <Clock size={12} />
                    <span>{activity}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
