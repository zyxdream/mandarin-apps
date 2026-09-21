import re
import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from pronunciation_scoring import (  # noqa: E402
    MIN_SYLLABLE_SCORE,
    PRONUNCIATION_PASS_THRESHOLD,
    align_syllables,
    final_similarity,
    initial_similarity,
    parse_pinyin_phrase,
    parse_pinyin_syllable,
    score_pronunciation,
    tone_similarity,
)


def generated_catalog_pinyin() -> list[str]:
    catalog_path = REPOSITORY_ROOT / "frontend" / "src" / "data" / "scriptSessions.generated.ts"
    catalog_text = catalog_path.read_text(encoding="utf-8")
    return re.findall(r'"pinyinRaw":\s*"([^"]+)"', catalog_text)


class PinyinCanonicalizationTests(unittest.TestCase):
    def assert_syllable(
        self,
        raw: str,
        *,
        initial: str,
        final: str,
        tone: int | None,
    ) -> None:
        syllable = parse_pinyin_syllable(raw)
        self.assertIsNotNone(syllable, raw)
        assert syllable is not None
        self.assertEqual(syllable.initial, initial, raw)
        self.assertEqual(syllable.final, final, raw)
        self.assertEqual(syllable.tone, tone, raw)

    def test_umlaut_spellings_normalize_to_the_same_final(self) -> None:
        for raw in ("nü3", "nv3", "nu:3"):
            with self.subTest(raw=raw):
                self.assert_syllable(raw, initial="n", final="ü", tone=3)

    def test_j_q_x_u_spellings_normalize_to_umlaut_finals(self) -> None:
        cases = {
            "ju1": ("j", "ü"),
            "qu4": ("q", "ü"),
            "xu3": ("x", "ü"),
            "qun2": ("q", "ün"),
            "jue2": ("j", "üe"),
            "xuan3": ("x", "üan"),
        }
        for raw, (initial, final) in cases.items():
            with self.subTest(raw=raw):
                self.assert_syllable(raw, initial=initial, final=final, tone=int(raw[-1]))

    def test_y_and_w_spellings_normalize_to_underlying_finals(self) -> None:
        cases = {
            "yi1": "i",
            "ya1": "ia",
            "you3": "iou",
            "yin1": "in",
            "ying1": "ing",
            "yong3": "iong",
            "yu2": "ü",
            "yue4": "üe",
            "yuan2": "üan",
            "yun2": "ün",
            "wu3": "u",
            "wa1": "ua",
            "wei4": "uei",
            "wen2": "uen",
            "weng1": "ueng",
        }
        for raw, final in cases.items():
            with self.subTest(raw=raw):
                self.assert_syllable(raw, initial="", final=final, tone=int(raw[-1]))

    def test_abbreviated_compound_finals_are_expanded(self) -> None:
        cases = {
            "liu3": ("l", "iou"),
            "gui4": ("g", "uei"),
            "lun2": ("l", "uen"),
        }
        for raw, (initial, final) in cases.items():
            with self.subTest(raw=raw):
                self.assert_syllable(raw, initial=initial, final=final, tone=int(raw[-1]))

    def test_missing_tone_is_unknown_and_tone_five_is_neutral(self) -> None:
        self.assert_syllable("kou", initial="k", final="ou", tone=None)
        self.assert_syllable("de5", initial="d", final="e", tone=5)
        self.assert_syllable("ê2", initial="", final="ê", tone=2)
        self.assertIsNone(tone_similarity(3, None))
        self.assertIsNone(tone_similarity(None, 5))
        self.assertEqual(tone_similarity(5, 5), 1.0)

    def test_invalid_tokens_are_not_pinyin(self) -> None:
        for raw in ("", "4", "123", "hello!", "ma6"):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_pinyin_syllable(raw))

        for phrase in ("ma6", "ma1 4", "ma1 hello"):
            with self.subTest(phrase=phrase):
                self.assertEqual(parse_pinyin_phrase(phrase), [])


class PhonologicalFeatureSimilarityTests(unittest.TestCase):
    def test_initial_similarity_table_is_symmetric(self) -> None:
        cases = [
            ("s", "sh", 0.80),
            ("z", "zh", 0.80),
            ("c", "ch", 0.80),
            ("b", "p", 0.75),
            ("d", "t", 0.75),
            ("g", "k", 0.75),
            ("j", "q", 0.75),
            ("z", "c", 0.75),
            ("zh", "ch", 0.75),
            ("n", "l", 0.65),
            ("j", "x", 0.50),
            ("q", "x", 0.50),
            ("z", "s", 0.50),
            ("c", "s", 0.50),
            ("zh", "sh", 0.50),
            ("ch", "sh", 0.50),
            ("p", "ch", 0.00),
        ]
        for left, right, expected in cases:
            with self.subTest(left=left, right=right):
                self.assertAlmostEqual(initial_similarity(left, right), expected)
                self.assertAlmostEqual(initial_similarity(right, left), expected)

    def test_exact_initials_score_one(self) -> None:
        initials = " b p m f d t n l g k h j q x zh ch sh r z c s".split(" ")
        for initial in initials:
            with self.subTest(initial=initial):
                self.assertEqual(initial_similarity(initial, initial), 1.0)

    def test_final_similarity_uses_medial_nucleus_and_coda_features(self) -> None:
        cases = [
            ("in", "ing", 0.91),
            ("i", "ü", 0.825),
            ("o", "u", 0.825),
            ("u", "ü", 0.725),
            ("e", "o", 0.675),
            ("a", "o", 0.650),
            ("a", "e", 0.625),
            ("a", "i", 0.250),
        ]
        for left, right, expected in cases:
            with self.subTest(left=left, right=right):
                self.assertAlmostEqual(final_similarity(left, right), expected)
                self.assertAlmostEqual(final_similarity(right, left), expected)

    def test_unknown_nonstandard_finals_have_no_fuzzy_fallback(self) -> None:
        self.assertEqual(final_similarity("not-a-final", "a"), 0.0)
        self.assertEqual(final_similarity("a", "not-a-final"), 0.0)

    def test_tone_similarity_table_is_symmetric(self) -> None:
        cases = [
            (2, 3, 0.60),
            (1, 2, 0.35),
            (3, 4, 0.30),
            (1, 5, 0.25),
            (2, 5, 0.25),
            (3, 5, 0.25),
            (4, 5, 0.25),
            (1, 3, 0.20),
            (2, 4, 0.20),
            (1, 4, 0.15),
        ]
        for left, right, expected in cases:
            with self.subTest(left=left, right=right):
                self.assertAlmostEqual(tone_similarity(left, right), expected)
                self.assertAlmostEqual(tone_similarity(right, left), expected)

    def test_exact_lexical_and_neutral_tones_score_one(self) -> None:
        for tone in range(1, 6):
            with self.subTest(tone=tone):
                self.assertEqual(tone_similarity(tone, tone), 1.0)


class SyllableAlignmentTests(unittest.TestCase):
    def alignment_statuses(self, expected: str, actual: str) -> list[str]:
        return [
            alignment.status
            for alignment in align_syllables(
                parse_pinyin_phrase(expected),
                parse_pinyin_phrase(actual),
            )
        ]

    def test_missing_syllables_align_at_beginning_middle_and_end(self) -> None:
        cases = [
            ("ma1 ba2 la3", "ba2 la3", ["missing", "matched", "matched"]),
            ("ma1 ba2 la3", "ma1 la3", ["matched", "missing", "matched"]),
            ("ma1 ba2 la3", "ma1 ba2", ["matched", "matched", "missing"]),
        ]
        for expected, actual, statuses in cases:
            with self.subTest(expected=expected, actual=actual):
                self.assertEqual(self.alignment_statuses(expected, actual), statuses)

    def test_extra_syllables_align_at_beginning_middle_and_end(self) -> None:
        cases = [
            ("ma1 ba2", "la3 ma1 ba2", ["extra", "matched", "matched"]),
            ("ma1 ba2", "ma1 la3 ba2", ["matched", "extra", "matched"]),
            ("ma1 ba2", "ma1 ba2 la3", ["matched", "matched", "extra"]),
        ]
        for expected, actual, statuses in cases:
            with self.subTest(expected=expected, actual=actual):
                self.assertEqual(self.alignment_statuses(expected, actual), statuses)

    def test_ties_favor_the_earliest_match(self) -> None:
        self.assertEqual(
            self.alignment_statuses("ma1 ma1", "ma1"),
            ["matched", "missing"],
        )


class PronunciationScoreTests(unittest.TestCase):
    def assert_score_is_bounded(self, score: object) -> None:
        for field in (
            "initial",
            "final",
            "completeness",
            "pronunciation",
            "confidence",
            "minimum_syllable_score",
        ):
            value = getattr(score, field)
            self.assertGreaterEqual(value, 0.0, field)
            self.assertLessEqual(value, 1.0, field)
        for field in ("tone_text", "tone_contour", "tone"):
            value = getattr(score, field)
            if value is not None:
                self.assertGreaterEqual(value, 0.0, field)
                self.assertLessEqual(value, 1.0, field)

    def test_threshold_constants_match_the_acceptance_policy(self) -> None:
        self.assertEqual(PRONUNCIATION_PASS_THRESHOLD, 0.82)
        self.assertEqual(MIN_SYLLABLE_SCORE, 0.60)

    def test_jin_is_close_enough_to_jing_in_a_two_syllable_word(self) -> None:
        score = score_pronunciation("jing3 li3", "jin3 li3")
        self.assertAlmostEqual(score.confidence, 0.97975)
        self.assertTrue(score.passed)

    def test_cha_for_pa_is_close_enough_only_when_averaged_with_correct_shu(self) -> None:
        phrase_score = score_pronunciation("pa2 shu4", "cha2 shu4")
        self.assertAlmostEqual(phrase_score.confidence, 0.825)
        self.assertTrue(phrase_score.passed)

        isolated_score = score_pronunciation("pa2", "cha2")
        self.assertAlmostEqual(isolated_score.confidence, 0.65)
        self.assertFalse(isolated_score.passed)

    def test_missing_and_extra_syllables_never_pass(self) -> None:
        cases = [
            ("ma1 ba2 la3", "ba2 la3", 2 / 3),
            ("ma1 ba2 la3", "ma1 la3", 2 / 3),
            ("ma1 ba2 la3", "ma1 ba2", 2 / 3),
            ("ma1 ba2", "la3 ma1 ba2", 2 / 3),
            ("ma1 ba2", "ma1 la3 ba2", 2 / 3),
            ("ma1 ba2", "ma1 ba2 la3", 2 / 3),
        ]
        for expected, actual, completeness in cases:
            with self.subTest(expected=expected, actual=actual):
                score = score_pronunciation(expected, actual)
                self.assertAlmostEqual(score.completeness, completeness)
                self.assertFalse(score.passed)

    def test_unknown_tone_is_excluded_instead_of_treated_as_neutral(self) -> None:
        unknown = score_pronunciation("kou3", "kou")
        neutral = score_pronunciation("kou3", "kou5")

        self.assertIsNone(unknown.tone_text)
        self.assertIsNone(unknown.tone)
        self.assertEqual(unknown.confidence, 1.0)
        self.assertTrue(unknown.passed)

        self.assertEqual(neutral.tone_text, 0.25)
        self.assertEqual(neutral.tone, 0.25)
        self.assertLess(neutral.confidence, unknown.confidence)

    def test_unknown_tone_is_renormalized_per_syllable(self) -> None:
        score = score_pronunciation("pa1 ba2", "cha ba2")

        self.assertAlmostEqual(score.confidence, 0.78125)
        self.assertFalse(score.passed)

    def test_acoustic_tone_is_averaged_with_text_tone(self) -> None:
        score = score_pronunciation("ma1", "ma4", acoustic_tone_score=0.85)
        self.assertEqual(score.tone_text, 0.15)
        self.assertEqual(score.tone_contour, 0.85)
        self.assertEqual(score.tone, 0.50)

    def test_acoustic_tone_cannot_bypass_the_per_syllable_floor(self) -> None:
        score = score_pronunciation(
            "pa1 ma1 ma1",
            "cha1 ma1 ma1",
            acoustic_tone_score=0.40,
        )

        self.assertGreater(score.confidence, PRONUNCIATION_PASS_THRESHOLD)
        self.assertAlmostEqual(score.minimum_syllable_score, 0.59)
        self.assertFalse(score.passed)

    def test_acoustic_contours_are_applied_to_their_own_syllables(self) -> None:
        per_syllable = score_pronunciation(
            "pa1 ma1 ma1",
            "cha1 ma1 ma1",
            acoustic_tone_scores=(0.40, 1.0, 1.0),
        )
        phrase_average_only = score_pronunciation(
            "pa1 ma1 ma1",
            "cha1 ma1 ma1",
            acoustic_tone_score=0.80,
        )

        self.assertAlmostEqual(per_syllable.tone_contour, 0.80)
        self.assertEqual(per_syllable.aligned_tone_contour_scores, (0.40, 1.0, 1.0))
        self.assertAlmostEqual(per_syllable.minimum_syllable_score, 0.59)
        self.assertFalse(per_syllable.passed)
        self.assertTrue(phrase_average_only.passed)

    def test_pass_threshold_uses_unrounded_confidence(self) -> None:
        below = score_pronunciation("ma1", "ma4", acoustic_tone_score=0.046)
        boundary = score_pronunciation("ma1", "ma4", acoustic_tone_score=0.05)

        self.assertEqual(round(below.confidence, 3), 0.82)
        self.assertFalse(below.passed)
        self.assertAlmostEqual(boundary.confidence, PRONUNCIATION_PASS_THRESHOLD)
        self.assertTrue(boundary.passed)

    def test_every_score_component_stays_in_range(self) -> None:
        for expected, actual in (
            ("jing3 li3", "jin3 li3"),
            ("pa2 shu4", "cha2 shu4"),
            ("ma1 ba2", "ma4"),
            ("nü3", "lu4 zi5"),
            ("kou3", "kou"),
        ):
            with self.subTest(expected=expected, actual=actual):
                self.assert_score_is_bounded(score_pronunciation(expected, actual))

    def test_every_generated_target_has_supported_phonological_features(self) -> None:
        target_phrases = generated_catalog_pinyin()
        self.assertGreaterEqual(len(target_phrases), 200)

        initials: set[str] = set()
        finals: set[str] = set()
        parsed_syllable_count = 0
        raw_syllable_count = 0

        for phrase in target_phrases:
            with self.subTest(phrase=phrase):
                syllables = parse_pinyin_phrase(phrase)
                raw_syllable_count += len(phrase.split())
                parsed_syllable_count += len(syllables)
                self.assertEqual(len(syllables), len(phrase.split()))

                exact_score = score_pronunciation(phrase, phrase)
                self.assertTrue(exact_score.passed)
                self.assertEqual(exact_score.confidence, 1.0)
                self.assertEqual(exact_score.completeness, 1.0)

                initials.update(syllable.initial for syllable in syllables)
                finals.update(syllable.final for syllable in syllables)

        self.assertEqual(parsed_syllable_count, raw_syllable_count)

        for initial in initials:
            self.assertEqual(initial_similarity(initial, initial), 1.0, initial)
        for final in finals:
            self.assertEqual(final_similarity(final, final), 1.0, final)

        for left in initials:
            for right in initials:
                with self.subTest(kind="initial", left=left, right=right):
                    forward = initial_similarity(left, right)
                    reverse = initial_similarity(right, left)
                    self.assertGreaterEqual(forward, 0.0)
                    self.assertLessEqual(forward, 1.0)
                    self.assertEqual(forward, reverse)

        for left in finals:
            for right in finals:
                with self.subTest(kind="final", left=left, right=right):
                    forward = final_similarity(left, right)
                    reverse = final_similarity(right, left)
                    self.assertGreaterEqual(forward, 0.0)
                    self.assertLessEqual(forward, 1.0)
                    self.assertEqual(forward, reverse)


if __name__ == "__main__":
    unittest.main()
