# DEV_STATUS.md
# AIR4 — Development Status

> Этот файл читается Cursor перед каждой сессией разработки.
> Обновляется после каждого значимого изменения.
> Единый источник статуса разработки — `PROGRESS.md` упразднён 22 мая 2026.

---

## Текущий статус: Sprint 14 (Proactive AIR4 + Observer)

**Дата аудита:** 28 июня 2026  
**Фаза:** Phase 6.5 — Real Usage Validation

AIR4 — персональный AI-ассистент на FastAPI + React. Все основные модули работают на реальных данных. Sprint 14 добавил macOS Observer, proactive chat (morning brief + nudges), discovery gaps, action confirmation layer, training log import и activity tile на Overview.

**Стек:** FastAPI :8000 · React/Vite `design-reference` :3000 · SQLite `backend/data/air4.db` · Claude Sonnet (чат) / Haiku (экстракторы, observations, nudges)

---

## 1. Backend endpoints (по доменам)

Все роутеры подключены в `main.py` с prefix `/api` (кроме recommendation → `/api/air4`).

### Health & infra
| Method | Path | Описание |
|--------|------|----------|
| GET | `/health` | Health check (`{"status":"ok"}`) |

### Finance
| Method | Path | Описание |
|--------|------|----------|
| POST | `/api/upload` | Swedbank CSV → transactions + categorization |
| GET | `/api/uploads` | Список загрузок |
| DELETE | `/api/uploads/{id}` | Удалить загрузку |
| GET | `/api/summary` | Сводка трат/дохода за период |
| GET | `/api/finance/cycles` | Зарплатные циклы 10→10 |
| GET | `/api/transactions` | Пагинированные транзакции |
| PUT | `/api/transactions/{id}/category` | Смена категории |
| GET | `/api/insights` | Finance insights |
| GET | `/api/category-rules` | Правила категоризации |
| GET/POST/PUT/DELETE | `/api/finance/subscriptions` | Подписки |
| GET/POST/PUT/DELETE | `/api/finance/obligations` | Кредиты и обязательства |
| GET | `/api/finance/monthly-fixed` | Итого фикс. расходов |

### Chat & proactive
| Method | Path | Описание |
|--------|------|----------|
| POST | `/api/chat` | Claude Sonnet, SSE streaming, attachments, domain agents |
| GET | `/api/chat/history` | История `chat_messages` (limit 1–500) |
| POST | `/api/chat/confirm-action` | Подтверждение pending data action |
| POST | `/api/chat/cancel-action` | Отмена pending action |
| GET | `/api/chat/morning-brief` | Proactive opening (Sonnet, multi-signal) |
| GET | `/api/chat/observer-nudge` | Nudge при долгой сессии в одном app |

### Memory & knowledge
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/events` | Life events (+ project_logs как events) |
| GET | `/api/profile` | Profile + user_facts bundle |
| GET | `/api/goals` | Цели (profile + facts, dedup) |
| GET | `/api/hypotheses` | Гипотезы о пользователе |
| GET | `/api/identity` | Identity model insights |
| GET | `/api/discovery/gaps` | Discovery gaps (что AIR4 ещё не знает) |
| GET | `/api/interview/question` | Interview вопрос (cooldown 3 дня) |
| PUT | `/api/interview/answer` | Ответ на interview |
| GET | `/api/followups` | Follow-up reminders |

### Observations & patterns
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/observations` | AIR4 observations |
| POST | `/api/observations/generate` | Ручная генерация |
| GET | `/api/cross-sphere` | Cross-sphere insights |
| GET | `/api/feed` | Live Feed (6 источников) |

### Dilemmas
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/dilemmas` | Список дилемм |
| POST | `/api/dilemmas` | Создать |
| PATCH | `/api/dilemmas/{id}` | Обновить |
| GET | `/api/dilemmas/pending-followups` | Ожидающие follow-up |
| POST | `/api/dilemmas/{id}/followup-answer` | Ответ на follow-up |
| GET | `/api/dilemmas/stats` | Статистика |

### Projects
| Method | Path | Описание |
|--------|------|----------|
| GET/POST | `/api/projects` | Список / создание |
| GET | `/api/projects/{id}` | Деталь + logs + active session |
| PUT | `/api/projects/{id}/goals` | Привязка goal_keys |
| GET/POST | `/api/projects/{id}/logs` | Логи активности |
| POST | `/api/projects/{id}/sessions/start` | Старт Pomodoro-сессии |
| POST | `/api/projects/{id}/sessions/stop` | Стоп сессии + duration |
| GET/POST | `/api/projects/{id}/todos` | Todo list |
| PUT | `/api/projects/todos/{id}` | Toggle todo done |

### Health & sport
| Method | Path | Описание |
|--------|------|----------|
| GET/POST | `/api/health/metrics` | Вес / рост |
| GET/POST | `/api/health/workouts` | Тренировки |
| POST | `/api/health/import-training-log` | Импорт `.md` training log |
| GET | `/api/health/markers/{name}/history` | История биомаркера |
| GET | `/api/health/checkups` | Анализы крови |

### Observer (macOS)
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/observer/status` | enabled + running |
| PUT | `/api/observer/toggle` | Вкл/выкл + start/stop thread |
| GET | `/api/observer/today` | Сегодня: events, by_app_aggregated, by_domain |
| GET | `/api/observer/log` | История (days, limit) |

### AIR4 modes & recommendations
| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/air4/recommendation` | Главная рекомендация (Haiku, cache 30 min) |
| GET | `/api/air4/recommendations` | Domain recommendations (finance/projects/health) |
| GET/PUT | `/api/air4/mode` | Energy state: quiet/normal/active/jarvis |

### Spaces (experimental)
| Method | Path | Описание |
|--------|------|----------|
| POST | `/api/spaces/suggest` | LLM-предложение Space |
| GET/POST | `/api/spaces` | Список / создание |

**Итого:** ~75 endpoints. Аутентификации нет — локальный single-user.

---

## 2. Frontend pages & components

**App:** `design-reference/src/App.tsx` — React Router, mobile (<768px) → только FullscreenChat.

### Страницы (sidebar + routes)

| Page | Route | Компонент | Данные |
|------|-------|-----------|--------|
| Overview | `/` | `OverviewDashboard.tsx` | summary, projects, workouts, observations, domain recos, observer today |
| Finance | `/finance` | `Finance.tsx` | transactions, subscriptions, obligations, cycle navigator |
| Health | `/health` | `Health.tsx` | checkups, biomarker trends |
| Sport | `/sport` | `Sport.tsx` | workouts, metrics, training log upload |
| Projects | `/projects` | `Projects.tsx` | projects, sessions, todos, momentum |
| Goals | `/goals` | `Goals.tsx` | goals, wishlist, deadlines |
| Dilemmas | `/dilemmas` | `Dilemmas.tsx` | dilemmas, follow-ups |
| Patterns | `/patterns` | `Patterns.tsx` | hypotheses, cross-sphere |
| Memory | `/memory` | `Memory.tsx` | events, domain filters |
| Observer | `/observer` | `Observer.tsx` | today aggregated bars, history, toggle |
| Profile | `/profile` | `Profile.tsx` | profile, facts |
| Settings | `/settings` | `Settings.tsx` | preferences |
| Chat | `/chat` | `ChatPanel.tsx` + `FullscreenChat.tsx` | streaming, history, proactive |

**Dev-only routes:** `CSVUpload`, `EmptyStates`, `Toasts` — не в sidebar.

### Shared / layout components

| Компонент | Назначение |
|-----------|------------|
| `Sidebar.tsx` | Icon nav 64px, observer status dot |
| `Header.tsx` | Page title, EnergyStateDropdown |
| `EnergyStateDropdown.tsx` | quiet / normal / active / jarvis + DND |
| `ChatPanel.tsx` | Embedded chat, interview, pending actions, proactive hooks |
| `FullscreenChat.tsx` | Full chat, context pills, morning brief label |
| `PendingActionBar.tsx` | Confirm/cancel chat data changes |
| `LiveFeed.tsx` | Overview feed digest |
| `MessageAttachmentView.tsx` | Image/PDF attachments in chat |
| `MarkerTrendChart.tsx` | Health biomarker sparkline |
| `ProjectGoalLinks.tsx` | Goal pills on projects |
| `OverviewCardEmpty.tsx` / `PageEmptyState.tsx` | Empty states |

### Frontend libs
- `lib/api.ts` — все fetch helpers (~1700 lines)
- `lib/proactiveChat.ts` — seen-today tracking, user activity timestamps
- `lib/useProactiveChatMessages.ts` — morning brief + observer nudge polling
- `lib/chatStorage.ts` — sessionStorage fallback
- `lib/chatEvents.ts` — `CHAT_REFRESH_EVENT` после import и т.п.
- `lib/navigation.ts` — Page ↔ path mapping
- Vite proxy `/api/*` → :8000

---

## 3. Services (`backend/services/`)

| Сервис | Назначение |
|--------|------------|
| **llm_client.py** | Chat sync SDK (Sonnet), streaming |
| **llm_client_shared.py** | Async Haiku для экстракторов и observations |
| **prompts.py** | CHARACTER_SYSTEM, build_system_context, domain contexts |
| **chat_history.py** | save/fetch chat_messages |
| **unified_extractor.py** | Один Haiku-вызов: events + workout + facts + decisions + discovery |
| **event_extractor.py** | Life events, dedup thresholds |
| **fact_extractor.py** | user_facts upsert |
| **workout_extractor.py** | Workouts из чата, validation `_is_real_workout()` |
| **body_extractor.py** | Weight/height из чата |
| **decision_extractor.py** | Dilemmas / decisions |
| **discovery.py** | discovery_gaps seed, get_open_gaps, gap learning |
| **proactive_chat.py** | Morning brief (Sonnet), observer nudge (Haiku), signal collectors |
| **test_mode.py** | `AIRCH_TEST_MODE` — lowered thresholds for QA |
| **observer.py** | macOS app tracking thread, periodic flush, project auto-link |
| **observation_engine.py** | Rule layer + LLM observations, 7-day cooldown |
| **cross_sphere_analyzer.py** | Finance ↔ Health ↔ Projects correlations |
| **action_layer.py** | Detect + execute chat actions (subs, workouts, loops…) |
| **subscription_updater.py** | Legacy recurring corrections from chat text |
| **obligation_from_chat.py** | Obligation-specific chat actions |
| **subscription_migration.py** | user_facts → subscriptions backfill |
| **followup_extractor.py** | Follow-up questions from chat |
| **identity_extractor.py** | Identity model updates |
| **interviewer.py** | Interview question selection |
| **feed.py** | Live Feed aggregator |
| **summary_loader.py** | Finance summary SQL |
| **salary_cycle.py** | 10→10 salary cycle periods |
| **parser.py** / **categorizer.py** | Swedbank CSV |
| **finance_facts.py** | Legacy (mostly superseded by subscriptions table) |

### Background jobs (main.py startup)
- Observation scheduler — каждые 24h (+ cross-sphere analysis)
- Subscription backfill migration (once via `_app_meta`)
- Observer thread (macOS only, if `observer_enabled`)

---

## 4. Database

**Файл:** `backend/data/air4.db` (SQLite WAL, не в git)

### Таблицы (31)

| Таблица | Назначение |
|---------|------------|
| `user_profile` | Имя, air4_mode, observer_enabled |
| `_app_meta` | Migration flags, observer_nudge_last_at |
| `user_facts` | Structured facts from chat |
| `embeddings` | ⚠️ declared, unused |
| `events` | Life events |
| `uploads` | CSV upload metadata |
| `transactions` | Bank transactions |
| `insights` | Finance insights |
| `projects` | Projects + goal_keys |
| `project_logs` | Activity logs (manual, observer, chat) |
| `project_todos` | Project todos |
| `hypotheses` | User hypotheses |
| `cross_sphere_insights` | Cross-domain patterns |
| `observations` | AIR4 observations |
| `dilemmas` | Decision memory |
| `interview_answers` | Interview responses |
| `workouts` | Training sessions |
| `body_metrics` | Weight/height |
| `health_checkups` | Blood markers |
| `subscriptions` | Recurring subscriptions |
| `obligations` | Loans / fixed obligations |
| `income_sources` | Income tracking |
| `chat_messages` | Full chat history + attachments |
| `spaces` | Experimental spaces |
| `identity_model` | Identity insights |
| `followups` | Scheduled follow-ups |
| `open_loops` | Open conversation loops |
| `observer_events` | macOS activity sessions |
| `category_rules` | Transaction categorization rules |
| `discovery_gaps` | What AIR4 still needs to learn |

**⚠️ `today_cache` referenced in `proactive_chat.get_today_signal()` but NOT in schema** — morning brief falls back to recommendation cache; SQL query fails silently if table missing.

### Текущие объёмы данных (28 июня 2026)

| Таблица | Count | Примечание |
|---------|------:|------------|
| transactions | 943 | 6 uploads Swedbank |
| events | 846 | После дедупа и активного использования |
| user_facts | 892 | |
| chat_messages | 1086 | 543 user messages |
| workouts | 30 | Coaich + chat + imports |
| health_checkups | 101 | Маркеры 2019→2026 |
| observations | 25 | |
| dilemmas | 66 | |
| followups | 12 | |
| subscriptions | 15 | |
| obligations | 3 | |
| projects | 3 | Air4, SkipMar, Тартупак (active) |
| project_logs | 8 | 6 manual + 2 observer |
| observer_events | 25 | 19 on 2026-06-27, 6 on 2026-06-28 |
| discovery_gaps | 19 | 16 open, 3 learned |
| cross_sphere_insights | 13 | |
| hypotheses | 2 | |
| open_loops | 0 | |

**Projects (live):** Air4 `updated_at` 2026-06-28 (observer-linked), SkipMar / Тартупак stale since May.

---

## 5. Known issues & tech debt

### Критично / блокеры
- **`today_cache` table missing** — `get_today_signal()` queries non-existent table; needs schema + writer or remove query
- **No authentication** — all endpoints open on 0.0.0.0 (ok locally + Tailscale, risky if exposed)
- **Observer macOS-only** — no Linux/Windows tracking

### Tech debt
- `@app.on_event("startup/shutdown")` deprecated → migrate to lifespan
- Two LLM clients (`llm_client.py` + `llm_client_shared.py`) — merge
- `prompts.py` ~24KB — split into modules
- `chat.py` ~800 lines — split pipeline
- Dead columns in `events`: `original_text`, `processed_text`, `embedding_id`, etc.
- `embeddings` table unused
- `search_relevant_events` — LIKE full scan; needs FTS5 at scale
- Workout dedup by date only — two workouts same day collide
- Duplicate action paths: `subscription_updater` + `action_layer` overlap
- `.env.example` still mentions Ollama; production is Anthropic-only
- `frontend/` removed in Sprint 13 ✓

### Мелкое
- Swedbank parser skips some service rows
- Category `other` noisy (hidden on Overview via `HIDDEN_CATEGORIES`)
- Project hint matching is substring-based — false positives possible
- Morning brief + nudge dedup via sessionStorage — not synced across tabs/devices
- `AIRCH_TEST_MODE=true` in `.env` — remember to disable for normal use

---

## 6. Sprint 14+ (июнь 2026 — последние сессии)

### Proactive AIR4
- **`proactive_chat.py`** — morning brief combines: open loop, discovery gap, yesterday observer, today signal; Sonnet generation
- **`GET /api/chat/morning-brief`** — triggers: 4h inactivity OR stale discovery gap OR recent observer activity (not just first open)
- **`GET /api/chat/observer-nudge`** — Haiku comment after 45+ min in one app; 2h cooldown in `_app_meta`
- **`AIRCH_TEST_MODE`** — test thresholds (5 min inactivity, 2 min nudge, 0-day discovery cooldown)
- Frontend: `useProactiveChatMessages` in ChatPanel + FullscreenChat; poll nudge every 15 min; brief seen-today tracking

### Discovery engine
- **`discovery_gaps` table** — 19 seeded categories
- **`discovery.py` service** — gap learning from facts + chat; woven into CHARACTER_SYSTEM
- **`GET /api/discovery/gaps`** — admin/debug view
- Integrated in unified_extractor + morning brief

### macOS Observer
- **`observer.py`** — background thread, app/window tracking via AppleScript
- Idle detection (5 min via `ioreg`) — pauses session
- **Periodic flush** every 5 min (60s in test mode) — saves long sessions without app switch
- **Project auto-link** — `project_hint` → match active project → `project_logs` source=`observer`
- **`observer_events` table** + router (`/api/observer/*`)
- **`Observer.tsx`** — today bar chart, history accordion, toggle
- Overview **АКТИВНОСТЬ СЕГОДНЯ** tile — top 3 apps, refresh 5 min
- Projects tile shows `{name} — активен сегодня` when `updated_at` is today

### Chat & actions
- **`action_layer.py`** — detect pending actions (subs, obligations, workouts, project logs, open loops)
- **`POST /api/chat/confirm-action`** / **`cancel-action`**
- **`PendingActionBar.tsx`** in ChatPanel + FullscreenChat
- **`fetch_recent_chat_messages` import fix** in chat.py
- Chat context includes all workout sources (not just coaich)

### Health & training
- **`import_training_log.py`** + **`POST /api/health/import-training-log`**
- Sport page `.md` upload; post-import chat notice + refresh
- **`workout_extractor._is_real_workout()`** — rejects garbage workouts

### Other fixes
- Observer timezone — `observed_at` local ISO; today filter uses local date
- `/api/observer/today` — `by_app_aggregated` for bar charts

---

## Структура проекта

```
AIR4/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── data/air4.db
│   ├── import_workouts.py
│   ├── import_health_checkup.py
│   ├── import_training_log.py
│   ├── cleanup_duplicate_events.py
│   └── routers/          # 24 router modules
│   └── services/         # 28 service modules
├── design-reference/     # React UI (port 3000)
│   ├── src/App.tsx
│   ├── src/components/
│   └── src/lib/api.ts
└── DEV_STATUS.md
```

---

## Запуск

```bash
# Терминал 1
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Терминал 2
cd design-reference && npm run dev
```

- Backend: http://127.0.0.1:8000
- Frontend: http://localhost:3000
- Tailscale: доступ с телефона (настроен Sprint 13)
- Health: `GET /health`

### Env vars (ключевые)

| Var | Default | Назначение |
|-----|---------|------------|
| `ANTHROPIC_API_KEY` | — | Claude API |
| `DATABASE_URL` | `./data/air4.db` | SQLite path |
| `AIRCH_TEST_MODE` | false | Lower proactive/observer thresholds |
| `AIR4_LOG_LEVEL` | INFO | Logging |
| `AIR4_CORS_ORIGINS` | localhost:3000 | CORS |
| `AIR4_OBSERVATION_INTERVAL_SECONDS` | 86400 | Observation scheduler |

---

## Полезные команды

```bash
# Импорт тренировок Coaich
cd backend && python3 import_workouts.py path/to/backup.json

# Импорт анализов крови
python3 backend/import_health_checkup.py

# Дедуп событий
python3 backend/cleanup_duplicate_events.py          # dry-run
python3 backend/cleanup_duplicate_events.py --apply

# DB sanity check
sqlite3 backend/data/air4.db "SELECT COUNT(*) FROM observer_events;"
sqlite3 backend/data/air4.db "SELECT name, updated_at FROM projects;"
```

---

## Исторические спринты (кратко)

| Sprint | Период | Highlights |
|--------|--------|------------|
| 1–2 | май 2026 | Finance CSV, chat, extractors |
| 3 | май 2026 | Events, profile, hypotheses, health endpoints |
| 4 | май 2026 | Projects CRUD, health checkups, interview, UI redesign |
| 5 | май 2026 | Subscriptions/obligations, FullscreenChat context |
| 6 | май 2026 | Salary cycle 10→10, chat_history, Live Feed |
| 7 | май 2026 | Real SSE streaming, Russian UI, SQLite tuning |
| 8–10 | май 2026 | Cross-sphere, dilemmas, file upload, forecast |
| 11 | июн 2026 | workout_extractor, event dedup cleanup (634→494) |
| 12 | июн 2026 | Jarvis mode, domain recommendations, Energy State |
| 13 | июн 2026 | Morning brief v1, unified_extractor, mobile chat, dark theme Overview, frontend/ removed |
| **14** | **июн 2026** | **Observer, proactive chat, discovery, action layer, training import** |

---

## Следующие шаги

1. **Создать `today_cache` table** или убрать мёртвый query в proactive_chat
2. **Жить с продуктом** — итерировать morning brief / nudge prompts на реальных данных
3. **Follow-up Engine** — AIR4 возвращается к важным событиям
4. **Отключить `AIRCH_TEST_MODE`** для daily use
5. **Загружать выписки** каждые 10 числа

---

## Roadmap

### Sprint 15
- Curiosity / discovery UX — показывать gaps пользователю
- Positive patterns — AIR4 замечает что работает
- Tech debt: lifespan, merge LLM clients

### Phase 7
- Global Session Toggle
- Conversation First — любая сущность через чат
- Financial calendar — разовые обязательства

### Phase 8+
- SQLCipher + auth
- iOS app, push (strong observations only)
- Voice (Whisper + TTS), Apple Health/Calendar
