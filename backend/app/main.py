"""AIR4 FastAPI application (MVP: Event Memory)."""

from fastapi import FastAPI

from app.api.events import router as events_router
from app.db import Base, engine
import app.models  # noqa: F401 — register ORM tables on Base.metadata before create_all

app = FastAPI(title="AIR4", version="0.1.0")

app.include_router(events_router)


@app.on_event("startup")
def _startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
