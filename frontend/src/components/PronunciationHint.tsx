import type { PronunciationHint as PronunciationHintData } from '../types/game';

const HINT_CONTEXT_LABELS: Record<string, string> = {
  tone_flat: 'Tone 1',
  tone_rise: 'Tone 2',
  tone_dip: 'Tone 3',
  tone_drop: 'Tone 4',
  tone_light: 'Neutral tone',
  initial_curl: 'zh/ch/sh/r',
  initial_forward: 'z/c/s',
  initial_smile: 'j/q/x',
  initial_air: 'p/t/k',
  initial_lip: 'b/m/f',
  final_nose_ng: 'ang/eng/ing/ong',
  final_n: 'an/en/in/un',
  final_round_lips: 'ü/üe',
  final_open: 'a/ai/ao/an/ang',
  final_round_mouth: 'uo/ou/u',
  missing_beat: 'Missing beat',
  extra_beat: 'Extra beat',
  nice_try_again: 'Try again',
  too_quiet: 'Volume',
  try_again_clearer: 'Clarity',
  heard_correct: 'Great',
  heard_retry: 'Try again',
};

function formatTeachingHint(hint: PronunciationHintData): string {
  const label = HINT_CONTEXT_LABELS[hint.code];
  if (!label) return hint.text;
  return `${label}: ${hint.text}`;
}

export function PedagogyHint({ hint }: { hint: PronunciationHintData }) {
  return (
    <div
      className="pronunciation-hint pronunciation-hint--pedagogy"
      role="status"
      aria-live="polite"
    >
      <span className="pronunciation-hint-text">{formatTeachingHint(hint)}</span>
    </div>
  );
}

export function EvaluatingStatus() {
  return (
    <div className="evaluating-status" role="status" aria-live="polite">
      <span className="evaluating-status-text">Checking pronunciation…</span>
    </div>
  );
}

/** Centered above dock: dev-only checking + heard / pinyin / confidence details. */
export function DevEvalCenterPanel({
  isEvaluating,
  hint,
}: {
  isEvaluating: boolean;
  hint: PronunciationHintData | null;
}) {
  if (isEvaluating) {
    return (
      <div
        className="pronunciation-hint pronunciation-hint--checking pronunciation-hint--dev-center-panel"
        role="status"
        aria-live="polite"
      >
        <span className="pronunciation-hint-text pronunciation-hint-text--dev-panel">
          ...Checking pronunciation
        </span>
      </div>
    );
  }
  if (!hint || (!hint.transcript && !hint.transcriptPinyin)) return null;
  return (
    <div
      className="pronunciation-hint pronunciation-hint--dev-center-panel"
      role="status"
      aria-live="polite"
    >
      <span className="pronunciation-hint-ghost">
        heard: {hint.transcript ?? 'audio'}
        {hint.transcriptPinyin ? ` / ${hint.transcriptPinyin}` : ''}
        {Number.isFinite(hint.confidence) ? ` (${Math.round(hint.confidence * 100)}%)` : ''}
      </span>
    </div>
  );
}
