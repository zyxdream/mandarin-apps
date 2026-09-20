import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_asr import SenseVoiceAsr


class FakeSenseVoiceModel:
    def __init__(self) -> None:
        self.generate_kwargs: dict[str, object] | None = None

    def generate(self, **kwargs: object) -> list[dict[str, str]]:
        self.generate_kwargs = kwargs
        return [{"text": "四"}]


class SenseVoiceAsrTests(unittest.TestCase):
    def test_transcribe_waveform_disables_inverse_text_normalization(self) -> None:
        model = FakeSenseVoiceModel()
        asr = SenseVoiceAsr()
        asr._model = model

        transcript = asr.transcribe_waveform(16000, np.zeros(16, dtype=np.float32))

        self.assertEqual(transcript, "四")
        self.assertIsNotNone(model.generate_kwargs)
        self.assertIs(model.generate_kwargs["use_itn"], False)


if __name__ == "__main__":
    unittest.main()
