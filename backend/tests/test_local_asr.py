import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_asr import SenseVoiceAsr


class FakeStream:
    def __init__(self) -> None:
        self.result = SimpleNamespace(text="四")
        self.sample_rate: int | None = None
        self.samples: np.ndarray | None = None

    def accept_waveform(self, sample_rate: int, samples: np.ndarray) -> None:
        self.sample_rate = sample_rate
        self.samples = samples


class FakeSenseVoiceRecognizer:
    def __init__(self) -> None:
        self.stream = FakeStream()
        self.decoded = False

    def create_stream(self) -> FakeStream:
        return self.stream

    def decode_stream(self, stream: FakeStream) -> None:
        self.decoded = stream is self.stream


class SenseVoiceAsrTests(unittest.TestCase):
    def test_transcribe_waveform_uses_float32_samples_and_keeps_timing_keys(self) -> None:
        model = FakeSenseVoiceRecognizer()
        asr = SenseVoiceAsr()
        asr._model = model

        transcript, timings = asr.transcribe_waveform_with_timings(
            16000, np.zeros(16, dtype=np.float64)
        )

        self.assertEqual(transcript, "四")
        self.assertTrue(model.decoded)
        self.assertEqual(model.stream.sample_rate, 16000)
        self.assertEqual(model.stream.samples.dtype, np.float32)
        self.assertTrue(model.stream.samples.flags.c_contiguous)
        self.assertTrue({
            "model_ready_ms", "write_wav_ms", "lock_wait_ms",
            "generate_ms", "postprocess_ms", "total_ms",
        }.issubset(timings))
        self.assertEqual(timings["write_wav_ms"], 0)

    def test_loads_int8_model_with_itn_disabled_and_reuses_recognizer(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = Path(tmpdir)
            (model_dir / "model.int8.onnx").write_bytes(b"model")
            (model_dir / "tokens.txt").write_text("token 0\n")
            calls: list[dict[str, object]] = []
            recognizer = FakeSenseVoiceRecognizer()

            def from_sense_voice(**kwargs: object) -> FakeSenseVoiceRecognizer:
                calls.append(kwargs)
                return recognizer

            fake_sherpa = SimpleNamespace(
                OfflineRecognizer=SimpleNamespace(from_sense_voice=from_sense_voice)
            )
            with patch.dict(os.environ, {
                "SENSEVOICE_MODEL_DIR": str(model_dir),
                "SENSEVOICE_LANGUAGE": "zh",
                "SENSEVOICE_NUM_THREADS": "1",
            }), patch.dict(sys.modules, {"sherpa_onnx": fake_sherpa}):
                asr = SenseVoiceAsr()
                first = asr.ensure_ready()
                second = asr.ensure_ready()

            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]["model"], str(model_dir / "model.int8.onnx"))
            self.assertEqual(calls[0]["tokens"], str(model_dir / "tokens.txt"))
            self.assertEqual(calls[0]["language"], "zh")
            self.assertIs(calls[0]["use_itn"], False)
            self.assertEqual(calls[0]["provider"], "cpu")
            self.assertEqual(calls[0]["num_threads"], 1)
            self.assertTrue(first["ready"])
            self.assertFalse(first["already_loaded"])
            self.assertTrue(second["already_loaded"])


if __name__ == "__main__":
    unittest.main()
