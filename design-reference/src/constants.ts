import { 
  LayoutDashboard, 
  Wallet, 
  Activity, 
  Briefcase, 
  Target, 
  Repeat, 
  Scale, 
  Brain, 
  Settings,
  MessageSquare,
  Layers,
  User,
  Bell
} from "lucide-react";
import { Page } from "./types";

export const NAVIGATION: { id: Page; Icon: any }[] = [
  { id: "Overview", Icon: LayoutDashboard },
  { id: "Chat", Icon: MessageSquare },
  { id: "EmptyStates", Icon: Layers },
  { id: "Profile", Icon: User },
  { id: "Toasts", Icon: Bell },
  { id: "Finance", Icon: Wallet },
  { id: "Health", Icon: Activity },
  { id: "Projects", Icon: Briefcase },
  { id: "Goals", Icon: Target },
  { id: "Patterns", Icon: Repeat },
  { id: "Dilemmas", Icon: Scale },
  { id: "Memory", Icon: Brain },
  { id: "Settings", Icon: Settings },
];
