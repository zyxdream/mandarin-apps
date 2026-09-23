import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import download_sherpa_model as downloader


class ModelChecksumTests(unittest.TestCase):
    def test_existing_model_requires_both_expected_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            model = model_dir / "model.int8.onnx"
            tokens = model_dir / "tokens.txt"
            model.write_bytes(b"model")
            tokens.write_bytes(b"tokens")
            expected = {
                "model.int8.onnx": hashlib.sha256(b"model").hexdigest(),
                "tokens.txt": hashlib.sha256(b"tokens").hexdigest(),
            }
            with patch.object(downloader, "MODEL_SHA256", expected):
                self.assertTrue(downloader.sensevoice_ready(model_dir))
                tokens.write_bytes(b"corrupted")
                self.assertFalse(downloader.sensevoice_ready(model_dir))

    def test_missing_or_corrupt_vad_is_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            vad = Path(directory) / downloader.VAD_MODEL_NAME
            self.assertFalse(downloader.checksum_matches(vad, downloader.VAD_SHA256))
            vad.write_bytes(b"not Silero")
            self.assertFalse(downloader.checksum_matches(vad, downloader.VAD_SHA256))


if __name__ == "__main__":
    unittest.main()
