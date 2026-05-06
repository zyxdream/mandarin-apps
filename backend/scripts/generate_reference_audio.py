#!/usr/bin/env python3
"""
Generate local reference pronunciation clips for the result screen.

Engines:
  openai  — OpenAI Speech API (natural; needs OPENAI_API_KEY). Writes MP3.
  say     — macOS `say` + ffmpeg (offline; needs Meijia voice + ffmpeg). Writes MP3.
  auto    — openai if OPENAI_API_KEY is set, else say.

Output: frontend/public/audio/reference/<word_id>.mp3

Run from repo root:
  cd backend && python scripts/generate_reference_audio.py
  cd backend && python scripts/generate_reference_audio.py --engine say --force
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

# Repo root = parent of backend/
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "audio" / "reference"

if load_dotenv:
    load_dotenv(BACKEND_ROOT / ".env")


def _import_catalog() -> dict[str, str]:
    sys.path.insert(0, str(BACKEND_ROOT))
    from word_catalog import REFERENCE_WORDS

    return dict(REFERENCE_WORDS)


async def generate_openai(word_id: str, hanzi: str, dest: Path) -> None:
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    model = os.getenv("OPENAI_TTS_MODEL", "tts-1-hd")
    voice = os.getenv("OPENAI_TTS_VOICE", "nova")

    def _write() -> None:
        client = OpenAI()
        response = client.audio.speech.create(
            model=model,
            voice=voice,
            input=hanzi,
            response_format="mp3",
        )
        response.stream_to_file(str(dest))

    await asyncio.to_thread(_write)


def generate_say(word_id: str, hanzi: str, dest: Path) -> None:
    if sys.platform != "darwin":
        raise RuntimeError("--engine say requires macOS")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found in PATH (needed to convert AIFF to MP3)")

    tmp_aiff = dest.with_suffix(".aiff.tmp")
    try:
        subprocess.run(
            ["say", "-v", "Meijia", hanzi, "-o", str(tmp_aiff)],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(tmp_aiff),
                "-acodec",
                "libmp3lame",
                "-q:a",
                "4",
                str(dest),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    finally:
        if tmp_aiff.exists():
            tmp_aiff.unlink()


async def main_async() -> int:
    parser = argparse.ArgumentParser(description="Generate reference MP3s for game words")
    parser.add_argument(
        "--engine",
        choices=("auto", "openai", "say"),
        default="auto",
        help="auto: OpenAI if OPENAI_API_KEY else macOS say+ffmpeg",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    catalog = _import_catalog()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    engine = args.engine
    if engine == "auto":
        engine = "openai" if os.getenv("OPENAI_API_KEY") else "say"

    if engine == "say" and sys.platform != "darwin":
        print("error: --engine say requires macOS; set OPENAI_API_KEY and use --engine openai", file=sys.stderr)
        return 1

    for word_id, hanzi in catalog.items():
        dest = OUT_DIR / f"{word_id}.mp3"
        if dest.exists() and not args.force:
            print(f"skip (exists): {dest.name}")
            continue
        print(f"generate [{engine}]: {word_id} ({hanzi}) -> {dest.name}")
        try:
            if engine == "openai":
                await generate_openai(word_id, hanzi, dest)
            else:
                generate_say(word_id, hanzi, dest)
        except Exception as exc:
            print(f"error: {word_id}: {exc}", file=sys.stderr)
            return 1

    print(f"done. {len(catalog)} files under {OUT_DIR}")
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
