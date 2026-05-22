import {
  LayoutDashboard,
  Wallet,
  Heart,
  Dumbbell,
  Briefcase,
  Target,
  Repeat,
  Scale,
  Brain,
  User,
  Settings,
} from "lucide-react";
import { Page } from "./types";

export const NAVIGATION: { id: Page; Icon: any }[] = [
  { id: "Overview", Icon: LayoutDashboard },
  { id: "Finance", Icon: Wallet },
  { id: "Health", Icon: Heart },
  { id: "Sport", Icon: Dumbbell },
  { id: "Projects", Icon: Briefcase },
  { id: "Goals", Icon: Target },
  { id: "Dilemmas", Icon: Scale },
  { id: "Patterns", Icon: Repeat },
  { id: "Memory", Icon: Brain },
  { id: "Profile", Icon: User },
  { id: "Settings", Icon: Settings },
];

/**
 * User-visible labels for each `Page`. The `Page` literal values are
 * used as routing/storage identifiers, so they stay in English; this
 * map provides the Russian label shown in the sidebar tooltip, page
 * header, and similar UI affordances.
 */
export const PAGE_LABELS: Record<Page, string> = {
  Overview: "Обзор",
  Finance: "Финансы",
  Health: "Здоровье",
  Sport: "Спорт",
  Projects: "Проекты",
  Goals: "Цели",
  Dilemmas: "Дилеммы",
  Patterns: "Паттерны",
  Memory: "Память",
  Profile: "Профиль",
  Settings: "Настройки",
  Chat: "Чат",
  CSVUpload: "Загрузка выписки",
  EmptyStates: "Пустые состояния",
  Toasts: "Уведомления",
};
