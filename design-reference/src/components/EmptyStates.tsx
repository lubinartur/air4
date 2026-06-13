import { motion } from "motion/react";
import { Wallet, Briefcase, Activity, Repeat, Brain, Scale, Upload, Plus } from "lucide-react";
import { cn } from "../lib/utils";

export function EmptyStates() {
  const cards = [
    {
      id: "finance",
      icon: Wallet,
      title: "Выписки пока не загружены",
      subtext: "Загрузите первую выписку Swedbank, чтобы увидеть, куда уходят деньги",
      button: "Загрузить выписку",
      type: "finance"
    },
    {
      id: "projects",
      icon: Briefcase,
      title: "Нет активных проектов",
      subtext: "Расскажите AIR4, над чем вы работаете",
      button: "Добавить проект",
      type: "projects"
    },
    {
      id: "health",
      icon: Activity,
      title: "Тренировок ещё нет",
      subtext: "Напишите в чате «жим лёжа 3х10 80кг сегодня» — AIR4 сделает остальное",
      type: "health"
    },
    {
      id: "patterns",
      icon: Repeat,
      title: "Пока недостаточно данных",
      subtext: "Паттерны проявятся через 2–3 недели реального использования. Продолжайте логировать.",
      extra: "Нужно ещё 3 точки данных",
      extraColor: "text-amber-500",
      type: "patterns"
    },
    {
      id: "memory",
      icon: Brain,
      title: "Память пуста",
      subtext: "Каждый разговор пополняет память AIR4. Начните говорить.",
      extra: "0 событий · 0 фактов",
      type: "memory"
    },
    {
      id: "dilemmas",
      icon: Scale,
      title: "Открытых дилемм нет",
      subtext: "Стоите перед сложным решением? Опишите его AIR4 в чате.",
      extra: "Это хороший знак.",
      extraColor: "text-green-500",
      type: "dilemmas",
      isGood: true
    }
  ];

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Пустые состояния</h1>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">Вид нового пользователя</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {cards.map((card, i) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              "bg-white rounded-[20px] p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col items-center text-center justify-center min-h-[320px]",
              card.isGood && "bg-green-50/30 shadow-none border-[1.5px] border-green-100/50"
            )}
          >
            <div className="mb-6 p-5 rounded-[20px] bg-gray-50 text-[#d1d5db]">
              <card.icon size={48} strokeWidth={1.5} />
            </div>
            
            <h3 className="text-[16px] font-bold text-[#111827] leading-tight">
              {card.title}
            </h3>
            
            <p className="text-[13px] text-[#9ca3af] font-medium mt-2 leading-relaxed max-w-[200px]">
              {card.subtext}
            </p>

            {card.button && (
              <button className="mt-6 flex items-center gap-2 bg-[#f97316] text-white px-5 py-2.5 rounded-[10px] font-bold text-[13px] shadow-lg shadow-[#f97316]/20 hover:bg-[#ea6a06] transition-all uppercase tracking-wider">
                {card.button === "Загрузить выписку" ? <Upload size={16} /> : <Plus size={16} />}
                {card.button}
              </button>
            )}

            {card.extra && (
              <p className={cn("mt-6 text-[11px] font-bold uppercase tracking-[0.1em]", card.extraColor || "text-[#9ca3af]")}>
                {card.extra}
              </p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
