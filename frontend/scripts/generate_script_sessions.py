#!/usr/bin/env python3
"""Generate ordered game session data and optional TTS clips from script JSON.

Run from repo root:
  python frontend/scripts/generate_script_sessions.py
  python frontend/scripts/generate_script_sessions.py --generate-audio
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from pypinyin import Style, lazy_pinyin

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPO_ROOT / "frontend"
BACKEND_ROOT = REPO_ROOT / "backend"
INPUT_JSON = FRONTEND_ROOT / "public" / "audio" / "script_content" / "whack_a_mole_textbook_sessions.json"
GENERATED_TS = FRONTEND_ROOT / "src" / "data" / "scriptSessions.generated.ts"
AUDIO_OUT_DIR = FRONTEND_ROOT / "public" / "audio" / "script_content" / "generated"
AUDIO_PUBLIC_DIR = "/audio/script_content/generated"
WORD_AUDIO_OUT_DIR = AUDIO_OUT_DIR / "words"
WORD_AUDIO_PUBLIC_DIR = f"{AUDIO_PUBLIC_DIR}/words"
TIMINGS_OUT_DIR = AUDIO_OUT_DIR / "timings"

TTS_MODEL = "gpt-4o-mini-tts"
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


def build_word(session_id: str, session_index: int, word_index: int, hanzi: str) -> dict[str, Any]:
    pinyin_raw = numbered_pinyin(hanzi)
    difficulty = difficulty_for_session(session_index)
    compact_pinyin = safe_slug(pinyin_raw.replace(" ", ""))
    word_id = f"{session_id}-{word_index + 1:02d}-{compact_pinyin}"
    return {
        "id": word_id,
        "hanzi": hanzi,
        "pinyin": display_pinyin(hanzi),
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
        game_words = [
          build_word(session_id, session_index, word_index, word)
          for word_index, word in enumerate(raw_session.get("game_words", []))
          if word.strip()
        ]
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


async def generate_openai_audio(session: dict[str, Any], force: bool) -> None:
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    AUDIO_OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = AUDIO_OUT_DIR / f"{session['id']}.mp3"
    if dest.exists() and not force:
        print(f"skip audio (exists): {dest.name}")
        return

    def _write() -> None:
        client = OpenAI()
        write_speech_mp3(
            client,
            voice=os.getenv("OPENAI_SCRIPT_TTS_VOICE", TTS_VOICE),
            input_text=session["ttsScript"],
            dest=dest,
        )

    print(f"generate audio: {session['id']} -> {dest.relative_to(REPO_ROOT)}")
    await asyncio.to_thread(_write)


async def generate_voice_preview(session: dict[str, Any]) -> None:
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    preview_dir = AUDIO_OUT_DIR / "voice_previews" / session["id"]
    preview_dir.mkdir(parents=True, exist_ok=True)

    def _write_voice(voice: str, dest: Path) -> None:
        client = OpenAI()
        write_speech_mp3(client, voice=voice, input_text=session["ttsScript"], dest=dest)

    for voice in TTS_VOICES:
        dest = preview_dir / f"{session['id']}-{voice}.mp3"
        if dest.exists():
            print(f"overwrite preview: {voice} -> {dest.relative_to(REPO_ROOT)}")
        else:
            print(f"generate preview: {voice} -> {dest.relative_to(REPO_ROOT)}")
        await asyncio.to_thread(_write_voice, voice, dest)

    print(f"voice previews: {preview_dir.relative_to(REPO_ROOT)}")


async def generate_word_audio(sessions: list[dict[str, Any]], force: bool, only_word_ids: set[str] | None = None) -> None:
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    WORD_AUDIO_OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = OpenAI()

    async def _generate_word(session: dict[str, Any], word: dict[str, Any]) -> bool:
        dest = WORD_AUDIO_OUT_DIR / f"{word['id']}.mp3"
        if dest.exists() and not force:
            print(f"skip word audio (exists): {dest.name}")
            return False

        action = "overwrite" if dest.exists() else "generate"
        print(f"{action} word audio: {word['hanzi']} -> {dest.relative_to(REPO_ROOT)}")
        await asyncio.to_thread(
            write_speech_mp3,
            client,
            voice=os.getenv("OPENAI_SCRIPT_TTS_VOICE", TTS_VOICE),
            input_text=word["hanzi"],
            dest=dest,
            instructions=word_tts_instructions(word, session),
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
    parser.add_argument("--generate-audio", action="store_true", help="Generate OpenAI TTS MP3 files")
    parser.add_argument("--generate-word-audio", action="store_true", help="Generate OpenAI TTS MP3 files for every game word")
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
        help="Generate one sample MP3 per OpenAI voice for a single session",
    )
    parser.add_argument(
        "--preview-session",
        default="wm-01",
        help="Session id to use with --preview-voices",
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
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    sessions = build_sessions(source)
    existing_timing_count = apply_existing_karaoke_timings(sessions)
    if existing_timing_count:
        print(f"applied existing karaoke timings: {existing_timing_count} sessions")

    word_count = sum(len(session["words"]) for session in sessions)

    if args.preview_voices:
        preview_session = find_session(sessions, args.preview_session)
        await generate_voice_preview(preview_session)

    if args.generate_audio:
        for session in sessions:
            await generate_openai_audio(session, force=args.force_audio)
        print(f"audio output: {AUDIO_OUT_DIR.relative_to(REPO_ROOT)}")

    if args.generate_word_audio:
        await generate_word_audio(sessions, force=args.force_audio, only_word_ids=set(args.word_id) or None)

    if args.generate_karaoke_timings:
        await generate_karaoke_timings(sessions, only_session_ids=set(args.timing_session) or None)

    write_generated_ts(sessions, args.output)
    print(f"generated {len(sessions)} sessions -> {args.output.relative_to(REPO_ROOT)}")
    print(f"generated {word_count} game words")

    if not args.preview_voices and not args.generate_audio and not args.generate_word_audio and not args.generate_karaoke_timings:
        print("audio generation skipped; rerun with --generate-audio when OPENAI_API_KEY is available")

    return 0


def main() -> None:
    raise SystemExit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
