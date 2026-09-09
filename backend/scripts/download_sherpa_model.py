from __future__ import annotations

import os
import urllib.request
from pathlib import Path


MODEL_NAME = "sensevoice-small"
MODEL_REPO_ID = "FunAudioLLM/SenseVoiceSmall"
MODEL_REQUIRED_FILES = (
    "am.mvn",
    "chn_jpn_yue_eng_ko_spectok.bpe.model",
    "config.yaml",
    "configuration.json",
    "model.pt",
)
VAD_MODEL_NAME = "silero_vad.onnx"
VAD_MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{VAD_MODEL_NAME}"


def sensevoice_ready(model_dir: Path) -> bool:
    return all((model_dir / filename).exists() for filename in MODEL_REQUIRED_FILES)


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    models_dir = backend_dir / "models"
    model_dir = Path(os.getenv("SENSEVOICE_MODEL_DIR", str(models_dir / MODEL_NAME))).expanduser()

    models_dir.mkdir(parents=True, exist_ok=True)
    if sensevoice_ready(model_dir):
        print(f"ASR model already exists: {model_dir}")
    else:
        try:
            from huggingface_hub import snapshot_download
        except Exception as exc:
            raise SystemExit(
                "huggingface_hub is not installed. Run "
                "`python -m pip install -r backend/requirements.txt` first."
            ) from exc

        print(f"Downloading {MODEL_REPO_ID} to {model_dir}")
        snapshot_download(
            repo_id=MODEL_REPO_ID,
            local_dir=str(model_dir),
            allow_patterns=[*MODEL_REQUIRED_FILES, "README.md"],
        )

    vad_path = models_dir / VAD_MODEL_NAME
    if vad_path.exists():
        print(f"VAD model already exists: {vad_path}")
    else:
        print(f"Downloading {VAD_MODEL_URL}")
        urllib.request.urlretrieve(VAD_MODEL_URL, vad_path)

    print(f"Ready: {model_dir}")


if __name__ == "__main__":
    main()
