import os
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from threading import Lock

import numpy as np


DEFAULT_MODEL_NAME = "sensevoice-int8"
SENSEVOICE_REQUIRED_FILES = (
    "model.int8.onnx",
    "tokens.txt",
)


class LocalAsrUnavailable(RuntimeError):
    pass


class SenseVoiceAsr:
    def __init__(self) -> None:
        self._model = None
        self._lock = Lock()

    @property
    def model_dir(self) -> Path:
        default_dir = Path(__file__).resolve().parent / "models" / DEFAULT_MODEL_NAME
        return Path(os.getenv("SENSEVOICE_MODEL_DIR", str(default_dir))).expanduser()

    def model_files_ready(self) -> bool:
        return all((self.model_dir / filename).exists() for filename in SENSEVOICE_REQUIRED_FILES)

    def transcribe_webm(self, audio_bytes: bytes, filename: str = "speech.webm", denoise: bool = False) -> str:
        sample_rate, waveform = self.load_webm_waveform(audio_bytes, filename, denoise=denoise)
        return self.transcribe_waveform(sample_rate, waveform)

    def transcribe_webm_with_timings(
        self,
        audio_bytes: bytes,
        filename: str = "speech.webm",
        denoise: bool = False,
    ) -> tuple[str, dict[str, int]]:
        started_at = time.perf_counter()
        decode_started_at = time.perf_counter()
        sample_rate, waveform = self.load_webm_waveform(audio_bytes, filename, denoise=denoise)
        decode_ms = self._elapsed_ms(decode_started_at)
        transcript, timings = self.transcribe_waveform_with_timings(sample_rate, waveform)
        timings = {
            **timings,
            "audio_decode_ms": decode_ms,
            "total_ms": self._elapsed_ms(started_at),
            "sample_rate": sample_rate,
            "samples": int(waveform.size),
        }
        return transcript, timings

    def load_webm_waveform(self, audio_bytes: bytes, filename: str = "speech.webm", denoise: bool = False) -> tuple[int, np.ndarray]:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_path = tmp_path / filename
            wav_path = tmp_path / "speech.wav"
            input_path.write_bytes(audio_bytes)
            self._convert_to_wav(input_path, wav_path, denoise=denoise)
            return self._read_wav(wav_path)

    def transcribe_waveform(self, sample_rate: int, waveform: np.ndarray) -> str:
        transcript, _ = self.transcribe_waveform_with_timings(sample_rate, waveform)
        return transcript

    def transcribe_waveform_with_timings(self, sample_rate: int, waveform: np.ndarray) -> tuple[str, dict[str, int]]:
        started_at = time.perf_counter()
        model_started_at = time.perf_counter()
        model = self._get_model()
        timings = {
            "model_ready_ms": self._elapsed_ms(model_started_at),
            "sample_rate": sample_rate,
            "samples": int(waveform.size),
        }
        # Preserve the timing keys consumed by the HTTP route. The ONNX adapter
        # accepts float32 samples directly, so it no longer writes a temporary wav.
        timings["write_wav_ms"] = 0
        lock_wait_started_at = time.perf_counter()
        with self._lock:
            timings["lock_wait_ms"] = self._elapsed_ms(lock_wait_started_at)
            generate_started_at = time.perf_counter()
            stream = model.create_stream()
            stream.accept_waveform(sample_rate, np.ascontiguousarray(waveform, dtype=np.float32))
            model.decode_stream(stream)
            timings["generate_ms"] = self._elapsed_ms(generate_started_at)
        postprocess_started_at = time.perf_counter()
        transcript = str(stream.result.text or "").strip()
        timings["postprocess_ms"] = self._elapsed_ms(postprocess_started_at)
        timings["total_ms"] = self._elapsed_ms(started_at)
        return transcript, timings

    def ensure_ready(self) -> dict[str, bool | int | str]:
        already_loaded = self._model is not None
        started_at = time.perf_counter()
        model = self._get_model()
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "ready": model is not None,
            "already_loaded": already_loaded,
            "elapsed_ms": elapsed_ms,
            "model_dir": str(self.model_dir),
        }

    def _get_model(self):
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model

            try:
                import sherpa_onnx  # type: ignore[import-not-found]
            except Exception as exc:
                raise LocalAsrUnavailable(
                    "sherpa-onnx is not installed. Run `python -m pip install -r backend/requirements.txt`."
                ) from exc

            model_dir = self.model_dir
            missing_files = [
                filename for filename in SENSEVOICE_REQUIRED_FILES
                if not (model_dir / filename).exists()
            ]
            if missing_files:
                raise LocalAsrUnavailable(
                    "SenseVoice INT8 model files are missing. Expected "
                    f"{', '.join(missing_files)} in {model_dir}. Download "
                    "them with `python backend/scripts/download_sherpa_model.py`."
                )

            self._model = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(model_dir / "model.int8.onnx"),
                tokens=str(model_dir / "tokens.txt"),
                language=os.getenv("SENSEVOICE_LANGUAGE", "zh"),
                # Pronunciation scoring needs lexical Hanzi (四, 十四, 一二三),
                # rather than inverse-normalized digits (4, 14, 123).
                use_itn=False,
                provider=os.getenv("SENSEVOICE_PROVIDER", "cpu"),
                num_threads=int(os.getenv("SENSEVOICE_NUM_THREADS", "1")),
            )
            return self._model

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

    def _elapsed_ms(self, started_at: float, ended_at: float | None = None) -> int:
        ended = ended_at if ended_at is not None else time.perf_counter()
        return int((ended - started_at) * 1000)


local_asr = SenseVoiceAsr()
