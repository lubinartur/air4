# API Specification (MVP)

Backend: FastAPI

## Core Endpoints

POST /event
Create new event

Body:
{
  "text": "worked on AIR4 architecture"
}

---

GET /events
List recent events

---

POST /chat
Chat with AIR4 brain

Body:
{
  "message": "What did I focus on this week?"
}

---

GET /search
Semantic search

Query:
?q=training

---

POST /meaning/confirm
Confirm hypothesis

Body:
{
 "meaning_id": "..."
}

---

POST /meaning/reject
Reject hypothesis