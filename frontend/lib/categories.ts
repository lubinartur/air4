export const CATEGORY_LABELS: Record<string, string> = {
  food_groceries: "Groceries",
  food_restaurants: "Restaurants",
  transport: "Transport",
  entertainment: "Entertainment",
  health: "Health",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  transfers: "Transfers",
  utilities: "Utilities",
  other: "Other",
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

/** Replace known category keys in prose (e.g. insight descriptions) with labels. */
export function textWithCategoryLabels(text: string): string {
  if (!text) return text;
  const keys = Object.keys(CATEGORY_LABELS).sort((a, b) => b.length - a.length);
  let s = text;
  for (const k of keys) {
    const label = CATEGORY_LABELS[k];
    if (label) s = s.split(k).join(label);
  }
  return s;
}
