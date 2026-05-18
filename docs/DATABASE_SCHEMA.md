# DATABASE_SCHEMA.md
# AIR4 — Database Schema v2

> SQLite. Local only. One file: air4.db
> All personal data stays on device.

---

## Philosophy

База данных AIR4 — это не просто хранилище. Это память системы. Каждая таблица отвечает на вопрос: что AIR4 должен помнить чтобы говорить точно?

Три уровня памяти:
```
Short-term  → events, observations (дни)
Mid-term    → summaries, hypotheses (недели)
Long-term   → facts, profile, confirmed patterns (навсегда)
```

---

## Schema Overview

```
air4.db
├── Core Identity
│   ├── user_profile          — кто ты (single row)
│   └── user_facts            — устойчивые свойства (permanent)
├── Memory
│   ├── events                — базовая единица памяти
│   ├── daily_summaries       — сжатие событий за день
│   ├── weekly_reflections    — еженедельный контекст
│   ├── embeddings            — векторные представления
│   ├── tags                  — теги и сущности
│   ├── event_tags            — связь events ↔ tags
│   └── interview_answers     — глубокий контекст
├── Finance
│   ├── uploads               — метаданные выписок
│   ├── transactions          — транзакции с хешем
│   └── insights              — AI инсайты
├── Projects
│   ├── projects              — проекты
│   └── project_logs          — история активности
├── Analysis
│   ├── hypotheses            — долгосрочные паттерны
│   ├── cross_sphere_insights — кросс-сферные связи
│   ├── observations          — краткосрочные сигналы
│   └── dilemmas              — решения с фоллоу-апом
└── Health (Phase 7)
    ├── workouts              — тренировки
    └── body_metrics          — вес, рост
```

---

## Core Identity

### user_profile
Единственная запись. Основной контекст пользователя.

```sql
CREATE TABLE user_profile (
    id              INTEGER PRIMARY KEY CHECK (id = 1),  -- single row enforced
    name            TEXT,
    city            TEXT,
    profession      TEXT,
    monthly_income  REAL,
    goals           TEXT,       -- JSON array ["запустить AIR4", "поездка в Японию"]
    transport       TEXT,
    context         TEXT,       -- свободный текст о пользователе
    timezone        TEXT DEFAULT 'UTC',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Гарантируем single row
CREATE UNIQUE INDEX idx_user_profile_single ON user_profile(id);
```

**Использование:** инжектируется в каждый запрос всех агентов. Сжатая версия — core identity.

---

### user_facts
Долгосрочные устойчивые свойства пользователя. Не события — характеристики.

```sql
CREATE TABLE user_facts (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,   -- "work_hours", "stress_pattern"
    value       TEXT NOT NULL,          -- "работает лучше между 22:00 и 01:00"
    confidence  REAL DEFAULT 1.0,       -- насколько уверены в этом факте
    source      TEXT DEFAULT 'chat',    -- "chat" | "interview" | "manual" | "inferred"
    evidence    TEXT,                   -- JSON array ссылок на events которые подтвердили
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
```

**Lifecycle:** permanent. Только явное удаление пользователем.

**Отличие от events:** facts = "кто ты". Events = "что произошло".

```
Примеры:
  key: "work_style"        value: "работает лучше между 22:00 и 01:00"
  key: "transport"         value: "не любит транспорт, предпочитает пешком"
  key: "stress_pattern"    value: "в стрессе тратит больше на еду вне дома"
  key: "focus_capacity"    value: "не может эффективно вести больше 2 проектов"
```

---

## Memory

### events
**Базовая единица памяти AIR4.** Всё что происходит в жизни пользователя.

```sql
CREATE TABLE events (
    id              INTEGER PRIMARY KEY,

    -- Время
    date            TEXT NOT NULL,          -- "2024-01-15" (дата события)
    timestamp       TEXT,                   -- "2024-01-15T22:30:00" (точное время если известно)

    -- Контент
    title           TEXT NOT NULL,          -- краткое название
    description     TEXT,                   -- развёрнутое описание
    original_text   TEXT,                   -- оригинал из чата до обработки
    processed_text  TEXT,                   -- нормализованный текст для поиска

    -- Классификация
    domain          TEXT NOT NULL,          -- "finance" | "health" | "projects" | "life" | "personal"
    category        TEXT,                   -- подкатегория: "workout", "expense", "milestone"
    importance      INTEGER DEFAULT 2,      -- 1=low, 2=medium, 3=high, 4=critical

    -- Метаданные (зависят от domain)
    metadata        TEXT,                   -- JSON, структура зависит от domain:
                                            -- health: {"type":"strength","duration":60,"exercises":[...]}
                                            -- finance: {"amount":45.20,"merchant":"Rimi","category":"groceries"}
                                            -- projects: {"project_id":1,"milestone":"v1 launch"}

    -- Память
    embedding_id    INTEGER REFERENCES embeddings(id),  -- вектор для semantic search
    source          TEXT DEFAULT 'chat',    -- "chat" | "manual" | "system" | "apple_health"

    -- Lifecycle
    archived        INTEGER DEFAULT 0,      -- 0=active, 1=archived
    archive_after   TEXT,                   -- дата автоархивации (default: +60 days)
    summarized      INTEGER DEFAULT 0,      -- включён ли в daily_summary

    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_domain ON events(domain);
CREATE INDEX idx_events_archived ON events(archived);
CREATE INDEX idx_events_importance ON events(importance);
```

**Metadata примеры по domain:**

```json
// domain: "health", category: "workout"
{
  "type": "strength",
  "duration": 60,
  "exercises": [
    {"name": "bench_press", "sets": 3, "reps": 10, "weight": 80},
    {"name": "squat", "sets": 3, "reps": 8, "weight": 100}
  ],
  "energy_level": 4,
  "notes": "хорошая тренировка"
}

// domain: "finance", category: "expense"
{
  "amount": 45.20,
  "currency": "EUR",
  "merchant": "Rimi",
  "category": "food_groceries",
  "account": "EE123456"
}

// domain: "projects", category: "milestone"
{
  "project_id": 1,
  "project_name": "AIR4",
  "milestone": "MVP запущен",
  "status_before": "in_progress",
  "status_after": "completed"
}
```

---

### daily_summaries
Сжатие событий за день. Основа Memory Lifecycle.

```sql
CREATE TABLE daily_summaries (
    id          INTEGER PRIMARY KEY,
    date        TEXT NOT NULL UNIQUE,   -- "2024-01-15"
    summary     TEXT NOT NULL,          -- "Активная рабочая среда: 6ч на AIR4, тренировка вечером, расходы в норме"
    domains     TEXT,                   -- JSON array доменов за день: ["projects", "health"]
    event_count INTEGER DEFAULT 0,      -- сколько событий за день
    key_facts   TEXT,                   -- JSON array важных фактов из этого дня
    embedding_id INTEGER REFERENCES embeddings(id),
    created_at  TEXT DEFAULT (datetime('now'))
);
```

**Lifecycle:** создаётся автоматически в конце дня или при архивации событий. Заменяет детальные events в контексте после 30 дней.

---

### weekly_reflections
Еженедельный контекст. Паттерны и настроение недели.

```sql
CREATE TABLE weekly_reflections (
    id              INTEGER PRIMARY KEY,
    week_start      TEXT NOT NULL UNIQUE,   -- "2024-01-13" (понедельник)
    week_end        TEXT NOT NULL,          -- "2024-01-19"
    summary         TEXT NOT NULL,          -- нарратив недели
    mood            TEXT,                   -- "productive" | "stressed" | "recovering" | "balanced"
    highlights      TEXT,                   -- JSON array ключевых событий
    domains_active  TEXT,                   -- JSON: {"projects": 4, "health": 3, "finance": 1}
    cross_sphere    TEXT,                   -- замеченные межсферные связи за неделю
    embedding_id    INTEGER REFERENCES embeddings(id),
    created_at      TEXT DEFAULT (datetime('now'))
);
```

---

### embeddings
Векторные представления для semantic search.

```sql
CREATE TABLE embeddings (
    id              INTEGER PRIMARY KEY,
    content_type    TEXT NOT NULL,  -- "event" | "fact" | "summary" | "observation"
    content_id      INTEGER,        -- id записи в исходной таблице
    content_preview TEXT,           -- первые 200 символов для debug
    vector          BLOB,           -- сериализованный float32 array
    model           TEXT,           -- "nomic-embed-text" | "all-minilm"
    dimensions      INTEGER,        -- размерность вектора (384, 768, etc)
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_embeddings_type ON embeddings(content_type);
CREATE INDEX idx_embeddings_content ON embeddings(content_type, content_id);
```

**Использование:** semantic search для нахождения релевантных воспоминаний. Внешний векторный индекс через ChromaDB или sqlite-vec для быстрого поиска.

---

### tags
Теги и сущности извлечённые из событий.

```sql
CREATE TABLE tags (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,   -- "рестораны", "AIR4", "стресс"
    tag_type    TEXT DEFAULT 'topic',   -- "topic" | "person" | "place" | "project" | "emotion"
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE event_tags (
    event_id    INTEGER REFERENCES events(id) ON DELETE CASCADE,
    tag_id      INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, tag_id)
);
```

---

### interview_answers
Ответы из interview режима.

```sql
CREATE TABLE interview_answers (
    id          INTEGER PRIMARY KEY,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    domain      TEXT,           -- к какой сфере относится
    created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## Finance

### uploads

```sql
CREATE TABLE uploads (
    id                  INTEGER PRIMARY KEY,
    filename            TEXT NOT NULL,
    account_iban        TEXT,
    period_start        TEXT,
    period_end          TEXT,
    total_transactions  INTEGER,
    created_at          TEXT DEFAULT (datetime('now'))
);
```

---

### transactions

```sql
CREATE TABLE transactions (
    id                    INTEGER PRIMARY KEY,
    upload_id             INTEGER REFERENCES uploads(id),
    transaction_hash      TEXT UNIQUE,    -- SHA256(date+amount+description) для дедупликации
    date                  TEXT NOT NULL,
    description           TEXT,
    amount                REAL NOT NULL,
    currency              TEXT DEFAULT 'EUR',
    category              TEXT,
    category_confirmed    INTEGER DEFAULT 0,
    account_iban          TEXT,
    is_debit              INTEGER DEFAULT 1,
    is_internal_transfer  INTEGER DEFAULT 0,
    raw_description       TEXT,
    created_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_hash ON transactions(transaction_hash);
CREATE INDEX idx_transactions_debit ON transactions(is_debit, is_internal_transfer);
```

---

### insights

```sql
CREATE TABLE insights (
    id           INTEGER PRIMARY KEY,
    upload_id    INTEGER REFERENCES uploads(id),
    insight_text TEXT NOT NULL,
    insight_type TEXT,  -- "anomaly" | "pattern" | "recommendation"
    created_at   TEXT DEFAULT (datetime('now'))
);
```

---

## Projects

### projects

```sql
CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'active',  -- "active" | "stalled" | "completed" | "archived"
    priority    INTEGER DEFAULT 2,      -- 1=low, 2=medium, 3=high
    started_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
```

---

### project_logs

```sql
CREATE TABLE project_logs (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    note        TEXT NOT NULL,
    log_type    TEXT DEFAULT 'update',  -- "update" | "milestone" | "blocker" | "decision"
    source      TEXT DEFAULT 'manual',  -- "manual" | "chat"
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_project_logs_project ON project_logs(project_id);
CREATE INDEX idx_project_logs_date ON project_logs(created_at);
```

---

## Analysis

### Hypotheses vs Observations — чёткое разделение

```
hypotheses   = долгосрочные паттерны поведения
               "ты всегда распыляешься в периоды стресса"
               Живут недели и месяцы. Требуют подтверждения.

observations = краткосрочные сигналы прямо сейчас
               "ты не тренировался 9 дней"
               Живут дни. Создаются Observation Engine автоматически.
```

---

### hypotheses

```sql
CREATE TABLE hypotheses (
    id              INTEGER PRIMARY KEY,
    text            TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',  -- "pending" | "confirmed" | "rejected"
    confidence      REAL DEFAULT 0.5,        -- 0.0 - 1.0
    evidence_count  INTEGER DEFAULT 1,       -- сколько событий подтверждают
    evidence_refs   TEXT,                    -- JSON array event_ids
    domains         TEXT,                    -- JSON array: ["finance", "health"]
    confirmed_at    TEXT,
    rejected_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
```

---

### cross_sphere_insights

```sql
CREATE TABLE cross_sphere_insights (
    id          INTEGER PRIMARY KEY,
    sphere1     TEXT NOT NULL,   -- "finance" | "health" | "projects" | "life"
    sphere2     TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    confidence  REAL DEFAULT 0.5,
    evidence    TEXT,            -- JSON array подтверждающих данных
    is_active   INTEGER DEFAULT 1,
    expires_at  TEXT,            -- автоархивация через 14 дней
    created_at  TEXT DEFAULT (datetime('now'))
);
```

---

### observations

```sql
CREATE TABLE observations (
    id               INTEGER PRIMARY KEY,
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    observation_type TEXT NOT NULL,     -- "inactivity" | "spending_spike" | "streak_break"
                                        -- "cross_domain" | "positive" | "stalled_project"
    confidence       REAL DEFAULT 0.5,  -- 0.0 - 1.0
    evidence_count   INTEGER DEFAULT 1,
    evidence_refs    TEXT,              -- JSON array: event_ids или rule triggers
    domains_involved TEXT,             -- JSON array: ["finance", "health"]
    triggered_by     TEXT DEFAULT 'rule_layer',  -- "rule_layer" | "llm_layer" | "both"
    is_hypothesis    INTEGER DEFAULT 1,           -- всегда 1 — observation ≠ fact
    is_read          INTEGER DEFAULT 0,
    expires_at       TEXT,             -- автоархивация (default: +7 days)
    created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_observations_read ON observations(is_read);
CREATE INDEX idx_observations_expires ON observations(expires_at);
```

---

### dilemmas

```sql
CREATE TABLE dilemmas (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    options         TEXT,           -- JSON array вариантов
    analysis        TEXT,           -- AI анализ
    recommendation  TEXT,           -- конкретная рекомендация
    status          TEXT DEFAULT 'open',  -- "open" | "decided" | "abandoned"
    followup_due    TEXT,           -- через 2 недели
    followup_done   INTEGER DEFAULT 0,
    followup_answer TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
```

---

## Health (Phase 7)

### workouts

```sql
CREATE TABLE workouts (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    type            TEXT,               -- "strength" | "cardio" | "flexibility" | "other"
    duration        INTEGER,            -- минуты
    exercises       TEXT,               -- JSON array упражнений
    energy_level    INTEGER,            -- 1-5 субъективная оценка
    notes           TEXT,
    source          TEXT DEFAULT 'chat', -- "chat" | "manual" | "apple_health"
    event_id        INTEGER REFERENCES events(id),  -- связь с events таблицей
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_workouts_date ON workouts(date);
```

---

### body_metrics

```sql
CREATE TABLE body_metrics (
    id          INTEGER PRIMARY KEY,
    date        TEXT NOT NULL,
    weight      REAL,           -- кг
    height      REAL,           -- см
    body_fat    REAL,           -- % если известен
    notes       TEXT,
    source      TEXT DEFAULT 'manual',
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_body_metrics_date ON body_metrics(date);
```

---

## Memory Lifecycle

```
Таблица              Lifecycle           Действие
─────────────────────────────────────────────────────────────
user_profile         permanent           только явное изменение
user_facts           permanent           только явное удаление
events               60 days → archive   создаёт daily_summary
daily_summaries      permanent           заменяет events в контексте
weekly_reflections   permanent           долгосрочный контекст
embeddings           follows source      удаляются с источником
tags                 permanent           накапливаются
interview_answers    permanent           в контекст только если релевантно
uploads              permanent           метаданные выписок
transactions         permanent           финансовая история
insights             permanent           привязаны к upload
project_logs         permanent           история активности
hypotheses           permanent           с датой confirm/reject
cross_sphere         14 days → archive   свежесть критична
observations         7 days → archive    краткосрочные сигналы
dilemmas             permanent           история решений
workouts             permanent           история тренировок
body_metrics         permanent           история метрик
```

---

## Context Manager — что читается

```
Все агенты — всегда:
  user_profile          сжато, ~100 токенов
  user_facts            все permanent

Все агенты — последние активные:
  events                5 записей, только active, importance >= 2
  daily_summaries       последние 7 дней (вместо детальных events)

По типу запроса:
  financial   → transactions (last 20 debit, not transfer)
               summary по категориям
  analytical  → hypotheses (confirmed, confidence > 0.6)
               cross_sphere_insights (active, < 14 days)
  planning    → projects (active, sorted by updated_at)
               dilemmas (open)
  health      → workouts (last 30 days)
               body_metrics (last 3 entries)
  reflective  → weekly_reflections (last 2)
               interview_answers (last 50)

Редко — только если явно релевантно:
  observations          непрочитанные < 7 дней
  insights              последние по upload_id
  tags                  для semantic filtering
```

---

## Indexes Summary

```sql
-- Events
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_domain ON events(domain);
CREATE INDEX idx_events_archived ON events(archived);
CREATE INDEX idx_events_importance ON events(importance);

-- Transactions
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_hash ON transactions(transaction_hash);
CREATE INDEX idx_transactions_debit ON transactions(is_debit, is_internal_transfer);

-- Observations
CREATE INDEX idx_observations_read ON observations(is_read);
CREATE INDEX idx_observations_expires ON observations(expires_at);

-- Embeddings
CREATE INDEX idx_embeddings_type ON embeddings(content_type);
CREATE INDEX idx_embeddings_content ON embeddings(content_type, content_id);

-- Project logs
CREATE INDEX idx_project_logs_project ON project_logs(project_id);
CREATE INDEX idx_project_logs_date ON project_logs(created_at);
```

---

## SQLite Config

```sql
-- При инициализации базы
PRAGMA journal_mode=WAL;        -- лучше для concurrent reads
PRAGMA foreign_keys=ON;         -- enforce relationships
PRAGMA synchronous=NORMAL;      -- баланс скорости и надёжности
PRAGMA cache_size=-64000;       -- 64MB cache
```

---

## Planned Additions

| Table | Phase | Purpose |
|-------|-------|---------|
| subscriptions | 8 | Подписки с датами и суммами |
| obligations | 8 | Кредиты, аренда, обязательства |
| agent_sessions | — | История сессий по агентам |
| goals | 8 | Цели с прогрессом отдельно от profile |
| notifications | — | Очередь уведомлений |

---

## Projects Extended (Phase 6-7)

### project_sessions
Session Timer — реальное время работы над проектом.

```sql
CREATE TABLE project_sessions (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    started_at  TEXT NOT NULL,
    stopped_at  TEXT,
    duration    INTEGER,        -- минуты
    note        TEXT,           -- что сделал за сессию
    source      TEXT DEFAULT 'timer',  -- "timer" | "manual"
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_project ON project_sessions(project_id);
CREATE INDEX idx_sessions_date ON project_sessions(started_at);
```

### project_milestones
Роадмап проекта — план vs реальность.

```sql
CREATE TABLE project_milestones (
    id              INTEGER PRIMARY KEY,
    project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    phase           INTEGER DEFAULT 1,      -- номер фазы
    order_index     INTEGER DEFAULT 0,      -- порядок внутри фазы
    status          TEXT DEFAULT 'pending', -- "pending" | "in_progress" | "done" | "skipped"
    planned_date    TEXT,                   -- когда планировали
    completed_date  TEXT,                   -- когда реально сделали
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_milestones_project ON project_milestones(project_id);
CREATE INDEX idx_milestones_status ON project_milestones(status);
```

---

## Health Extended (Phase 7-8)

### health_checkups
Результаты медицинских чекапов и анализов.

```sql
CREATE TABLE health_checkups (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    type            TEXT,               -- "blood_test" | "hormone_panel" | "general" | "other"
    lab_name        TEXT,
    raw_pdf_path    TEXT,               -- путь к PDF на устройстве
    parsed_results  TEXT,               -- JSON структурированных результатов
    ai_summary      TEXT,               -- разбор от Claude API (Smart Mode)
    notes           TEXT,
    source          TEXT DEFAULT 'upload', -- "upload" | "manual"
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_checkups_date ON health_checkups(date);
CREATE INDEX idx_checkups_type ON health_checkups(type);
```

### health_markers
Отдельные показатели из анализов для отслеживания динамики.

```sql
CREATE TABLE health_markers (
    id          INTEGER PRIMARY KEY,
    checkup_id  INTEGER REFERENCES health_checkups(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    marker_name TEXT NOT NULL,      -- "testosterone", "cortisol", "vitamin_d", "hemoglobin"
    value       REAL NOT NULL,
    unit        TEXT,               -- "ng/dL", "nmol/L", "μg/dL"
    ref_min     REAL,               -- нижняя граница нормы
    ref_max     REAL,               -- верхняя граница нормы
    status      TEXT,               -- "low" | "normal" | "high" — вычисляется автоматически
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_markers_name ON health_markers(marker_name);
CREATE INDEX idx_markers_date ON health_markers(date);
```

### health_protocols
Протоколы и циклы — логирование через чат.

```sql
CREATE TABLE health_protocols (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,      -- "TRT protocol", "vitamin course"
    description     TEXT,
    started_at      TEXT NOT NULL,
    ended_at        TEXT,               -- NULL если активный
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE health_protocol_logs (
    id          INTEGER PRIMARY KEY,
    protocol_id INTEGER REFERENCES health_protocols(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    action      TEXT NOT NULL,          -- "injection 250mg", "took vitamin D 5000IU"
    notes       TEXT,
    source      TEXT DEFAULT 'chat',
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_protocol_logs_protocol ON health_protocol_logs(protocol_id);
CREATE INDEX idx_protocol_logs_date ON health_protocol_logs(date);
```

---

## Smart Mode — Anonymization

Перед отправкой данных в облако Context Manager применяет anonymization layer.

```sql
-- Лог отправок в облако для прозрачности
CREATE TABLE cloud_requests_log (
    id              INTEGER PRIMARY KEY,
    timestamp       TEXT DEFAULT (datetime('now')),
    query_type      TEXT,               -- "dilemma" | "health_analysis" | "cross_sphere"
    data_sent       TEXT,               -- JSON что именно ушло (анонимизированное)
    model_used      TEXT,               -- "claude-3-5-sonnet" | "gpt-4"
    user_confirmed  INTEGER DEFAULT 1,  -- пользователь подтвердил отправку
    created_at      TEXT DEFAULT (datetime('now'))
);
```

Пользователь всегда может посмотреть историю что и когда уходило в облако.

---

## Updated Schema Overview

```
air4.db
├── Core Identity
│   ├── user_profile
│   └── user_facts
├── Memory
│   ├── events
│   ├── daily_summaries
│   ├── weekly_reflections
│   ├── embeddings
│   ├── tags / event_tags
│   └── interview_answers
├── Finance
│   ├── uploads
│   ├── transactions
│   └── insights
├── Projects
│   ├── projects
│   ├── project_logs
│   ├── project_sessions      ← NEW: session timer
│   └── project_milestones    ← NEW: roadmap
├── Analysis
│   ├── hypotheses
│   ├── cross_sphere_insights
│   ├── observations
│   └── dilemmas
├── Health
│   ├── workouts
│   ├── body_metrics
│   ├── health_checkups       ← NEW: анализы и чекапы
│   ├── health_markers        ← NEW: динамика показателей
│   └── health_protocols      ← NEW: протоколы
└── System
    └── cloud_requests_log    ← NEW: прозрачность Smart Mode
```
