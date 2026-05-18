# DEVELOPMENT_STRATEGY.md
# AIR4 — Development Strategy

> Этот документ определяет порядок разработки.
> Cursor должен следовать этой стратегии при реализации.

---

## Главный принцип

Сначала облако — потом локально.

Не строим локальный AI пока не убедились что продукт работает и даёт ценность.

---

## Phase A — Cloud First (сейчас)

Цель: проверить что AIR4 реально работает и даёт "чёрт… он прав" моменты.

### LLM
```
Chat (все запросы)     → Claude API (claude-sonnet-4-5)
Категоризация CSV      → Claude API
Observations           → Claude API
PDF анализы            → Claude API
```

### База данных
```
SQLite локально → air4.db на устройстве пользователя
Данные никуда не уходят — только LLM запросы в облако
```

### Стек Phase A
```
Frontend:  React + TypeScript + Tailwind (уже готов)
Backend:   FastAPI (Python) или Express (Node) — выбрать один
Database:  SQLite — air4.db локально
LLM:       Claude API (anthropic SDK)
CSV:       Python pandas или papaparse
```

### Что НЕ строим в Phase A
```
✗ Ollama / локальные модели
✗ Anonymization layer
✗ Smart Mode / Full Mode переключение
✗ Vector search / embeddings
✗ Memory lifecycle (archive/summarize)
✗ Mobile
✗ Сложный Context Manager — простой достаточно
```

---

## Phase B — Hybrid (после валидации)

Когда: после 2-4 недель реального использования и подтверждения ценности.

```
Простые запросы        → Ollama локально (llama3.1:8b)
Сложный анализ         → Claude API анонимно
Категоризация          → Ollama локально
Observations           → Ollama (rule layer) + Claude (generation)
PDF анализы            → Claude API (качество важнее приватности)
```

Переключение между Cloud и Local — одна строчка в `.env`:
```
LLM_MODE=cloud    # Phase A
LLM_MODE=hybrid   # Phase B
LLM_MODE=local    # Phase C
```

---

## Phase C — Local First (продакшн)

Когда: после Phase B валидации, когда качество локальных моделей устраивает.

```
Всё локально           → qwen3.6:27b via Ollama (MTP для скорости)
Только для анализов    → Claude API анонимно
```

---

## Порядок разработки (Phase A)

### Sprint 1 — База и данные
1. Создать `air4.db` по DATABASE_SCHEMA.md
2. CSV парсер для Swedbank (s4.csv, s5.csv, s6.csv, s7.csv уже есть)
3. Категоризация через Claude API
4. Эндпоинты: POST /upload, GET /transactions, GET /summary

### Sprint 2 — Умный чат
1. Подключить Claude API вместо Gemini
2. Простой Context Manager — читает из SQLite
3. Event extractor — сохраняет события из чата
4. Fact extractor — сохраняет факты о пользователе

### Sprint 3 — Observations
1. Rule Layer — простые триггеры (inactivity, spending spikes)
2. Observation generation через Claude
3. Показ на Overview

### Sprint 4 — Polish
1. Projects с логами
2. Health базовый
3. Dilemmas
4. Memory экран с реальными данными

---

## .env конфигурация

```bash
# Phase A — всё через Claude
LLM_MODE=cloud
ANTHROPIC_API_KEY=sk-ant-...

# Phase B — гибрид (раскомментировать позже)
# LLM_MODE=hybrid
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=qwen3.6:27b

DATABASE_URL=./data/air4.db
```

---

## Важно для Cursor

При генерации кода:
- Используй `anthropic` SDK, не `@google/genai`
- Все LLM вызовы через единый `llm_client.py` (или `llmClient.ts`)
- Всегда читай контекст из SQLite перед запросом к Claude
- Не строй сложную архитектуру — сначала работающий MVP
