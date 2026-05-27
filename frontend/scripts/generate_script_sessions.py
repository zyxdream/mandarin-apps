#!/usr/bin/env python3
"""Generate ordered game session data and optional TTS clips from script JSON.

Run from repo root:
  python frontend/scripts/generate_script_sessions.py
  python frontend/scripts/generate_script_sessions.py --generate-audio
  python frontend/scripts/generate_script_sessions.py --preview-voices --preview-session wm-01
  python frontend/scripts/generate_script_sessions.py --preview-voices --tts-provider qwen --preview-session wm-01
  python frontend/scripts/generate_script_sessions.py --preview-voices --tts-provider qwen --preview-session wm-01 --serena-experiment
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from pypinyin import Style, lazy_pinyin
from pypinyin.contrib.tone_convert import tone3_to_tone

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPO_ROOT / "frontend"
BACKEND_ROOT = REPO_ROOT / "backend"
INPUT_JSON = FRONTEND_ROOT / "public" / "audio" / "script_content" / "whack_a_mole_current_numbered_sessions_v3.json"
GENERATED_TS = FRONTEND_ROOT / "src" / "data" / "scriptSessions.generated.ts"
AUDIO_OUT_DIR = FRONTEND_ROOT / "public" / "audio" / "script_content" / "generated"
AUDIO_PUBLIC_DIR = "/audio/script_content/generated"
WORD_AUDIO_OUT_DIR = AUDIO_OUT_DIR / "words"
WORD_AUDIO_PUBLIC_DIR = f"{AUDIO_PUBLIC_DIR}/words"
TIMINGS_OUT_DIR = AUDIO_OUT_DIR / "timings"

TTS_MODEL = "gpt-4o-tts"
TTS_VOICE = "nova"
TTS_SPEED = 0.85
TTS_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
)
TTS_INSTRUCTIONS = (
    "Speak Mandarin Chinese slowly, clearly, warmly, and energetically for young learners. "
    "Keep tones precise, add tiny pauses after phrases, and sound encouraging rather than dramatic."
)
QWEN_TTS_MODEL = "qwen3-tts-instruct-flash"
QWEN_TTS_LANGUAGE_TYPE = "Chinese"
QWEN_TTS_VOICE = "Serena"
QWEN_TTS_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1"
QWEN_TTS_MAX_WORD_RETRIES = 2
QWEN_TTS_QUALITY_REPORT = "word_quality_report.json"
QWEN_TTS_PREVIEW_VOICES = (
    "Cherry",
    "Serena",
    "Mia",
    "Bunny",
    "Ethan",
    "Neil",
)
SERENA_EXPERIMENT_VOICE = "Serena"
SERENA_EXPERIMENT_MANIFEST = "qwen-serena-experiment-manifest.json"
SERENA_EXPERIMENT_PROFILES = (
    {
        "id": "p1-baseline-cn",
        "label": "baseline chinese",
        "languageType": "Chinese",
        "mode": "baseline",
    },
    {
        "id": "p2-baseline-auto",
        "label": "baseline auto language",
        "languageType": "Auto",
        "mode": "baseline",
    },
    {
        "id": "p3-phrase-breaks",
        "label": "phrase breaks",
        "languageType": "Chinese",
        "mode": "phrase_breaks",
    },
    {
        "id": "p4-long-pauses",
        "label": "long pauses",
        "languageType": "Chinese",
        "mode": "long_pauses",
    },
    {
        "id": "p5-story-calm",
        "label": "story calm",
        "languageType": "Chinese",
        "mode": "story_calm",
    },
    {
        "id": "p6-lively-rhythm",
        "label": "lively rhythm",
        "languageType": "Chinese",
        "mode": "lively_rhythm",
    },
)
CJK_RE = re.compile(r"[\u3400-\u9fff]")
SAFE_ID_RE = re.compile(r"[^a-z0-9]+")
ALIGNMENT_MIN_COVERAGE = 0.65

if load_dotenv:
    load_dotenv(BACKEND_ROOT / ".env")


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def normalize_pinyin_syllable(syllable: str) -> str:
    return unicodedata.normalize("NFC", syllable).replace("u:", "ü").replace("v", "ü")


def phrase_pinyin(text: str, style: Style) -> list[str]:
    return [
        normalize_pinyin_syllable(item)
        for item in lazy_pinyin(
            text,
            style=style,
            neutral_tone_with_five=True,
            tone_sandhi=True,
            errors="ignore",
        )
        if item
    ]


def display_pinyin(text: str) -> str:
    return " ".join(phrase_pinyin(text, Style.TONE))


def numbered_pinyin(text: str) -> str:
    return " ".join(phrase_pinyin(text, Style.TONE3))


def tone_from_pinyin_raw(pinyin_raw: str) -> int:
    match = re.search(r"([1-5])", pinyin_raw)
    return int(match.group(1)) if match else 5


def safe_slug(text: str) -> str:
    slug = SAFE_ID_RE.sub("", text.lower())
    return slug[:36] or "word"


def normalize_numbered_pinyin(text: str) -> str:
    tokens = [token for token in re.split(r"\s+", text.strip()) if token]
    normalized = [normalize_pinyin_syllable(token.lower()) for token in tokens]
    return " ".join(normalized)


def display_pinyin_from_numbered(pinyin_raw: str) -> str:
    parts: list[str] = []
    for token in pinyin_raw.split():
        try:
            parts.append(tone3_to_tone(token))
        except Exception:
            parts.append(token)
    return " ".join(parts)


def difficulty_for_session(index: int) -> str:
    if index < 10:
        return "easy"
    if index < 22:
        return "medium"
    return "hard"


def score_for_word(text: str, difficulty: str) -> int:
    if difficulty == "hard" or len(text) >= 4:
        return 20
    if difficulty == "medium" or len(text) >= 3:
        return 15
    return 10


def script_tokens(text: str) -> list[dict[str, Any]]:
    pinyin_items = lazy_pinyin(
        text,
        style=Style.TONE,
        neutral_tone_with_five=True,
        tone_sandhi=True,
        errors=lambda chunk: list(chunk),
    )
    tokens: list[dict[str, Any]] = []
    for char, pinyin in zip(text, pinyin_items, strict=False):
        if CJK_RE.match(char):
            tokens.append({"text": char, "pinyin": normalize_pinyin_syllable(pinyin)})
        else:
            tokens.append({"text": char})
    return tokens


def cjk_text(text: str) -> str:
    return "".join(CJK_RE.findall(text))


def rounded_sec(value: float) -> float:
    return round(max(0.0, value), 3)


def response_to_dict(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "model_dump"):
        return response.model_dump()
    if hasattr(response, "to_dict_recursive"):
        return response.to_dict_recursive()
    if hasattr(response, "to_dict"):
        return response.to_dict()
    if hasattr(response, "json"):
        return json.loads(response.json())
    raise TypeError(f"Unsupported OpenAI response type: {type(response)!r}")


def iter_transcription_words(data: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for word in data.get("words") or []:
        yield word
    for segment in data.get("segments") or []:
        for word in segment.get("words") or []:
            yield word


def timed_words_from_transcription(data: dict[str, Any]) -> list[dict[str, Any]]:
    timed_words: list[dict[str, Any]] = []
    for raw_word in iter_transcription_words(data):
        word_text = str(raw_word.get("word") or raw_word.get("text") or "")
        normalized = cjk_text(word_text)
        if not normalized:
            continue
        try:
            start = float(raw_word["start"])
            end = float(raw_word["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end < start:
            continue
        timed_words.append({
            "word": word_text,
            "normalized": normalized,
            "start": start,
            "end": end,
        })
    return timed_words


def script_hanzi_positions(tokens: list[dict[str, Any]]) -> list[tuple[int, str]]:
    return [
        (index, token["text"])
        for index, token in enumerate(tokens)
        if token.get("pinyin") and CJK_RE.match(token["text"])
    ]


def find_chunk_positions(script_text: str, chunk: str, cursor: int) -> list[int]:
    exact_at_or_after_cursor = script_text.find(chunk, cursor)
    if exact_at_or_after_cursor >= 0:
        return list(range(exact_at_or_after_cursor, exact_at_or_after_cursor + len(chunk)))

    # Whisper can occasionally split or substitute a word. Keep alignment moving
    # by matching known Hanzi in order, but do not jump far backwards.
    positions: list[int] = []
    search_from = cursor
    for char in chunk:
        found = script_text.find(char, search_from)
        if found < 0:
            continue
        positions.append(found)
        search_from = found + 1
    return positions


def has_timing(token: dict[str, Any]) -> bool:
    return isinstance(token.get("startSec"), (int, float)) and isinstance(token.get("endSec"), (int, float))


def add_estimated_token_timings(tokens: list[dict[str, Any]]) -> None:
    if not any(has_timing(token) for token in tokens):
        return

    index = 0
    while index < len(tokens):
        if has_timing(tokens[index]):
            index += 1
            continue

        gap_start = index
        while index < len(tokens) and not has_timing(tokens[index]):
            index += 1
        gap_end = index - 1
        gap_count = gap_end - gap_start + 1

        previous_index = next((i for i in range(gap_start - 1, -1, -1) if has_timing(tokens[i])), None)
        next_index = next((i for i in range(index, len(tokens)) if has_timing(tokens[i])), None)

        if previous_index is not None and next_index is not None:
            previous_end = float(tokens[previous_index]["endSec"])
            next_start = float(tokens[next_index]["startSec"])
            gap_span = next_start - previous_end
            if gap_span > 0:
                step = gap_span / gap_count
                for offset, token_index in enumerate(range(gap_start, gap_end + 1)):
                    tokens[token_index]["startSec"] = rounded_sec(previous_end + step * offset)
                    tokens[token_index]["endSec"] = rounded_sec(previous_end + step * (offset + 1))
                    tokens[token_index]["timingSource"] = "estimated"
                continue

        if previous_index is not None:
            start_cursor = float(tokens[previous_index]["endSec"])
        elif next_index is not None:
            next_start = float(tokens[next_index]["startSec"])
            start_cursor = max(0.0, next_start - 0.12 * gap_count)
        else:
            start_cursor = 0.0

        for token_index in range(gap_start, gap_end + 1):
            tokens[token_index]["startSec"] = rounded_sec(start_cursor)
            tokens[token_index]["endSec"] = rounded_sec(start_cursor + 0.12)
            tokens[token_index]["timingSource"] = "estimated"
            start_cursor += 0.12


def apply_karaoke_timings(session: dict[str, Any], transcription_data: dict[str, Any]) -> dict[str, Any]:
    tokens = session["scriptTokens"]
    positions = script_hanzi_positions(tokens)
    script_text = "".join(char for _, char in positions)
    timed_words = timed_words_from_transcription(transcription_data)

    if not script_text or not timed_words:
        return {
            "status": "failed",
            "reason": "missing_script_or_word_timestamps",
            "coverage": 0,
            "timedWordCount": len(timed_words),
        }

    for token in tokens:
        token.pop("startSec", None)
        token.pop("endSec", None)
        token.pop("timingSource", None)

    cursor = 0
    aligned_positions: set[int] = set()
    unmatched_words: list[str] = []
    for timed_word in timed_words:
        chunk = timed_word["normalized"]
        chunk_positions = find_chunk_positions(script_text, chunk, cursor)
        if not chunk_positions:
            unmatched_words.append(timed_word["word"])
            continue

        start = timed_word["start"]
        end = timed_word["end"]
        span = max(0.04, end - start)
        count = len(chunk_positions)
        for offset, char_position in enumerate(chunk_positions):
            if char_position >= len(positions):
                continue
            token_index = positions[char_position][0]
            token_start = start + span * (offset / count)
            token_end = start + span * ((offset + 1) / count)
            tokens[token_index]["startSec"] = rounded_sec(token_start)
            tokens[token_index]["endSec"] = rounded_sec(token_end)
            tokens[token_index]["timingSource"] = "aligned"
            aligned_positions.add(char_position)
        cursor = max(cursor, max(chunk_positions) + 1)

    coverage = len(aligned_positions) / len(positions)
    if coverage < ALIGNMENT_MIN_COVERAGE:
        for token in tokens:
            token.pop("startSec", None)
            token.pop("endSec", None)
            token.pop("timingSource", None)
        return {
            "status": "failed",
            "reason": "low_alignment_coverage",
            "coverage": round(coverage, 3),
            "timedWordCount": len(timed_words),
            "unmatchedWords": unmatched_words[:12],
        }

    add_estimated_token_timings(tokens)
    return {
        "status": "aligned",
        "coverage": round(coverage, 3),
        "timedWordCount": len(timed_words),
        "unmatchedWords": unmatched_words[:12],
    }


def parse_game_word_entry(raw_word: Any, *, session_id: str, word_index: int) -> tuple[str, str | None]:
    if isinstance(raw_word, str):
        hanzi = raw_word.strip()
        return hanzi, None

    if isinstance(raw_word, dict):
        hanzi = str(raw_word.get("hanzi") or "").strip()
        if not hanzi:
            raise ValueError(
                f"Invalid game_words entry in {session_id} at index {word_index}: object is missing non-empty 'hanzi'"
            )
        raw_pinyin = raw_word.get("pinyinRaw")
        if raw_pinyin is None:
            return hanzi, None
        explicit = normalize_numbered_pinyin(str(raw_pinyin))
        if not explicit:
            raise ValueError(
                f"Invalid game_words entry in {session_id} at index {word_index}: 'pinyinRaw' is empty"
            )
        return hanzi, explicit

    raise TypeError(
        f"Invalid game_words entry in {session_id} at index {word_index}: expected string or object, got {type(raw_word)!r}"
    )


def build_word(
    session_id: str,
    session_index: int,
    word_index: int,
    hanzi: str,
    explicit_pinyin_raw: str | None = None,
) -> dict[str, Any]:
    pinyin_raw = explicit_pinyin_raw or numbered_pinyin(hanzi)
    difficulty = difficulty_for_session(session_index)
    compact_pinyin = safe_slug(pinyin_raw.replace(" ", ""))
    word_id = f"{session_id}-{word_index + 1:02d}-{compact_pinyin}"
    pinyin_display = display_pinyin_from_numbered(pinyin_raw) if explicit_pinyin_raw else display_pinyin(hanzi)
    return {
        "id": word_id,
        "hanzi": hanzi,
        "pinyin": pinyin_display,
        "pinyinRaw": pinyin_raw,
        "tone": tone_from_pinyin_raw(pinyin_raw),
        "difficulty": difficulty,
        "creatureName": f"{hanzi} Mole",
        "scoreValue": score_for_word(hanzi, difficulty),
        "audioUrl": f"{WORD_AUDIO_PUBLIC_DIR}/{word_id}.mp3",
    }


def build_sessions(source: dict[str, Any]) -> list[dict[str, Any]]:
    sessions = []
    for session_index, raw_session in enumerate(source.get("sessions", [])):
        session_id = raw_session["id"]
        title = (raw_session.get("title") or "").strip() or f"Session {session_id}"
        source_items = [str(item) for item in raw_session.get("source", []) if str(item).strip()]
        game_words: list[dict[str, Any]] = []
        for word_index, raw_word in enumerate(raw_session.get("game_words", [])):
            hanzi, explicit_pinyin_raw = parse_game_word_entry(raw_word, session_id=session_id, word_index=word_index)
            if not hanzi:
                continue
            game_words.append(build_word(session_id, session_index, word_index, hanzi, explicit_pinyin_raw))
        sessions.append({
            "id": session_id,
            "title": title,
            "source": source_items,
            "ttsScript": raw_session["tts_script"],
            "audioUrl": f"{AUDIO_PUBLIC_DIR}/{session_id}.mp3",
            "scriptTokens": script_tokens(raw_session["tts_script"]),
            "words": game_words,
        })
    return sessions


def find_session(sessions: list[dict[str, Any]], session_id: str) -> dict[str, Any]:
    for session in sessions:
        if session["id"] == session_id:
            return session
    available = ", ".join(session["id"] for session in sessions)
    raise ValueError(f"Unknown session {session_id!r}. Available sessions: {available}")


def report_word_pinyin_mapping(source: dict[str, Any], *, only_session_ids: set[str] | None = None) -> None:
    session_rows = 0
    word_rows = 0
    for session_index, raw_session in enumerate(source.get("sessions", [])):
        session_id = raw_session["id"]
        if only_session_ids is not None and session_id not in only_session_ids:
            continue
        session_rows += 1
        print(f"session {session_id}:")
        for word_index, raw_word in enumerate(raw_session.get("game_words", [])):
            hanzi, explicit_pinyin_raw = parse_game_word_entry(raw_word, session_id=session_id, word_index=word_index)
            if not hanzi:
                continue
            computed_pinyin_raw = numbered_pinyin(hanzi)
            final_pinyin_raw = explicit_pinyin_raw or computed_pinyin_raw
            word_id = f"{session_id}-{word_index + 1:02d}-{safe_slug(final_pinyin_raw.replace(' ', ''))}"
            explicit_label = explicit_pinyin_raw or "-"
            print(
                f"  #{word_index + 1:02d} hanzi={hanzi} explicit={explicit_label} "
                f"computed={computed_pinyin_raw} final={final_pinyin_raw} id={word_id}"
            )
            word_rows += 1

    if only_session_ids is not None:
        known = {session["id"] for session in source.get("sessions", [])}
        missing = sorted(only_session_ids - known)
        if missing:
            print(f"warning: unknown report session ids: {', '.join(missing)}")
    print(f"pinyin report: {session_rows} sessions, {word_rows} words")


def write_generated_ts(sessions: list[dict[str, Any]], output_path: Path) -> None:
    output_path.write_text(
        "import type { ScriptSession } from './scriptSessions';\n\n"
        "/* This file is generated by frontend/scripts/generate_script_sessions.py. */\n"
        f"export const SCRIPT_SESSIONS: ScriptSession[] = {compact_json(sessions)};\n",
        encoding="utf-8",
    )


def write_speech_mp3(client: Any, *, voice: str, input_text: str, dest: Path, instructions: str | None = None) -> None:
    params = {
        "model": os.getenv("OPENAI_SCRIPT_TTS_MODEL", TTS_MODEL),
        "voice": voice,
        "input": input_text,
        "response_format": "mp3",
        "speed": float(os.getenv("OPENAI_SCRIPT_TTS_SPEED", str(TTS_SPEED))),
    }
    tts_instructions = instructions or os.getenv("OPENAI_SCRIPT_TTS_INSTRUCTIONS", TTS_INSTRUCTIONS)
    try:
        response = client.audio.speech.create(**params, instructions=tts_instructions)
    except TypeError as exc:
        if "instructions" not in str(exc):
            raise
        response = client.audio.speech.create(**params, extra_body={"instructions": tts_instructions})
    dest.write_bytes(response.read())


def resolve_preview_voices(provider: str, selected_voices: list[str]) -> tuple[str, ...]:
    cleaned = [voice.strip() for voice in selected_voices if voice.strip()]
    if cleaned:
        return tuple(dict.fromkeys(cleaned))
    if provider == "qwen":
        return QWEN_TTS_PREVIEW_VOICES
    return TTS_VOICES


def voice_filename_fragment(voice: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", voice.strip().lower()).strip("-")
    return slug or "voice"


def qwen_base_url() -> str:
    return os.getenv("DASHSCOPE_TTS_BASE_URL", QWEN_TTS_BASE_URL).rstrip("/")


def qwen_request_timeout_sec() -> float:
    raw = os.getenv("QWEN_TTS_TIMEOUT_SEC", "120")
    try:
        return max(10.0, float(raw))
    except ValueError:
        return 120.0


def qwen_tts_voice() -> str:
    return os.getenv("QWEN_SCRIPT_TTS_VOICE", QWEN_TTS_VOICE)


def qwen_tts_model() -> str:
    return os.getenv("QWEN_SCRIPT_TTS_MODEL", QWEN_TTS_MODEL)


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def qwen_supports_instructions(model_name: str) -> bool:
    normalized = model_name.strip().lower()
    return normalized.startswith("qwen3-tts-instruct-flash")


def qwen_default_instructions() -> str:
    return os.getenv("QWEN_SCRIPT_TTS_INSTRUCTIONS", "").strip() or os.getenv(
        "OPENAI_SCRIPT_TTS_INSTRUCTIONS",
        TTS_INSTRUCTIONS,
    )


def _qwen_request_json(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not set")

    endpoint = f"{qwen_base_url()}/services/aigc/multimodal-generation/generation"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=qwen_request_timeout_sec()) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Qwen TTS request failed ({exc.code}): {error_body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Qwen TTS request failed: {exc.reason}") from exc

    try:
        response_data = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Qwen TTS response is not valid JSON: {response_body[:300]}") from exc
    return response_data


def request_qwen_audio_url(
    *,
    text: str,
    voice: str,
    language_type: str | None = None,
    instructions: str | None = None,
    optimize_instructions: bool | None = None,
) -> str:
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not set")

    model_name = qwen_tts_model()
    resolved_language_type = language_type or os.getenv("QWEN_SCRIPT_TTS_LANGUAGE_TYPE", QWEN_TTS_LANGUAGE_TYPE)
    payload = {
        "model": model_name,
        "input": {
            "text": text,
            "voice": voice,
            "language_type": resolved_language_type,
        },
    }

    trimmed_instructions = (instructions or "").strip()
    supports_instructions = qwen_supports_instructions(model_name)
    if trimmed_instructions:
        if supports_instructions:
            payload["instructions"] = trimmed_instructions
            enable_opt = (
                optimize_instructions
                if optimize_instructions is not None
                else env_bool("QWEN_SCRIPT_TTS_OPTIMIZE_INSTRUCTIONS", True)
            )
            if enable_opt:
                payload["optimize_instructions"] = True
        else:
            print(
                "warning: Qwen instructions requested but model does not support instruction control; "
                f"skipping instructions for model={model_name}"
            )

    try:
        response_data = _qwen_request_json(payload)
    except RuntimeError as exc:
        # Some endpoints/models reject optimize_instructions; retry once without it.
        if payload.get("optimize_instructions"):
            retry_payload = dict(payload)
            retry_payload.pop("optimize_instructions", None)
            print("warning: retrying Qwen request without optimize_instructions")
            response_data = _qwen_request_json(retry_payload)
        else:
            raise exc

    output = response_data.get("output")
    audio = output.get("audio") if isinstance(output, dict) else None
    audio_url = audio.get("url") if isinstance(audio, dict) else None
    if isinstance(audio_url, str) and audio_url:
        return audio_url
    raise RuntimeError(f"Qwen TTS response missing output.audio.url: {compact_json(response_data)[:500]}")


def download_file(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "mandarin-apps-tts-preview/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=qwen_request_timeout_sec()) as response, dest.open("wb") as out_file:
            shutil.copyfileobj(response, out_file)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Qwen audio download failed ({exc.code}): {error_body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Qwen audio download failed: {exc.reason}") from exc


def convert_wav_to_mp3(input_wav: Path, output_mp3: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found in PATH (needed to convert Qwen WAV to MP3)")
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(input_wav),
                "-acodec",
                "libmp3lame",
                "-q:a",
                "4",
                str(output_mp3),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        error_message = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg failed to convert Qwen WAV to MP3: {error_message[:300]}") from exc


def write_qwen_speech_mp3(
    *,
    voice: str,
    input_text: str,
    dest: Path,
    language_type: str | None = None,
    instructions: str | None = None,
    optimize_instructions: bool | None = None,
) -> None:
    audio_url = request_qwen_audio_url(
        text=input_text,
        voice=voice,
        language_type=language_type,
        instructions=instructions,
        optimize_instructions=optimize_instructions,
    )
    with tempfile.TemporaryDirectory(prefix="qwen-tts-preview-") as tmp_dir:
        tmp_wav = Path(tmp_dir) / "preview.wav"
        download_file(audio_url, tmp_wav)
        convert_wav_to_mp3(tmp_wav, dest)


def normalize_serena_experiment_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def serena_experiment_text(script_text: str, mode: str) -> str:
    if mode == "baseline":
        return script_text
    if mode == "phrase_breaks":
        return normalize_serena_experiment_text(script_text.replace("，", "，\n").replace("。", "。\n"))
    if mode == "long_pauses":
        return normalize_serena_experiment_text(script_text.replace("，", "，……").replace("。", "。……\n"))
    if mode == "story_calm":
        return normalize_serena_experiment_text(script_text.replace("，", "。\n").replace("。", "。\n"))
    if mode == "lively_rhythm":
        return normalize_serena_experiment_text(script_text.replace("。", "！\n"))
    raise ValueError(f"Unknown Serena experiment mode: {mode}")


def resolve_serena_experiment_profiles(selected_profile_ids: list[str]) -> list[dict[str, str]]:
    profile_map = {profile["id"]: profile for profile in SERENA_EXPERIMENT_PROFILES}
    if not selected_profile_ids:
        return [dict(profile) for profile in SERENA_EXPERIMENT_PROFILES]

    selected: list[dict[str, str]] = []
    seen: set[str] = set()
    for profile_id in selected_profile_ids:
        normalized = profile_id.strip()
        if not normalized or normalized in seen:
            continue
        profile = profile_map.get(normalized)
        if profile is None:
            available = ", ".join(profile_map)
            raise ValueError(f"Unknown --serena-profile {normalized!r}. Available profiles: {available}")
        selected.append(dict(profile))
        seen.add(normalized)
    if not selected:
        raise ValueError("No valid --serena-profile values provided")
    return selected


async def generate_serena_experiment(
    session: dict[str, Any],
    *,
    selected_profile_ids: list[str],
) -> None:
    preview_dir = AUDIO_OUT_DIR / "voice_previews" / session["id"]
    preview_dir.mkdir(parents=True, exist_ok=True)

    profiles = resolve_serena_experiment_profiles(selected_profile_ids)
    base_script = session["ttsScript"]
    manifest_rows: list[dict[str, str]] = []

    for profile in profiles:
        profile_id = profile["id"]
        transformed_text = serena_experiment_text(base_script, profile["mode"])
        language_type = profile["languageType"]
        dest = preview_dir / f"{session['id']}-qwen-serena-{profile_id}.mp3"
        action = "overwrite" if dest.exists() else "generate"
        print(f"{action} Serena experiment: {profile_id} -> {dest.relative_to(REPO_ROOT)}")
        await asyncio.to_thread(
            write_qwen_speech_mp3,
            voice=SERENA_EXPERIMENT_VOICE,
            input_text=transformed_text,
            dest=dest,
            language_type=language_type,
        )
        manifest_rows.append(
            {
                "profileId": profile_id,
                "label": profile["label"],
                "languageType": language_type,
                "outputPath": str(dest.relative_to(REPO_ROOT)),
                "textPreview": transformed_text[:120],
            }
        )

    manifest_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sessionId": session["id"],
        "voice": SERENA_EXPERIMENT_VOICE,
        "provider": "qwen",
        "model": os.getenv("QWEN_SCRIPT_TTS_MODEL", QWEN_TTS_MODEL),
        "profiles": manifest_rows,
    }
    manifest_path = preview_dir / SERENA_EXPERIMENT_MANIFEST
    manifest_path.write_text(compact_json(manifest_payload), encoding="utf-8")
    print(f"Serena experiment manifest: {manifest_path.relative_to(REPO_ROOT)}")


def word_tts_instructions(word: dict[str, Any], session: dict[str, Any]) -> str:
    source = " / ".join(session.get("source") or [])
    tone = tone_from_pinyin_raw(word["pinyinRaw"])
    tone_guidance = {
        1: "Tone 1 is high and level.",
        2: "Tone 2 rises upward.",
        3: "Tone 3 is low and dipping; keep it low with a gentle fall-rise contour.",
        4: "Tone 4 falls sharply downward.",
        5: "Tone 5 is neutral/light and short.",
    }.get(tone, "Use the numbered pinyin tone exactly.")
    huo_guidance = (
        "\nImportant for this target: 火 must be pronounced huǒ, third tone. "
        "Use a low dipping third-tone contour. Do not pronounce it as first, second, fourth, or neutral tone.\n"
        if word["pinyinRaw"].replace(" ", "") == "huo3"
        else ""
    )
    return (
        f"Session title: {session['title']}.\n"
        f"Session source: {source or 'unknown'}.\n"
        f"Full reading context: {session['ttsScript']}\n\n"
        "Use the session context only to choose the correct Mandarin pronunciation.\n"
        f"Speak ONLY this Mandarin word or phrase: {word['hanzi']}.\n"
        f"Pronunciation: {word['pinyin']} / {word['pinyinRaw']}.\n"
        "Mandarin has four lexical tones plus a neutral/light tone. "
        "The number in the numbered pinyin is the required tone and must be followed exactly.\n"
        f"Required tone number: {tone}. {tone_guidance}\n"
        f"{huo_guidance}"
        "Do not speak the pinyin. Do not speak the surrounding context.\n"
        "Do not explain. Do not add extra words.\n"
        "Say it once, clearly and slowly for a child to repeat. Keep tones precise."
    )


def transcribe_word_audio_text(audio_path: Path) -> str:
    from openai import OpenAI

    model_name = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
    client = OpenAI()
    with audio_path.open("rb") as audio_file:
        response = client.audio.transcriptions.create(
            file=audio_file,
            model=model_name,
            language="zh",
            response_format="text",
        )
    return response if isinstance(response, str) else str(response)


def normalize_zh_text(value: str) -> str:
    return "".join(CJK_RE.findall(value or ""))


def verify_word_audio(word: dict[str, Any], audio_path: Path) -> tuple[bool, str]:
    transcript = normalize_zh_text(transcribe_word_audio_text(audio_path))
    expected = normalize_zh_text(word["hanzi"])
    if not expected:
        return True, transcript
    expected_pinyin = numbered_pinyin(expected).replace(" ", "")
    transcript_pinyin = numbered_pinyin(transcript).replace(" ", "")
    ok = (
        transcript == expected
        or expected in transcript
        or (expected_pinyin and transcript_pinyin and transcript_pinyin == expected_pinyin)
    )
    return ok, transcript


async def generate_session_audio(session: dict[str, Any], force: bool, provider: str) -> None:
    AUDIO_OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = AUDIO_OUT_DIR / f"{session['id']}.mp3"
    if dest.exists() and not force:
        print(f"skip audio (exists): {dest.name}")
        return

    if provider == "openai":
        from openai import OpenAI

        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set")

        def _write_openai() -> None:
            client = OpenAI()
            write_speech_mp3(
                client,
                voice=os.getenv("OPENAI_SCRIPT_TTS_VOICE", TTS_VOICE),
                input_text=session["ttsScript"],
                dest=dest,
            )

        print(f"generate audio [{provider}]: {session['id']} -> {dest.relative_to(REPO_ROOT)}")
        await asyncio.to_thread(_write_openai)
        return

    if provider == "qwen":
        if not os.getenv("DASHSCOPE_API_KEY"):
            raise RuntimeError("DASHSCOPE_API_KEY is not set")
        print(f"generate audio [{provider}]: {session['id']} -> {dest.relative_to(REPO_ROOT)}")
        await asyncio.to_thread(
            write_qwen_speech_mp3,
            voice=qwen_tts_voice(),
            input_text=session["ttsScript"],
            dest=dest,
            instructions=qwen_default_instructions(),
        )
        return

    raise ValueError(f"Unsupported provider for --generate-audio: {provider}")


async def generate_voice_preview(session: dict[str, Any], *, provider: str, selected_voices: list[str]) -> None:
    preview_dir = AUDIO_OUT_DIR / "voice_previews" / session["id"]
    preview_dir.mkdir(parents=True, exist_ok=True)

    preview_voices = resolve_preview_voices(provider, selected_voices)
    if provider == "openai" and not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    if provider == "qwen" and not os.getenv("DASHSCOPE_API_KEY"):
        raise RuntimeError("DASHSCOPE_API_KEY is not set")

    def _write_openai_voice(voice: str, dest: Path) -> None:
        from openai import OpenAI

        client = OpenAI()
        write_speech_mp3(client, voice=voice, input_text=session["ttsScript"], dest=dest)

    for voice in preview_voices:
        if provider == "qwen":
            dest = preview_dir / f"{session['id']}-qwen-{voice_filename_fragment(voice)}.mp3"
        else:
            dest = preview_dir / f"{session['id']}-{voice}.mp3"
        if dest.exists():
            print(f"overwrite preview: {voice} -> {dest.relative_to(REPO_ROOT)}")
        else:
            print(f"generate preview: {voice} -> {dest.relative_to(REPO_ROOT)}")
        if provider == "qwen":
            await asyncio.to_thread(
                write_qwen_speech_mp3,
                voice=voice,
                input_text=session["ttsScript"],
                dest=dest,
                instructions=qwen_default_instructions(),
            )
        else:
            await asyncio.to_thread(_write_openai_voice, voice, dest)

    print(f"voice previews: {preview_dir.relative_to(REPO_ROOT)}")


async def generate_word_audio(
    sessions: list[dict[str, Any]],
    force: bool,
    provider: str,
    only_word_ids: set[str] | None = None,
) -> None:
    WORD_AUDIO_OUT_DIR.mkdir(parents=True, exist_ok=True)
    if provider == "openai":
        from openai import OpenAI

        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set")
        openai_client = OpenAI()
    elif provider == "qwen":
        if not os.getenv("DASHSCOPE_API_KEY"):
            raise RuntimeError("DASHSCOPE_API_KEY is not set")
        if not os.getenv("OPENAI_API_KEY"):
            print("warning: OPENAI_API_KEY not set; word quality ASR checks disabled for this run")
        openai_client = None
    else:
        raise ValueError(f"Unsupported provider for --generate-word-audio: {provider}")

    max_retries_raw = os.getenv("QWEN_WORD_ASR_MAX_RETRIES", str(QWEN_TTS_MAX_WORD_RETRIES))
    try:
        max_retries = max(0, int(max_retries_raw))
    except ValueError:
        max_retries = QWEN_TTS_MAX_WORD_RETRIES
    quality_enabled = env_bool("QWEN_WORD_ASR_QUALITY_CHECK", True) and bool(os.getenv("OPENAI_API_KEY"))
    quality_report: list[dict[str, Any]] = []

    async def _generate_word(session: dict[str, Any], word: dict[str, Any]) -> bool:
        dest = WORD_AUDIO_OUT_DIR / f"{word['id']}.mp3"
        if dest.exists() and not force:
            print(f"skip word audio (exists): {dest.name}")
            return False

        action = "overwrite" if dest.exists() else "generate"
        print(f"{action} word audio [{provider}]: {word['hanzi']} -> {dest.relative_to(REPO_ROOT)}")
        if provider == "openai":
            await asyncio.to_thread(
                write_speech_mp3,
                openai_client,
                voice=os.getenv("OPENAI_SCRIPT_TTS_VOICE", TTS_VOICE),
                input_text=word["hanzi"],
                dest=dest,
                instructions=word_tts_instructions(word, session),
            )
        else:
            instructions = word_tts_instructions(word, session)
            attempts = max_retries + 1
            if not quality_enabled:
                attempts = 1
            last_transcript = ""
            verified = True
            for attempt in range(1, attempts + 1):
                await asyncio.to_thread(
                    write_qwen_speech_mp3,
                    voice=qwen_tts_voice(),
                    input_text=word["hanzi"],
                    dest=dest,
                    instructions=instructions,
                )
                if not quality_enabled:
                    break
                verified, transcript = await asyncio.to_thread(verify_word_audio, word, dest)
                last_transcript = transcript
                if verified:
                    if attempt > 1:
                        print(f"  recovered after retry {attempt - 1}: {word['id']}")
                    break
                if attempt < attempts:
                    print(
                        f"  quality retry {attempt}/{max_retries}: "
                        f"expected={word['hanzi']} got={transcript or '(empty)'}"
                    )
            if quality_enabled and not verified:
                quality_report.append(
                    {
                        "wordId": word["id"],
                        "hanzi": word["hanzi"],
                        "sessionId": session["id"],
                        "attempts": attempts,
                        "finalTranscript": last_transcript,
                        "audioPath": str(dest.relative_to(REPO_ROOT)),
                    }
                )
                print(
                    f"  warning: pronunciation check failed after {attempts} attempts for "
                    f"{word['id']} (got: {last_transcript or '(empty)'})"
                )
        return True

    generated = 0
    matched = 0
    for session in sessions:
        for word in session["words"]:
            if only_word_ids is not None and word["id"] not in only_word_ids:
                continue
            matched += 1
            if await _generate_word(session, word):
                generated += 1

    total = sum(len(session["words"]) for session in sessions)
    if only_word_ids is not None:
        missing = sorted(only_word_ids - {word["id"] for session in sessions for word in session["words"]})
        if missing:
            print(f"warning: unknown word ids: {', '.join(missing)}")
        print(
            f"word audio output: {WORD_AUDIO_OUT_DIR.relative_to(REPO_ROOT)} "
            f"({generated} generated, {matched} matched, {total} total)"
        )
    else:
        print(f"word audio output: {WORD_AUDIO_OUT_DIR.relative_to(REPO_ROOT)} ({generated} generated, {total} total)")
    if provider == "qwen":
        report_payload = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": qwen_tts_model(),
            "voice": qwen_tts_voice(),
            "qualityCheckEnabled": quality_enabled,
            "maxRetries": max_retries,
            "failedCount": len(quality_report),
            "items": quality_report,
        }
        report_name = QWEN_TTS_QUALITY_REPORT if only_word_ids is None else "word_quality_report.partial.json"
        report_payload["scope"] = "all_words" if only_word_ids is None else "subset_words"
        report_path = WORD_AUDIO_OUT_DIR / report_name
        report_path.write_text(compact_json(report_payload), encoding="utf-8")
        print(f"word quality report: {report_path.relative_to(REPO_ROOT)}")


async def transcribe_session_audio(session: dict[str, Any]) -> dict[str, Any]:
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    audio_path = AUDIO_OUT_DIR / f"{session['id']}.mp3"
    if not audio_path.exists():
        raise FileNotFoundError(f"Missing session audio: {audio_path.relative_to(REPO_ROOT)}")

    def _transcribe() -> dict[str, Any]:
        client = OpenAI()
        with audio_path.open("rb") as audio_file:
            response = client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-1",
                language="zh",
                prompt=session["ttsScript"],
                response_format="verbose_json",
                extra_body={"timestamp_granularities": ["word"]},
            )
        return response_to_dict(response)

    return await asyncio.to_thread(_transcribe)


async def generate_karaoke_timings(sessions: list[dict[str, Any]], only_session_ids: set[str] | None = None) -> None:
    TIMINGS_OUT_DIR.mkdir(parents=True, exist_ok=True)

    aligned = 0
    attempted = 0
    for session in sessions:
        if only_session_ids is not None and session["id"] not in only_session_ids:
            continue

        attempted += 1
        print(f"align karaoke timings: {session['id']}")
        transcription_data = await transcribe_session_audio(session)
        result = apply_karaoke_timings(session, transcription_data)
        debug_payload = {
            "sessionId": session["id"],
            "audioUrl": session["audioUrl"],
            "alignment": result,
            "transcription": transcription_data,
        }
        debug_path = TIMINGS_OUT_DIR / f"{session['id']}.json"
        debug_path.write_text(compact_json(debug_payload), encoding="utf-8")

        if result["status"] == "aligned":
            aligned += 1
            print(
                f"  aligned coverage={result['coverage']} "
                f"words={result['timedWordCount']} -> {debug_path.relative_to(REPO_ROOT)}"
            )
        else:
            print(
                f"  warning: fallback to estimated timing for {session['id']} "
                f"({result['reason']}, coverage={result['coverage']})"
            )

    if only_session_ids is not None:
        missing = sorted(only_session_ids - {session["id"] for session in sessions})
        if missing:
            print(f"warning: unknown timing session ids: {', '.join(missing)}")
    print(f"karaoke timings: {aligned}/{attempted} sessions aligned")


def apply_existing_karaoke_timings(sessions: list[dict[str, Any]]) -> int:
    if not TIMINGS_OUT_DIR.exists():
        return 0

    applied = 0
    for session in sessions:
        debug_path = TIMINGS_OUT_DIR / f"{session['id']}.json"
        if not debug_path.exists():
            continue
        try:
            debug_payload = json.loads(debug_path.read_text(encoding="utf-8"))
            transcription_data = debug_payload["transcription"]
        except (json.JSONDecodeError, KeyError) as exc:
            print(f"warning: cannot read timing debug for {session['id']}: {exc}")
            continue

        result = apply_karaoke_timings(session, transcription_data)
        if result["status"] == "aligned":
            applied += 1
        else:
            print(
                f"warning: existing timing debug no longer aligns for {session['id']} "
                f"({result['reason']}, coverage={result['coverage']})"
            )

    return applied


async def main_async() -> int:
    parser = argparse.ArgumentParser(description="Generate script-based game sessions and optional TTS clips")
    parser.add_argument("--input", type=Path, default=INPUT_JSON)
    parser.add_argument("--output", type=Path, default=GENERATED_TS)
    parser.add_argument("--generate-audio", action="store_true", help="Generate TTS MP3 files")
    parser.add_argument(
        "--audio-session",
        action="append",
        default=[],
        help="Limit --generate-audio to a session id. Can be passed multiple times.",
    )
    parser.add_argument("--generate-word-audio", action="store_true", help="Generate TTS MP3 files for every game word")
    parser.add_argument(
        "--word-id",
        action="append",
        default=[],
        help="Limit --generate-word-audio to a generated word id. Can be passed multiple times.",
    )
    parser.add_argument("--force-audio", action="store_true", help="Overwrite existing generated MP3 files")
    parser.add_argument(
        "--preview-voices",
        action="store_true",
        help="Generate one sample MP3 per voice for a single session",
    )
    parser.add_argument(
        "--tts-provider",
        choices=("openai", "qwen"),
        default="openai",
        help="Provider for preview and bulk audio generation (default: openai)",
    )
    parser.add_argument(
        "--preview-session",
        default="wm-01",
        help="Session id to use with --preview-voices",
    )
    parser.add_argument(
        "--preview-voice",
        action="append",
        default=[],
        help="Limit --preview-voices to specific voice names. Can be passed multiple times.",
    )
    parser.add_argument(
        "--serena-experiment",
        action="store_true",
        help="Run Serena-only Qwen experiment profiles for the selected preview session.",
    )
    parser.add_argument(
        "--serena-profile",
        action="append",
        default=[],
        help="Limit --serena-experiment to profile ids (repeatable).",
    )
    parser.add_argument(
        "--generate-karaoke-timings",
        action="store_true",
        help="Generate token-level karaoke timings from existing session MP3 files",
    )
    parser.add_argument(
        "--timing-session",
        action="append",
        default=[],
        help="Limit --generate-karaoke-timings to a session id. Can be passed multiple times.",
    )
    parser.add_argument(
        "--report-word-pinyin",
        action="store_true",
        help="Print word mapping report: hanzi, explicit/computed/final pinyinRaw, and generated word id.",
    )
    parser.add_argument(
        "--report-session",
        action="append",
        default=[],
        help="Limit --report-word-pinyin to a session id. Can be passed multiple times.",
    )
    args = parser.parse_args()

    if args.serena_experiment:
        if not args.preview_voices:
            raise ValueError("--serena-experiment requires --preview-voices")
        if args.tts_provider != "qwen":
            raise ValueError("--serena-experiment requires --tts-provider qwen")
    source = json.loads(args.input.read_text(encoding="utf-8"))
    sessions = build_sessions(source)
    report_only_run = (
        args.report_word_pinyin
        and not args.preview_voices
        and not args.generate_audio
        and not args.generate_word_audio
        and not args.generate_karaoke_timings
    )
    preview_only_run = (
        args.preview_voices
        and not args.generate_audio
        and not args.generate_word_audio
        and not args.generate_karaoke_timings
        and not args.report_word_pinyin
        and args.input == INPUT_JSON
        and args.output == GENERATED_TS
    )
    if not preview_only_run and not report_only_run:
        existing_timing_count = apply_existing_karaoke_timings(sessions)
        if existing_timing_count:
            print(f"applied existing karaoke timings: {existing_timing_count} sessions")

    word_count = sum(len(session["words"]) for session in sessions)

    if args.serena_experiment:
        if args.preview_voice:
            print("info: --serena-experiment ignores --preview-voice and uses Serena only")

    if args.preview_voices:
        preview_session = find_session(sessions, args.preview_session)
        if args.serena_experiment:
            await generate_serena_experiment(
                preview_session,
                selected_profile_ids=args.serena_profile,
            )
        else:
            await generate_voice_preview(
                preview_session,
                provider=args.tts_provider,
                selected_voices=args.preview_voice,
            )

    if args.report_word_pinyin:
        report_word_pinyin_mapping(source, only_session_ids=set(args.report_session) or None)

    if args.generate_audio:
        audio_session_filter = set(args.audio_session)
        audio_sessions = [
            session for session in sessions if not audio_session_filter or session["id"] in audio_session_filter
        ]
        for session in audio_sessions:
            await generate_session_audio(session, force=args.force_audio, provider=args.tts_provider)
        if audio_session_filter:
            missing = sorted(audio_session_filter - {session["id"] for session in sessions})
            if missing:
                print(f"warning: unknown audio session ids: {', '.join(missing)}")
        print(f"audio output: {AUDIO_OUT_DIR.relative_to(REPO_ROOT)}")

    if args.generate_word_audio:
        await generate_word_audio(
            sessions,
            force=args.force_audio,
            provider=args.tts_provider,
            only_word_ids=set(args.word_id) or None,
        )

    if args.generate_karaoke_timings:
        await generate_karaoke_timings(sessions, only_session_ids=set(args.timing_session) or None)

    if preview_only_run or report_only_run:
        print("preview-only run: skipped rewriting frontend/src/data/scriptSessions.generated.ts")
    else:
        write_generated_ts(sessions, args.output)
        print(f"generated {len(sessions)} sessions -> {args.output.relative_to(REPO_ROOT)}")
        print(f"generated {word_count} game words")

    if (
        not args.preview_voices
        and not args.generate_audio
        and not args.generate_word_audio
        and not args.generate_karaoke_timings
        and not args.report_word_pinyin
    ):
        print("audio generation skipped; rerun with --generate-audio when OPENAI_API_KEY is available")

    return 0


def main() -> None:
    raise SystemExit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
