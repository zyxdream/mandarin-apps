# Pinyin-Only Pronunciation Acceptance Rules

These rules describe the deterministic pronunciation scorer shared by realtime
and practice evaluation. Keep this document, `pronunciation_scoring.py`, and the
scoring regression tests in sync.

## Goal

The expected `pinyin_raw` is the scoring target. Recognized Hanzi is converted
to pinyin, but matching characters never add points, remove points, or bypass a
threshold. This makes homophones and near ASR transcriptions behave according
to their pronunciation instead of their spelling.

This is an ASR-tolerant transcript comparison. It is not a direct acoustic
pronunciation assessment.

## Components

Each aligned syllable is scored from:

- initial similarity: 35%
- final similarity: 45%
- tone similarity: 20%

Initials, final features, and tone pairs use explicit symmetric similarity
tables. Unknown tones are omitted and the initial/final weights are
renormalized. An explicit tone 5 remains a real neutral tone.

Pinyin is canonicalized before comparison, including `ü` spellings, `y`/`w`
orthography, `j`/`q`/`x` plus `u`, and the abbreviated finals `iu`, `ui`, and
`un`.

## Alignment and Completeness

Expected and recognized syllables are globally aligned so a missing syllable
does not shift all later comparisons.

`completeness` is the number of paired syllables divided by the larger of the
expected and recognized syllable counts. Each paired syllable is scored first,
then the phrase confidence is:

```text
syllable = 0.35 * initial + 0.45 * final + 0.20 * tone
pronunciation = mean(paired syllable scores)
confidence = pronunciation * completeness
```

In practice mode, each syllable's effective tone is the mean of available
transcript-tone and that syllable's acoustic-contour evidence. The top-level
`tone_contour` field is the mean of those per-syllable contour scores. If tone
evidence is unavailable for a syllable, only its initial/final weights are used
and renormalized. The top-level component fields are diagnostic means; when
tone availability differs by syllable, `pronunciation` must be read from the
returned value rather than reconstructed from those means. Missing or extra
syllables always fail, even though their partial score and alignment diagnostics
are still returned.

## Acceptance

An utterance passes only when all of these conditions are true:

- confidence is at least `0.82`
- completeness is exactly `1.0`
- every paired syllable scores at least `0.60`
- the transcript contains valid Hanzi or pinyin

The phrase average is intentionally kid-friendly. For example,
`cha2 shu4` can pass for `pa2 shu4` because its scores are approximately
`[0.65, 1.0]`, producing `0.825`. The isolated comparison `cha2` versus `pa2`
still fails at approximately `0.65`.

`jin3 li3` passes for `jing3 li3` because `n` and `ng` are explicitly modeled
as related codas. `shi2` still fails for `si4` because its combined initial and
tone differences keep it below the phrase threshold.

## Hints and Safety Boundaries

- Successful utterances do not receive corrective hints.
- Failed utterances select a hint from the largest weighted phonological loss.
- Missing and extra syllable hints take priority over component hints.
- Standalone Arabic digits remain unusable; the scorer does not guess a spoken
  Hanzi form from a display-form number.
- Hanzi may still be supplied to ASR as recognition context and returned for
  display, but it is not a scoring component.
