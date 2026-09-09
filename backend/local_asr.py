import os
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from threading import Lock

import numpy as np


DEFAULT_MODEL_NAME = "sensevoice-small"
SENSEVOICE_REQUIRED_FILES = (
    "am.mvn",
    "chn_jpn_yue_eng_ko_spectok.bpe.model",
    "config.yaml",
    "configuration.json",
    "model.pt",
)


class LocalAsrUnavailable(RuntimeError):
    pass


class SenseVoiceAsr:
    def __init__(self) -> None:
        self._model = None
        self._postprocess = None
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

    def load_webm_waveform(self, audio_bytes: bytes, filename: str = "speech.webm", denoise: bool = False) -> tuple[int, np.ndarray]:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_path = tmp_path / filename
            wav_path = tmp_path / "speech.wav"
            input_path.write_bytes(audio_bytes)
            self._convert_to_wav(input_path, wav_path, denoise=denoise)
            return self._read_wav(wav_path)

    def transcribe_waveform(self, sample_rate: int, waveform: np.ndarray) -> str:
        model = self._get_model()
        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = Path(tmpdir) / "speech.wav"
            self._write_wav(wav_path, sample_rate, waveform)
            with self._lock:
                result = model.generate(
                    input=str(wav_path),
                    cache={},
                    language=os.getenv("SENSEVOICE_LANGUAGE", "zh"),
                    use_itn=True,
                    batch_size_s=int(os.getenv("SENSEVOICE_BATCH_SIZE_S", "60")),
                    merge_vad=True,
                    merge_length_s=int(os.getenv("SENSEVOICE_MERGE_LENGTH_S", "15")),
                )
        return self._extract_text(result)

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
                from funasr import AutoModel  # type: ignore[import-not-found]
                from funasr.utils.postprocess_utils import rich_transcription_postprocess
            except Exception as exc:
                raise LocalAsrUnavailable(
                    "FunASR is not installed. Run `python -m pip install -r backend/requirements.txt`."
                ) from exc

            model_dir = self.model_dir
            missing_files = [
                filename for filename in SENSEVOICE_REQUIRED_FILES
                if not (model_dir / filename).exists()
            ]
            if missing_files:
                raise LocalAsrUnavailable(
                    "SenseVoiceSmall model files are missing. Expected "
                    f"{', '.join(missing_files)} in {model_dir}. Download "
                    f"{DEFAULT_MODEL_NAME} into backend/models/."
                )

            self._model = AutoModel(
                model=str(model_dir),
                vad_model=None,
                device=os.getenv("SENSEVOICE_DEVICE", "cpu"),
                hub="hf",
                disable_update=True,
                disable_pbar=True,
            )
            self._postprocess = rich_transcription_postprocess
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

    def _write_wav(self, wav_path: Path, sample_rate: int, waveform: np.ndarray) -> None:
        clipped = np.clip(waveform, -1.0, 1.0)
        pcm = (clipped * 32767.0).astype(np.int16)
        with wave.open(str(wav_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm.tobytes())

    def _extract_text(self, result: object) -> str:
        if not result or not isinstance(result, list):
            return ""

        text = ""
        first = result[0]
        if isinstance(first, dict):
            text = str(first.get("text") or "")
        else:
            text = str(first)

        if self._postprocess:
            return str(self._postprocess(text))
        return text


local_asr = SenseVoiceAsr()
