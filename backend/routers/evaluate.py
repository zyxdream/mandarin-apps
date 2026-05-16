import asyncio
import os
import re
import subprocess
import tempfile
import time
import uuid
from difflib import SequenceMatcher
from pathlib import Path
from statistics import mean

import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel
from pypinyin import Style, lazy_pinyin

from local_asr import LocalAsrUnavailable, local_asr
from local_vad import LocalVadUnavailable, VadResult, local_vad

try:
    from opencc import OpenCC  # type: ignore[import-not-found]
except Exception:
    OpenCC = None  # type: ignore[assignment]

router = APIRouter(prefix="/evaluate", tags=["evaluate"])

_client: AsyncOpenAI | None = None
_simplifier = OpenCC("t2s") if OpenCC else None
_COMMON_TRADITIONAL_TO_SIMPLIFIED = str.maketrans({
    "車": "车",
    "飛": "飞",
    "機": "机",
    "蘋": "苹",
    "貓": "猫",
    "馬": "马",
    "鳥": "鸟",
    "魚": "鱼",
    "門": "门",
    "書": "书",
    "師": "师",
    "學": "学",
    "習": "习",
    "聲": "声",
    "話": "话",
})


def get_transcribe_model() -> str:
    return os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")


def is_fake_evaluation_enabled() -> bool:
    return os.getenv("DEV_FAKE_EVALUATION", "false").lower() == "true"


def get_openai_client() -> AsyncOpenAI | None:
    global _client
    if not os.getenv("OPENAI_API_KEY"):
        return None
    if _client is None:
        _client = AsyncOpenAI()
    return _client


class EvaluateResponse(BaseModel):
    success: bool
    confidence: float
    word_id: str
    transcript: str = ""
    transcript_pinyin: str = ""
    scores: dict[str, float | None] = {}
    diagnostics: list[dict[str, str | int | bool]] = []
    hint_code: str | None = None
    hint_text: str | None = None


class LocalAsrStatusResponse(BaseModel):
    available: bool
    model_dir: str
    model_exists: bool
    tokens_exists: bool
    error: str | None = None


class LocalAsrWarmupResponse(BaseModel):
    ready: bool
    already_loaded: bool
    elapsed_ms: int
    model_dir: str


class PinyinSyllable(BaseModel):
    raw: str
    base: str
    initial: str
    final: str
    tone: int


INITIALS = (
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
    "y",
    "w",
)

HINTS: dict[str, str] = {
    "tone_flat": "Laser flat",
    "tone_rise": "Rocket up",
    "tone_dip": "Trampoline dip",
    "tone_drop": "Knife drop",
    "tone_light": "Light and quick",
    "initial_curl": "Curl tongue",
    "initial_forward": "Tongue forward",
    "initial_smile": "Smile sound",
    "initial_air": "More air pop",
    "initial_lip": "Lip sound",
    "final_nose_ng": "Nose ending",
    "final_n": "Soft N end",
    "final_round_lips": "Round lips",
    "final_open": "Open mouth",
    "final_round_mouth": "Round mouth",
    "missing_beat": "Say every beat",
    "extra_beat": "Keep it short",
    "nice_try_again": "Nice try — again!",
    "too_quiet": "🔊 Speak a little louder",
    "try_again_clearer": "🎤 Try again clearer",
}


_HINT_PREFIX: dict[str, str] = {
    "tone_flat": "Tone 1: ",
    "tone_rise": "Tone 2: ",
    "tone_dip": "Tone 3: ",
    "tone_drop": "Tone 4: ",
    "tone_light": "Tone 5: ",
    "initial_curl": "zh/ch/sh/r: ",
    "initial_forward": "z/c/s: ",
    "initial_smile": "j/q/x: ",
    "initial_air": "p/t/k: ",
    "initial_lip": "b/m/f: ",
    "final_nose_ng": "Ending: ",
    "final_n": "Ending: ",
    "final_round_lips": "Ending: ",
    "final_open": "Ending: ",
    "final_round_mouth": "Ending: ",
    "missing_beat": "Beats: ",
    "extra_beat": "Beats: ",
    "nice_try_again": "Tip: ",
    "too_quiet": "Tip: ",
    "try_again_clearer": "Mic: ",
}


def hint_display_text(code: str, body: str) -> str:
    """Player-facing line: where the mistake is + existing punchy body from HINTS."""
    prefix = _HINT_PREFIX.get(code, "Tip: ")
    return f"{prefix}{body}"


def hint_text_for_code(code: str) -> str:
    return hint_display_text(code, HINTS[code])

ISSUE_SEVERITY = {
    "tone_mismatch": 1,
    "final_mismatch": 2,
    "initial_mismatch": 3,
    "extra_syllable": 4,
    "missing_syllable": 4,
}

GENERIC_HINT_CODE = "nice_try_again"

MIN_REALTIME_AUDIO_BYTES = int(os.getenv("MIN_REALTIME_AUDIO_BYTES", "9000"))
MIN_REALTIME_AUDIO_RMS = float(os.getenv("MIN_REALTIME_AUDIO_RMS", "0.006"))
MIN_REALTIME_AUDIO_PEAK = float(os.getenv("MIN_REALTIME_AUDIO_PEAK", "0.045"))
MIN_REALTIME_ACTIVE_RATIO = float(os.getenv("MIN_REALTIME_ACTIVE_RATIO", "0.025"))
MIN_REALTIME_ACTIVE_MS = int(os.getenv("MIN_REALTIME_ACTIVE_MS", "120"))

REALTIME_THRESHOLDS = {
    "lexical_exact": 0.98,
    "lexical_floor": 0.72,
    "syllable_floor": 0.82,
    "tone_floor": 0.65,
    "confidence_floor": 0.78,
}

PRACTICE_THRESHOLDS = {
    "lexical_exact": 0.98,
    "lexical_floor": 0.68,
    "syllable_floor": 0.76,
    "tone_floor": 0.60,
    "confidence_floor": 0.72,
}

LOCAL_ASR_DENOISE_RETRY_ENABLED = os.getenv("LOCAL_ASR_DENOISE_RETRY", "true").lower() == "true"


def analyze_audio_activity(waveform: np.ndarray, sample_rate: int) -> dict[str, float | int]:
    if waveform.size == 0 or sample_rate <= 0:
        return {
            "duration_ms": 0,
            "rms": 0.0,
            "peak": 0.0,
            "active_ratio": 0.0,
            "active_ms": 0,
        }

    absolute = np.abs(waveform)
    rms = float(np.sqrt(np.mean(np.square(waveform))))
    peak = float(np.max(absolute))
    frame_size = max(1, int(sample_rate * 0.02))
    frame_count = max(1, waveform.size // frame_size)
    trimmed = waveform[:frame_count * frame_size]
    frames = trimmed.reshape(frame_count, frame_size)
    frame_rms = np.sqrt(np.mean(np.square(frames), axis=1))
    active_threshold = max(MIN_REALTIME_AUDIO_RMS * 1.2, rms * 1.35)
    active_frames = int(np.sum(frame_rms >= active_threshold))
    active_ratio = active_frames / frame_count
    duration_ms = int((waveform.size / sample_rate) * 1000)
    active_ms = int(active_frames * 20)

    return {
        "duration_ms": duration_ms,
        "rms": round(rms, 5),
        "peak": round(peak, 5),
        "active_ratio": round(active_ratio, 4),
        "active_ms": active_ms,
    }


def is_realtime_audio_too_weak(activity: dict[str, float | int]) -> bool:
    return (
        float(activity["rms"]) < MIN_REALTIME_AUDIO_RMS or
        float(activity["peak"]) < MIN_REALTIME_AUDIO_PEAK or
        float(activity["active_ratio"]) < MIN_REALTIME_ACTIVE_RATIO or
        int(activity["active_ms"]) < MIN_REALTIME_ACTIVE_MS
    )


def should_reject_realtime_audio(
    activity: dict[str, float | int],
    vad_result: VadResult | None,
) -> bool:
    weak_by_level = is_realtime_audio_too_weak(activity)
    if not weak_by_level:
        return False
    if vad_result is None:
        return True
    return not vad_result.detected


def debug_log(request_id: str, stage: str, payload: dict, started_at: float | None = None) -> None:
    event: dict[str, object] = {"request_id": request_id, "stage": stage, **payload}
    if started_at is not None:
        event["elapsed_ms"] = int((time.perf_counter() - started_at) * 1000)
    print("[evaluate][debug]", event, flush=True)


def should_run_acoustic(eval_mode: str, request_id: str) -> bool:
    if eval_mode == "practice":
        return True
    if eval_mode != "realtime":
        return False
    return False


def get_thresholds(eval_mode: str) -> dict[str, float]:
    if eval_mode == "practice":
        return PRACTICE_THRESHOLDS
    return REALTIME_THRESHOLDS


@router.get("/local/status", response_model=LocalAsrStatusResponse)
async def local_asr_status() -> LocalAsrStatusResponse:
    model_dir = local_asr.model_dir
    model_path = model_dir / "model.int8.onnx"
    tokens_path = model_dir / "tokens.txt"
    model_exists = model_path.exists()
    tokens_exists = tokens_path.exists()
    error = None
    try:
        import sherpa_onnx  # type: ignore[import-not-found]  # noqa: F401
    except Exception:
        error = "sherpa-onnx is not installed"

    return LocalAsrStatusResponse(
        available=error is None and model_exists and tokens_exists,
        model_dir=str(model_dir),
        model_exists=model_exists,
        tokens_exists=tokens_exists,
        error=error,
    )


@router.get("/local/warmup", response_model=LocalAsrWarmupResponse)
async def local_asr_warmup() -> LocalAsrWarmupResponse:
    started_at = time.perf_counter()
    print("[warmup][asr] start", {"model_dir": str(local_asr.model_dir)}, flush=True)
    try:
        warmup = await asyncio.to_thread(local_asr.ensure_ready)
    except LocalAsrUnavailable as exc:
        print(
            "[warmup][asr] failed",
            {"error": str(exc), "elapsed_ms": int((time.perf_counter() - started_at) * 1000)},
            flush=True,
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(
            "[warmup][asr] failed",
            {"error": str(exc), "elapsed_ms": int((time.perf_counter() - started_at) * 1000)},
            flush=True,
        )
        raise HTTPException(status_code=502, detail="Local ASR warmup failed") from exc

    print("[warmup][asr] complete", warmup, flush=True)
    return LocalAsrWarmupResponse(
        ready=bool(warmup["ready"]),
        already_loaded=bool(warmup["already_loaded"]),
        elapsed_ms=int(warmup["elapsed_ms"]),
        model_dir=str(warmup["model_dir"]),
    )


def normalize_hanzi(text: str) -> str:
    hanzi = "".join(re.findall(r"[\u4e00-\u9fff]+", text))
    if _simplifier:
        return _simplifier.convert(hanzi)
    return hanzi.translate(_COMMON_TRADITIONAL_TO_SIMPLIFIED)


def has_hanzi(text: str) -> bool:
    return bool(normalize_hanzi(text))


def normalize_pinyin(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower().replace("ü", "v"))


def split_numbered_pinyin(text: str) -> list[str]:
    return re.findall(r"[a-züv]+[1-5]?", text.lower().replace("ü", "v"))


def parse_pinyin_syllable(raw: str) -> PinyinSyllable:
    normalized = normalize_pinyin(raw)
    tone_match = re.search(r"([1-5])$", normalized)
    tone = int(tone_match.group(1)) if tone_match else 5
    base = re.sub(r"[1-5]$", "", normalized)
    initial = ""
    for candidate in INITIALS:
        if base.startswith(candidate):
            initial = candidate
            break
    final = base[len(initial):]
    return PinyinSyllable(raw=raw, base=base, initial=initial, final=final, tone=tone)


def looks_like_pinyin_text(text: str, expected_syllable_count: int) -> bool:
    syllables = split_numbered_pinyin(text)
    if len(syllables) < expected_syllable_count:
        return False

    parsed = [parse_pinyin_syllable(s) for s in syllables[:expected_syllable_count]]
    return all(s.base and s.final for s in parsed)


def is_transcript_usable(text: str, expected_pinyin_raw: str) -> bool:
    if has_hanzi(text):
        return True
    expected_syllable_count = len(split_numbered_pinyin(expected_pinyin_raw))
    return looks_like_pinyin_text(text, expected_syllable_count)


def pinyin_syllables_from_text(text: str) -> list[str]:
    hanzi = normalize_hanzi(text)
    if not hanzi:
        return split_numbered_pinyin(text)
    return lazy_pinyin(hanzi, style=Style.TONE3, neutral_tone_with_five=True)


def transcript_to_pinyin(text: str) -> str:
    return normalize_pinyin(" ".join(pinyin_syllables_from_text(text)))


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def final_family(final: str) -> str:
    if final.endswith("ng"):
        return "ng"
    if final.endswith("n"):
        return "n"
    if final in {"u", "uo", "ou", "ong", "iong", "v", "ve", "ue"}:
        return "rounded"
    if final in {"a", "ai", "an", "ang", "ao"}:
        return "open"
    return final


def syllable_similarity(expected: PinyinSyllable, actual: PinyinSyllable | None) -> tuple[float, dict[str, str | int | bool]]:
    if actual is None:
        return 0.0, {
            "expected": expected.raw,
            "actual": "",
            "initial_match": False,
            "final_match": False,
            "tone_match": False,
            "issue": "missing_syllable",
        }

    initial_match = expected.initial == actual.initial
    final_match = expected.final == actual.final
    tone_match = expected.tone == actual.tone
    score = (0.35 if initial_match else 0.0) + (0.45 if final_match else 0.0) + (0.20 if tone_match else 0.0)

    issue = ""
    if not initial_match:
        issue = "initial_mismatch"
    elif not final_match:
        issue = "final_mismatch"
    elif not tone_match:
        issue = "tone_mismatch"

    return score, {
        "expected": expected.raw,
        "actual": actual.raw,
        "initial_match": initial_match,
        "final_match": final_match,
        "tone_match": tone_match,
        "issue": issue,
    }


def tone_hint_code(tone: int) -> str:
    return {
        1: "tone_flat",
        2: "tone_rise",
        3: "tone_dip",
        4: "tone_drop",
        5: "tone_light",
    }.get(tone, GENERIC_HINT_CODE)


def initial_hint_code(initial: str) -> str | None:
    if initial in {"zh", "ch", "sh", "r"}:
        return "initial_curl"
    if initial in {"z", "c", "s"}:
        return "initial_forward"
    if initial in {"j", "q", "x"}:
        return "initial_smile"
    if initial in {"p", "t", "k"}:
        return "initial_air"
    if initial in {"b", "m", "f"}:
        return "initial_lip"
    return None


def final_hint_code(final: str) -> str | None:
    family = final_family(final)
    if family == "ng":
        return "final_nose_ng"
    if family == "n":
        return "final_n"
    if final in {"v", "ve", "ue"}:
        return "final_round_lips"
    if family == "open":
        return "final_open"
    if family == "rounded":
        return "final_round_mouth"
    return None


def is_detailed_hint_clear(
    issue: str,
    diagnostic: dict[str, str | int | bool],
    *,
    confidence: float,
    lexical_score: float,
    syllable_score: float,
    tone_score: float,
) -> bool:
    actual = str(diagnostic.get("actual", ""))
    if issue in {"missing_syllable", "extra_syllable"}:
        return True
    if not actual:
        return False

    initial_match = bool(diagnostic.get("initial_match", False))
    final_match = bool(diagnostic.get("final_match", False))
    tone_match = bool(diagnostic.get("tone_match", False))

    if issue == "tone_mismatch":
        return initial_match and final_match and tone_score <= 0.75
    if issue == "final_mismatch":
        return initial_match and syllable_score <= 0.82
    if issue == "initial_mismatch":
        return (
            confidence >= 0.18 or
            lexical_score >= 0.35 or
            final_match or
            tone_match
        )
    return False


def hint_for_issue(issue: str, expected: PinyinSyllable | None) -> str | None:
    if issue == "missing_syllable":
        return "missing_beat"
    if issue == "extra_syllable":
        return "extra_beat"
    if expected is None:
        return None
    if issue == "tone_mismatch":
        return tone_hint_code(expected.tone)
    if issue == "final_mismatch":
        return final_hint_code(expected.final)
    if issue == "initial_mismatch":
        return initial_hint_code(expected.initial)
    return None


def choose_hint(
    expected_syllables: list[PinyinSyllable],
    diagnostics: list[dict[str, str | int | bool]],
    acoustic_hint: str | None,
    *,
    success: bool,
    confidence: float,
    lexical_score: float,
    syllable_score: float,
    tone_score: float,
    transcript_syllable_count: int,
) -> tuple[str | None, str | None]:
    if success:
        return None, None

    if acoustic_hint and acoustic_hint in HINTS and tone_score <= 0.75:
        return acoustic_hint, hint_text_for_code(acoustic_hint)

    candidates: list[tuple[int, int, str, PinyinSyllable | None, dict[str, str | int | bool]]] = []
    for index, (expected, diagnostic) in enumerate(zip(expected_syllables, diagnostics)):
        issue = str(diagnostic.get("issue", ""))
        if not issue:
            continue
        candidates.append((ISSUE_SEVERITY.get(issue, 0), index, issue, expected, diagnostic))

    if transcript_syllable_count > len(expected_syllables):
        candidates.append((
            ISSUE_SEVERITY["extra_syllable"],
            len(expected_syllables),
            "extra_syllable",
            None,
            {
                "expected": "",
                "actual": "extra",
                "initial_match": False,
                "final_match": False,
                "tone_match": False,
                "issue": "extra_syllable",
            },
        ))

    if not candidates:
        return None, None

    candidates.sort(key=lambda item: (-item[0], item[1]))
    for _, _, issue, expected, diagnostic in candidates:
        if not is_detailed_hint_clear(
            issue,
            diagnostic,
            confidence=confidence,
            lexical_score=lexical_score,
            syllable_score=syllable_score,
            tone_score=tone_score,
        ):
            continue
        hint_code = hint_for_issue(issue, expected)
        if hint_code and hint_code in HINTS:
            return hint_code, hint_text_for_code(hint_code)

    return GENERIC_HINT_CODE, hint_text_for_code(GENERIC_HINT_CODE)


def expected_tone_shape(tone: int) -> str:
    if tone == 1:
        return "steady"
    if tone == 2:
        return "rising"
    if tone == 4:
        return "falling"
    if tone == 3:
        return "dipping"
    return "neutral"


def contour_shape(values: list[float]) -> str:
    if len(values) < 4:
        return "unknown"
    start = mean(values[: max(1, len(values) // 3)])
    middle = mean(values[len(values) // 3: max(len(values) // 3 + 1, (len(values) * 2) // 3)])
    end = mean(values[(len(values) * 2) // 3:])
    span = max(values) - min(values)
    if span < 8:
        return "steady"
    if end - start > 12:
        return "rising"
    if start - end > 12:
        return "falling"
    if middle < start - 6 and end > middle + 6:
        return "dipping"
    return "moving"


def score_tone_shape(expected_tone: int, actual_shape: str) -> float:
    expected_shape = expected_tone_shape(expected_tone)
    if actual_shape == "unknown" or expected_shape == "neutral":
        return 0.5
    if actual_shape == expected_shape:
        return 1.0
    if expected_shape == "dipping" and actual_shape in {"falling", "rising"}:
        return 0.55
    if expected_shape == "steady" and actual_shape == "moving":
        return 0.6
    return 0.25


def acoustic_hint_for_tone(expected_tone: int, actual_shape: str) -> str | None:
    if actual_shape == "unknown":
        return None
    if expected_tone == 1 and actual_shape != "steady":
        return "tone_flat"
    if expected_tone == 2 and actual_shape != "rising":
        return "tone_rise"
    if expected_tone == 3 and actual_shape != "dipping":
        return "tone_dip"
    if expected_tone == 4 and actual_shape != "falling":
        return "tone_drop"
    if expected_tone == 5 and actual_shape != "neutral":
        return "tone_light"
    return None


def analyze_tone_contour(audio_bytes: bytes, expected_pinyin_raw: str) -> tuple[dict[str, float | None], str | None]:
    expected_syllables = [parse_pinyin_syllable(s) for s in split_numbered_pinyin(expected_pinyin_raw)]
    if not expected_syllables:
        return {"tone_contour": None}, None

    try:
        import librosa  # type: ignore
        import numpy as np  # type: ignore
    except Exception as exc:
        print("[evaluate] acoustic unavailable", {"error": str(exc)}, flush=True)
        return {"tone_contour": None}, None

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = Path(tmpdir) / "input.webm"
        wav_path = Path(tmpdir) / "input.wav"
        input_path.write_bytes(audio_bytes)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(input_path), "-ac", "1", "-ar", "16000", str(wav_path)],
                check=True,
                capture_output=True,
            )
            y, sr = librosa.load(str(wav_path), sr=16000)
            pitches, voiced_flag, _ = librosa.pyin(y, fmin=80, fmax=450, sr=sr)
        except Exception as exc:
            print("[evaluate] acoustic failed", {"error": str(exc)}, flush=True)
            return {"tone_contour": None}, None

    voiced = [float(p) for p, keep in zip(pitches, voiced_flag) if keep and not np.isnan(p)]
    if len(voiced) < 6:
        print("[evaluate] acoustic too sparse", {"voiced_frames": len(voiced)}, flush=True)
        return {"tone_contour": None}, None

    chunks = np.array_split(voiced, len(expected_syllables))
    shape_scores: list[float] = []
    hint_code: str | None = None
    for expected, chunk in zip(expected_syllables, chunks):
        chunk_values = [float(value) for value in chunk]
        shape = contour_shape(chunk_values)
        shape_scores.append(score_tone_shape(expected.tone, shape))
        hint_code = hint_code or acoustic_hint_for_tone(expected.tone, shape)

    tone_contour = mean(shape_scores) if shape_scores else None
    print(
        "[evaluate] acoustic",
        {"tone_contour": round(tone_contour, 3) if tone_contour is not None else None, "hint_code": hint_code},
        flush=True,
    )
    return {"tone_contour": tone_contour}, hint_code


def score_transcript(
    transcript: str,
    expected_hanzi: str,
    expected_pinyin_raw: str,
    acoustic_scores: dict[str, float | None] | None = None,
    acoustic_hint: str | None = None,
    eval_mode: str = "realtime",
    request_id: str | None = None,
    started_at: float | None = None,
) -> tuple[bool, float, str, dict[str, float | None], list[dict[str, str | int | bool]], str | None, str | None]:
    normalized_transcript_hanzi = normalize_hanzi(transcript)
    normalized_expected_hanzi = normalize_hanzi(expected_hanzi)
    expected_pinyin_syllables_raw = split_numbered_pinyin(expected_pinyin_raw)
    transcript_pinyin_syllables_raw = pinyin_syllables_from_text(transcript)
    expected_syllables = [parse_pinyin_syllable(s) for s in expected_pinyin_syllables_raw]
    transcript_syllables = [parse_pinyin_syllable(s) for s in transcript_pinyin_syllables_raw]
    expected_pinyin = normalize_pinyin(" ".join(expected_pinyin_syllables_raw))
    transcript_pinyin = transcript_to_pinyin(transcript)

    hanzi_score = 0.0
    if normalized_expected_hanzi and normalized_transcript_hanzi:
        if normalized_expected_hanzi in normalized_transcript_hanzi:
            hanzi_score = 1.0
        else:
            hanzi_score = similarity(normalized_expected_hanzi, normalized_transcript_hanzi)

    syllable_scores: list[float] = []
    diagnostics: list[dict[str, str | int | bool]] = []
    for index, expected in enumerate(expected_syllables):
        syllable_score, diagnostic = syllable_similarity(
            expected,
            transcript_syllables[index] if index < len(transcript_syllables) else None,
        )
        syllable_scores.append(syllable_score)
        diagnostics.append(diagnostic)

    if request_id:
        debug_log(
            request_id,
            "pinyin_alignment",
            {
                "expected_syllables": [s.model_dump() for s in expected_syllables],
                "transcript_syllables": [s.model_dump() for s in transcript_syllables],
                "diagnostics": diagnostics,
            },
            started_at,
        )

    syllable_score = mean(syllable_scores) if syllable_scores else 0.0
    tone_text_score = mean(
        1.0 if d["tone_match"] else 0.0 for d in diagnostics
    ) if diagnostics else 0.0
    acoustic_tone_score = (acoustic_scores or {}).get("tone_contour")
    tone_score = mean(
        score for score in [tone_text_score, acoustic_tone_score] if score is not None
    )
    thresholds = get_thresholds(eval_mode)
    lexical_score = 1.0 if normalized_expected_hanzi and normalized_expected_hanzi == normalized_transcript_hanzi else hanzi_score
    confidence = (lexical_score * 0.40) + (syllable_score * 0.35) + (tone_score * 0.25)
    pinyin_perfect = (
        expected_pinyin == transcript_pinyin and
        len(transcript_syllables) == len(expected_syllables) and
        syllable_score >= 0.999 and
        tone_text_score >= 0.999
    )
    success = lexical_score >= thresholds["lexical_exact"] or pinyin_perfect or (
        lexical_score >= thresholds["lexical_floor"] and
        syllable_score >= thresholds["syllable_floor"] and
        tone_score >= thresholds["tone_floor"] and
        confidence >= thresholds["confidence_floor"]
    )
    scores: dict[str, float | None] = {
        "lexical": round(lexical_score, 3),
        "syllable": round(syllable_score, 3),
        "tone_text": round(tone_text_score, 3),
        "tone_contour": round(acoustic_tone_score, 3) if acoustic_tone_score is not None else None,
        "tone": round(tone_score, 3),
    }
    hint_code, hint_text = choose_hint(
        expected_syllables,
        diagnostics,
        acoustic_hint,
        success=success,
        confidence=confidence,
        lexical_score=lexical_score,
        syllable_score=syllable_score,
        tone_score=tone_score,
        transcript_syllable_count=len(transcript_syllables),
    )
    if request_id:
        debug_log(
            request_id,
            "weighted_scores",
            {
                "lexical_formula": round(lexical_score * 0.40, 3),
                "syllable_formula": round(syllable_score * 0.35, 3),
                "tone_formula": round(tone_score * 0.25, 3),
                "scores": scores,
                "confidence": round(confidence, 3),
                "success": success,
                "pinyin_perfect": pinyin_perfect,
                "hint_code": hint_code,
                "hint_text": hint_text,
                "eval_mode": eval_mode,
                "thresholds": thresholds,
            },
            started_at,
        )
    print(
        "[evaluate] score",
        {
            "normalized_transcript_hanzi": normalized_transcript_hanzi,
            "normalized_expected_hanzi": normalized_expected_hanzi,
            "expected_pinyin": expected_pinyin,
            "transcript_pinyin": transcript_pinyin,
            "scores": scores,
            "diagnostics": diagnostics,
            "confidence": round(confidence, 3),
            "success": success,
            "hint_code": hint_code,
        },
        flush=True,
    )
    return success, round(confidence, 3), transcript_pinyin, scores, diagnostics, hint_code, hint_text


@router.post("/local", response_model=EvaluateResponse)
async def evaluate_pronunciation_local(
    audio: UploadFile = File(..., description="webm/opus audio recording"),
    word_id: str = Form(...),
    pinyin_raw: str = Form(...),
    hanzi: str = Form(""),
    eval_mode: str = Form("realtime"),
) -> EvaluateResponse:
    """
    Prototype local evaluator:
    1. Convert uploaded browser audio to 16 kHz mono wav.
    2. Transcribe with local sherpa-onnx Paraformer.
    3. Reuse the same deterministic Hanzi/Pinyin scoring as the OpenAI route.
    """
    started_at = time.perf_counter()
    request_id = uuid.uuid4().hex[:8]
    timings: dict[str, float] = {"request_start": started_at}
    eval_mode = eval_mode.lower().strip()
    if eval_mode not in {"realtime", "practice"}:
        eval_mode = "realtime"

    audio_bytes = await audio.read()
    debug_log(
        request_id,
        "local_request_received",
        {
            "word_id": word_id,
            "hanzi": hanzi,
            "pinyin_raw": pinyin_raw,
            "eval_mode": eval_mode,
            "filename": audio.filename,
            "content_type": audio.content_type,
            "bytes": len(audio_bytes),
            "model_dir": str(local_asr.model_dir),
        },
        started_at,
    )

    if not audio_bytes:
        return EvaluateResponse(success=False, confidence=0.0, word_id=word_id)

    if eval_mode == "realtime" and len(audio_bytes) < MIN_REALTIME_AUDIO_BYTES:
        return EvaluateResponse(
            success=False,
            confidence=0.0,
            word_id=word_id,
            hint_code="too_quiet",
            hint_text=hint_text_for_code("too_quiet"),
        )

    try:
        timings["audio_decode_start"] = time.perf_counter()
        sample_rate, waveform = await asyncio.to_thread(
            local_asr.load_webm_waveform,
            audio_bytes,
            audio.filename or "speech.webm",
        )
        timings["audio_decode_end"] = time.perf_counter()
    except LocalAsrUnavailable as exc:
        debug_log(request_id, "local_asr_unavailable", {"error": str(exc)}, started_at)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        debug_log(request_id, "local_audio_decode_failed", {"error": str(exc)}, started_at)
        raise HTTPException(status_code=502, detail="Local audio conversion failed") from exc

    activity = analyze_audio_activity(waveform, sample_rate)
    debug_log(request_id, "local_audio_activity", activity, started_at)
    vad_result: VadResult | None = None
    if eval_mode == "realtime":
        try:
            timings["vad_start"] = time.perf_counter()
            vad_result = await asyncio.to_thread(local_vad.detect, sample_rate, waveform)
            timings["vad_end"] = time.perf_counter()
            debug_log(
                request_id,
                "local_vad_activity",
                {
                    "enabled": local_vad.enabled,
                    "model_path": str(local_vad.model_path),
                    "detected": vad_result.detected,
                    "speech_ms": vad_result.speech_ms,
                    "speech_ratio": vad_result.speech_ratio,
                    "segments": vad_result.segment_count,
                    "reason": vad_result.reason,
                },
                started_at,
            )
        except LocalVadUnavailable as exc:
            debug_log(
                request_id,
                "local_vad_unavailable",
                {
                    "enabled": local_vad.enabled,
                    "model_path": str(local_vad.model_path),
                    "error": str(exc),
                },
                started_at,
            )
        except Exception as exc:
            debug_log(
                request_id,
                "local_vad_failed",
                {"error": str(exc)},
                started_at,
            )

    if eval_mode == "realtime" and should_reject_realtime_audio(activity, vad_result):
        timings["response_end"] = time.perf_counter()
        debug_log(
            request_id,
            "local_audio_rejected_no_speech",
            {
                **activity,
                "min_rms": MIN_REALTIME_AUDIO_RMS,
                "min_peak": MIN_REALTIME_AUDIO_PEAK,
                "min_active_ratio": MIN_REALTIME_ACTIVE_RATIO,
                "min_active_ms": MIN_REALTIME_ACTIVE_MS,
                "vad_detected": vad_result.detected if vad_result else None,
                "vad_speech_ms": vad_result.speech_ms if vad_result else None,
                "vad_speech_ratio": vad_result.speech_ratio if vad_result else None,
            },
            started_at,
        )
        debug_log(
            request_id,
            "local_latency_summary",
            {
                "total_ms": int((timings["response_end"] - timings["request_start"]) * 1000),
                "audio_decode_ms": int((timings["audio_decode_end"] - timings["audio_decode_start"]) * 1000),
                "vad_ms": int((timings.get("vad_end", timings["response_end"]) - timings.get("vad_start", timings.get("audio_decode_end", timings["response_end"]))) * 1000),
                "asr_ms": 0,
                "asr_denoise_ms": 0,
                "scoring_ms": 0,
            },
            started_at,
        )
        return EvaluateResponse(
            success=False,
            confidence=0.0,
            word_id=word_id,
            hint_code="too_quiet",
            hint_text=hint_text_for_code("too_quiet"),
        )

    waveform_for_asr = waveform
    if eval_mode == "realtime" and vad_result and vad_result.detected and vad_result.cropped_waveform.size:
        waveform_for_asr = vad_result.cropped_waveform
    if eval_mode == "realtime":
        debug_log(
            request_id,
            "local_asr_input_selected",
            {
                "used_vad_crop": bool(vad_result and vad_result.detected and vad_result.cropped_waveform.size),
                "samples_original": int(waveform.size),
                "samples_for_asr": int(waveform_for_asr.size),
            },
            started_at,
        )

    try:
        timings["asr_start"] = time.perf_counter()
        transcript = await asyncio.to_thread(local_asr.transcribe_waveform, sample_rate, waveform_for_asr)
        timings["asr_end"] = time.perf_counter()
    except LocalAsrUnavailable as exc:
        debug_log(request_id, "local_asr_unavailable", {"error": str(exc)}, started_at)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        debug_log(request_id, "local_asr_failed", {"error": str(exc)}, started_at)
        raise HTTPException(status_code=502, detail="Local sherpa-onnx transcription failed") from exc

    debug_log(request_id, "local_asr_transcript", {"transcript": transcript}, started_at)
    transcript_usable = is_transcript_usable(transcript, pinyin_raw)
    allow_denoise_retry = (
        eval_mode != "realtime" or
        vad_result is None or
        vad_result.detected or
        vad_result.reason in {"disabled", "unsupported_sample_rate"}
    )
    if not transcript_usable and LOCAL_ASR_DENOISE_RETRY_ENABLED and allow_denoise_retry:
        debug_log(
            request_id,
            "local_asr_denoise_retry_start",
            {"transcript": transcript},
            started_at,
        )
        try:
            timings["asr_denoise_start"] = time.perf_counter()
            retry_transcript = await asyncio.to_thread(
                local_asr.transcribe_webm,
                audio_bytes,
                audio.filename or "speech.webm",
                True,
            )
            timings["asr_denoise_end"] = time.perf_counter()
            debug_log(
                request_id,
                "local_asr_denoise_retry_transcript",
                {"retry_transcript": retry_transcript},
                started_at,
            )
            if retry_transcript and is_transcript_usable(retry_transcript, pinyin_raw):
                transcript = retry_transcript
                transcript_usable = True
                debug_log(
                    request_id,
                    "local_asr_denoise_retry_accepted",
                    {"retry_transcript": retry_transcript},
                    started_at,
                )
        except Exception as retry_exc:
            debug_log(
                request_id,
                "local_asr_denoise_retry_failed",
                {"error": str(retry_exc)},
                started_at,
            )

    if not transcript_usable:
        timings["response_end"] = time.perf_counter()
        debug_log(
            request_id,
            "local_asr_rejected_unusable_transcript",
            {
                "transcript": transcript,
                "expected_pinyin_raw": pinyin_raw,
                "has_hanzi": has_hanzi(transcript),
                "pinyin_like": looks_like_pinyin_text(transcript, len(split_numbered_pinyin(pinyin_raw))),
            },
            started_at,
        )
        debug_log(
            request_id,
            "local_latency_summary",
            {
                "total_ms": int((timings["response_end"] - timings["request_start"]) * 1000),
                "asr_ms": int((timings.get("asr_end", timings["response_end"]) - timings.get("asr_start", timings["request_start"])) * 1000),
                "asr_denoise_ms": int((timings.get("asr_denoise_end", timings.get("asr_denoise_start", timings["response_end"])) - timings.get("asr_denoise_start", timings["response_end"])) * 1000),
                "vad_ms": int((timings.get("vad_end", timings["response_end"]) - timings.get("vad_start", timings.get("audio_decode_end", timings["response_end"]))) * 1000),
                "scoring_ms": 0,
            },
            started_at,
        )
        return EvaluateResponse(
            success=False,
            confidence=0.0,
            word_id=word_id,
            transcript=transcript,
            hint_code="try_again_clearer",
            hint_text=hint_text_for_code("try_again_clearer"),
        )

    timings["scoring_start"] = time.perf_counter()
    success, confidence, transcript_pinyin, scores, diagnostics, hint_code, hint_text = score_transcript(
        transcript,
        hanzi,
        pinyin_raw,
        {"tone_contour": None},
        None,
        eval_mode=eval_mode,
        request_id=request_id,
        started_at=started_at,
    )
    timings["scoring_end"] = time.perf_counter()
    timings["response_end"] = time.perf_counter()
    debug_log(
        request_id,
        "local_latency_summary",
        {
            "total_ms": int((timings["response_end"] - timings["request_start"]) * 1000),
            "asr_ms": int((timings.get("asr_end", timings["response_end"]) - timings.get("asr_start", timings["request_start"])) * 1000),
            "asr_denoise_ms": int((timings.get("asr_denoise_end", timings.get("asr_denoise_start", timings["response_end"])) - timings.get("asr_denoise_start", timings["response_end"])) * 1000),
            "vad_ms": int((timings.get("vad_end", timings["response_end"]) - timings.get("vad_start", timings.get("audio_decode_end", timings["response_end"]))) * 1000),
            "scoring_ms": int((timings["scoring_end"] - timings["scoring_start"]) * 1000),
        },
        started_at,
    )

    return EvaluateResponse(
        success=success,
        confidence=confidence,
        word_id=word_id,
        transcript=transcript,
        transcript_pinyin=transcript_pinyin,
        scores=scores,
        diagnostics=diagnostics,
        hint_code=hint_code,
        hint_text=hint_text,
    )


@router.post("", response_model=EvaluateResponse)
async def evaluate_pronunciation(
    audio: UploadFile = File(..., description="webm/opus audio recording"),
    word_id: str = Form(...),
    pinyin_raw: str = Form(...),
    hanzi: str = Form(""),
    eval_mode: str = Form("realtime"),
) -> EvaluateResponse:
    """
    V1 Mandarin scoring:
    1. Transcribe the short utterance.
    2. Convert Mandarin transcript to numbered pinyin.
    3. Leniently compare expected hanzi / pinyin to the transcript.

    This response shape is intentionally transport-neutral so a future
    WebSocket route can emit the same payload after an utterance ends.
    """
    started_at = time.perf_counter()
    timings: dict[str, float] = {"request_start": started_at}
    request_id = uuid.uuid4().hex[:8]
    eval_mode = eval_mode.lower().strip()
    if eval_mode not in {"realtime", "practice"}:
        eval_mode = "realtime"
    audio_bytes = await audio.read()
    model = get_transcribe_model()
    dev_fake = is_fake_evaluation_enabled()
    client = get_openai_client()
    debug_log(
        request_id,
        "request_received",
        {
            "word_id": word_id,
            "hanzi": hanzi,
            "pinyin_raw": pinyin_raw,
            "eval_mode": eval_mode,
            "filename": audio.filename,
            "content_type": audio.content_type,
            "bytes": len(audio_bytes),
            "model": model,
            "dev_fake": dev_fake,
            "openai_key_loaded": client is not None,
        },
        started_at,
    )
    print(
        "[evaluate] request",
        {
            "word_id": word_id,
            "hanzi": hanzi,
            "pinyin_raw": pinyin_raw,
            "eval_mode": eval_mode,
            "filename": audio.filename,
            "content_type": audio.content_type,
            "bytes": len(audio_bytes),
            "model": model,
            "dev_fake": dev_fake,
            "openai_key_loaded": client is not None,
        },
        flush=True,
    )
    if not audio_bytes:
        print("[evaluate] empty audio upload", flush=True)
        debug_log(request_id, "request_rejected_empty_audio", {}, started_at)
        return EvaluateResponse(success=False, confidence=0.0, word_id=word_id)

    if eval_mode == "realtime" and len(audio_bytes) < MIN_REALTIME_AUDIO_BYTES:
        debug_log(
            request_id,
            "audio_rejected_too_small",
            {"bytes": len(audio_bytes), "min_bytes": MIN_REALTIME_AUDIO_BYTES},
            started_at,
        )
        return EvaluateResponse(
            success=False,
            confidence=0.0,
            word_id=word_id,
            hint_code="too_quiet",
            hint_text=hint_text_for_code("too_quiet"),
        )

    if dev_fake:
        print("[evaluate] DEV_FAKE_EVALUATION=true, skipping transcription", flush=True)
        success, confidence, transcript_pinyin, scores, diagnostics, hint_code, hint_text = score_transcript(
            hanzi,
            hanzi,
            pinyin_raw,
            eval_mode=eval_mode,
            request_id=request_id,
            started_at=started_at,
        )
        print(
            "[evaluate] response",
            {
                "success": success,
                "confidence": confidence,
                "transcript": hanzi,
                "transcript_pinyin": transcript_pinyin,
                "hint_code": hint_code,
            },
            flush=True,
        )
        return EvaluateResponse(
            success=success,
            confidence=confidence,
            word_id=word_id,
            transcript=hanzi,
            transcript_pinyin=transcript_pinyin,
            scores=scores,
            diagnostics=diagnostics,
            hint_code=hint_code,
            hint_text=hint_text,
        )

    if client is None:
        print("[evaluate] missing OPENAI_API_KEY", flush=True)
        debug_log(request_id, "request_rejected_missing_openai_key", {}, started_at)
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required for pronunciation evaluation. Set DEV_FAKE_EVALUATION=true for local fake scoring.",
        )

    try:
        print("[evaluate] transcribing audio...", flush=True)
        debug_log(request_id, "asr_start", {"model": model}, started_at)
        timings["asr_start"] = time.perf_counter()
        transcription = await client.audio.transcriptions.create(
            model=model,
            file=(audio.filename or "speech.webm", audio_bytes, "audio/webm"),
            language="zh",
            prompt=(
                "Transcribe only the spoken Mandarin target word in Simplified Chinese. "
                f"The expected word is {hanzi}; expected pinyin is {pinyin_raw}. "
                "Return only the Chinese word if it was spoken."
            ),
        )
        timings["asr_end"] = time.perf_counter()
        debug_log(request_id, "asr_complete", {}, started_at)
    except Exception as exc:
        print("[evaluate] transcription failed", {"error": str(exc)}, flush=True)
        debug_log(request_id, "asr_failed", {"error": str(exc)}, started_at)
        raise HTTPException(status_code=502, detail="Audio transcription failed") from exc

    transcript = getattr(transcription, "text", "") or ""
    print("[evaluate] transcript", {"text": transcript}, flush=True)
    debug_log(request_id, "asr_transcript", {"transcript": transcript}, started_at)
    if not is_transcript_usable(transcript, pinyin_raw):
        debug_log(
            request_id,
            "asr_rejected_unusable_transcript",
            {
                "transcript": transcript,
                "expected_pinyin_raw": pinyin_raw,
                "has_hanzi": has_hanzi(transcript),
                "pinyin_like": looks_like_pinyin_text(transcript, len(split_numbered_pinyin(pinyin_raw))),
            },
            started_at,
        )
        timings["response_end"] = time.perf_counter()
        debug_log(
            request_id,
            "latency_summary",
            {
                "total_ms": int((timings["response_end"] - timings["request_start"]) * 1000),
                "asr_ms": int((timings.get("asr_end", timings["response_end"]) - timings.get("asr_start", timings["request_start"])) * 1000),
                "acoustic_ms": 0,
                "scoring_ms": 0,
            },
            started_at,
        )
        return EvaluateResponse(
            success=False,
            confidence=0.0,
            word_id=word_id,
            transcript=transcript,
            hint_code="try_again_clearer",
            hint_text=hint_text_for_code("try_again_clearer"),
        )

    run_acoustic = should_run_acoustic(eval_mode, request_id)
    acoustic_scores = {"tone_contour": None}
    acoustic_hint = None
    if run_acoustic:
        debug_log(request_id, "acoustic_start", {"eval_mode": eval_mode}, started_at)
        timings["acoustic_start"] = time.perf_counter()
        acoustic_scores, acoustic_hint = analyze_tone_contour(audio_bytes, pinyin_raw)
        timings["acoustic_end"] = time.perf_counter()
        debug_log(request_id, "acoustic_complete", {"acoustic_scores": acoustic_scores, "acoustic_hint": acoustic_hint}, started_at)
    else:
        debug_log(request_id, "acoustic_skipped", {"eval_mode": eval_mode}, started_at)
    timings["scoring_start"] = time.perf_counter()
    success, confidence, transcript_pinyin, scores, diagnostics, hint_code, hint_text = score_transcript(
        transcript,
        hanzi,
        pinyin_raw,
        acoustic_scores,
        acoustic_hint,
        eval_mode=eval_mode,
        request_id=request_id,
        started_at=started_at,
    )
    timings["scoring_end"] = time.perf_counter()
    print(
        "[evaluate] response",
        {
            "success": success,
            "confidence": confidence,
            "transcript": transcript,
            "transcript_pinyin": transcript_pinyin,
            "scores": scores,
            "hint_code": hint_code,
        },
        flush=True,
    )
    debug_log(
        request_id,
        "response_ready",
        {"success": success, "confidence": confidence, "hint_code": hint_code, "hint_text": hint_text},
        started_at,
    )
    timings["response_end"] = time.perf_counter()
    latency_summary = {
        "total_ms": int((timings["response_end"] - timings["request_start"]) * 1000),
        "asr_ms": int((timings.get("asr_end", timings["response_end"]) - timings.get("asr_start", timings["request_start"])) * 1000),
        "acoustic_ms": int((timings.get("acoustic_end", timings.get("acoustic_start", timings["response_end"])) - timings.get("acoustic_start", timings["response_end"])) * 1000),
        "scoring_ms": int((timings.get("scoring_end", timings["response_end"]) - timings.get("scoring_start", timings["response_end"])) * 1000),
    }
    debug_log(request_id, "latency_summary", latency_summary, started_at)
    return EvaluateResponse(
        success=success,
        confidence=confidence,
        word_id=word_id,
        transcript=transcript,
        transcript_pinyin=transcript_pinyin,
        scores=scores,
        diagnostics=diagnostics,
        hint_code=hint_code,
        hint_text=hint_text,
    )
