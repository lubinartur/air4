# AIR4 — Cursor Context

> Читай этот файл перед каждой сессией разработки.
> Актуально на: 22 июня 2026

---

## Проект

AIR4 — локальный персональный AI советник. Personal Operating System.
Данные только на устройстве. Local-first.

**Ощущение продукта:** Джарвис. Советник который знает тебя потому что у него данные.

---

## Stack

| Слой | Технология |
|------|-----------|
| Frontend | React + Vite + TypeScript (port 3000) |
| Backend | FastAPI Python (port 8000) |
| Database | SQLite `backend/data/air4.db` |
| LLM Chat | Claude Sonnet (`claude-sonnet-4-5`) |
| LLM Fast | Claude Haiku |
| Mobile | Tailscale `100.115.122.70:3000` |

---

## Структура проекта

```
AIR4/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── data/air4.db
│   ├── routers/          # все endpoints
│   └── services/         # бизнес-логика
└── design-reference/     # React UI (активный фронт)
    ├── src/
    │   ├── App.tsx
    │   ├── components/   # все страницы
    │   └── lib/api.ts
    └── vite.config.ts
```

**Важно:** `frontend/` удалён (был мёртвым Next.js прототипом).
Активный фронт — только `design-reference/`.

---

## Текущий статус: Sprint 13 завершён

**Что работает:**
- Finance — CSV upload, категоризация, цикл 10→10, подписки, кредиты
- Memory — events, facts, interview, daily summaries
- Projects — список, логи, таймер сессий, todos
- Health — тренировки, вес, маркеры крови
- Analysis — observations, hypotheses, cross-sphere, dilemmas
- Chat — Claude Sonnet, streaming SSE, история из БД
- Morning Brief — AIR4 говорит первым при открытии
- Unified extractor — 4 LLM вызова объединены в один
- PWA — установка на телефон
- Тёмная тема — `#0f0f14` bg, `#13131f` cards, `#f97316` orange accent
- Tailscale — доступ с телефона

---

## Правила разработки

**Запуск:**
```bash
# Терминал 1
cd backend && uvicorn main:app --reload --port 8000 --host 0.0.0.0

# Терминал 2  
cd design-reference && npm run dev
```

**Git — коммит перед рискованными изменениями:**
```bash
git add -A && git commit -m "checkpoint: описание"
```

**Стиль кода:**
- TypeScript везде на фронте
- Async/await на бэкенде
- SQLite через `database.py` — не создавать новые подключения
- Два LLM клиента: `llm_client.py` (чат, Sonnet) и `llm_client_shared.py` (экстракторы, Haiku)

**Дизайн:**
- Тёмная тема, оранжевый акцент `#f97316`
- Финансовые цифры — JetBrains Mono
- Формат валюты: `15.01 €`
- Домены: Finance=blue, Health=green, Projects=purple, Life=orange

---

## Backlog (приоритет)

### Срочно
- [ ] Зарплата в профиле — без этого свободный капитал сломан (`-3,592 €`)
- [ ] Переписать синюю плашку на Finance — реальный контекст вместо технического сообщения

### Overview редизайн
- [ ] Убрать одну большую синюю плашку
- [ ] Три компактных плашки по сферам (Финансы, Здоровье, Проекты)
- [ ] Быстрые кнопки `[Да]` `[Нет]` `[Расскажу]`

### Новые фичи
- [ ] Global Session Toggle — тоггл проекта из шапки/чата/Overview
- [ ] Follow-up Engine — AIR4 возвращается к важным событиям
- [ ] Страница "Что AIR4 знает обо мне"
- [ ] Финансовый календарь — разовые события (техосмотр, страховка)
- [ ] Еженедельный разбор полётов
- [ ] Помощь выбраться из финансовой ямы — конкретный план с цифрами

### AIRCH vNext (новое направление)
- [ ] Identity Model — таблица выводов о пользователе
- [ ] Spaces — гибкие области вместо фиксированных страниц
- [ ] Knowledge Layer — выводы между чатом и памятью

### Tech debt
- [ ] Объединить два LLM клиента в один
- [ ] Дедуп workouts по `(date, type)` вместо только `date`
- [ ] `@app.on_event` → lifespan context manager
- [ ] Быстрый capture `Cmd+Shift+Space`

---

## Known Issues

- Свободный капитал показывает `-3,592 €` — зарплата не зафиксирована
- Синяя плашка на Finance говорит техническое сообщение вместо реального контекста
- Два LLM клиента — `llm_client.py` и `llm_client_shared.py`
- `@app.on_event` deprecated в FastAPI

---

## Принципы

1. **Бэкенд не трогаем** без необходимости — он работает
2. **Новое рядом со старым** — не ломаем пока новое не работает лучше
3. **Git checkpoint** перед любым рискованным изменением
4. **Реальные данные** — не моки, проверять через `sqlite3`
5. **Один LLM вызов** вместо нескольких последовательных

---

## Полезные команды

```bash
# Проверить БД
sqlite3 backend/data/air4.db "SELECT COUNT(*) FROM events;"
sqlite3 backend/data/air4.db "SELECT * FROM user_profile;"

# Проверить транзакции
sqlite3 backend/data/air4.db "SELECT date, description, amount FROM transactions ORDER BY date DESC LIMIT 10;"

# Health check
curl http://127.0.0.1:8000/health
```
