import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_vad import SherpaOnnxSileroVad, VadResult
from routers.evaluate import (
    decode_pcm_s16le_waveform,
    normalize_audio_format,
    pcm_s16le_to_wav_bytes,
    should_attempt_local_denoise_retry,
    should_reject_realtime_audio,
)


class RealtimeAudioGateTests(unittest.TestCase):
    def test_rejects_weak_audio_without_vad(self) -> None:
        activity = {"duration_ms": 500, "rms": 0.003, "peak": 0.02, "active_ratio": 0.01, "active_ms": 40}
        self.assertTrue(should_reject_realtime_audio(activity, None))

    def test_accepts_weak_audio_when_vad_detects_speech(self) -> None:
        activity = {"duration_ms": 500, "rms": 0.003, "peak": 0.02, "active_ratio": 0.01, "active_ms": 40}
        vad = VadResult(
            detected=True,
            speech_ms=260,
            speech_ratio=0.21,
            segment_count=1,
            cropped_waveform=np.ones(500, dtype=np.float32),
        )
        self.assertFalse(should_reject_realtime_audio(activity, vad))

    def test_accepts_strong_audio_without_vad(self) -> None:
        activity = {"duration_ms": 500, "rms": 0.012, "peak": 0.12, "active_ratio": 0.2, "active_ms": 600}
        self.assertFalse(should_reject_realtime_audio(activity, None))

    def test_rejects_short_audio_even_if_loud(self) -> None:
        activity = {"duration_ms": 120, "rms": 0.2, "peak": 0.8, "active_ratio": 0.8, "active_ms": 120}
        self.assertTrue(should_reject_realtime_audio(activity, None))


class PcmAudioHelperTests(unittest.TestCase):
    def test_normalize_audio_format_defaults_to_webm(self) -> None:
        self.assertEqual(normalize_audio_format(None), "webm_opus")
        self.assertEqual(normalize_audio_format(""), "webm_opus")

    def test_decode_pcm_s16le_matches_existing_float32_math(self) -> None:
        pcm = np.array([-32768, -16384, 0, 16384, 32767], dtype="<i2").tobytes()
        sample_rate, waveform = decode_pcm_s16le_waveform(pcm, 16000, 1)

        self.assertEqual(sample_rate, 16000)
        np.testing.assert_allclose(
            waveform,
            np.array([-1.0, -0.5, 0.0, 0.5, 32767 / 32768], dtype=np.float32),
            rtol=0,
            atol=1e-6,
        )

    def test_decode_pcm_s16le_rejects_invalid_metadata(self) -> None:
        pcm = np.array([0, 1], dtype="<i2").tobytes()
        with self.assertRaises(HTTPException):
            decode_pcm_s16le_waveform(pcm, 44100, 1)
        with self.assertRaises(HTTPException):
            decode_pcm_s16le_waveform(pcm, 16000, 2)
        with self.assertRaises(HTTPException):
            decode_pcm_s16le_waveform(b"\x00", 16000, 1)

    def test_pcm_denoise_retry_is_disabled_for_pcm(self) -> None:
        vad = VadResult(
            detected=True,
            speech_ms=260,
            speech_ratio=0.21,
            segment_count=1,
            cropped_waveform=np.ones(500, dtype=np.float32),
        )

        self.assertFalse(should_attempt_local_denoise_retry("pcm_s16le", False, vad, "realtime", True))
        self.assertTrue(should_attempt_local_denoise_retry("webm_opus", False, vad, "realtime", True))

    def test_pcm_s16le_to_wav_bytes_writes_riff_header(self) -> None:
        pcm = np.array([0, 100, -100], dtype="<i2").tobytes()
        wav_bytes = pcm_s16le_to_wav_bytes(pcm, 16000, 1)

        self.assertEqual(wav_bytes[:4], b"RIFF")
        self.assertEqual(wav_bytes[8:12], b"WAVE")
        self.assertEqual(wav_bytes[36:40], b"data")


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
