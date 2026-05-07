import type { PronunciationHint as PronunciationHintData } from '../types/game';

export function PedagogyHint({ hint }: { hint: PronunciationHintData }) {
  return (
    <div
      className="pronunciation-hint pronunciation-hint--pedagogy"
      role="status"
      aria-live="polite"
    >
      <span className="pronunciation-hint-text">{hint.text}</span>
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

/** Centered above dock: original combined pill for dev (checking + heard / pinyin / %). */
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
  if (!hint) return null;
  return (
    <div
      className="pronunciation-hint pronunciation-hint--dev-center-panel"
      role="status"
      aria-live="polite"
    >
      <span className="pronunciation-hint-text pronunciation-hint-text--dev-panel">{hint.text}</span>
      {(hint.transcript || hint.transcriptPinyin) && (
        <span className="pronunciation-hint-ghost">
          heard: {hint.transcript ?? 'audio'}
          {hint.transcriptPinyin ? ` / ${hint.transcriptPinyin}` : ''}
          {Number.isFinite(hint.confidence) ? ` (${Math.round(hint.confidence * 100)}%)` : ''}
        </span>
      )}
    </div>
  );
}
