import type { PronunciationHint as PronunciationHintData } from '../types/game';

interface PronunciationHintProps {
  hint: PronunciationHintData | null;
}

export function PronunciationHint({ hint }: PronunciationHintProps) {
  if (!hint) return null;
  const checking = hint.code === 'checking';

  return (
    <div
      className={`pronunciation-hint${checking ? ' pronunciation-hint--checking' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="pronunciation-hint-text">{hint.text}</span>
      {hint.transcript && (
        <span className="pronunciation-hint-ghost">heard: {hint.transcript}</span>
      )}
    </div>
  );
}
