"""Deterministic, pinyin-only Mandarin pronunciation scoring.

This module deliberately has no web-framework or ASR dependencies.  It scores
the pinyin produced by an upstream recognizer against the target pinyin; it is
therefore tolerant of some transcription ambiguity, but is not a replacement
for direct acoustic pronunciation assessment.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from statistics import mean
from typing import Literal, Sequence


PRONUNCIATION_PASS_THRESHOLD = 0.82
MIN_SYLLABLE_SCORE = 0.60

INITIAL_WEIGHT = 0.35
FINAL_WEIGHT = 0.45
TONE_WEIGHT = 0.20
GAP_COST = 1.0


_INITIALS = (
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
)

_PINYIN_TOKEN_RE = re.compile(
    r"[a-zA-ZüÜêÊvV:\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8"
    r"\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9"
    r"\u01d6\u01d8\u01da\u01dc]+[1-5]?"
)

_TONE_MARKS: dict[str, tuple[str, int]] = {
    "ā": ("a", 1),
    "á": ("a", 2),
    "ǎ": ("a", 3),
    "à": ("a", 4),
    "ē": ("e", 1),
    "é": ("e", 2),
    "ě": ("e", 3),
    "è": ("e", 4),
    "ī": ("i", 1),
    "í": ("i", 2),
    "ǐ": ("i", 3),
    "ì": ("i", 4),
    "ō": ("o", 1),
    "ó": ("o", 2),
    "ǒ": ("o", 3),
    "ò": ("o", 4),
    "ū": ("u", 1),
    "ú": ("u", 2),
    "ǔ": ("u", 3),
    "ù": ("u", 4),
    "ǖ": ("ü", 1),
    "ǘ": ("ü", 2),
    "ǚ": ("ü", 3),
    "ǜ": ("ü", 4),
}

_Y_FINALS = {
    "yi": "i",
    "ya": "ia",
    "yo": "io",
    "ye": "ie",
    "yai": "iai",
    "yao": "iao",
    "you": "iou",
    "yan": "ian",
    "yin": "in",
    "yang": "iang",
    "ying": "ing",
    "yong": "iong",
    "yu": "ü",
    "yue": "üe",
    "yuan": "üan",
    "yun": "ün",
}

_W_FINALS = {
    "wu": "u",
    "wa": "ua",
    "wo": "uo",
    "wai": "uai",
    "wei": "uei",
    "wan": "uan",
    "wen": "uen",
    "wang": "uang",
    "weng": "ueng",
}

# (medial, nucleus, coda). Orthographic contractions are expanded before this
# table is used, so equivalent spellings receive identical feature scores.
_FINAL_FEATURES: dict[str, tuple[str, str, str]] = {
    "a": ("", "a", ""),
    "o": ("", "o", ""),
    "e": ("", "e", ""),
    "ê": ("", "ê", ""),
    "ai": ("", "a", "i"),
    "ei": ("", "e", "i"),
    "ao": ("", "a", "o"),
    "ou": ("", "o", "u"),
    "an": ("", "a", "n"),
    "en": ("", "e", "n"),
    "ang": ("", "a", "ng"),
    "eng": ("", "e", "ng"),
    "ong": ("", "o", "ng"),
    "er": ("", "er", ""),
    "i": ("", "i", ""),
    "ia": ("i", "a", ""),
    "io": ("i", "o", ""),
    "ie": ("i", "e", ""),
    "iai": ("i", "a", "i"),
    "iao": ("i", "a", "o"),
    "iou": ("i", "o", "u"),
    "ian": ("i", "a", "n"),
    "in": ("", "i", "n"),
    "iang": ("i", "a", "ng"),
    "ing": ("", "i", "ng"),
    "iong": ("i", "o", "ng"),
    "u": ("", "u", ""),
    "ua": ("u", "a", ""),
    "uo": ("u", "o", ""),
    "uai": ("u", "a", "i"),
    "uei": ("u", "e", "i"),
    "uan": ("u", "a", "n"),
    "uen": ("u", "e", "n"),
    "uang": ("u", "a", "ng"),
    "ueng": ("u", "e", "ng"),
    "ü": ("", "ü", ""),
    "üe": ("ü", "e", ""),
    "üan": ("ü", "a", "n"),
    "ün": ("", "ü", "n"),
}


@dataclass(frozen=True, slots=True)
class PinyinSyllable:
    raw: str
    base: str
    initial: str
    final: str
    tone: int | None


@dataclass(frozen=True, slots=True)
class SyllableComparison:
    initial: float
    final: float
    tone: float | None
    score: float
    issue: str


AlignmentStatus = Literal["matched", "missing", "extra"]


@dataclass(frozen=True, slots=True)
class SyllableAlignment:
    expected_index: int | None
    actual_index: int | None
    expected: PinyinSyllable | None
    actual: PinyinSyllable | None
    status: AlignmentStatus
    comparison: SyllableComparison | None


@dataclass(frozen=True, slots=True)
class PronunciationScore:
    initial: float
    final: float
    tone_text: float | None
    tone_contour: float | None
    tone: float | None
    completeness: float
    pronunciation: float
    confidence: float
    minimum_syllable_score: float
    passed: bool
    alignments: tuple[SyllableAlignment, ...]
    aligned_tone_contour_scores: tuple[float | None, ...]
    effective_tone_scores: tuple[float | None, ...]
    effective_syllable_scores: tuple[float, ...]
    effective_issues: tuple[str, ...]


def _canonicalize_marked_pinyin(raw: str) -> tuple[str, int | None] | None:
    text = raw.strip().lower().replace("u:", "ü").replace("v", "ü")
    marked_tones: set[int] = set()
    converted: list[str] = []
    for character in text:
        marked = _TONE_MARKS.get(character)
        if marked is None:
            converted.append(character)
        else:
            vowel, tone = marked
            converted.append(vowel)
            marked_tones.add(tone)

    if len(marked_tones) > 1:
        return None
    marked_tone = next(iter(marked_tones), None)
    return "".join(converted), marked_tone


def _canonicalize_initial_and_final(base: str) -> tuple[str, str] | None:
    if base in _Y_FINALS:
        return "", _Y_FINALS[base]
    if base in _W_FINALS:
        return "", _W_FINALS[base]

    initial = ""
    for candidate in _INITIALS:
        if base.startswith(candidate):
            initial = candidate
            break
    final = base[len(initial) :]

    if initial in {"j", "q", "x"} and final.startswith("u"):
        final = "ü" + final[1:]
    elif final == "iu":
        final = "iou"
    elif final == "ui":
        final = "uei"
    elif final == "un":
        final = "uen"

    if not final:
        return None
    return initial, final


def parse_pinyin_syllable(raw: str) -> PinyinSyllable | None:
    """Parse one numbered or tone-marked syllable into canonical features.

    A missing tone remains ``None``. It is not silently converted to neutral
    tone 5. Nonstandard finals are rejected here, while ``final_similarity``
    also safely returns zero if it is called directly with unknown finals.
    """

    marked = _canonicalize_marked_pinyin(raw)
    if marked is None:
        return None
    normalized, marked_tone = marked

    numeric_match = re.search(r"([1-5])$", normalized)
    numeric_tone = int(numeric_match.group(1)) if numeric_match else None
    if numeric_tone is not None:
        normalized = normalized[:-1]
    if marked_tone is not None and numeric_tone is not None and marked_tone != numeric_tone:
        return None
    tone = numeric_tone if numeric_tone is not None else marked_tone

    if not re.fullmatch(r"[a-züê]+", normalized):
        return None
    canonical = _canonicalize_initial_and_final(normalized)
    if canonical is None:
        return None
    initial, final = canonical
    if final not in _FINAL_FEATURES:
        return None
    return PinyinSyllable(
        raw=raw,
        base=f"{initial}{final}",
        initial=initial,
        final=final,
        tone=tone,
    )


def parse_pinyin_phrase(raw: str) -> list[PinyinSyllable]:
    """Extract every valid pinyin syllable from a phrase, in order."""

    syllables: list[PinyinSyllable] = []
    cursor = 0
    for match in _PINYIN_TOKEN_RE.finditer(raw):
        unmatched = raw[cursor : match.start()]
        if re.search(r"[a-zA-Z0-9üÜêÊvV:]", unmatched):
            return []
        parsed = parse_pinyin_syllable(match.group(0))
        if parsed is None:
            return []
        syllables.append(parsed)
        cursor = match.end()
    if re.search(r"[a-zA-Z0-9üÜêÊvV:]", raw[cursor:]):
        return []
    return syllables


def _unordered_pair(expected: str | int, actual: str | int) -> frozenset[str | int]:
    return frozenset((expected, actual))


_RETROFLEX_PAIRS = {
    frozenset(("z", "zh")),
    frozenset(("c", "ch")),
    frozenset(("s", "sh")),
}
_ASPIRATION_PAIRS = {
    frozenset(("b", "p")),
    frozenset(("d", "t")),
    frozenset(("g", "k")),
    frozenset(("j", "q")),
    frozenset(("z", "c")),
    frozenset(("zh", "ch")),
}
_RELATED_INITIAL_PAIRS = {
    frozenset(("j", "x")),
    frozenset(("q", "x")),
    frozenset(("z", "s")),
    frozenset(("c", "s")),
    frozenset(("zh", "sh")),
    frozenset(("ch", "sh")),
}


def initial_similarity(expected: str, actual: str) -> float:
    """Return a symmetric phonological similarity for two initials."""

    if expected == actual:
        return 1.0
    pair = _unordered_pair(expected, actual)
    if pair in _RETROFLEX_PAIRS:
        return 0.80
    if pair in _ASPIRATION_PAIRS:
        return 0.75
    if pair == frozenset(("n", "l")):
        return 0.65
    if pair in _RELATED_INITIAL_PAIRS:
        return 0.50
    return 0.0


def _medial_similarity(expected: str, actual: str) -> float:
    if expected == actual:
        return 1.0
    if _unordered_pair(expected, actual) == frozenset(("u", "ü")):
        return 0.45
    return 0.0


_NUCLEUS_SCORES: dict[frozenset[str], float] = {
    frozenset(("i", "ü")): 0.65,
    frozenset(("o", "u")): 0.65,
    frozenset(("u", "ü")): 0.45,
    frozenset(("e", "o")): 0.35,
    frozenset(("a", "o")): 0.30,
    frozenset(("a", "e")): 0.25,
}


def _nucleus_similarity(expected: str, actual: str) -> float:
    if expected == actual:
        return 1.0
    return _NUCLEUS_SCORES.get(frozenset((expected, actual)), 0.0)


def _coda_similarity(expected: str, actual: str) -> float:
    if expected == actual:
        return 1.0
    if _unordered_pair(expected, actual) == frozenset(("n", "ng")):
        return 0.70
    return 0.0


def final_similarity(expected: str, actual: str) -> float:
    """Return a feature-based similarity for two canonical finals."""

    if expected == actual:
        return 1.0
    expected_features = _FINAL_FEATURES.get(expected)
    actual_features = _FINAL_FEATURES.get(actual)
    if expected_features is None or actual_features is None:
        return 0.0

    expected_medial, expected_nucleus, expected_coda = expected_features
    actual_medial, actual_nucleus, actual_coda = actual_features
    nucleus_score = _nucleus_similarity(expected_nucleus, actual_nucleus)
    score = (
        0.20 * _medial_similarity(expected_medial, actual_medial)
        + 0.50 * nucleus_score
        + 0.30 * _coda_similarity(expected_coda, actual_coda)
    )
    if nucleus_score == 0.0:
        score = min(score, 0.25)
    return score


_TONE_SCORES: dict[frozenset[int], float] = {
    frozenset((2, 3)): 0.60,
    frozenset((1, 2)): 0.35,
    frozenset((3, 4)): 0.30,
    frozenset((1, 3)): 0.20,
    frozenset((2, 4)): 0.20,
    frozenset((1, 4)): 0.15,
}


def tone_similarity(expected: int | None, actual: int | None) -> float | None:
    """Return tone similarity, or ``None`` when either tone is unknown."""

    if expected is None or actual is None:
        return None
    if expected == actual:
        return 1.0
    if expected == 5 or actual == 5:
        return 0.25
    return _TONE_SCORES.get(frozenset((expected, actual)), 0.0)


def _weighted_syllable_score(initial: float, final: float, tone: float | None) -> float:
    if tone is None:
        return (
            INITIAL_WEIGHT * initial + FINAL_WEIGHT * final
        ) / (INITIAL_WEIGHT + FINAL_WEIGHT)
    return INITIAL_WEIGHT * initial + FINAL_WEIGHT * final + TONE_WEIGHT * tone


def _largest_loss_issue(initial: float, final: float, tone: float | None) -> str:
    losses = (
        (INITIAL_WEIGHT * (1.0 - initial), "initial_mismatch"),
        (FINAL_WEIGHT * (1.0 - final), "final_mismatch"),
        (
            TONE_WEIGHT * (1.0 - tone) if tone is not None else -1.0,
            "tone_mismatch",
        ),
    )
    largest_loss, issue = max(losses, key=lambda item: item[0])
    return issue if largest_loss > 0.0 else ""


def compare_syllables(expected: PinyinSyllable, actual: PinyinSyllable) -> SyllableComparison:
    initial_score = initial_similarity(expected.initial, actual.initial)
    final_score = final_similarity(expected.final, actual.final)
    tone_score = tone_similarity(expected.tone, actual.tone)
    score = _weighted_syllable_score(initial_score, final_score, tone_score)

    return SyllableComparison(
        initial=initial_score,
        final=final_score,
        tone=tone_score,
        score=score,
        issue=_largest_loss_issue(initial_score, final_score, tone_score),
    )


@dataclass(frozen=True, slots=True)
class _AlignmentPath:
    cost: float
    gaps: int
    paired_index_sum: int
    operation_ranks: tuple[int, ...]
    alignments: tuple[SyllableAlignment, ...]

    @property
    def ordering_key(self) -> tuple[float, int, int, tuple[int, ...]]:
        # Rounding makes mathematically equivalent floating-point paths tie in a
        # predictable way. Fewer gaps and earlier pairings then win.
        return (round(self.cost, 12), self.gaps, self.paired_index_sum, self.operation_ranks)


def align_syllables(
    expected: Sequence[PinyinSyllable],
    actual: Sequence[PinyinSyllable],
) -> list[SyllableAlignment]:
    """Globally align syllables with deterministic tie-breaking."""

    rows = len(expected) + 1
    columns = len(actual) + 1
    table: list[list[_AlignmentPath | None]] = [[None] * columns for _ in range(rows)]
    table[0][0] = _AlignmentPath(0.0, 0, 0, (), ())

    for expected_count in range(rows):
        for actual_count in range(columns):
            if expected_count == 0 and actual_count == 0:
                continue
            candidates: list[_AlignmentPath] = []

            if expected_count and actual_count:
                previous = table[expected_count - 1][actual_count - 1]
                assert previous is not None
                comparison = compare_syllables(
                    expected[expected_count - 1],
                    actual[actual_count - 1],
                )
                alignment = SyllableAlignment(
                    expected_index=expected_count - 1,
                    actual_index=actual_count - 1,
                    expected=expected[expected_count - 1],
                    actual=actual[actual_count - 1],
                    status="matched",
                    comparison=comparison,
                )
                candidates.append(
                    _AlignmentPath(
                        cost=previous.cost + (1.0 - comparison.score),
                        gaps=previous.gaps,
                        paired_index_sum=(
                            previous.paired_index_sum + expected_count - 1 + actual_count - 1
                        ),
                        operation_ranks=previous.operation_ranks + (0,),
                        alignments=previous.alignments + (alignment,),
                    )
                )

            if expected_count:
                previous = table[expected_count - 1][actual_count]
                assert previous is not None
                alignment = SyllableAlignment(
                    expected_index=expected_count - 1,
                    actual_index=None,
                    expected=expected[expected_count - 1],
                    actual=None,
                    status="missing",
                    comparison=None,
                )
                candidates.append(
                    _AlignmentPath(
                        cost=previous.cost + GAP_COST,
                        gaps=previous.gaps + 1,
                        paired_index_sum=previous.paired_index_sum,
                        operation_ranks=previous.operation_ranks + (2,),
                        alignments=previous.alignments + (alignment,),
                    )
                )

            if actual_count:
                previous = table[expected_count][actual_count - 1]
                assert previous is not None
                alignment = SyllableAlignment(
                    expected_index=None,
                    actual_index=actual_count - 1,
                    expected=None,
                    actual=actual[actual_count - 1],
                    status="extra",
                    comparison=None,
                )
                candidates.append(
                    _AlignmentPath(
                        cost=previous.cost + GAP_COST,
                        gaps=previous.gaps + 1,
                        paired_index_sum=previous.paired_index_sum,
                        operation_ranks=previous.operation_ranks + (1,),
                        alignments=previous.alignments + (alignment,),
                    )
                )

            table[expected_count][actual_count] = min(
                candidates,
                key=lambda candidate: candidate.ordering_key,
            )

    result = table[-1][-1]
    assert result is not None
    return list(result.alignments)


def _bounded_optional_score(score: float | None) -> float | None:
    if score is None or not math.isfinite(score):
        return None
    return min(1.0, max(0.0, score))


def score_pronunciation(
    expected_raw: str,
    actual_raw: str,
    acoustic_tone_score: float | None = None,
    acoustic_tone_scores: Sequence[float | None] | None = None,
) -> PronunciationScore:
    """Score actual pinyin against expected pinyin without consulting Hanzi."""

    expected = parse_pinyin_phrase(expected_raw)
    actual = parse_pinyin_phrase(actual_raw)
    alignments = align_syllables(expected, actual)
    comparisons = [
        alignment.comparison
        for alignment in alignments
        if alignment.status == "matched" and alignment.comparison is not None
    ]

    initial_score = mean(comparison.initial for comparison in comparisons) if comparisons else 0.0
    final_score = mean(comparison.final for comparison in comparisons) if comparisons else 0.0
    tone_values = [comparison.tone for comparison in comparisons if comparison.tone is not None]
    tone_text_score = mean(tone_values) if tone_values else None
    provided_contours = (
        tuple(_bounded_optional_score(score) for score in acoustic_tone_scores)
        if acoustic_tone_scores is not None
        else None
    )
    if provided_contours is None:
        tone_contour_score = _bounded_optional_score(acoustic_tone_score)
    else:
        valid_contours = [score for score in provided_contours if score is not None]
        tone_contour_score = mean(valid_contours) if valid_contours else None

    aligned_tone_contour_scores: list[float | None] = []
    effective_tone_values: list[float] = []
    effective_tone_scores: list[float | None] = []
    effective_syllable_scores: list[float] = []
    effective_issues: list[str] = []
    matched_alignments = [
        alignment
        for alignment in alignments
        if alignment.status == "matched" and alignment.comparison is not None
    ]
    for alignment, comparison in zip(matched_alignments, comparisons):
        if provided_contours is None:
            aligned_contour = tone_contour_score
        elif (
            alignment.expected_index is not None
            and alignment.expected_index < len(provided_contours)
        ):
            aligned_contour = provided_contours[alignment.expected_index]
        else:
            aligned_contour = None
        aligned_tone_contour_scores.append(aligned_contour)
        tone_evidence = [
            score
            for score in (comparison.tone, aligned_contour)
            if score is not None
        ]
        effective_tone = mean(tone_evidence) if tone_evidence else None
        effective_tone_scores.append(effective_tone)
        if effective_tone is not None:
            effective_tone_values.append(effective_tone)
        effective_syllable_score = _weighted_syllable_score(
            comparison.initial,
            comparison.final,
            effective_tone,
        )
        effective_syllable_scores.append(effective_syllable_score)
        effective_issues.append(_largest_loss_issue(
            comparison.initial,
            comparison.final,
            effective_tone,
        ))

    combined_tone_score = mean(effective_tone_values) if effective_tone_values else None
    pronunciation_score = mean(effective_syllable_scores) if effective_syllable_scores else 0.0
    maximum_syllable_count = max(len(expected), len(actual))
    completeness = (
        len(comparisons) / maximum_syllable_count if maximum_syllable_count else 0.0
    )
    confidence = pronunciation_score * completeness
    minimum_syllable_score = min(effective_syllable_scores) if effective_syllable_scores else 0.0
    fully_complete = bool(expected and actual) and math.isclose(
        completeness,
        1.0,
        rel_tol=0.0,
        abs_tol=1e-12,
    )
    passed = (
        fully_complete
        and confidence >= PRONUNCIATION_PASS_THRESHOLD
        and minimum_syllable_score >= MIN_SYLLABLE_SCORE
    )

    return PronunciationScore(
        initial=initial_score,
        final=final_score,
        tone_text=tone_text_score,
        tone_contour=tone_contour_score,
        tone=combined_tone_score,
        completeness=completeness,
        pronunciation=pronunciation_score,
        confidence=confidence,
        minimum_syllable_score=minimum_syllable_score,
        passed=passed,
        alignments=tuple(alignments),
        aligned_tone_contour_scores=tuple(aligned_tone_contour_scores),
        effective_tone_scores=tuple(effective_tone_scores),
        effective_syllable_scores=tuple(effective_syllable_scores),
        effective_issues=tuple(effective_issues),
    )


__all__ = [
    "FINAL_WEIGHT",
    "GAP_COST",
    "INITIAL_WEIGHT",
    "MIN_SYLLABLE_SCORE",
    "PRONUNCIATION_PASS_THRESHOLD",
    "TONE_WEIGHT",
    "PinyinSyllable",
    "PronunciationScore",
    "SyllableAlignment",
    "SyllableComparison",
    "align_syllables",
    "compare_syllables",
    "final_similarity",
    "initial_similarity",
    "parse_pinyin_phrase",
    "parse_pinyin_syllable",
    "score_pronunciation",
    "tone_similarity",
]
