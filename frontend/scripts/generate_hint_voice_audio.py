#!/usr/bin/env python3
"""Generate fast, cheerful English voice clips for displayed game hints.

Run from the repo root:
  python frontend/scripts/generate_hint_voice_audio.py
  python frontend/scripts/generate_hint_voice_audio.py --force
  python frontend/scripts/generate_hint_voice_audio.py --clip fantastic --clip so-close
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any, TypedDict

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]


class HintVoiceClip(TypedDict):
    id: str
    text: str


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPO_ROOT / "frontend"
BACKEND_ROOT = REPO_ROOT / "backend"
HINT_VOICE_AUDIO_OUT_DIR = FRONTEND_ROOT / "public" / "audio" / "sound_effects" / "hint_voice"

DEFAULT_TTS_MODEL = "gpt-4o-mini-tts"
DEFAULT_TTS_VOICE = "shimmer"
DEFAULT_TTS_SPEED = 1.2

HINT_VOICE_CLIPS: tuple[HintVoiceClip, ...] = (
    {"id": "great", "text": "Great"},
    {"id": "amazing", "text": "Amazing"},
    {"id": "fantastic", "text": "Fantastic"},
    {"id": "try-again", "text": "Try again"},
    {"id": "so-close", "text": "So close"},
    {"id": "try-that-sound-again", "text": "Try that sound again"},
)

TTS_INSTRUCTIONS = (
    "Say only the exact phrase. Use a short, bright, excited arcade game feedback voice for a young "
    "learner. Keep it upbeat, crisp, and quick, with no extra words."
)


def load_env_files() -> None:
    if load_dotenv is None:
        return

    for env_path in (BACKEND_ROOT / ".env", FRONTEND_ROOT / ".env"):
        if env_path.exists():
            load_dotenv(env_path, override=False)


def resolve_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def selected_clips(clip_ids: list[str]) -> list[HintVoiceClip]:
    if not clip_ids:
        return list(HINT_VOICE_CLIPS)

    clip_by_id = {clip["id"]: clip for clip in HINT_VOICE_CLIPS}
    missing_ids = sorted(set(clip_ids) - set(clip_by_id))
    if missing_ids:
        raise ValueError(f"Unknown hint voice clip id(s): {', '.join(missing_ids)}")
    return [clip_by_id[clip_id] for clip_id in dict.fromkeys(clip_ids)]


def write_openai_speech_mp3(
    *,
    client: Any,
    model: str,
    voice: str,
    speed: float,
    clip: HintVoiceClip,
    dest: Path,
) -> None:
    params = {
        "model": model,
        "voice": voice,
        "input": clip["text"],
        "response_format": "mp3",
        "speed": speed,
    }
    try:
        response = client.audio.speech.create(**params, instructions=TTS_INSTRUCTIONS)
    except TypeError as exc:
        if "instructions" not in str(exc):
            raise
        response = client.audio.speech.create(**params, extra_body={"instructions": TTS_INSTRUCTIONS})
    dest.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate displayed hint voice MP3 files")
    parser.add_argument(
        "--clip",
        action="append",
        default=[],
        help="Generate only one hint voice clip id. Can be passed multiple times.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing MP3 files")
    parser.add_argument("--output-dir", type=Path, default=HINT_VOICE_AUDIO_OUT_DIR)
    parser.add_argument("--model", default=None, help="OpenAI TTS model override")
    parser.add_argument("--voice", default=None, help="OpenAI TTS voice override")
    parser.add_argument("--speed", type=float, default=None, help="OpenAI TTS speed override")
    parser.add_argument("--list", action="store_true", help="List available hint voice clip ids and exit")
    args = parser.parse_args()

    if args.list:
        for clip in HINT_VOICE_CLIPS:
            print(f"{clip['id']}: {clip['text']}")
        return 0

    load_env_files()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required. Add it to backend/.env or your shell environment.")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("The openai package is required. Install backend requirements first.") from exc

    model = args.model or os.getenv("OPENAI_HINT_TTS_MODEL", DEFAULT_TTS_MODEL)
    voice = args.voice or os.getenv("OPENAI_HINT_TTS_VOICE", DEFAULT_TTS_VOICE)
    speed = args.speed
    if speed is None:
        speed = resolve_float_env("OPENAI_HINT_TTS_SPEED", DEFAULT_TTS_SPEED)

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    client = OpenAI(api_key=api_key)

    for clip in selected_clips(args.clip):
        dest = output_dir / f"{clip['id']}.mp3"
        if dest.exists() and not args.force:
            print(f"skip hint voice audio (exists): {dest.relative_to(REPO_ROOT)}")
            continue

        print(f"generate hint voice audio: {clip['id']} -> {dest.relative_to(REPO_ROOT)}")
        write_openai_speech_mp3(
            client=client,
            model=model,
            voice=voice,
            speed=speed,
            clip=clip,
            dest=dest,
        )

    print(f"hint voice audio output: {output_dir.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
