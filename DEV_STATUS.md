# DEV_STATUS.md
# AIR4 — Development Status

> Этот файл читается Cursor перед каждой сессией разработки.
> Обновляется после каждого значимого изменения.

---

## Текущий статус: Sprint 5 завершён

**Дата:** Май 2026  
**Фаза:** Phase 6.5 — Real Usage Validation

Все основные страницы живые, memory-система работает: события и факты извлекаются после каждого сообщения, наблюдения генерируются по rule layer + LLM.

---

## Что работает ✓

### Backend (FastAPI, port 8000)

**Финансы (Sprint 1–2):**
- `POST /api/upload` — парсер Swedbank CSV, категоризация через Claude
- `GET /api/summary` — сводка трат; `mark_internal_transfers_in_db` при каждом запросе
- `GET /api/transactions` — список транзакций
- `GET /api/uploads`, `DELETE /api/uploads/{id}`
- `GET /api/insights`
- Internal transfers fix — парный матчинг ±2 дня (`parser.py`)

**Чат и memory (Sprint 2–3):**
- `POST /api/chat` — Claude Sonnet, контекст из SQLite, streaming (SSE)
- `event_extractor`, `fact_extractor`, `body_extractor` — fire-and-forget после каждого сообщения
- Дедупликация событий (title + date ±1 день)
- Дедупликация фактов (первые два слова ключа)

**Новые endpoints (Sprint 3):**
- `GET /api/events` — события из memory
- `GET /api/profile` — профиль, факты, stats
- `GET /api/goals` — цели из profile + user_facts
- `GET /api/hypotheses` — паттерны (hypotheses table)
- `GET /api/health/metrics`, `GET /api/health/workouts`
- `POST /api/observations/generate`, `GET /api/observations`
- `GET /api/finance/subscriptions`, `GET /api/finance/obligations` — из user_facts (UI пока empty state)
- `GET /api/projects`, `GET /api/dilemmas`

**Сервисы:**
- `observation_engine` — rule layer + LLM (Haiku), cooldown 7 дней, сигналы `workout_streak` / `no_workout` взаимоисключающие
- `llm_client_shared.py` — общий async Claude-клиент для всех экстракторов
- `import_workouts.py` — импорт тренировок из Coaich JSON (`python3 import_workouts.py coaich-backup.json`)
- `strip_internal_xml_tags()` — XML-теги не попадают в ответ пользователю

### Frontend (design-reference, port 3000)

**Все страницы на реальных данных:**
- Overview — Finance, Health, Projects, Patterns, Dilemma, AIR4 bubble
- Finance — snapshot, categories, transactions, insights, uploads
- Health — body metrics, workouts
- Projects, Memory, Goals, Dilemmas, Patterns, Profile
- Chat — ChatPanel + FullscreenChat, история в localStorage

**Паттерны загрузки:**
- Рефетч в App после каждого сообщения в чате (`refreshOverviewData`)
- `Promise.allSettled` — один упавший запрос не роняет страницу (Finance, Overview)
- Express proxy в `server.ts` для всех `/api/*` (маппинг `chatHistory` → `history`)

**Пока empty state (данные есть, UI отложен):**
- Finance → Subscriptions, Loans (ждут отдельные таблицы, Phase 8)

### Database (SQLite, `backend/data/air4.db`)

| Данные | Состояние |
|--------|-----------|
| Выписки Swedbank | 3 загружены (январь—май 2026) |
| Тренировки | 8 из Coaich импортированы |
| Body metrics | 95 кг / 187 см |
| user_facts | ~73 факта |
| observations | 2 активных |
| events | из чата, с дедупликацией |

### LLM

- **Чат:** Claude Sonnet (`claude-sonnet-4-5`) via `llm_client.py`
- **Экстракторы / observations:** Claude Haiku via `llm_client_shared.py`
- Системный промпт: `CHARACTER_SYSTEM` + контекст (profile, facts, summary, events)

---

## Что не сделано (следующие фазы)

| Задача | Фаза |
|--------|------|
| Subscriptions и Loans — отдельные таблицы (не user_facts) | Phase 8 |
| Кликабельные тренировки с деталями упражнений | Phase 7 |
| Auth на API | Phase 8 |
| Memory lifecycle — архивация событий | Phase 7–8 |
| Observations по расписанию (сейчас только по кнопке) | Phase 7 |
| `chatHistory` → `history` при dev через Vite без Express | — |

---

## Структура проекта

```
AIR4/
├── backend/                         # FastAPI (активный backend)
│   ├── main.py
│   ├── database.py
│   ├── data/air4.db
│   ├── import_workouts.py
│   ├── routers/
│   │   ├── upload.py, summary.py, transactions.py, insights.py
│   │   ├── chat.py, projects.py, dilemmas.py, observations.py
│   │   ├── health.py, profile.py, events.py, goals.py
│   │   ├── hypotheses.py, finance_facts.py
│   └── services/
│       ├── llm_client.py            # чат (Sonnet)
│       ├── llm_client_shared.py     # экстракторы (Haiku)
│       ├── parser.py, categorizer.py, summary_loader.py
│       ├── prompts.py, event_extractor.py, fact_extractor.py
│       ├── body_extractor.py, observation_engine.py
│       └── finance_facts.py
├── design-reference/                # React UI (порт 3000)
│   ├── src/App.tsx                  # state + рефетч после чата
│   ├── src/components/              # все страницы
│   ├── src/lib/api.ts
│   └── server.ts                    # Express proxy → :8000
├── backend/app/                     # legacy (не используется в dev)
├── docs/
└── DEV_STATUS.md
```

---

## Запуск

```bash
# Терминал 1
cd backend && uvicorn main:app --reload --port 8000

# Терминал 2
cd design-reference && npm run dev
```

- Backend: http://127.0.0.1:8000  
- Frontend: http://localhost:3000  
- Health check: `GET http://127.0.0.1:8000/health`

---

## Аудит (май 2026) — исправлено

- `.gitignore` — CSV, backup JSON, `backend/data/` не в git
- `Finance.tsx` — `Promise.allSettled`
- Убраны debug `console.log` с пользовательскими данными
- `llm_client_shared.py` — без дублирования httpx в экстракторах
- `handleMessageSent` — только `refreshOverviewData()`, без двойных fetch
- `workout_streak` / `no_workout` — взаимоисключение в rule layer

---

## Sprint 4 — UI Redesign & New Features (май 2026)

### Backend — новые endpoints
- `POST /api/projects` — создание проектов
- `GET/POST /api/health/metrics` — запись веса/роста
- `GET/POST /api/health/workouts` — тренировки (manual + coaich)
- `GET /api/health/checkups` — маркеры анализов крови
- `GET /api/projects/{id}` — детальная страница проекта
- `GET/POST /api/projects/{id}/todos`, `PUT /api/projects/todos/{id}` — todo
- `POST /api/projects/{id}/sessions/start|stop` — таймер сессий
- `GET/POST /api/interview/question|answer` — interview режим (cooldown 3 дня)
- `POST /api/health/metrics` — запись веса через форму

### Backend — новые скрипты
- `import_health_checkup.py` — импорт анализов крови (18 маркеров, 2026-03-12)

### Frontend — редизайн страниц
- Единый стиль баннера на всех страницах (Health, Sport, Projects, Goals, Dilemmas, Patterns, Memory, Profile, Finance, Settings)
- **Health** — маркеры крови с группировкой CBC/Biochemistry/Lipids/Hormones, date picker, Biomarker Insight Panel, кликабельные маркеры
- **Sport** — Athletic Command дизайн, Weight Trajectory chart, Log Session форма, кликабельные тренировки с деталями упражнений
- **Projects** — Command Center дизайн, momentum bars, Focus Distribution, детальная страница с таймером Pomodoro и todo списком
- **Goals** — карточки целей с прогресс-барами, Wishlist, Deadlines timeline, Weekly Focus
- **Memory** — фильтры по доменам (ALL/FINANCE/HEALTH/PROJECTS/LIFE/PERSONAL), grid layout
- **Health/Sport** разделены на две отдельные страницы в сайдбаре
- Sidebar очищен: убраны Chat, EmptyStates, Toasts
- Interview режим — AIR4 задаёт вопросы раз в 3 дня в ChatPanel
- Express proxy лимит увеличен до 10mb (fix PayloadTooLargeError)
- body_extractor больше не пишет workouts из чата

### Database
- Таблица `health_checkups` — маркеры анализов крови
- Таблица `project_todos` — todo для проектов
- Колонка `duration_minutes` в `project_logs`

---

## Sprint 5 — Conversational AI & Finance Module (май 2026)

### Backend — новые endpoints
- `GET/POST /api/finance/subscriptions` + PUT/DELETE — подписки
- `GET/POST /api/finance/obligations` + PUT/DELETE — кредиты и обязательства
- `GET /api/finance/monthly-fixed` — итого фиксированных расходов
- Observation scheduler — автогенерация каждые 24ч при старте backend
- Health checkups context в чат промпте
- Financial obligations context в чат промпте

### Frontend
- FullscreenChat — левая панель с реальным контекстом (loaded context, memory, facts count)
- Кнопка Maximize в ChatPanel → открывает fullscreen
- AIRCheckIn блок на Overview — реальные вопросы из interview API
- Overview bento grid редизайн — разные размеры карточек, horizontal bars
- Типографика унифицирована через `src/lib/typography.ts` по всем страницам

### Database
- Таблица `subscriptions` — подписки пользователя
- Таблица `obligations` — кредиты и обязательства
- 5 дат анализов крови (2019→2026 динамика тестостерона)
- Реальные данные: 9 подписок €205/мес, 2 кредита €647/мес

### Character System
- Новый CHARACTER_SYSTEM промпт — живой разговорный тон
- AIR4 видит анализы крови и строит медицинский план
- AIR4 видит подписки и кредиты в контексте

---

## Следующие шаги (приоритет)

1. **Conversational Continuity** — AIR4 помнит прошлые разговоры
2. **Decision Memory Layer** — таблица решений с исходами
3. **Live Feed на Overview** — хронологический нарратив
4. **Chat as primary input** — всё вводится через разговор
5. **Finance зарплатный цикл 10-го → 10-го**
6. **Автоматический пересчёт остатка по кредитам**
