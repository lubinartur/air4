import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers.chat import router as chat_router
from app.routers.events import router as events_router
from app.routers.facts import router as facts_router
from app.routers.insights import router as insights_router
from app.routers.hypotheses import router as hypotheses_router
from app.routers.profile import router as profile_router
from app.routers.projects import router as projects_router
from app.routers.report import router as report_router
from app.routers.summary import router as summary_router
from app.routers.cross_sphere import router as cross_sphere_router
from app.routers.observations import router as observations_router
from app.routers.dilemmas import router as dilemmas_router
from app.routers.interview import router as interview_router
from app.routers.timeline import router as timeline_router
from app.routers.transactions import router as transactions_router
from app.routers.upload import router as upload_router


load_dotenv()

app = FastAPI(title="AIR4 Finance", version="1.0.0")

cors_origins = os.environ.get("AIR4_CORS_ORIGINS", "http://localhost:3000").split(",")
cors_origins = [o.strip() for o in cors_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router, prefix="/api", tags=["upload"])
app.include_router(transactions_router, prefix="/api", tags=["transactions"])
app.include_router(summary_router, prefix="/api", tags=["summary"])
app.include_router(insights_router, prefix="/api", tags=["insights"])
app.include_router(chat_router, prefix="/api", tags=["chat"])
app.include_router(events_router, prefix="/api", tags=["events"])
app.include_router(facts_router, prefix="/api", tags=["facts"])
app.include_router(hypotheses_router, prefix="/api", tags=["hypotheses"])
app.include_router(profile_router, prefix="/api", tags=["profile"])
app.include_router(projects_router, prefix="/api", tags=["projects"])
app.include_router(report_router, prefix="/api", tags=["report"])
app.include_router(cross_sphere_router, prefix="/api", tags=["cross-sphere"])
app.include_router(observations_router, prefix="/api", tags=["observations"])
app.include_router(dilemmas_router, prefix="/api", tags=["dilemmas"])
app.include_router(interview_router, prefix="/api", tags=["interview"])
app.include_router(timeline_router, prefix="/api", tags=["timeline"])


@app.on_event("startup")
async def _startup() -> None:
    await init_db()
