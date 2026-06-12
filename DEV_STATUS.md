# DEV_STATUS.md
# AIR4 — Development Status

> Этот файл читается Cursor перед каждой сессией разработки.
> Обновляется после каждого значимого изменения.
> Единый источник статуса разработки — `PROGRESS.md` упразднён 22 мая 2026
> и слит сюда.

---

## Текущий статус: Sprint 12 завершён

**Дата:** 12 июня 2026
**Фаза:** Phase 6.5 — Real Usage Validation

Все основные модули работают: Finance, Memory, Projects, Health, Analysis, Observations, Chat со стримингом. Добавлен workout_extractor для логирования тренировок через чат. Почищено 140 дублей событий (634 → 494). Проведён полный аудит кода.

---

## Что работает ✓

### Backend (FastAPI, port 8000)

**Финансы (Sprint 1–2):**
- `POST /api/upload` — парсер Swedbank CSV, категоризация через Claude
- `GET /api/summary` — сводка трат; `mark_internal_transfers_in_db` только при upload
- `GET /api/transactions`, `PUT /api/transactions/{id}/category`
- `GET /api/uploads`, `DELETE /api/uploads/{id}`
- `GET /api/insights`
- `GET /api/finance/subscriptions` + POST/PUT/DELETE
- `GET /api/finance/obligations` + POST/PUT/DELETE
- `GET /api/finance/monthly-fixed`, `GET /api/finance/cycles`
- Internal transfers fix — парный матчинг ±2 дня (`parser.py`)
- Зарплатный цикл 10→10 (`salary_cycle.py`)

**Чат и memory (Sprint 2–3):**
- `POST /api/chat` — Claude Sonnet, контекст из SQLite, streaming (SSE)
- `GET /api/chat/history`
- Цепочка пост-чат экстракторов: `body_extractor` → `event_extractor` → `workout_extractor` → `fact_extractor` → `decision_extractor`
- Дедупликация событий — двухуровневый порог (0.70 та же дата, 0.85 соседние)
- Дедупликация фактов (первые два слова ключа)
- Conversational continuity — `chat_messages` в БД, история подмешивается в LLM-контекст

**Endpoints (Sprint 3+):**
- `GET /api/events`, `GET /api/profile`, `GET /api/goals`
- `GET /api/hypotheses`, `GET /api/observations`, `POST /api/observations/generate`
- `GET /api/cross-sphere`, `GET /api/dilemmas` + POST/PATCH/followup
- `GET /api/health/metrics`, `GET /api/health/workouts`, `GET /api/health/checkups`
- `GET /api/health/markers/{name}/history`
- `GET /api/projects` + detail/todos/sessions/logs
- `GET /api/feed` — Live Feed по 6 источникам
- `GET /api/interview/question`, `PUT /api/interview/answer`

**Сервисы:**
- `observation_engine` — rule layer + LLM (Haiku), cooldown 7 дней, сигналы `workout_streak` / `no_workout` взаимоисключающие
- `workout_extractor.py` — логирование тренировок через чат, футер-подтверждение, notes для кардио (дистанция, пульс)
- `cleanup_duplicate_events.py` — разовый инструмент дедупа (dry-run + --apply + --date)
- `cross_sphere_analyzer.py` — кросс-сферный анализ (Finance ↔ Health ↔ Projects)
- `subscription_updater.py` — чат правит подписки и кредиты
- `subscription_migration.py` — идемпотентный перелив из user_facts в subscriptions
- `llm_client.py` — чат (Sonnet, sync SDK)
- `llm_client_shared.py` — экстракторы (Haiku, async httpx)
- `import_workouts.py` — импорт тренировок из Coaich JSON
- `import_health_checkup.py` — импорт анализов крови
- `strip_internal_xml_tags()` — XML-теги не попадают в ответ пользователю

### Frontend (design-reference, port 3000)

**Все страницы на реальных данных:**
- Overview — Finance, Health, Projects, Patterns, Dilemma, AIR4 bubble, Live Feed
- Finance — snapshot, categories, transactions, insights, uploads, cycle navigator
- Health — маркеры крови CBC/Biochemistry/Lipids/Hormones, динамика, date picker, Biomarker Insight Panel
- Sport — Athletic Command дизайн, Weight Trajectory chart, Log Session форма, кликабельные тренировки с деталями упражнений
- Projects — Command Center дизайн, momentum bars, Focus Distribution, детальная страница с таймером Pomodoro и todo списком
- Goals — карточки целей с прогресс-барами, Wishlist, Deadlines timeline, Weekly Focus
- Memory — фильтры по доменам (ALL/FINANCE/HEALTH/PROJECTS/LIFE/PERSONAL), grid layout
- Dilemmas, Patterns, Profile
- Chat — ChatPanel + FullscreenChat, история из БД

**Паттерны загрузки:**
- Рефетч в App после каждого сообщения в чате (`refreshOverviewData`)
- `Promise.allSettled` — один упавший запрос не роняет страницу (Finance, Overview)
- Vite proxy для всех `/api/*` → :8000

**Subscriptions / Loans:** живой UI, таблицы `subscriptions` и `obligations`
— единый источник правды; чат правит цены и удаляет записи через `subscription_updater`.

### Database (SQLite, `backend/data/air4.db`)

| Данные | Состояние |
|--------|-----------|
| Выписки Swedbank | 3 загружены (январь–май 2026) |
| Тренировки | 10 (8 Coaich + 2 новых) |
| Body metrics | 95 кг / 187 см |
| user_facts | ~73 факта |
| events | 494 (после чистки 140 дублей) |
| observations | 2 активных |
| health_checkups | маркеры крови 5 дат (2019→2026) |
| subscriptions | 9 подписок ~€205/мес |
| obligations | 2 кредита ~€647/мес |
| chat_messages | полная история переписки |

### LLM

- **Чат:** Claude Sonnet (`claude-sonnet-4-5`) via `llm_client.py`
- **Экстракторы / observations:** Claude Haiku via `llm_client_shared.py`
- Системный промпт: `CHARACTER_SYSTEM` + контекст (profile, facts, summary, events)

---

## Known issues / tech-debt (актуально)

**Критично:**
- `frontend/` — мёртвый Next.js прототип, 20+ битых endpoint-ов. Удалить или синхронизировать с бэкендом
- Пост-чат экстракторы — 5 последовательных LLM вызовов после каждого сообщения, регулярные 429. Объединить в один вызов или asyncio.gather + backoff

**Tech debt:**
- Два LLM клиента — `llm_client.py` (sync SDK) и `llm_client_shared.py` (async httpx). Объединить
- `@app.on_event` deprecated в FastAPI — заменить на lifespan context manager
- Мёртвые колонки в `events`: `original_text`, `processed_text`, `embedding_id`, `archive_after`, `summarized`, `timestamp`
- Таблица `embeddings` — объявлена в схеме, нигде не используется
- `prompts.py` 23.5KB — разделить на `system.py` + `search.py`
- `chat.py` 590 строк — разнести на `chat_attachments.py` + `chat_pipeline.py`
- `.env.example` рекламирует Ollama, но код полностью на Anthropic — переписать
- `GEMINI_API_KEY` в `vite.config.ts` — наследие шаблона, вычистить
- Нет аутентификации — все 50 endpoints открыты (локально ок, но риск при проксировании)
- `search_relevant_events` — LIKE '%kw%' full scan, при >10k events нужен FTS5
- Дедуп workouts только по дате — при двух тренировках в день вторая не запишется. Расширить до `(date, type)`

**Мелкое:**
- Парсер Swedbank иногда пропускает служебные строки (`lõppsaldo`, `Käive`)
- Категория `other` собирает шум (на Overview скрыта через `HIDDEN_CATEGORIES`)

---

## Структура проекта

```
AIR4/
├── backend/                         # FastAPI (активный backend)
│   ├── main.py
│   ├── database.py
│   ├── data/air4.db
│   ├── import_workouts.py
│   ├── import_health_checkup.py
│   ├── cleanup_duplicate_events.py
│   ├── routers/
│   │   ├── upload.py, summary.py, transactions.py, insights.py
│   │   ├── chat.py, projects.py, dilemmas.py, observations.py
│   │   ├── health.py, profile.py, events.py, goals.py
│   │   ├── hypotheses.py, finance_recurring.py, finance_facts.py
│   └── services/
│       ├── llm_client.py            # чат (Sonnet)
│       ├── llm_client_shared.py     # экстракторы (Haiku)
│       ├── parser.py, categorizer.py, summary_loader.py
│       ├── prompts.py, event_extractor.py, fact_extractor.py
│       ├── body_extractor.py, workout_extractor.py
│       ├── observation_engine.py, cross_sphere_analyzer.py
│       ├── subscription_updater.py, subscription_migration.py
│       ├── salary_cycle.py, feed.py, chat_history.py
│       └── finance_facts.py
├── design-reference/                # React UI (порт 3000)
│   ├── src/App.tsx
│   ├── src/components/              # все страницы
│   ├── src/lib/api.ts
│   └── vite.config.ts
├── frontend/                        # МЁРТВЫЙ Next.js прототип — удалить
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

## Полезные команды

```bash
# Импорт тренировок из Coaich
cd backend && python3 import_workouts.py path/to/coaich-backup.json

# Импорт анализов крови
cd backend && python3 import_health_checkup.py

# Дедуп событий — dry-run
python3 backend/cleanup_duplicate_events.py

# Дедуп — применить
python3 backend/cleanup_duplicate_events.py --apply

# Дедуп — конкретная дата
python3 backend/cleanup_duplicate_events.py --date 2026-05-29 --apply

# Проверить БД
sqlite3 backend/data/air4.db "SELECT COUNT(*) FROM events;"
sqlite3 backend/data/air4.db "SELECT date, type, source FROM workouts ORDER BY date DESC LIMIT 10;"
```

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

## Sprint 6 — Conversational Continuity & Live Feed (22 мая 2026)

### Backend

**Зарплатный цикл 10→10:**
- `services/salary_cycle.py` — `salary_cycle_period(date)` возвращает
  диапазон `[YYYY-MM-10, YYYY-(MM+1)-09]` для произвольной даты.
- `GET /api/finance/cycles` — `active` / `latest_with_data` /
  `earliest_with_data` для дефолта и стрелок навигатора.
- `GET /api/summary?start=...&end=...` принимает явный диапазон и не
  привязан к календарному месяцу.

**Income split:**
- `SummaryOut.total_income` теперь только зарплата; `other_incoming`
  отдельным полем (возвраты, переводы между своими, нерегулярные
  поступления).

**Subscriptions как single source of truth:**
- `services/subscription_migration.py` — на старте приложения
  идемпотентно переливает все subscription-подобные факты из
  `user_facts` в таблицу `subscriptions`.
- `fact_extractor.py` — публичные предикаты `is_subscription_key`,
  `is_obligation_key`; `canonical_subscription_name` + `_BRAND_DISPLAY`
  для нормального написания брендов (ChatGPT, iCloud и т.д.).
- `prompts.py` — `get_subscriptions_context(db)` читает таблицу;
  `_format_facts` отсеивает subscription-related факты из `user_facts`.

**Чат правит recurring items:**
- `services/subscription_updater.py` — парсит сообщения пользователя,
  ищет совпадение в `subscriptions` / `obligations`, различает intent
  «обновить цену» vs «удалить».
- `routers/chat.py` — после ответа LLM вызывает
  `apply_recurring_corrections` и аппендит markdown-footer.
- `DELETE /api/finance/subscriptions/{id}` добавлен.

**Conversational continuity:**
- Таблица `chat_messages (id, role, content, page, created_at)` +
  индекс по `created_at`.
- `services/chat_history.py` — `save_chat_message`, `save_exchange`,
  `fetch_recent_chat_messages`.
- `GET /api/chat/history?limit=50` отдаёт историю фронту.

**Live Feed (`GET /api/feed?limit=30`):**
- `services/feed.py` — агрегатор по 6 источникам: `transactions`,
  `uploads`, `project_logs`, `events`, `observations`, плюс парсинг
  footer'ов из `chat_messages` для subscription-апдейтов.

### Frontend

**Cycle navigator:**
- `Finance.tsx` — стрелки `<` / `>` в шапке Monthly Snapshot.
- `App.tsx` — `fetchOverviewSummary()` тянет `latest_with_data` через
  `/api/finance/cycles`.

**Finance страница:**
- Карточка «Upcoming Obligations» — `nextBillingDate(billing_day)`.
- «Loans & Obligations» — прогресс-бары, цветовая шкала через `progressTone()`.

**Live Feed на Overview:**
- `components/LiveFeed.tsx` — Digest (дефолт) + Full вьюхи.
- Дедуп на бэке + категориальный фильтр на фронте.

**Chat history hydration:**
- `ChatPanel.tsx` и `FullscreenChat.tsx` — на mount тянут историю с бэка.

### Database (новое)
- `chat_messages` — лог переписки.
- `subscriptions` / `obligations` — теперь авторитетные таблицы.

---

## Sprint 7 — Performance, Streaming UX & Russian Localization (22 мая 2026)

### Backend

**Реальный стриминг чата:**
- `routers/chat.py` — честный per-delta SSE: каждая дельта от
  Anthropic SDK уходит во фронт через `yield` сразу.
- `asyncio.to_thread()` оборачивает блокирующий SDK-вызов.

**Transfer detection — только на upload:**
- `mark_internal_transfers_in_db` убран из read-пути и вызывается
  только в `POST /api/upload`.

**SQLite tuning:**
- `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
  `temp_store=MEMORY`, `cache_size=-64000`.
- Добавлены индексы: `transactions(date)`, `transactions(category)`,
  `events(date)`, `events(domain)`, `observations(created_at)`,
  `observations(status)`, `subscriptions(is_active, billing_day)`,
  `user_facts(key)`.

**N+1 fix в projects:**
- `GET /api/projects` — одним SQL с `LEFT JOIN project_sessions ... GROUP BY project_id`.

**Goals deduplication:**
- `routers/goals.py` — `difflib.SequenceMatcher` с порогом 0.85.

**Migration gating:**
- Таблица `_app_meta(key TEXT PRIMARY KEY, value TEXT)`.
- Одноразовые миграции проверяют `_app_meta` и не повторяются.

### Frontend

**Streaming UI:**
- Каждый SSE-чанк добавляется в сообщение с CSS-анимацией `fadeIn`.

**Дедуп Overview-запросов:**
- `fetchOverviewSummary()` мемоизирован — 1 запрос вместо 4–6.

**Полный перевод UI на русский:**
- Все 22 компонента переведены. Сохранены английскими: `AIR4`,
  `milestone`, технические названия маркеров, merchant names.
- `constants.ts` — `PAGE_LABELS`, `PROJECT_STATUS_LABEL`,
  `DILEMMA_STATUS_LABEL`.
- Locale `ru-RU`, русская плюрализация счётчиков.

**Удалён мёртвый код:**
- `backend/services/finance_facts.py` — поглощён subscriptions/obligations.
- `design-reference/src/components/Insights.tsx` — заменён карточками.
- Deprecated алиасы в `lib/api.ts` удалены.

---

## Sprint 8–10 — Health, Cross-sphere, Decision Memory (май 2026)

- Cross-sphere insights на реальных данных
- Decision Memory Layer — таблица решений с исходами
- Health trend charts — динамика маркеров крови
- Projects → Goals связь
- File upload в чат (фото/PDF)
- Forecast остаток к концу цикла
- Burn rate дней на балансе

---

## Sprint 11 — Workout Extractor & Event Cleanup (1 июня 2026)

### Backend
- `workout_extractor.py` — логирование тренировок через чат естественным языком,
  футер-подтверждение (`_Записал: cardio, 2026-05-31, 33 мин_`), notes для
  кардио-данных (дистанция, пульс)
- Интеграция в `routers/chat.py` — fire-and-forget после стрима
- Фикс `event_extractor.py` — LLM больше не записывает meta-действия
  («Добавил тренировку», «Импортировал данные» и т.п.) как жизненные события
- Улучшен дедуп событий — двухуровневый порог:
  - 0.70 для той же даты
  - 0.85 для соседних дат (±1 день)
- `cleanup_duplicate_events.py` — разовый инструмент:
  - dry-run по умолчанию, `--apply` для коммита, `--date` для прицельной даты
  - адаптивный порог: >5 групп на дату → 0.75 вместо 0.5
  - защита от удаления событий на которые ссылается `workouts`
- Очищено 140 дублей (634 → 494 events)
- Импорт 2 новых тренировок из Coaich (2026-05-29 Upper A, 2026-05-30 Lower)

### Database
- `body_extractor.py` обновлён — workouts теперь двумя путями:
  Coaich-импорт + чат через `workout_extractor`

### Аудит кода (июнь 2026)
Проведён полный аудит, найдены и задокументированы:
- Мёртвый `frontend/` с 20+ битыми endpoints
- 5 последовательных LLM вызовов после каждого сообщения (429 риск)
- Два LLM клиента, deprecated lifecycle, мёртвые колонки схемы
- Отсутствие аутентификации, устаревший .env.example

---

## Sprint 12 — Jarvis Mode & Energy State (12 июня 2026)

### Backend
- Новый роутер `backend/routers/recommendation.py`
- `GET /api/air4/recommendation` — главная рекомендация на основе всех сфер, Claude Haiku, кэш 30 минут
- `GET /api/air4/mode` — читает текущий режим из `user_profile`
- `PUT /api/air4/mode` — сохраняет режим в `user_profile`
- Миграция: колонка `air4_mode TEXT DEFAULT 'normal'` в `user_profile`, гейтится через `_app_meta`
- Промпты по режимам `quiet`/`normal`/`active`/`jarvis` подмешиваются в `chat.py` и `recommendation.py`
- Роутер подключён в `main.py` с `prefix="/api/air4"`

### Frontend
- `OverviewDashboard.tsx` — синий блок заменён на Current Recommendation (одна рекомендация, цвет по state: stable=indigo, attention=amber, critical=red, skeleton при загрузке)
- `OverviewDashboard.tsx` — статус бейджи на карточках сфер (🟢🟡🔴)
- `EnergyStateDropdown.tsx` — новый переиспользуемый компонент, 4 режима + DND
- `Header.tsx` — Energy State dropdown, синхронизация с БД
- `FullscreenChat.tsx` — Energy State dropdown в шапке

---

## Следующие шаги (приоритет)

1. **Tailscale** — доступ с телефона
2. **Morning Brief** — при первом открытии за день AIR4 говорит сам
3. **Загрузить выписку за май**
4. **Объединить экстракторы в один LLM вызов** — убрать 429
5. **Удалить `frontend/`** — мёртвый код

---

## Roadmap — Фазы

### Sprint 13 (текущий)
- Tailscale — доступ с телефона
- Morning Brief — AIR4 говорит первым при первом открытии за день
- Загрузить выписку за май

### Sprint 14
- Объединить 5 экстракторов в один LLM вызов — убрать 429
- Удалить мёртвый frontend/
- Follow-up Engine — AIR4 заканчивает разговор действием

### Sprint 15
- Живём с продуктом, итерируем промпты
- Фиксируем моменты "чёрт… он прав"
- Observation Engine — улучшаем качество на реальных данных

### Phase 7
- Global Session Toggle
- Финансовый календарь — разовые обязательства через чат
- Conversation First — любая сущность через чат без UI форм
- Tech debt: объединить LLM клиенты, deprecated lifecycle

### Phase 8
- Curiosity Engine — редкие вопросы для понимания пользователя
- Positive Patterns — AIR4 замечает что работает
- Онбординг через разговор
- SQLCipher + X-AIR4-Key аутентификация

### Phase 9
- iOS приложение
- Push уведомления — только strong observations

### Phase 10
- Голос — Whisper + Kokoro локально
- Apple Health, Apple Calendar
- Другие банки