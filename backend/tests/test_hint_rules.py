import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.evaluate import choose_hint, parse_pinyin_syllable, score_transcript, syllable_similarity


def diagnostic_for(expected_raw: str, actual_raw: str | None) -> tuple[list, list[dict[str, str | int | bool]]]:
    expected = parse_pinyin_syllable(expected_raw)
    actual = parse_pinyin_syllable(actual_raw) if actual_raw else None
    _, diagnostic = syllable_similarity(expected, actual)
    return [expected], [diagnostic]


def select_hint(
    expected_raw: str,
    actual_raw: str | None,
    *,
    confidence: float = 0.4,
    lexical_score: float = 0.0,
    syllable_score: float = 0.6,
    tone_score: float = 0.5,
    transcript_syllable_count: int = 1,
) -> tuple[str | None, str | None]:
    expected, diagnostics = diagnostic_for(expected_raw, actual_raw)
    return choose_hint(
        expected,
        diagnostics,
        None,
        success=False,
        confidence=confidence,
        lexical_score=lexical_score,
        syllable_score=syllable_score,
        tone_score=tone_score,
        transcript_syllable_count=transcript_syllable_count,
    )


class PronunciationHintRuleTests(unittest.TestCase):
    def test_tone_hints_use_expected_tone(self) -> None:
        self.assertEqual(select_hint("ma1", "ma4")[1], "Tone 1: Laser flat")
        self.assertEqual(select_hint("ma2", "ma4")[1], "Tone 2: Rocket up")
        self.assertEqual(select_hint("ma3", "ma4")[1], "Tone 3: Trampoline dip")
        self.assertEqual(select_hint("ma4", "ma1")[1], "Tone 4: Knife drop")

    def test_initial_hint_for_retroflex_family(self) -> None:
        hint_code, hint_text = select_hint("shi4", "si4")
        self.assertEqual(hint_code, "initial_curl")
        self.assertEqual(hint_text, "zh/ch/sh/r: Curl tongue")

    def test_final_hints_distinguish_nasal_endings(self) -> None:
        self.assertEqual(select_hint("fang1", "fan1")[1], "Ending: Nose ending")
        self.assertEqual(select_hint("fan1", "fa1")[1], "Ending: Soft N end")

    def test_missing_and_extra_syllable_hints_are_short(self) -> None:
        self.assertEqual(select_hint("ma1", None)[1], "Beats: Say every beat")

        expected, diagnostics = diagnostic_for("ma1", "ma1")
        hint_code, hint_text = choose_hint(
            expected,
            diagnostics,
            None,
            success=False,
            confidence=0.5,
            lexical_score=0.0,
            syllable_score=1.0,
            tone_score=1.0,
            transcript_syllable_count=2,
        )
        self.assertEqual(hint_code, "extra_beat")
        self.assertEqual(hint_text, "Beats: Keep it short")

    def test_ambiguous_low_confidence_gets_rotating_generic_hint(self) -> None:
        for retry_text in ("Try again", "So close"):
            with self.subTest(retry_text=retry_text):
                with patch("routers.evaluate.random.choice", return_value=retry_text):
                    hint_code, hint_text = select_hint(
                        "shi4",
                        "ma2",
                        confidence=0.05,
                        lexical_score=0.0,
                        syllable_score=0.0,
                        tone_score=0.0,
                    )

                self.assertEqual(hint_code, "nice_try_again")
                self.assertEqual(hint_text, f"Tip: {retry_text}")

    def test_success_returns_no_hint(self) -> None:
        success, confidence, _, _, _, hint_code, hint_text = score_transcript("火", "火", "huo3")
        self.assertTrue(success)
        self.assertGreaterEqual(confidence, 0.99)
        self.assertIsNone(hint_code)
        self.assertIsNone(hint_text)


if __name__ == "__main__":
    unittest.main()
