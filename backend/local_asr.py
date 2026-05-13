import os
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from threading import Lock

import numpy as np


class LocalAsrUnavailable(RuntimeError):
    pass


class SherpaOnnxAsr:
    def __init__(self) -> None:
        self._recognizer = None
        self._lock = Lock()

    @property
    def model_dir(self) -> Path:
        default_dir = Path(__file__).resolve().parent / "models" / "sherpa-onnx-paraformer-zh-small-2024-03-09"
        return Path(os.getenv("SHERPA_ONNX_MODEL_DIR", str(default_dir))).expanduser()

    def transcribe_webm(self, audio_bytes: bytes, filename: str = "speech.webm", denoise: bool = False) -> str:
        sample_rate, waveform = self.load_webm_waveform(audio_bytes, filename, denoise=denoise)
        return self.transcribe_waveform(sample_rate, waveform)

    def load_webm_waveform(self, audio_bytes: bytes, filename: str = "speech.webm", denoise: bool = False) -> tuple[int, np.ndarray]:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_path = tmp_path / filename
            wav_path = tmp_path / "speech.wav"
            input_path.write_bytes(audio_bytes)
            self._convert_to_wav(input_path, wav_path, denoise=denoise)
            return self._read_wav(wav_path)

    def transcribe_waveform(self, sample_rate: int, waveform: np.ndarray) -> str:
        recognizer = self._get_recognizer()
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, waveform)
        recognizer.decode_stream(stream)
        return getattr(stream.result, "text", "") or ""

    def ensure_ready(self) -> dict[str, bool | int | str]:
        already_loaded = self._recognizer is not None
        started_at = time.perf_counter()
        recognizer = self._get_recognizer()
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "ready": recognizer is not None,
            "already_loaded": already_loaded,
            "elapsed_ms": elapsed_ms,
            "model_dir": str(self.model_dir),
        }

    def _get_recognizer(self):
        if self._recognizer is not None:
            return self._recognizer

        with self._lock:
            if self._recognizer is not None:
                return self._recognizer

            try:
                import sherpa_onnx  # type: ignore[import-not-found]
            except Exception as exc:
                raise LocalAsrUnavailable(
                    "sherpa-onnx is not installed. Install it with `pip install sherpa-onnx`."
                ) from exc

            model_dir = self.model_dir
            model_path = model_dir / "model.int8.onnx"
            tokens_path = model_dir / "tokens.txt"
            if not model_path.exists() or not tokens_path.exists():
                raise LocalAsrUnavailable(
                    "Sherpa ONNX model files are missing. Expected "
                    f"{model_path} and {tokens_path}. Download "
                    "sherpa-onnx-paraformer-zh-small-2024-03-09 into backend/models/."
                )

            self._recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
                paraformer=str(model_path),
                tokens=str(tokens_path),
                num_threads=int(os.getenv("SHERPA_ONNX_NUM_THREADS", "2")),
                sample_rate=16000,
                feature_dim=80,
                decoding_method="greedy_search",
                provider=os.getenv("SHERPA_ONNX_PROVIDER", "cpu"),
            )
            return self._recognizer

    def _convert_to_wav(self, input_path: Path, wav_path: Path, denoise: bool = False) -> None:
        filters = ["highpass=f=80", "lowpass=f=7800"]
        if denoise:
            # Lightweight denoise fallback for noisy environments.
            filters.append("afftdn=nf=-25")

        command = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            ",".join(filters),
            str(wav_path),
        ]
        try:
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            details = (exc.stderr or exc.stdout or "").strip()
            message = "ffmpeg failed to convert uploaded audio to 16 kHz mono wav."
            if details:
                message = f"{message} ffmpeg: {details[-500:]}"
            raise LocalAsrUnavailable(message) from exc
        except Exception as exc:
            raise LocalAsrUnavailable("ffmpeg failed to convert uploaded audio to 16 kHz mono wav.") from exc

    def _read_wav(self, wav_path: Path) -> tuple[int, np.ndarray]:
        with wave.open(str(wav_path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            sample_width = wav_file.getsampwidth()
            frames = wav_file.readframes(wav_file.getnframes())

        if sample_width != 2:
            raise LocalAsrUnavailable(f"Expected 16-bit wav from ffmpeg, got sample width {sample_width}.")

        waveform = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        return sample_rate, waveform


local_asr = SherpaOnnxAsr()
