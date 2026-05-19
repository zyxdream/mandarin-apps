import type { PronunciationHint as PronunciationHintData } from '../types/game';
import { formatTeachingHint } from '../engine/hintTextFormat';

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
