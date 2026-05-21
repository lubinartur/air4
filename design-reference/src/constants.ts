import {
  LayoutDashboard,
  Wallet,
  Activity,
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
  { id: "Health", Icon: Activity },
  { id: "Projects", Icon: Briefcase },
  { id: "Goals", Icon: Target },
  { id: "Dilemmas", Icon: Scale },
  { id: "Patterns", Icon: Repeat },
  { id: "Memory", Icon: Brain },
  { id: "Profile", Icon: User },
  { id: "Settings", Icon: Settings },
];
