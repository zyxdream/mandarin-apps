from __future__ import annotations

import os
import tarfile
import urllib.request
from pathlib import Path


MODEL_NAME = "sherpa-onnx-paraformer-zh-small-2024-03-09"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL_NAME}.tar.bz2"
VAD_MODEL_NAME = "silero_vad.onnx"
VAD_MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{VAD_MODEL_NAME}"


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    models_dir = backend_dir / "models"
    model_dir = Path(os.getenv("SHERPA_ONNX_MODEL_DIR", str(models_dir / MODEL_NAME))).expanduser()
    archive_path = models_dir / f"{MODEL_NAME}.tar.bz2"

    models_dir.mkdir(parents=True, exist_ok=True)
    asr_ready = (model_dir / "model.int8.onnx").exists() and (model_dir / "tokens.txt").exists()
    if asr_ready:
        print(f"ASR model already exists: {model_dir}")
    else:
        print(f"Downloading {MODEL_URL}")
        urllib.request.urlretrieve(MODEL_URL, archive_path)

        print(f"Extracting {archive_path}")
        with tarfile.open(archive_path, "r:bz2") as archive:
            archive.extractall(models_dir, filter="data")

        archive_path.unlink(missing_ok=True)

    vad_path = models_dir / VAD_MODEL_NAME
    if vad_path.exists():
        print(f"VAD model already exists: {vad_path}")
    else:
        print(f"Downloading {VAD_MODEL_URL}")
        urllib.request.urlretrieve(VAD_MODEL_URL, vad_path)

    print(f"Ready: {model_dir}")


if __name__ == "__main__":
    main()
