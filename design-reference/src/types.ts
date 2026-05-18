export type Page = 
  | "Overview" 
  | "Finance" 
  | "Health" 
  | "Projects" 
  | "Goals" 
  | "Patterns" 
  | "Dilemmas" 
  | "Memory" 
  | "Settings"
  | "Chat"
  | "CSVUpload"
  | "EmptyStates"
  | "Profile"
  | "Toasts";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Insight {
  id: string;
  category: string;
  content: string;
  status: "normal" | "warning" | "critical";
}
