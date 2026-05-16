from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np


class LocalVadUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class VadResult:
    detected: bool
    speech_ms: int
    speech_ratio: float
    segment_count: int
    cropped_waveform: np.ndarray
    reason: str = ""
    error: str | None = None


class SherpaOnnxSileroVad:
    def __init__(self) -> None:
        self._lock = Lock()

    @property
    def enabled(self) -> bool:
        return os.getenv("LOCAL_ASR_VAD_ENABLED", "true").lower() == "true"

    @property
    def model_path(self) -> Path:
        backend_dir = Path(__file__).resolve().parent
        default_path = backend_dir / "models" / "silero_vad.onnx"
        return Path(os.getenv("LOCAL_ASR_VAD_MODEL_PATH", str(default_path))).expanduser()

    @property
    def min_speech_ms(self) -> int:
        return max(60, int(os.getenv("LOCAL_ASR_VAD_MIN_SPEECH_MS", "140")))

    @property
    def min_speech_ratio(self) -> float:
        return max(0.0, min(1.0, float(os.getenv("LOCAL_ASR_VAD_MIN_SPEECH_RATIO", "0.08"))))

    @property
    def threshold(self) -> float:
        return max(0.01, min(0.99, float(os.getenv("LOCAL_ASR_VAD_THRESHOLD", "0.5"))))

    @property
    def min_silence_duration(self) -> float:
        return max(0.05, float(os.getenv("LOCAL_ASR_VAD_MIN_SILENCE_SEC", "0.2")))

    @property
    def max_speech_duration(self) -> float:
        return max(0.3, float(os.getenv("LOCAL_ASR_VAD_MAX_SPEECH_SEC", "2.5")))

    def detect(self, sample_rate: int, waveform: np.ndarray) -> VadResult:
        if not self.enabled:
            return VadResult(
                detected=False,
                speech_ms=0,
                speech_ratio=0.0,
                segment_count=0,
                cropped_waveform=np.array([], dtype=np.float32),
                reason="disabled",
            )

        if sample_rate != 16000:
            return VadResult(
                detected=False,
                speech_ms=0,
                speech_ratio=0.0,
                segment_count=0,
                cropped_waveform=np.array([], dtype=np.float32),
                reason="unsupported_sample_rate",
            )

        if waveform.size == 0:
            return VadResult(
                detected=False,
                speech_ms=0,
                speech_ratio=0.0,
                segment_count=0,
                cropped_waveform=np.array([], dtype=np.float32),
                reason="empty_waveform",
            )

        speech_segments = self._collect_segments(waveform.astype(np.float32, copy=False), sample_rate)
        if not speech_segments:
            return VadResult(
                detected=False,
                speech_ms=0,
                speech_ratio=0.0,
                segment_count=0,
                cropped_waveform=np.array([], dtype=np.float32),
                reason="no_segments",
            )

        cropped = np.concatenate(speech_segments).astype(np.float32, copy=False)
        speech_ms = int((cropped.size / sample_rate) * 1000)
        speech_ratio = float(cropped.size / max(1, waveform.size))
        detected = speech_ms >= self.min_speech_ms and speech_ratio >= self.min_speech_ratio

        return VadResult(
            detected=detected,
            speech_ms=speech_ms,
            speech_ratio=round(speech_ratio, 4),
            segment_count=len(speech_segments),
            cropped_waveform=cropped,
            reason="ok" if detected else "below_minimums",
        )

    def _collect_segments(self, waveform: np.ndarray, sample_rate: int) -> list[np.ndarray]:
        with self._lock:
            try:
                import sherpa_onnx  # type: ignore[import-not-found]
            except Exception as exc:
                raise LocalVadUnavailable(
                    "sherpa-onnx is not installed. Install it with `pip install sherpa-onnx`."
                ) from exc

            model_path = self.model_path
            if not model_path.exists():
                raise LocalVadUnavailable(
                    f"Silero VAD model is missing: {model_path}. "
                    "Download silero_vad.onnx into backend/models/ or set LOCAL_ASR_VAD_MODEL_PATH."
                )

            config = sherpa_onnx.VadModelConfig()
            config.sample_rate = sample_rate
            config.silero_vad.model = str(model_path)
            if hasattr(config.silero_vad, "threshold"):
                config.silero_vad.threshold = self.threshold
            if hasattr(config.silero_vad, "min_silence_duration"):
                config.silero_vad.min_silence_duration = self.min_silence_duration
            if hasattr(config.silero_vad, "min_speech_duration"):
                config.silero_vad.min_speech_duration = self.min_speech_ms / 1000.0
            if hasattr(config.silero_vad, "max_speech_duration"):
                config.silero_vad.max_speech_duration = self.max_speech_duration
            window_size = int(getattr(config.silero_vad, "window_size", 512))
            detector = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)

            # Feed fixed-size windows; pad tail so final speech in partial chunk is still visible.
            cursor = 0
            while cursor + window_size <= waveform.size:
                detector.accept_waveform(waveform[cursor:cursor + window_size])
                cursor += window_size
            if cursor < waveform.size:
                tail = np.zeros(window_size, dtype=np.float32)
                remaining = waveform[cursor:]
                tail[:remaining.size] = remaining
                detector.accept_waveform(tail)

            if hasattr(detector, "flush"):
                detector.flush()

            segments: list[np.ndarray] = []
            while True:
                empty_attr = getattr(detector, "empty")
                is_empty = empty_attr() if callable(empty_attr) else bool(empty_attr)
                if is_empty:
                    break

                front_attr = getattr(detector, "front")
                segment = front_attr() if callable(front_attr) else front_attr
                segment_waveform = np.asarray(segment.samples, dtype=np.float32)
                if segment_waveform.size > 0:
                    segments.append(segment_waveform)

                pop_attr = getattr(detector, "pop")
                if callable(pop_attr):
                    pop_attr()
                else:
                    break
            return segments


local_vad = SherpaOnnxSileroVad()
