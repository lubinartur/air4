# SYSTEM_ARCHITECTURE.md
# AIR4 — System Architecture v3

> Local-first personal AI advisor. All data stays on device.
> See also: OBSERVATION_ENGINE.md, CHARACTER_SYSTEM.md, DATABASE_SCHEMA.md

---

## Архитектурное видение

AIR4 — не просто чат с AI. Это система которая знает пользователя, думает о нём между сессиями и говорит когда есть что сказать.

Три архитектурных принципа которые определяют все решения:

**Local first.** Данные не покидают устройство без явного разрешения. Это не ограничение — это конкурентное преимущество.

**Минимальный достаточный контекст.** Context Manager решает что релевантно для конкретного запроса. Не "пихаем всё" — а "что нужно прямо сейчас?"

**Редко но точно.** Observation Engine говорит только когда есть реальный сигнал. Молчание — тоже решение. Частота — враг доверия.

```
User Input
    ↓
Next.js Frontend (localhost:3000)
    ↓
FastAPI Backend (localhost:8000)
    ↓
Context Manager ← SQLite + Vector Index
    ↓
Query Classifier → Agent Router
    ↓
Agent (Finance / Sport / Project / Life / Master)
    ↓
LLM (Ollama localhost:11434)
    ↓
Response Pipeline (events, facts, observations)
    ↓
Frontend
```

---

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14 + TypeScript + Tailwind | Быстро, App Router |
| Backend | FastAPI (Python) | Простой, async |
| Database | SQLite | Локально, без настройки |
| Vector Index | sqlite-vec или ChromaDB | Semantic search |
| LLM Fast | llama3.1:8b via Ollama | Простые запросы, Gate Check |
| LLM Smart | qwen2.5:32b via Ollama | Сложный анализ, observations |
| CSV Parsing | Python pandas | Стандарт |

---

## Frontend Architecture

### Routes
```
/              → Overview (Dashboard of Life)
/dashboard     → Finance Dashboard
/timeline      → Сравнение периодов
/upload        → Загрузка CSV
/projects      → Проекты
/health        → Health Dashboard
/goals         → Goals & Wishlist
/dilemmas      → Дилеммы
/hypotheses    → Паттерны
/events        → События
/facts         → Факты о пользователе
/interview     → Interview режим
/profile       → Профиль пользователя
/chat          → Полноэкранный чат (MasterAgent)
```

### Key Components
```
ChatSidebar.tsx        — Чат панель (всегда открыта справа)
ChatWindow.tsx         — Полноэкранный чат
MainWithChatPanel.tsx  — Layout: контент + чат
SiteHeader.tsx         — Шапка с навигацией + "+ Add event"
FileUpload.tsx         — Drag & drop загрузка CSV
SpendingChart.tsx      — Графики трат
TransactionTable.tsx   — Таблица транзакций
InsightCard.tsx        — Карточка AI инсайта
ObservationCard.tsx    — Карточка наблюдения
HypothesisCard.tsx     — Карточка паттерна
CrossSphereCard.tsx    — Карточка кросс-сферного инсайта
SessionTimer.tsx       — Таймер сессии для проектов
```

### Page Context System
Каждая страница передаёт минимальный lightweight контекст через `pageContext.ts`.

**Принцип:** page context — подсказка агенту, не full-page dump.

```typescript
// Только то что нужно для понимания намерения
{
  page: "dashboard",
  agent: "FinanceAgent",
  focus: "spending",
  period: "2024-01"   // только если релевантно
}
```

---

## Backend Architecture

### Structure
```
backend/
├── main.py
├── database.py
├── routers/           (все endpoints)
└── services/
    ├── context_manager.py     ← CRITICAL: Context Prioritization Layer
    ├── agent_router.py        — выбор агента по странице/запросу
    ├── analyzer.py            — Core chat (MasterAgent)
    ├── query_classifier.py    — Query type routing
    ├── anonymizer.py          — Strip PII перед Smart Mode
    ├── vector_search.py       — Semantic search через embeddings
    ├── categorizer.py
    ├── parser.py
    ├── event_extractor.py
    ├── fact_extractor.py
    ├── hypothesis_generator.py
    ├── cross_sphere_analyzer.py
    ├── observation_engine.py  ← Hybrid: rules + LLM (см. OBSERVATION_ENGINE.md)
    ├── dilemma_analyzer.py
    ├── session_tracker.py     — Session Timer для проектов
    └── interviewer.py
```

---

## Agent System

AIR4 — система специализированных агентов с общей памятью. Для пользователя всегда один AIR4. Переключения невидимы.

Подробнее о характере каждого агента: **CHARACTER_SYSTEM.md**

```
Страница          Агент           Видит                    Тон
─────────────────────────────────────────────────────────────────────
Overview          MasterAgent     всё через Context Manager thinking companion
Finance           FinanceAgent    финансы                  холодный аналитик
Health            SportAgent      здоровье                 строгий тренер
Projects          ProjectAgent    проекты + сессии         требовательный продакт
Life/Goals        LifeAgent       события, цели            честный компаньон
```

### Agent Router
```python
def route_agent(page: str, query: str) -> Agent:
    # Явное указание страницы → специализированный агент
    page_agents = {
        "dashboard":  FinanceAgent,
        "health":     SportAgent,
        "projects":   ProjectAgent,
        "goals":      LifeAgent,
    }
    if page in page_agents:
        return page_agents[page]

    # Overview или полноэкранный чат → MasterAgent
    return MasterAgent
```

---

## Context Manager — Critical Layer

> Главная архитектурная опасность AIR4: gigantic context injection.
> Весь контекст в каждый запрос = latency + шум + context dilution.

`context_manager.py` решает что релевантно для конкретного запроса.

**Принцип:** минимальный достаточный контекст — не максимальный.

### Token Budget
```python
TOKEN_BUDGET = 2000  # жёсткий лимит на контекст

PRIORITY_WEIGHTS = {
    "user_profile":      "HIGH",    # всегда, ~100 токенов
    "current_page":      "HIGH",    # всегда, lightweight
    "confirmed_facts":   "HIGH",    # permanent facts only
    "recent_events":     "MEDIUM",  # последние 5, не 20
    "active_projects":   "MEDIUM",  # только если planning query
    "spending_summary":  "MEDIUM",  # только если finance контекст
    "semantic_matches":  "MEDIUM",  # релевантные воспоминания из vector search
    "observations":      "LOW",     # только непрочитанные < 7 дней
    "hypotheses":        "LOW",     # только confirmed
    "dilemmas":          "LOW",     # только open
    "interview_answers": "LOW",     # только если reflective query
    "cross_sphere":      "LOW",     # только если analytical query
}
```

### Selection Algorithm
```python
def build_context(query: str, query_type: str, page: str, agent: str) -> str:
    context = []
    budget = TOKEN_BUDGET

    # 1. Core identity — всегда
    context.append(get_profile_summary())      # ~100 токенов
    context.append(get_confirmed_facts())      # permanent only

    # 2. Semantic search — релевантные воспоминания
    semantic_results = vector_search(query, limit=3)
    context.append(format_semantic_results(semantic_results))

    # 3. По типу запроса
    if query_type == "financial":
        context.append(get_spending_summary())
        context.append(get_recent_transactions(limit=10))

    elif query_type == "analytical":
        context.append(get_confirmed_hypotheses())
        context.append(get_cross_sphere_insights())

    elif query_type == "planning":
        context.append(get_active_projects())
        context.append(get_project_sessions(days=7))
        context.append(get_open_dilemmas())

    elif query_type == "health":
        context.append(get_recent_workouts(limit=10))
        context.append(get_body_metrics(limit=3))

    # 4. Свежие события — всегда последними
    context.append(get_recent_events(limit=5, importance_min=2))

    return truncate_to_budget(context, budget)
```

### Freshness Rules
```
user_profile:    permanent
user_facts:      permanent
events:          релевантны < 30 дней
observations:    релевантны < 7 дней + is_read=false
hypotheses:      только confirmed
cross_sphere:    релевантны < 14 дней
health_checkups: последние 3 записи
project_sessions: последние 14 дней
```

---

## Vector Search

Embeddings хранятся в таблице `embeddings` (см. DATABASE_SCHEMA.md). Векторный индекс — sqlite-vec или ChromaDB.

### Как используется
```python
def vector_search(query: str, limit: int = 3) -> list:
    """
    Находит семантически близкие воспоминания.
    Используется для обогащения контекста релевантными данными
    которые не попадут через фильтрацию по дате или типу.
    """
    query_embedding = embed(query)  # nomic-embed-text или all-minilm
    results = index.search(query_embedding, limit=limit)
    return filter_by_freshness(results, max_age_days=60)
```

### Когда критичен
- Пользователь упоминает что-то из прошлого: "помнишь ту встречу с инвестором?"
- Поиск похожих паттернов: "это же было со мной раньше"
- Reflective запросы: "как у меня дела в целом?"

---

## Query Classifier

### Current
```
Query → llama3.1:8b → SIMPLE / COMPLEX
SIMPLE  → llama3.1:8b   (факты, навигация, ~100ms)
COMPLEX → qwen2.5:32b   (анализ, паттерны, ~2-5s)
```

### Planned Extension
```python
QUERY_TYPES = {
    "factual":    "сколько потратил на еду?",           # llama, минимум контекста
    "analytical": "почему я трачу больше в стрессе?",   # qwen, полный контекст
    "reflective": "как у меня дела в целом?",           # qwen, memory-heavy
    "planning":   "что важнее — AIR4 или 4Track?",      # qwen, projects+goals
    "emotional":  "я устал и не понимаю куда двигаться",# qwen, companion mode
    "dilemma":    "думаю уйти с работы",                # qwen, structured analysis
    "health":     "что делать на тренировке сегодня?",  # qwen, health context
}
```

---

## Observation Engine

> Подробная документация: **OBSERVATION_ENGINE.md**

Hybrid архитектура: Rule Layer (детерминированный) + LLM Layer (интерпретация).

### Gate Check в архитектуре
```
Rule Layer срабатывает
    ↓
Gate Check (llama3.1:8b, ~50ms)
    ↓
SKIP → стоп, не тратим токены qwen
SEND → Generation (qwen2.5:32b)
    ↓
Observation с confidence + evidence + domains
```

Gate Check — быстрый и дешёвый фильтр который отсеивает банальные observations до генерации. Экономит токены и защищает доверие пользователя.

Confidence language: см. **OBSERVATION_ENGINE.md §4**

---

## Projects Module

### Session Timer
```
POST /api/projects/{id}/sessions/start  — запуск таймера
POST /api/projects/{id}/sessions/stop   — остановка + auto-log prompt
GET  /api/projects/{id}/sessions        — история сессий
GET  /api/projects/focus-distribution   — % времени по проектам
```

После остановки AIR4 спрашивает "что сделал?" — ответ сохраняется в project_logs через event_extractor.

### Roadmap
```
POST /api/projects/{id}/milestones      — создать milestone
PUT  /api/projects/{id}/milestones/{m}  — обновить статус
GET  /api/projects/{id}/roadmap         — план vs реальность
```

### Stall Detection (Rule Layer)
```python
STALL_RULES = {
    "weak":    {"days_inactive": 3,  "signal": "flag in UI"},
    "strong":  {"days_inactive": 7,  "signal": "observation"},
    "critical":{"days_inactive": 14, "signal": "strong observation + history"},
}
```

---

## Health Module

### Phase 1 — Basic
Тренировки, вес, streak, логирование через чат.

### Phase 2 — Health Assistant
```
POST /api/health/checkups          — загрузка PDF анализов (→ Smart Mode)
GET  /api/health/markers           — динамика показателей
GET  /api/health/markers/{name}    — история конкретного маркера
```

### Phase 3 — Advanced Tracking
```
POST /api/health/protocols         — новый протокол
POST /api/health/protocols/{id}/log — запись через чат
GET  /api/health/hormones          — гормональный профиль
```

**Правило:** AIR4 никогда не ставит диагнозы и не рекомендует дозировки.

---

## Smart Mode — Anonymization Layer

Обязательный слой перед отправкой данных в облако.

### Что strip'ается
```python
STRIP_BEFORE_CLOUD = [
    "name", "iban", "merchant_name",
    "location", "phone", "email",
    "account_number", "transaction_id",
]

# Что остаётся:
# category + amount + period + trend + anomaly_flag
# Пример: "food_restaurants €340, +89% vs 4w avg"
```

### Preview для пользователя
```
До отправки пользователь видит:
  "AIR4 отправит в облако:
   — Сводка трат по категориям (без названий магазинов)
   — Период: январь 2024
   — Без имён, IBAN и личных данных"
  [Отправить] [Отмена]
```

### Когда оправдан
```
✓ Анализы и чекапы — качество важнее приватности
✓ Дилеммы — сложный reasoning
✓ Кросс-сферный анализ MasterAgent
✓ Генерация роадмапа
✗ Категоризация транзакций — локального достаточно
✗ Простые вопросы — локального достаточно
```

### Лог прозрачности
Каждый cloud request логируется в `cloud_requests_log` (см. DATABASE_SCHEMA.md). Пользователь может посмотреть историю что и когда уходило.

---

## Data Flow

### Chat Message → Response
```
1. User sends message
2. Frontend: lightweight page context + agent hint
3. POST /api/chat
4. agent_router → выбирает агента
5. query_classifier → тип запроса
6. context_manager → минимальный достаточный контекст
   + vector_search → семантически релевантные воспоминания
7. [Smart Mode?] → anonymizer если нужно
8. LLM генерирует ответ с системным промптом агента
9. event_extractor → извлекает события
10. fact_extractor → извлекает факты
11. Response → Frontend
```

### Observation Pipeline
```
1. Trigger: при входе пользователя или по расписанию
2. Rule Layer → проверяет все триггеры (без LLM)
3. Gate Check (llama) → SEND или SKIP
4. SEND → Generation (qwen) → observation с confidence
5. Сохраняет в observations с metadata
6. Frontend показывает на Overview

Подробнее: OBSERVATION_ENGINE.md
```

### Upload CSV → Insights
```
1. User uploads CSV
2. parser → парсит Swedbank, дедуплицирует переводы
3. categorizer → батчи по 20 → qwen → category
4. Непонятные транзакции → AIR4 спрашивает через чат
5. analyzer → генерирует инсайты
6. embeddings → создаёт векторы для новых транзакций
```

---

## Error Handling & Observability

Локальный продукт требует особого подхода — нет облачного мониторинга, нет алертов. Пользователь должен понимать что происходит.

### LLM Errors
```python
async def call_llm(prompt: str, model: str) -> str:
    try:
        response = await ollama.chat(model=model, messages=[...])
        return response
    except OllamaConnectionError:
        # Ollama не запущен
        return fallback_response("Ollama недоступен. Запусти: ollama serve")
    except ModelNotFoundError:
        # Модель не загружена
        return fallback_response(f"Модель {model} не найдена. Запусти: ollama pull {model}")
    except TimeoutError:
        # Слишком долго
        if model == SMART_MODEL:
            # Fallback на быструю модель
            return await call_llm(prompt, FAST_MODEL)
        return fallback_response("Превышено время ожидания")
```

### Database Errors
```python
# WAL mode для concurrent reads
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;

# Автоматический backup при старте
def backup_on_startup():
    if db_exists():
        shutil.copy("air4.db", f"air4_backup_{date}.db")
        cleanup_old_backups(keep=7)
```

### Frontend Error States
```
LLM недоступен    → "AIR4 думает... Убедись что Ollama запущен"
DB ошибка         → Toast с деталями, без крэша
Smart Mode ошибка → Fallback на локальный режим автоматически
Пустые данные     → Пустые блоки без ошибок, с подсказкой что делать
```

### Logging
```python
# Структурированные логи без PII
logger.info("observation_generated", {
    "type": observation.observation_type,
    "confidence": observation.confidence,
    "domains": observation.domains_involved,
    "gate_check": "SEND",
    # НЕ логируем: текст observation, данные пользователя
})

logger.info("llm_request", {
    "model": model,
    "query_type": query_type,
    "context_tokens": len(context),
    "response_time_ms": elapsed,
    # НЕ логируем: промпт, ответ, личные данные
})
```

---

## Privacy Modes

```
Full Local (default):
  Весь трафик: localhost only
  Ноль внешних запросов
  Ollama + SQLite

Smart Mode:
  + Claude API / GPT-4 для сложного reasoning
  Anonymization Layer обязателен
  Preview перед каждой отправкой
  Лог всех cloud requests

Full Mode (Phase 10):
  + Внешние данные (погода, курсы, поиск)
  Данные всегда локально
  Internet access только для запросов, не для данных
```

---

## Current Limitations

- **Context Manager** — базовая реализация. Приоритизация и token budget нужно доработать.
- **Vector Search** — таблица есть в схеме, runtime интеграция нужна.
- **Observation Engine** — Rule Layer не реализован, только LLM.
- **Memory Lifecycle** — не реализован. Данные накапливаются.
- **Agent Router** — один промпт для всех. Специализация агентов нужна.
- **SQLCipher** — нет шифрования (Phase 8).
- **Error handling** — базовый. Production-ready нужен в Phase 8.

---

## Planned Improvements

| Component | Current | Planned | Phase |
|-----------|---------|---------|-------|
| Context Manager | базовый | Token budget + semantic search | 6-7 |
| Vector Search | схема есть | Runtime интеграция | 7 |
| Observation Engine | LLM only | Rule layer + Gate Check | 7 |
| Agent Router | один промпт | Специализация по страницам | 7 |
| Memory Lifecycle | нет | Archive/summarize | 7-8 |
| Session Timer | нет | Projects module | 8 |
| Health Checkups | нет | PDF upload + Smart Mode | 7-8 |
| Anonymization | нет | Smart Mode layer | 10 |
| SQLCipher | нет | Шифрование базы | 8 |
| Error handling | базовый | Production-ready | 8 |
| Mobile sync | нет | Локальная синхронизация | 9 |
