# OBSERVATION_ENGINE.md
# AIR4 — Observation Engine v3

> Сердце AIR4. Не информирует — провоцирует осознание и действие.

---

## 1. Философия

### Observation ≠ Fact

```
Fact:        "Ты потратил €340 на рестораны в январе."
             Данные. AIR4 читает из базы.

Observation: "Траты на рестораны выросли на 89% в недели
             когда проект не двигался. Это паттерн."
             Интерпретация. Может ошибаться. Требует честности.
```

Observation — hypothesis with evidence. Никогда не представляется как факт.

### Главная цель

Не информировать. Провоцировать осознание и действие.

```
Плохо:  "Ты потратил на еду больше обычного."
        → "Ну и что?"

Хорошо: "Рестораны +89% за две недели. Совпадает с паузой в AIR4.
         Это уже третий раз. Сэкономишь €150 если готовишь дома."
        → "Чёрт… он прав."
```

### Когда молчать

- Evidence < 3 data points
- Пользователь знает это сам без AIR4
- Похожее observation было < 7 дней назад
- Нет actionable вывода или вопроса
- Данные старше 30 дней
- Пользователь в blackout period

**Молчание — это решение. Часто правильное.**

### Главный тест

```
"Чёрт… он прав. Я бы сам не заметил." → SEND
"Ну да, я и так знал."                 → SKIP
"Что за ерунда?"                        → SKIP
"Опять одно и то же."                   → SKIP
```

---

## 2. Rule Layer

Работает без LLM. Детерминированный, быстрый, стабильный.

### Триггеры

```python
RULES = {
    # Inactivity
    "no_workout_7d":          {"days": 7,  "strength": "weak",             "cooldown": 3, "max_month": 2},
    "no_workout_14d":         {"days": 14, "strength": "strong",           "cooldown": 7, "max_month": 1},
    "project_stalled_3d":     {"days": 3,  "strength": "weak",             "cooldown": 2, "max_month": 4},
    "project_stalled_7d":     {"days": 7,  "strength": "strong",           "cooldown": 5, "max_month": 2},
    "no_upload_21d":          {"days": 21, "strength": "medium",           "cooldown": 7, "max_month": 1},

    # Spending
    "category_spike_50pct":   {"threshold": 1.5, "strength": "weak",      "cooldown": 5, "max_month": 3},
    "category_spike_100pct":  {"threshold": 2.0, "strength": "strong",    "cooldown": 7, "max_month": 2},
    "late_night_purchase":    {"hour": 23, "min_amount": 50, "strength": "weak", "cooldown": 3},

    # Streaks
    "streak_break_3d":        {"min_streak": 3, "strength": "weak",       "cooldown": 1, "max_month": 4},
    "streak_break_7d":        {"min_streak": 7, "strength": "strong",     "cooldown": 3, "max_month": 2},

    # Positive
    "streak_7d":              {"streak": 7,  "strength": "positive",      "cooldown": 0},
    "streak_30d":             {"streak": 30, "strength": "positive_strong","cooldown": 0},

    # Cross-sphere
    "spending_spike_AND_stalled_project": {
        "conditions": ["category_spike_100pct", "project_stalled_3d"],
        "strength": "cross_sphere_strong",
        "domains": ["finance", "projects"],
        "cooldown": 10, "max_month": 1,
    },
    "no_workout_AND_project_slowdown": {
        "conditions": ["no_workout_7d", "project_velocity_drop_30pct"],
        "strength": "cross_sphere_medium",
        "domains": ["health", "projects"],
        "cooldown": 7, "max_month": 2,
    },
}
```

### Throttling и приоритеты

```python
LIMITS = {
    "daily_max":          1,
    "weekly_max":         3,
    "cross_sphere_month": 4,
}

PRIORITY = [
    "cross_sphere_strong",   # 1. Самые ценные
    "strong",                # 2. Сильные
    "positive_strong",       # 3.
    "cross_sphere_medium",   # 4.
    "medium",                # 5.
    "positive",              # 6.
    "weak",                  # 7. Только если давно тихо
]

BLACKOUT = {
    "after_dilemma_opened": "24h",
    "user_muted":           "forever",
    "new_user_first_7d":    "gentle_only",
}
```

---

## 3. LLM Layer

Rule Layer выявляет сигнал. LLM Layer решает — говорить или нет, и как именно.

### Шаг 1 — Gate Check

Быстрый вызов на llama3.1:8b. Решает говорить или молчать до генерации текста.

```
GATE PROMPT:

Ты фильтр для AIR4. Твоя задача — отсеять банальные и бесполезные наблюдения.

Сигнал: {signal_type} | Confidence: {confidence}
Evidence: {evidence_summary}
Дней с последнего похожего: {days_since_similar}
Известные паттерны: {known_patterns}

Ответь ТОЛЬКО: SEND или SKIP

SEND если:
— Пользователь скажет "чёрт… он прав, я бы сам не заметил"
— Есть конкретная цифра или факт который удивит
— Есть связь между двумя+ сферами

SKIP если:
— Пользователь знает это без AIR4
— Нет actionable вывода
— Слишком рано (cooldown не прошёл)
— Confidence < 0.35

Будь жёстким. Лучше промолчать, чем сказать банальность.
```

Если Gate → SKIP: observation не генерируется. Конец.

### Шаг 2 — Данные для LLM

Порядок важен. Самое релевантное — первым.

```python
context = {
    "signal":    {"type": "cross_sphere_strong", "domains": ["finance", "projects"]},
    "evidence":  {
        "finance":   {"category": "food_restaurants", "spike_pct": 89, "amount": 340},
        "projects":  {"name": "AIR4", "days_stalled": 4},
    },
    "user":      {"known_patterns": ["стресс → рестораны"], "hardness": 8},
    "params":    {"confidence": 0.72, "max_sentences": 3, "end_with": "action"},
}
```

### Шаг 3 — Generation Prompt

```
Ты формулируешь наблюдение для AIR4. Характер: прямой, без смягчений, 8/10 жёсткости.

Данные: {context}

Жёсткие правила:
1. Первое предложение — факт с цифрой. Никаких вступлений.
2. Второе — связь или паттерн. Язык соответствует confidence {confidence}.
3. Третье — действие ИЛИ вопрос. Не оба. Не мораль.
4. Максимум 3 предложения. Жёстко.
5. Запрещено: "тебе следует", "попробуй", "рекомендую", "постарайся"
6. Запрещено: читать мораль, давать общие советы

Плохо: "Ты снова много тратишь на рестораны. Нужно контролировать расходы."
Хорошо: "Рестораны +89% за две недели — совпадает с паузой в AIR4. Третий раз подряд. Сэкономишь €150 если готовишь дома пока не разберёшься с проектом."
```

### Cross-sphere — минимальные требования

```python
CROSS_SPHERE_MIN = {
    "min_coinciding_periods": 2,
    "min_data_points_each":   3,
    "max_time_gap_days":      7,
    "min_confidence":         0.45,
}

LANGUAGE = {
    "weak":      "Интересное совпадение — ...",
    "medium":    "Это начинает выглядеть как паттерн...",
    "strong":    "Судя по последним {n} случаям...",
    "confirmed": "Это уже твой известный паттерн: ...",
}
```

LLM не утверждает причинно-следственную связь при < 3 совпадениях.

### Тон по агентам

```
FinanceAgent:  "Траты выросли на €160. Основная причина — рестораны (+89%)."
SportAgent:    "9 дней без тренировки. Это уже не пауза."
ProjectAgent:  "AIR4 не двигался 4 дня. Что происходит?"
MasterAgent:   "Когда проект буксует — ты компенсируешь едой. Третий раз за два месяца."
```

---

## 4. Confidence System

```python
def confidence(signal) -> float:
    s = 0.3
    s += min(signal.evidence_count * 0.1, 0.3)
    s += 0.2 if signal.matches_known_pattern else 0
    s += 0.1 if signal.data_age_days < 7 else 0
    s -= 0.15 if signal.data_age_days > 30 else 0
    s += 0.15 if len(signal.domains) > 1 else 0
    s += 0.1 if signal.user_confirmed_similar else 0
    s -= 0.1 if signal.user_rejected_similar else 0
    return min(max(s, 0.0), 1.0)
```

```
< 0.4        "Начинает выглядеть как..." / только вопрос в конце
0.4 – 0.65   "Похоже что..." / мягкий совет допустим
0.65 – 0.85  "Судя по данным за X недель..." / конкретный совет с цифрами
> 0.85       Прямой вывод / "Это твой известный паттерн: ..."
```

---

## 5. Delivery & Timing

### Decision Tree — говорить сегодня или нет

```
1. Есть сигналы от Rule Layer?
   НЕТ → стоп. Молчать.

2. Gate Check (LLM) → SEND или SKIP?
   SKIP → стоп. Молчать.

3. Соблюдены лимиты?
   daily_max=1, weekly_max=3
   НЕТ → отложить. Завтра.

4. Данные свежие? (< 30 дней)
   НЕТ → стоп. Молчать.

5. Пользователь не в blackout?
   НЕТ → стоп. Молчать.

6. Выбрать observation с наивысшим приоритетом из PRIORITY.

7. Генерировать текст (LLM Generation Prompt).

8. Доставить.
```

Каждый шаг — бинарное решение. Нет серых зон.

### Где доставляется

```
Dashboard:   Блок "AIR4 говорит". Максимум 1 одновременно.
             Если нечего — пусто. Не "всё хорошо!", просто пусто.

Чат:         Только если пользователь не писал > 24ч.
             "Заметил кое-что — ..."

Push (P9):   Только strong и cross_sphere_strong.
             Максимум 1 в день. 9:00 – 21:00.
```

### Пользовательский контроль

```
Mute типа:  "не показывай про спорт этот месяц"
Snooze:     "напомни через неделю"
Hardness:   1-10 в настройках
Confirm:    → confidence растёт
Reject:     → confidence падает
```

---

## 6. Anti-patterns

| Anti-pattern | Признак | Решение |
|---|---|---|
| Observation inflation | Говорит каждый день | Строгие лимиты. Нечего — молчать. |
| Банальность | "Ты много тратишь на еду" | Gate Check. Знает сам — не отправлять. |
| Surveillance | Комментирует одиночные покупки | Только паттерны (3+ events). |
| Judgment без action | Констатирует, не помогает | Каждый observation = action или вопрос. |
| Overconfidence | Уверенный вывод из 1 точки | Confidence system обязателен. |
| Tone mismatch | SportAgent говорит как психолог | Промпт адаптируется по агенту. |

---

## 7. Примеры

### Хорошие

```
Кросс-сферный (confidence 0.72):
"Рестораны выросли на 89% за две недели — совпадает с паузой в AIR4.
Это уже третий раз. Сэкономишь €150 если готовишь дома пока не разберёшься с проектом."

Inactivity (confidence 0.55):
"9 дней без тренировки. По данным энергия просела — пишешь меньше и позже.
Что мешает сегодня?"

Проектный, жёсткий:
"SkipMar не двигался 7 дней. В прошлый раз когда так было — ты его бросил.
Это то же самое или что-то изменилось?"

Финансовый, проактивный:
"Выписка не загружалась 18 дней. Либо всё хорошо и ты боишься проверить — либо забыл.
Загрузи — разберёмся."
```

### До/После

```
До:   "Ты снова не тренировался несколько дней. Это нехорошо для здоровья.
       Попробуй найти время для тренировок."

После: "8 дней без тренировки. Что мешает?"
```

---

## 8. Evaluation & Iteration

### Метрики

```
Главная:         "Чёрт… он прав" rate — цель: 5+ за 2 недели (Phase 6.5)
Open rate:       % прочитанных (не скипнутых)
Act rate:        % приведших к действию или ответу в чате
Mute rate:       % отключённых пользователем
False positive:  % опровергнутых пользователем
Cross-sphere:    % кросс-сферных которые подтвердились
```

### A/B тестирование

```python
VARIANTS = {
    "direct":   {"style": "statement", "end_with": "action"},
    "question": {"style": "open",      "end_with": "question"},
}
# После 10+ observations каждого — сравниваем open rate и act rate.
# Итерируем промпт на данных, не интуиции.
```

### Процесс (Phase 6.5)

```
1. Логировать все observations: тип, confidence, реакция пользователя
2. Еженедельно: что сработало, что нет
3. Категоризировать неудачи: банальность / surveillance / judgment / tone
4. Корректировать Rule Layer thresholds и cooldown
5. Итерировать Gate Check и Generation промпты
6. A/B новых формулировок
```

### Сигналы что работает / не работает

```
✓ Пользователь начинает разговор после observation
✓ Упоминает observation в дилеммах
✓ Возвращается сказать "ты был прав"

✗ Скипает не читая
✗ Отключает тип
✗ "Это я и так знал"
✗ Открывает AIR4 реже после частых observations
```
