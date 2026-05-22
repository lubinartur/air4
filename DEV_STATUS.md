# DEV_STATUS.md
# AIR4 — Development Status

> Этот файл читается Cursor перед каждой сессией разработки.
> Обновляется после каждого значимого изменения.
> Единый источник статуса разработки — `PROGRESS.md` упразднён 22 мая 2026
> и слит сюда.

---

## Текущий статус: Sprint 7 завершён

**Дата:** 22 мая 2026  
**Фаза:** Phase 7 — Performance, Streaming UX & Russian Localization

Все основные страницы живые, memory-система работает: события и факты извлекаются после каждого сообщения, наблюдения генерируются по rule layer + LLM. Чат стримит ответы по дельтам, БД ускорена (PRAGMA + индексы + N+1 fix), весь UI переведён на русский.

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

**Subscriptions / Loans:** живой UI, таблицы `subscriptions` и `obligations`
— единый источник правды; чат правит цены и удаляет записи через
`subscription_updater`.

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
| Decision Memory Layer — таблица решений с исходами | Phase 7 |
| Memory lifecycle — архивация событий | Phase 7–8 |
| Cross-sphere report (Health × Finance × Projects) | Phase 8 |
| Auth на API | Phase 8 |
| Multiple bank support / Apple Health / Calendar | Phase 8 |
| `chatHistory` → `history` при dev через Vite без Express | — |

### Known issues / tech-debt (актуально)

- Парсер Swedbank иногда пропускает служебные строки (`lõppsaldo`,
  `Käive`) — фильтр работает, но не покрывает все варианты.
- Категория `other` на Finance странице всё ещё собирает шум —
  на Overview уже скрыта через `HIDDEN_CATEGORIES`.

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
  `user_facts` в таблицу `subscriptions` (key-сканер + value-сканер с
  списком известных брендов и проверкой negation).
- `fact_extractor.py` — публичные предикаты `is_subscription_key`,
  `is_obligation_key`, `is_subscription_related_key`;
  `canonical_subscription_name` + `_BRAND_DISPLAY` для нормального
  написания брендов (ChatGPT, iCloud и т.д.); `_upsert_subscription_from_fact`
  пишет любую новую subscription-факт сразу в таблицу.
- `prompts.py` — `get_subscriptions_context(db)` читает таблицу;
  `_format_facts` отсеивает subscription-related факты из `user_facts`,
  чтобы LLM не видел дубликатов.

**Чат правит recurring items:**
- `services/subscription_updater.py` — парсит сообщения пользователя,
  ищет лучшее совпадение в `subscriptions` / `obligations` (токенизация
  + рус. стемминг, стоп-слова, regex для сумм), различает intent
  «обновить цену» vs «удалить»; обновляет `amount` /
  `monthly_payment`, мягко удаляет (`is_active=0`).
- `routers/chat.py` — после ответа LLM вызывает
  `apply_recurring_corrections` и аппендит markdown-footer
  (`_Обновлено: X €old → €new_` или `_Удалено: X_`); возвращает массив
  `recurring_updated` в `ChatOut`.
- `DELETE /api/finance/subscriptions/{id}` добавлен.

**Conversational continuity:**
- Таблица `chat_messages (id, role, content, page, created_at)` +
  индекс по `created_at`.
- `services/chat_history.py` — `save_chat_message`, `save_exchange`,
  `fetch_recent_chat_messages`.
- `routers/chat.py` — `_persist_exchange` сохраняет каждую пару
  user/assistant, `_build_llm_history` подгружает последние сообщения
  из БД и подмешивает их в LLM-контекст; `GET /api/chat/history?limit=50`
  отдаёт историю фронту.

**Live Feed (`GET /api/feed?limit=30`):**
- `services/feed.py` — агрегатор по 6 источникам: `transactions`,
  `uploads`, `project_logs`, `events`, `observations`, плюс парсинг
  footer'ов из `chat_messages` для subscription-апдейтов.
- Сортировка по `created_at desc` (SQLite ISO-строки сортируются
  лексикографически), `_dedupe_by_title` снимает повторы `(type,
  title)`.

### Frontend

**Cycle navigator:**
- `Finance.tsx` — стрелки `<` / `>` в шапке Monthly Snapshot, дефолт на
  `latest_with_data`, обновление `summary` при смене цикла.
- `App.tsx` — `fetchOverviewSummary()` помощник в `lib/api.ts`, тянет
  `latest_with_data` через `/api/finance/cycles` и подставляет его в
  `/api/summary`. Все три точки загрузки Overview переведены на него
  (initial mount, page-switch, post-chat refresh).

**Finance страница:**
- Cycle navigator переехал в шапку Monthly Snapshot (право).
- Карточка «Upcoming Obligations» в правой колонке:
  `nextBillingDate(billing_day)` + `formatRelativeDate` для следующих
  списаний подписок и кредитов.
- «Loans & Obligations» — прогресс-бары `remaining_amount / total_amount`,
  цветовая шкала через `progressTone()` (зелёный / индиго / красный),
  graceful fallback когда суммы не заданы.
- При `recurring_updated.length > 0` из чата —
  `setFinanceRefreshTick`, и `useEffect` рефетчит subscriptions /
  obligations / monthly-fixed.

**Live Feed на Overview:**
- `components/LiveFeed.tsx` — две вьюхи:
  - **Digest** (дефолт, ≤8 строк) — последний элемент в каждой
    «категории» (`categoryOf` отделяет spend от income, и event_health
    от event_finance).
  - **Full** — хронологический список с группировкой
    TODAY / YESTERDAY / `MAY 20`, цветные accent bars слева, иконки
    в tinted квадратах, точное локальное время.
- Дедуп на бэке + категориальный фильтр на фронте.
- Toggle `View all (N)` / `Show digest`, futter `CHRONICLE EVENTS
  SYNCHRONIZED · LIVE STREAM CONNECTED`.

**Observed Patterns на Overview:**
- Перенесён в правую колонку, рядом с Live Feed (2/3 + 1/3 grid).
- Title-only вид с indigo accent + chevron справа, max 3 элемента,
  клик ведёт на страницу Patterns.

**Overview typography & data:**
- `fetchOverviewSummary` чинит KPI (Total Spent, Income, Free Capital)
  и Spend Chart — Overview больше не дёргает пустой active cycle.
- `HIDDEN_CATEGORIES` (`transfers`, `other`, `uncategorized`, ...)
  отфильтровываются на Spend Chart, top 6.
- Подписи категорий переехали на `w-32 break-words leading-tight` —
  больше не режутся `...`.
- Все sub-labels на Overview (INCOME, FREE, LAST 7 DAYS, LAST WORKOUT,
  PRIMARY DILEMMA, TIMELINE) теперь идут через `t.cardLabel`
  (`text-[11px] font-bold text-gray-400 uppercase tracking-wider`);
  BMI вынесен на строку под весом.

**Chat history hydration:**
- `lib/api.ts` — `fetchChatHistory(limit)`.
- `ChatPanel.tsx` и `FullscreenChat.tsx` — на mount тянут историю с
  бэка; `sessionStorage` остаётся fallback на офлайн.
- `onMessageSent` пробрасывает `ChatResponseMeta` (с `recurring_updated`)
  до App.

### Database (новое)

- `chat_messages` — лог переписки.
- `subscriptions` / `obligations` — теперь авторитетные таблицы
  (миграция из `user_facts` идемпотентна).

---

## Sprint 7 — Performance, Streaming UX & Russian Localization (22 мая 2026)

### Backend

**Реальный стриминг чата:**
- `routers/chat.py` — переход с псевдо-стриминга (накопление полного
  ответа + отдача целиком) на честный per-delta SSE: каждая дельта от
  Anthropic SDK уходит во фронт через `yield` сразу.
- `asyncio.to_thread()` оборачивает блокирующий SDK-вызов, чтобы event
  loop не залипал; экстракторы (`event_extractor`, `fact_extractor`,
  `body_extractor`) запускаются после закрытия стрима.

**Transfer detection — только на upload:**
- `mark_internal_transfers_in_db` убран из read-пути
  (`/api/summary`, `/api/transactions`) и вызывается только в
  `POST /api/upload` после парсинга CSV.
- Read-запросы больше не делают O(N²) парный матчинг на каждый GET.

**SQLite tuning:**
- `database.py:get_db()` — `PRAGMA journal_mode=WAL`,
  `synchronous=NORMAL`, `foreign_keys=ON`, `temp_store=MEMORY`,
  `cache_size=-64000` применяются на каждое подключение.
- Добавлены недостающие индексы: `transactions(date)`,
  `transactions(category)`, `events(date)`, `events(domain)`,
  `observations(created_at)`, `observations(status)`,
  `subscriptions(is_active, billing_day)`,
  `user_facts(key)`.

**N+1 fix в projects:**
- `routers/projects.py` — `GET /api/projects` теперь одним SQL с
  `LEFT JOIN project_sessions ... GROUP BY project_id` тянет
  `total_sessions_minutes`. Раньше — отдельный запрос на каждый проект.

**Чистка proxy и API:**
- Express proxy убран — Vite сам ходит на :8000.
- `chatHistory` ключи в `localStorage` переименованы в `history`;
  миграционный код снят.

**Goals deduplication:**
- `routers/goals.py` — `difflib.SequenceMatcher` с порогом 0.85
  фильтрует дубли (например, «Купить машину» и «купить авто»
  схлопываются в одну запись).

**Migration gating:**
- Новая служебная таблица `_app_meta(key TEXT PRIMARY KEY, value TEXT)`.
- Одноразовые миграции (subscription_migration, etc.) проверяют
  `_app_meta` и не запускаются повторно при каждом старте backend.

### Frontend

**Streaming UI:**
- `ChatPanel.tsx` и `FullscreenChat.tsx` — каждый SSE-чанк добавляется
  в сообщение с CSS-анимацией `fadeIn`, без блинкающего курсора в конце.
- Текст «всплывает» по мере прихода токенов, ощущение живой печати.

**Дедуп Overview-запросов:**
- `App.tsx` — `fetchOverviewSummary()` мемоизирован и вызывается один
  раз на mount + после чата. Раньше Overview, Finance и
  `LiveFeed`/`OverviewDashboard` независимо дёргали `/api/summary` и
  `/api/finance/cycles` — суммарно 4–6 GET на загрузку. Теперь 1.

**Полный перевод UI на русский:**
- Все 22 компонента в `design-reference/src/components/` переведены:
  кнопки, статусы (`ON TRACK` → `НА ПУТИ`, `ACTIVE` → `АКТИВЕН`,
  `HIGH/LOW/NORMAL` → `ВЫШЕ/НИЖЕ/НОРМА`), заголовки секций, empty
  states, тексты ошибок, placeholder'ы, `aria-label`/`title`,
  AIR4-цитаты, footer-метки.
- Сохранены английскими по правилу: `AIR4`, `milestone`,
  `Push/Pull/Legs`, технические названия маркеров (hemoglobin,
  testosterone, SHBG), merchant names (Swedbank).
- `constants.ts` — добавлены `PAGE_LABELS`, `PROJECT_STATUS_LABEL`,
  `DILEMMA_STATUS_LABEL`: идентификаторы остаются английскими (роутинг,
  API), отображение — русское.
- Locale `ru-RU` для дат/времени (`LiveFeed`, `Projects`,
  `OverviewDashboard`, `Finance`).
- Русская плюрализация для счётчиков (день/дня/дней,
  воспоминание/воспоминания/воспоминаний, и т.д.).

**Технические исправления:**
- `React keys` — везде, где использовался `index` массива, заменено на
  стабильный `id` (Memory, Goals, LiveFeed, Patterns).
- `Dilemma` TS-тип расширен под новые поля бэка
  (`follow_up_due`, `resolution_note`).

**Удалён мёртвый код:**
- `backend/services/finance_facts.py` — устаревший роутер,
  поглощённый `subscriptions` / `obligations`.
- `design-reference/src/components/Insights.tsx` — заменён карточками
  в Finance / Overview.
- Deprecated алиасы в `lib/api.ts` (`fetchProjectsList`,
  `fetchHealthData`) — удалены, везде используется единое имя.

---

## Следующие шаги (приоритет)

1. **Decision Memory Layer** — таблица решений с исходами, привязка
   к dilemmas и observations.
2. **Memory lifecycle** — архивация старых событий, expirable user_facts.
3. **Загрузить выписку за май** (после 31 мая) — закроет текущий
   зарплатный цикл и даст полный месяц данных для cross-sphere
   insights.
4. **Авто-декремент `remaining_amount` по кредитам** при обнаружении
   платежа в транзакциях (matching по merchant + amount ± tolerance).
5. **Cross-sphere insights на реальных данных** — наблюдения,
   связывающие Finance ↔ Health ↔ Projects (после загрузки полных
   циклов).
