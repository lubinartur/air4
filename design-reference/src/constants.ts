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
