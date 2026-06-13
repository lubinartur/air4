import { motion } from "motion/react";
import { User, Shield, Globe, Bell, Database, Info, Lock, ChevronRight, AlertTriangle, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

export function Settings() {
  const privacyModes = [
    { id: "local", title: "Полностью локально", desc: "Только Ollama. Ничего не покидает устройство.", status: "green", active: true },
    { id: "smart", title: "Умный режим", desc: "Сложные рассуждения через Claude API. Анонимизируется перед отправкой.", status: "gray", active: false },
    { id: "full", title: "Полный режим", desc: "Локальные данные + внешняя информация по запросу. Фаза 10.", status: "gray", active: false },
  ];

  const notifications = [
    { label: "Ежедневные наблюдения", enabled: true },
    { label: "Напоминания по дилеммам", enabled: true },
    { label: "Алерты о застрявших проектах", enabled: true },
    { label: "Недельная сводка", enabled: false },
  ];

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-white/5 text-[#cbd5e1] rounded-xl">
            <SettingsIcon size={22} className="fill-white/10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#f1f5f9] tracking-tight">
              Настройки системы
            </h1>
            <p className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-widest mt-0.5">
              Предпочтения и конфигурация
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white/5 border border-white/5 px-3.5 py-1.5 rounded-xl">
          <Sparkles size={14} className="text-[#cbd5e1]" />
          <span className="text-xs font-bold text-[#cbd5e1]">Система AIR4</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Left Column */}
        <div className="col-span-3 space-y-6">
          {/* Card 1 - AIR4 Character */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-8">Характер AIR4</h2>
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <p className="text-[14px] font-black text-[#f1f5f9] uppercase tracking-widest">Уровень жёсткости</p>
                <p className="text-2xl font-black text-[#f97316]">8<span className="text-[14px] text-[#64748b]">/10</span></p>
              </div>
              <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="absolute top-0 left-0 h-full bg-[#f97316] rounded-full w-[80%]" />
              </div>
              <div className="flex justify-between text-[11px] font-bold text-[#94a3b8] uppercase tracking-widest">
                <span>Мягко</span>
                <span>Жёстко</span>
              </div>
              <p className="text-[12px] text-[#94a3b8] font-medium italic mt-2 text-center">
                «Управляет тем, насколько прямолинейно говорит AIR4. По умолчанию: 8/10.»
              </p>
            </div>
          </div>

          {/* Card 2 - Privacy Mode */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-8">Режим приватности</h2>
            <div className="space-y-3">
              {privacyModes.map((mode) => (
                <div 
                  key={mode.id}
                  className={cn(
                    "p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between group",
                    mode.active ? "border-[#f97316] bg-[#13131f] shadow-sm" : "border-white/5 bg-white/5 hover:border-white/10"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn("w-2 h-2 rounded-full", mode.status === "green" ? "bg-green-500" : "bg-white/10")} />
                    <div>
                      <p className="text-[14px] font-bold text-[#f1f5f9]">{mode.title}</p>
                      <p className="text-[11px] text-[#94a3b8] font-medium mt-0.5">{mode.desc}</p>
                    </div>
                  </div>
                  {mode.active && <div className="w-1.5 h-1.5 rounded-full bg-[#f97316]" />}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#94a3b8] font-medium mt-4 italic text-center">
              «Умный режим показывает превью того, что отправляется, перед каждым запросом.»
            </p>
          </div>

          {/* Card 3 - Language */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em]">Язык</h2>
            <div className="flex bg-white/5 p-1 rounded-xl">
              <button className="px-6 py-2 rounded-lg bg-[#f97316] text-white font-black text-[12px] shadow-sm uppercase tracking-widest">RU</button>
              <button className="px-6 py-2 rounded-lg text-[#94a3b8] font-black text-[12px] uppercase tracking-widest">EN</button>
            </div>
          </div>

          {/* Card 4 - Notifications */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6">Уведомления</h2>
            <div className="space-y-4">
              {notifications.map((n, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 last:pb-0">
                  <span className="text-[14px] font-bold text-[#cbd5e1]">{n.label}</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full relative transition-all cursor-pointer",
                    n.enabled ? "bg-[#f97316]" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
                      n.enabled ? "left-6" : "left-1"
                    )} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-2 space-y-6">
          {/* Card 5 - Profile */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6">Профиль</h2>
            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-baseline py-1 border-b border-white/5">
                <span className="text-[11px] font-black text-[#94a3b8] uppercase">Имя</span>
                <span className="text-[14px] font-medium text-[#94a3b8]">Не указано</span>
              </div>
              <div className="flex justify-between items-baseline py-1 border-b border-white/5">
                <span className="text-[11px] font-black text-[#94a3b8] uppercase">Город</span>
                <span className="text-[14px] font-medium text-[#94a3b8]">Не указан</span>
              </div>
              <div className="flex justify-between items-baseline py-1 border-b border-white/5">
                <span className="text-[11px] font-black text-[#94a3b8] uppercase">Профессия</span>
                <span className="text-[14px] font-medium text-[#94a3b8]">Не указана</span>
              </div>
              <div className="flex justify-between items-baseline py-1 border-b border-white/5">
                <span className="text-[11px] font-black text-[#94a3b8] uppercase">Доход</span>
                <span className="text-[14px] font-medium text-[#94a3b8]">Не указан</span>
              </div>
            </div>
            <button className="w-full py-3 rounded-xl border-2 border-[#f97316] text-[#f97316] font-black text-[13px] hover:bg-[#f97316] hover:text-white transition-all uppercase tracking-widest">
              Изменить профиль
            </button>
          </div>

          {/* Card 6 - Data & Memory */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <h2 className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-[0.1em] mb-6 whitespace-nowrap overflow-hidden text-ellipsis">База данных</h2>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#94a3b8]">
                <Database size={20} />
              </div>
              <div>
                <p className="text-[15px] font-medium text-[#94a3b8]">—</p>
                <p className="text-[11px] text-[#94a3b8] font-mono">air4.db хранится локально</p>
              </div>
            </div>
            <div className="space-y-3">
              <button className="w-full py-3 rounded-xl border-2 border-white/10 text-[#94a3b8] font-black text-[13px] hover:border-white/20 hover:text-[#cbd5e1] transition-all uppercase tracking-widest">
                Экспорт данных
              </button>
              <button className="w-full py-3 rounded-xl border-2 border-red-100 text-red-500 font-black text-[13px] hover:bg-red-500 hover:text-white hover:border-red-500 transition-all uppercase tracking-widest flex items-center justify-center gap-2">
                <AlertTriangle size={16} />
                Очистить память
              </button>
            </div>
            <p className="text-[10px] text-red-400 font-medium mt-4 italic text-center leading-relaxed">
              «Очистка памяти удалит все события и факты. Необратимо.»
            </p>
          </div>

          {/* Card 7 - About */}
          <div className="bg-[#13131f] rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <div className="flex justify-between items-start mb-6">
               <div>
                  <h3 className="text-[18px] font-black text-[#f1f5f9]">AIR4</h3>
                  <p className="text-[11px] font-bold text-[#94a3b8] mt-0.5">Версия 0.6.1</p>
               </div>
               <div className="w-8 h-8 rounded-lg bg-[#f97316]/15 border border-[#f97316]/30 flex items-center justify-center text-[#f97316]">
                 <Info size={18} />
               </div>
            </div>
            <div className="space-y-4">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <p className="text-[10px] font-black text-[#94a3b8] uppercase tracking-widest mb-1">Модель</p>
                <p className="text-[13px] font-bold text-[#f1f5f9] font-mono">qwen2.5:32b через Ollama</p>
              </div>
              <p className="text-[11px] text-[#94a3b8] font-medium italic text-center">
                «Работает полностью локально. Облачное подключение неактивно.»
              </p>
              <button className="w-full py-2 text-[12px] font-bold text-[#f97316] hover:text-[#f97316] transition-colors">
                Список изменений →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
