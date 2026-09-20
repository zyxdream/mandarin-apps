# Realtime Pronunciation Acceptance Rules

These rules describe the conservative target-aware rescue layer used by the realtime game evaluator.
Keep this document, the target-aware scorer helpers, and the matching unit tests in sync.

## Goal

The evaluator should use the expected `hanzi` and `pinyin_raw` as context after ASR transcription. This helps short Mandarin words pass when ASR hears the correct syllable but chooses a wrong tone, homophone, or pinyin-only transcript.

## Rules

- One-syllable targets:
  - Accept only when the transcript has exactly one syllable and its pinyin base exactly matches the expected base, ignoring tone.
  - Accept `kou` and `扣 / kou4` for `口 / kou3`.
  - Reject `gou`, `ke`, `口耳`, and any transcript with extra syllables.
- Two-syllable targets:
  - Accept only when both transcript syllable bases exactly match in order, ignoring tone.
  - Reject missing syllables, extra syllables, and fuzzy base edits.
- Three-or-more-syllable targets:
  - Accept a full-length transcript when all transcript bases exactly match expected bases in order, ignoring tone.
  - Accept one missing syllable only when the remaining transcript bases exactly match an ordered subsequence of the expected bases.
  - Reject extra syllables, two-or-more missing syllables, and fuzzy base edits.
  - Accept `行如`, `如风`, and `xing ru feng` for `行如风 / xing2 ru2 feng1`.
  - Reject `如`, `xing ru zhong`, and extra-syllable phrases for `行如风 / xing2 ru2 feng1`.

## Confidence Floors

- Exact base-match acceptance returns at least `0.82` confidence.
- One-missing-syllable longer-phrase acceptance returns at least `0.78` confidence.
- Rejected extra-syllable transcripts return at most `0.45` confidence.

## Boundaries

- These rules apply only to realtime game evaluation.
- Exact pinyin base means the initial and final match exactly. No edit distance or sound-alike matching is allowed.
- Tone is ignored only inside this target-aware rescue layer because ASR transcript tone is unreliable for short Mandarin utterances.
