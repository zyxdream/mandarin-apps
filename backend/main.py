from contextlib import asynccontextmanager
import asyncio
import os
import time

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
FALSE_ENV_VALUES = {"0", "false", "no", "off"}


def env_flag(name: str, default: bool) -> bool:
    configured = os.getenv(name)
    if configured is None:
        return default
    return configured.strip().lower() not in FALSE_ENV_VALUES


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
    if env_flag("LOCAL_ASR_PRELOAD", True):
        started_at = time.perf_counter()
        print(
            "[warmup][asr] startup preload start",
            {"model_dir": str(evaluate.local_asr.model_dir)},
            flush=True,
        )
        try:
            warmup = await asyncio.to_thread(evaluate.local_asr.ensure_ready)
        except Exception as exc:
            print(
                "[warmup][asr] startup preload failed",
                {"error": str(exc), "elapsed_ms": int((time.perf_counter() - started_at) * 1000)},
                flush=True,
            )
            raise RuntimeError(f"Local ASR preload failed: {exc}") from exc
        print("[warmup][asr] startup preload complete", warmup, flush=True)
    else:
        print("[warmup][asr] startup preload skipped", {"LOCAL_ASR_PRELOAD": "false"}, flush=True)
    yield


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
