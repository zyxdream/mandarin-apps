from __future__ import annotations

import hashlib
import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path


MODEL_NAME = "sensevoice-int8"
MODEL_RELEASE_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL_RELEASE_NAME}.tar.bz2"
MODEL_REQUIRED_FILES = ("model.int8.onnx", "tokens.txt")
MODEL_SHA256 = {
    "model.int8.onnx": "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    "tokens.txt": "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
}
VAD_MODEL_NAME = "silero_vad.onnx"
VAD_MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{VAD_MODEL_NAME}"
VAD_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checksum_matches(path: Path, expected: str) -> bool:
    return path.is_file() and sha256_file(path) == expected


def sensevoice_ready(model_dir: Path) -> bool:
    return all(checksum_matches(model_dir / filename, MODEL_SHA256[filename])
               for filename in MODEL_REQUIRED_FILES)


def download_sensevoice(model_dir: Path, models_dir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="sensevoice-int8-", dir=models_dir) as tmpdir:
        tmp_path = Path(tmpdir)
        archive_path = tmp_path / f"{MODEL_RELEASE_NAME}.tar.bz2"
        print(f"Downloading {MODEL_URL}", flush=True)
        urllib.request.urlretrieve(MODEL_URL, archive_path)

        with tarfile.open(archive_path, "r:bz2") as archive:
            for filename in MODEL_REQUIRED_FILES:
                member = archive.getmember(f"{MODEL_RELEASE_NAME}/{filename}")
                if not member.isfile():
                    raise RuntimeError(f"Model archive entry is not a file: {member.name}")
                source = archive.extractfile(member)
                if source is None:
                    raise RuntimeError(f"Cannot read model archive entry: {member.name}")
                with source, (tmp_path / filename).open("wb") as destination:
                    shutil.copyfileobj(source, destination)

        for filename in MODEL_REQUIRED_FILES:
            if not checksum_matches(tmp_path / filename, MODEL_SHA256[filename]):
                raise RuntimeError(f"SenseVoice INT8 checksum mismatch: {filename}")

        model_dir.mkdir(parents=True, exist_ok=True)
        for filename in MODEL_REQUIRED_FILES:
            os.replace(tmp_path / filename, model_dir / filename)

    if not sensevoice_ready(model_dir):
        raise RuntimeError(f"SenseVoice INT8 download is incomplete: {model_dir}")


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    models_dir = backend_dir / "models"
    model_dir = Path(os.getenv("SENSEVOICE_MODEL_DIR", str(models_dir / MODEL_NAME))).expanduser()

    models_dir.mkdir(parents=True, exist_ok=True)
    if sensevoice_ready(model_dir):
        print(f"ASR model already exists: {model_dir}")
    else:
        download_sensevoice(model_dir, models_dir)

    vad_path = models_dir / VAD_MODEL_NAME
    if checksum_matches(vad_path, VAD_SHA256):
        print(f"VAD model already exists: {vad_path}")
    else:
        print(f"Downloading {VAD_MODEL_URL}")
        with tempfile.TemporaryDirectory(prefix="silero-vad-", dir=models_dir) as tmpdir:
            download_path = Path(tmpdir) / VAD_MODEL_NAME
            urllib.request.urlretrieve(VAD_MODEL_URL, download_path)
            if not checksum_matches(download_path, VAD_SHA256):
                raise RuntimeError("Silero VAD checksum mismatch")
            os.replace(download_path, vad_path)

    print(f"Ready: {model_dir}")


if __name__ == "__main__":
    main()
