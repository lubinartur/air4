import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../lib/utils";

interface ToastProps {
  id: string;
  type: "success" | "warning" | "critical" | "info";
  title?: string;
  body: string;
  action?: string;
  onDismiss: (id: string) => void;
}

const Toast = ({ id, type, title, body, action, onDismiss }: ToastProps) => {
  const configs = {
    success: { border: "border-l-green-500", icon: CheckCircle2, iconColor: "text-green-500" },
    warning: { border: "border-l-amber-500", icon: AlertTriangle, iconColor: "text-amber-500" },
    critical: { border: "border-l-red-500", icon: AlertCircle, iconColor: "text-red-500" },
    info: { border: "border-l-indigo-500", icon: Info, iconColor: "text-indigo-500" },
  };

  const config = configs[type];
  const Icon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn(
        "bg-white rounded-[20px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] border-l-[4px] p-5 w-[320px] relative transition-all",
        config.border
      )}
    >
      <button 
        onClick={() => onDismiss(id)}
        className="absolute top-4 right-4 text-gray-300 hover:text-gray-500 transition-colors"
      >
        <X size={16} />
      </button>

      <div className="flex gap-4">
        <div className={cn("shrink-0", config.iconColor)}>
          <Icon size={20} />
        </div>
        <div className="space-y-1">
          {type === "info" ? (
             <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-[0.1em] mb-1">AIR4 ЗАМЕТИЛ</p>
          ) : (
             <h4 className="text-[14px] font-bold text-[#111827] tracking-tight">{title}</h4>
          )}
          <p className="text-[13px] text-[#6b7280] font-medium leading-relaxed">{body}</p>
          {action && (
            <button className="text-[13px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors mt-2 block">
              {action}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export function ToastDemo() {
  const toasts = [
    { id: "1", type: "success" as const, title: "Пример: успех", body: "Превью уведомлений — данные демо.", action: "Закрыть →" },
    { id: "2", type: "warning" as const, title: "Пример: предупреждение", body: "Уведомления будут использовать настоящие наблюдения после подключения.", action: "Закрыть →" },
    { id: "3", type: "critical" as const, title: "Пример: критично", body: "В рабочих экранах не показываем фейковые алерты.", action: "Закрыть →" },
    { id: "4", type: "info" as const, body: "AIR4 будет показывать паттерны из ваших данных, когда их накопится достаточно.", action: "Закрыть →" },
  ];

  return (
    <div className="relative min-h-[600px] rounded-[32px] overflow-hidden border border-gray-100 bg-gray-50/50">
      {/* Background - Mock Overview Content */}
      <div className="p-8 opacity-40 select-none pointer-events-none blur-[2px]">
         <div className="flex justify-between items-end mb-10">
            <div className="h-10 w-48 bg-gray-200 rounded-lg" />
            <div className="h-8 w-32 bg-gray-200 rounded-lg" />
         </div>
         <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 h-64 bg-white rounded-[24px] shadow-sm" />
            <div className="h-64 bg-white rounded-[24px] shadow-sm" />
            <div className="h-48 bg-white rounded-[24px] shadow-sm" />
            <div className="h-48 bg-white rounded-[24px] shadow-sm" />
            <div className="h-48 bg-white rounded-[24px] shadow-sm" />
         </div>
      </div>

      {/* Foreground - Toasts */}
      <div className="absolute inset-0 flex flex-col justify-end items-end p-8 gap-4 pointer-events-none">
         <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 mr-2">Уведомления</p>
         <div className="flex flex-col gap-4 pointer-events-auto">
            {toasts.map((t) => (
              <Toast key={t.id} {...t as any} onDismiss={() => {}} />
            ))}
         </div>
      </div>
    </div>
  );
}
