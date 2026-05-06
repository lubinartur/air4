# AIR4 — Progress Tracker

## Status: Active Development
Last updated: 6 May 2026

---

## ✅ Phase 1 — Finance MVP (DONE)
- [x] Swedbank CSV upload (two accounts, internal transfer deduplication)
- [x] Transaction parsing (DD.MM.YYYY, semicolon-separated, quoted)
- [x] LLM categorization via Ollama (batches of 20, qwen2.5:32b)
- [x] Estonian merchant awareness (Rimi, Bolt, Telia, etc.)
- [x] Dashboard: total spent, period, spending by category (donut chart)
- [x] Top 5 expenses block
- [x] Human-readable category labels
- [x] AI insights (llama3.1:8b, on-demand via button)
- [x] Monthly life report (qwen2.5:32b, paragraphs, copy button)
- [x] Upload progress states (uploading → categorizing → done)
- [x] Last updated timestamp on dashboard
- [x] Transaction table with manual category correction

## ✅ Phase 2 — Event Memory (DONE)
- [x] Events table + extraction from chat (llama3.1:8b)
- [x] Events page with categories and delete
- [x] User facts table + extraction from chat
- [x] Facts page with delete
- [x] Facts badge in navbar
- [x] Events and facts injected into chat context

## ✅ Profile System (DONE)
- [x] User profile: name, city, profession, monthly income, goals, transport, about
- [x] Profile page (/profile)
- [x] Profile injected into all chat responses
- [x] Name shown in navbar: "AIR4 — Арч"

## ✅ Chat System (DONE)
- [x] Persistent sidebar chat on all pages (dashboard, events, facts, profile)
- [x] Page-aware greeting with real data
- [x] Proactive questions about unknown transactions on dashboard
- [x] Auto model selection (SIMPLE → llama3.1:8b, COMPLEX → qwen2.5:32b)
- [x] Full transaction list in chat context (100 transactions)
- [x] Event + fact extraction from every message
- [x] Chat history persists during navigation

## 🔲 Phase 3 — Time Layers
- [x] Multiple CSV uploads (different months)
- [x] Month-over-month comparison
- [ ] Weekly spending patterns
- [ ] "This month vs last month" in dashboard

## 🔲 Phase 4 — Projects Module
- [x] Projects table (name, description, status, start date)
- [x] Project activity log
- [x] Projects page
- [x] AIR4 tracks project progress from chat mentions
- [x] Projects context in chat

## 🔲 Phase 5 — Meaning Engine
- [x] AIR4 generates hypotheses about user behavior
- [x] Confirm/reject/edit hypotheses
- [x] Confirmed meanings stored and used in chat

## 🔲 Phase 6 — Cross-Sphere Intelligence
- [ ] Finance ↔ Events correlation
- [ ] Spending patterns around life events
- [ ] "When stressed, you spend more on food delivery" type insights
- [ ] Cross-sphere report section

## 🔲 Phase 7 — Observation Engine
- [ ] AIR4 proactively notices patterns
- [ ] Weekly observation (max 1-2 per week)
- [ ] Behavior change detection

## 🔲 Phase 8 — Integrations
- [ ] Multiple bank support
- [ ] Apple Health (workouts, sleep)
- [ ] Calendar integration
- [ ] Workout module (image parsing via vision model)

---

## Known Issues / Tech Debt
- Upload via browser sometimes doesn't reach backend (browser extension interference)
- Markdown in report not rendered (shows ** symbols)
- Balance rows (lõppsaldo, Käive) sometimes slip through parser
- Category "other" still contains some miscategorized transactions

## Tech Stack
- Frontend: Next.js 14, Tailwind CSS, TypeScript
- Backend: FastAPI, SQLite, Python
- LLM Fast: llama3.1:8b via Ollama
- LLM Quality: qwen2.5:32b via Ollama  
- Models available: qwen2.5:32b, llama3.1:8b, deepseek-r1:14b, deepseek-r1:32b
