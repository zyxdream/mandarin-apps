import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_vad import SherpaOnnxSileroVad, VadResult
from routers.evaluate import should_reject_realtime_audio


class RealtimeAudioGateTests(unittest.TestCase):
    def test_rejects_weak_audio_without_vad(self) -> None:
        activity = {"rms": 0.003, "peak": 0.02, "active_ratio": 0.01, "active_ms": 40}
        self.assertTrue(should_reject_realtime_audio(activity, None))

    def test_accepts_weak_audio_when_vad_detects_speech(self) -> None:
        activity = {"rms": 0.003, "peak": 0.02, "active_ratio": 0.01, "active_ms": 40}
        vad = VadResult(
            detected=True,
            speech_ms=260,
            speech_ratio=0.21,
            segment_count=1,
            cropped_waveform=np.ones(500, dtype=np.float32),
        )
        self.assertFalse(should_reject_realtime_audio(activity, vad))

    def test_accepts_strong_audio_without_vad(self) -> None:
        activity = {"rms": 0.012, "peak": 0.12, "active_ratio": 0.2, "active_ms": 600}
        self.assertFalse(should_reject_realtime_audio(activity, None))


class LocalVadHelperTests(unittest.TestCase):
    def test_disabled_vad_is_non_blocking(self) -> None:
        with patch.dict(os.environ, {"LOCAL_ASR_VAD_ENABLED": "false"}, clear=False):
            helper = SherpaOnnxSileroVad()
            result = helper.detect(16000, np.ones(16000, dtype=np.float32))
        self.assertFalse(result.detected)
        self.assertEqual(result.reason, "disabled")

    def test_detect_marks_speech_when_segments_meet_duration_and_ratio(self) -> None:
        with patch.dict(
            os.environ,
            {
                "LOCAL_ASR_VAD_ENABLED": "true",
                "LOCAL_ASR_VAD_MIN_SPEECH_MS": "80",
                "LOCAL_ASR_VAD_MIN_SPEECH_RATIO": "0.05",
            },
            clear=False,
        ):
            helper = SherpaOnnxSileroVad()
            waveform = np.ones(16000, dtype=np.float32)
            with patch.object(
                helper,
                "_collect_segments",
                return_value=[np.ones(1800, dtype=np.float32), np.ones(600, dtype=np.float32)],
            ):
                result = helper.detect(16000, waveform)
        self.assertTrue(result.detected)
        self.assertGreaterEqual(result.speech_ms, 100)
        self.assertGreater(result.speech_ratio, 0.1)
        self.assertEqual(result.segment_count, 2)

    def test_detect_rejects_when_ratio_below_minimum(self) -> None:
        with patch.dict(
            os.environ,
            {
                "LOCAL_ASR_VAD_ENABLED": "true",
                "LOCAL_ASR_VAD_MIN_SPEECH_MS": "30",
                "LOCAL_ASR_VAD_MIN_SPEECH_RATIO": "0.2",
            },
            clear=False,
        ):
            helper = SherpaOnnxSileroVad()
            waveform = np.ones(16000, dtype=np.float32)
            with patch.object(
                helper,
                "_collect_segments",
                return_value=[np.ones(1000, dtype=np.float32)],
            ):
                result = helper.detect(16000, waveform)
        self.assertFalse(result.detected)
        self.assertEqual(result.reason, "below_minimums")

    def test_detect_skips_unsupported_sample_rate(self) -> None:
        with patch.dict(os.environ, {"LOCAL_ASR_VAD_ENABLED": "true"}, clear=False):
            helper = SherpaOnnxSileroVad()
            result = helper.detect(22050, np.ones(22050, dtype=np.float32))
        self.assertFalse(result.detected)
        self.assertEqual(result.reason, "unsupported_sample_rate")


if __name__ == "__main__":
    unittest.main()
