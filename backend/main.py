from contextlib import asynccontextmanager
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from routers import evaluate

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
    "ionic://localhost",
)


def get_cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS") or os.getenv("CORS_ORIGIN")
    if not configured:
        return list(DEFAULT_CORS_ORIGINS)
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return sorted(set([*DEFAULT_CORS_ORIGINS, *origins]))


RESOLVED_CORS_ORIGINS = get_cors_origins()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(
        "[config] cors",
        {
            "origins": RESOLVED_CORS_ORIGINS,
            "origin_regex": r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        },
        flush=True,
    )
    # Future: load pronunciation model here
    yield
    # Future: clean up model resources here


app = FastAPI(
    title="mandarinMadeEasy API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=RESOLVED_CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(evaluate.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
