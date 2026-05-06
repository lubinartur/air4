export const CATEGORY_LABELS: Record<string, string> = {
  food_groceries: "Продукты",
  food_restaurants: "Рестораны",
  transport: "Транспорт",
  entertainment: "Развлечения",
  health: "Здоровье",
  subscriptions: "Подписки",
  shopping: "Покупки",
  transfers: "Переводы",
  utilities: "Коммунальные",
  other: "Другое",
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
