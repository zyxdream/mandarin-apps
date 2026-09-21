import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.evaluate import is_transcript_usable, score_transcript


EXPECTED_SCORE_KEYS = {
    "initial",
    "final",
    "tone_text",
    "tone_contour",
    "tone",
    "completeness",
    "pronunciation",
}


def evaluate(
    transcript: str,
    pinyin_raw: str,
    *,
    hanzi: str = "",
    acoustic_tone: float | None = None,
    acoustic_hint: str | None = None,
    eval_mode: str = "realtime",
):
    acoustic_scores = {"tone_contour": acoustic_tone} if acoustic_tone is not None else None
    return score_transcript(
        transcript,
        hanzi,
        pinyin_raw,
        acoustic_scores,
        acoustic_hint,
        eval_mode=eval_mode,
    )


class PronunciationHintRuleTests(unittest.TestCase):
    def test_largest_initial_loss_uses_expected_initial_hint(self) -> None:
        success, _, _, _, diagnostics, hint_code, hint_text = evaluate(
            "cha2",
            "pa2",
        )

        self.assertFalse(success)
        self.assertEqual(diagnostics[0]["issue"], "initial_mismatch")
        self.assertEqual(hint_code, "initial_air")
        self.assertEqual(hint_text, "p/t/k: More air pop")

    def test_largest_final_loss_uses_expected_final_hint(self) -> None:
        success, _, _, _, diagnostics, hint_code, hint_text = evaluate(
            "fu1",
            "fang1",
        )

        self.assertFalse(success)
        self.assertEqual(diagnostics[0]["issue"], "final_mismatch")
        self.assertEqual(hint_code, "final_nose_ng")
        self.assertEqual(hint_text, "Ending: Nose ending")

    def test_acoustic_tone_hint_is_used_when_it_is_the_largest_loss(self) -> None:
        success, confidence, _, _, _, hint_code, hint_text = evaluate(
            "ma4",
            "ma1",
            acoustic_tone=0.0,
            acoustic_hint="tone_flat",
            eval_mode="practice",
        )

        self.assertFalse(success)
        self.assertLess(confidence, 0.82)
        self.assertEqual(hint_code, "tone_flat")
        self.assertEqual(hint_text, "Tone 1: Laser flat")

    def test_acoustic_evidence_can_make_a_final_the_largest_loss(self) -> None:
        success, confidence, _, _, diagnostics, hint_code, hint_text = evaluate(
            "lai4",
            "lan1",
            acoustic_tone=1.0,
            acoustic_hint="tone_flat",
            eval_mode="practice",
        )

        self.assertFalse(success)
        self.assertAlmostEqual(confidence, 0.78)
        self.assertEqual(diagnostics[0]["tone_text_similarity"], 0.15)
        self.assertEqual(diagnostics[0]["tone_contour_similarity"], 1.0)
        self.assertEqual(diagnostics[0]["tone_similarity"], 0.575)
        self.assertEqual(diagnostics[0]["issue"], "final_mismatch")
        self.assertEqual(hint_code, "final_n")
        self.assertEqual(hint_text, "Ending: Soft N end")

    def test_missing_and_extra_hints_take_priority_over_acoustic_hint(self) -> None:
        missing = evaluate(
            "ma1",
            "ma1 ba2",
            acoustic_tone=0.0,
            acoustic_hint="tone_flat",
            eval_mode="practice",
        )
        extra = evaluate(
            "ma1 ba2",
            "ma1",
            acoustic_tone=0.0,
            acoustic_hint="tone_flat",
            eval_mode="practice",
        )

        self.assertEqual(missing[5], "missing_beat")
        self.assertEqual(missing[6], "Beats: Say every beat")
        self.assertEqual(extra[5], "extra_beat")
        self.assertEqual(extra[6], "Beats: Keep it short")

    def test_unmapped_largest_loss_uses_generic_hint(self) -> None:
        success, _, _, _, _, hint_code, hint_text = evaluate("ma1", "hao3")

        self.assertFalse(success)
        self.assertEqual(hint_code, "nice_try_again")
        self.assertTrue(hint_text.startswith("Tip: "))

    def test_success_returns_no_corrective_hint(self) -> None:
        success, confidence, _, _, _, hint_code, hint_text = evaluate("火", "huo3", hanzi="火")

        self.assertTrue(success)
        self.assertEqual(confidence, 1.0)
        self.assertIsNone(hint_code)
        self.assertIsNone(hint_text)


class PinyinOnlyScoringIntegrationTests(unittest.TestCase):
    def test_numeric_hanzi_transcripts_are_usable_and_score_successfully(self) -> None:
        cases = [
            ("四", "四", "si4"),
            ("十", "十", "shi2"),
            ("十四", "十四", "shi2 si4"),
            ("四十", "四十", "si4 shi2"),
            ("一二三", "一二三", "yi1 er4 san1"),
            ("四五", "四五", "si4 wu3"),
            ("五只", "五只", "wu3 zhi3"),
        ]
        for transcript, hanzi, pinyin_raw in cases:
            with self.subTest(transcript=transcript, hanzi=hanzi):
                self.assertTrue(is_transcript_usable(transcript, pinyin_raw))
                success, confidence, _, scores, _, hint_code, _ = evaluate(
                    transcript,
                    pinyin_raw,
                    hanzi=hanzi,
                )
                self.assertTrue(success)
                self.assertEqual(confidence, 1.0)
                self.assertEqual(set(scores), EXPECTED_SCORE_KEYS)
                self.assertIsNone(hint_code)

    def test_numeric_transcript_safety_rejects_digits_mismatches_and_extras(self) -> None:
        self.assertFalse(is_transcript_usable("4", "si4"))

        cases = [
            ("4", "四", "si4"),
            ("十", "四", "si4"),
            ("四十", "四", "si4"),
        ]
        for transcript, hanzi, pinyin_raw in cases:
            with self.subTest(transcript=transcript):
                success, _, _, _, _, _, _ = evaluate(transcript, pinyin_raw, hanzi=hanzi)
                self.assertFalse(success)

    def test_hanzi_neither_rewards_nor_penalizes_the_same_pronunciation(self) -> None:
        matching_context = evaluate("木", "mu4", hanzi="目")
        unrelated_context = evaluate("木", "mu4", hanzi="完全不同")

        self.assertEqual(matching_context[:6], unrelated_context[:6])
        self.assertTrue(matching_context[0])
        self.assertEqual(matching_context[1], 1.0)
        self.assertNotIn("lexical", matching_context[3])

    def test_exact_hanzi_does_not_override_mismatched_target_pinyin(self) -> None:
        success, confidence, _, _, _, _, _ = evaluate("四", "shi2", hanzi="四")

        self.assertFalse(success)
        self.assertAlmostEqual(confidence, 0.77)

    def test_close_asr_confusions_pass_by_pinyin_features(self) -> None:
        jing = evaluate("锦鲤", "jing3 li3", hanzi="井里")
        pa_shu = evaluate("茶树", "pa2 shu4", hanzi="爬树")

        self.assertTrue(jing[0])
        self.assertAlmostEqual(jing[1], 0.98)
        self.assertTrue(pa_shu[0])
        self.assertAlmostEqual(pa_shu[1], 0.825)

    def test_distant_initial_only_passes_as_part_of_selected_phrase_average(self) -> None:
        isolated = evaluate("cha2", "pa2")
        phrase = evaluate("cha2 shu4", "pa2 shu4")

        self.assertFalse(isolated[0])
        self.assertAlmostEqual(isolated[1], 0.65)
        self.assertTrue(phrase[0])
        self.assertAlmostEqual(phrase[1], 0.825)

    def test_same_pinyin_homophone_gets_a_perfect_score(self) -> None:
        success, confidence, transcript_pinyin, scores, diagnostics, _, _ = evaluate(
            "木",
            "mu4",
            hanzi="目",
        )

        self.assertTrue(success)
        self.assertEqual(confidence, 1.0)
        self.assertEqual(transcript_pinyin, "mu4")
        self.assertEqual(scores["pronunciation"], 1.0)
        self.assertEqual(diagnostics[0]["initial_similarity"], 1.0)

    def test_missing_and_extra_syllables_are_usable_but_never_pass(self) -> None:
        cases = [
            ("行如", "xing2 ru2 feng1", "行如风"),
            ("如风", "xing2 ru2 feng1", "行如风"),
            ("xing2 ru2", "xing2 ru2 feng1", "行如风"),
            ("xing2 ru2 feng1 zhong1", "xing2 ru2 feng1", "行如风"),
        ]
        for transcript, pinyin_raw, hanzi in cases:
            with self.subTest(transcript=transcript):
                self.assertTrue(is_transcript_usable(transcript, pinyin_raw))
                success, _, _, scores, diagnostics, hint_code, _ = evaluate(
                    transcript,
                    pinyin_raw,
                    hanzi=hanzi,
                )
                self.assertFalse(success)
                self.assertLess(scores["completeness"], 1.0)
                self.assertIn(hint_code, {"missing_beat", "extra_beat"})
                self.assertTrue(any(item["alignment"] != "matched" for item in diagnostics))

    def test_alignment_does_not_shift_after_a_missing_middle_syllable(self) -> None:
        _, _, _, _, diagnostics, hint_code, _ = evaluate(
            "ma1 la3",
            "ma1 ba2 la3",
        )

        self.assertEqual(
            [diagnostic["alignment"] for diagnostic in diagnostics],
            ["matched", "missing", "matched"],
        )
        self.assertEqual(hint_code, "missing_beat")

    def test_unknown_tone_is_not_treated_as_neutral_tone(self) -> None:
        unknown = evaluate("kou", "kou3", hanzi="口")
        neutral = evaluate("kou5", "kou3", hanzi="口")

        self.assertTrue(unknown[0])
        self.assertEqual(unknown[1], 1.0)
        self.assertIsNone(unknown[3]["tone_text"])
        self.assertEqual(neutral[3]["tone_text"], 0.25)
        self.assertLess(neutral[1], unknown[1])

    def test_realtime_and_practice_use_the_same_transcript_threshold(self) -> None:
        realtime = evaluate("kou", "kou3", eval_mode="realtime")
        practice = evaluate("kou", "kou3", eval_mode="practice")

        self.assertEqual(realtime[:6], practice[:6])
        self.assertTrue(realtime[0])

    def test_partial_pinyin_usability_no_longer_depends_on_expected_count(self) -> None:
        self.assertTrue(is_transcript_usable("xing2", "xing2 ru2 feng1", eval_mode="realtime"))
        self.assertTrue(is_transcript_usable("xing2", "xing2 ru2 feng1", eval_mode="practice"))
        self.assertFalse(is_transcript_usable("", "xing2 ru2 feng1"))


if __name__ == "__main__":
    unittest.main()
