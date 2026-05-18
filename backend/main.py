from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import (
    chat,
    dilemmas,
    events,
    finance_facts,
    goals,
    health,
    hypotheses,
    insights,
    observations,
    profile,
    projects,
    summary,
    transactions,
    upload,
)

load_dotenv()

app = FastAPI(title="AIR4", version="1.0.0")

cors_origins = os.environ.get(
    "AIR4_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
cors_origins = [o.strip() for o in cors_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(summary.router, prefix="/api", tags=["summary"])
app.include_router(insights.router, prefix="/api", tags=["insights"])
app.include_router(transactions.router, prefix="/api", tags=["transactions"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(dilemmas.router, prefix="/api", tags=["dilemmas"])
app.include_router(observations.router, prefix="/api", tags=["observations"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(profile.router, prefix="/api", tags=["profile"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(goals.router, prefix="/api", tags=["goals"])
app.include_router(finance_facts.router, prefix="/api", tags=["finance"])
app.include_router(hypotheses.router, prefix="/api", tags=["hypotheses"])


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
