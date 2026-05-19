import type { PronunciationHint as PronunciationHintData } from '../types/game.js';

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

const GENERIC_PREFIX_PATTERN = /^(tip|hint|feedback|advice|note)\s*[:：-]\s*/i;
const RETRY_PREFIX_PATTERN = /^(try\s*again|retry)\s*[:：-]\s*/i;
const BEAT_PREFIX_PATTERN = /^(beats?|rhythm)\s*[:：-]\s*/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHintToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s:：,.;!?'"`~\-_/\\|()[\]{}]+/g, '');
}

function stripLeadingPrefix(body: string, label: string): string {
  let current = body.trim();
  if (!current) return '';

  const labelPattern = label
    ? new RegExp(`^${escapeRegExp(label.trim())}\\s*[:：-]\\s*`, 'i')
    : null;

  let changed = true;
  while (changed && current) {
    changed = false;
    const nextByLabel = labelPattern ? current.replace(labelPattern, '').trim() : current;
    if (nextByLabel !== current) {
      current = nextByLabel;
      changed = true;
      continue;
    }
    const nextByGeneric = current.replace(GENERIC_PREFIX_PATTERN, '').trim();
    if (nextByGeneric !== current) {
      current = nextByGeneric;
      changed = true;
      continue;
    }
    const nextByRetry = current.replace(RETRY_PREFIX_PATTERN, '').trim();
    if (nextByRetry !== current) {
      current = nextByRetry;
      changed = true;
      continue;
    }
    const nextByBeat = current.replace(BEAT_PREFIX_PATTERN, '').trim();
    if (nextByBeat !== current) {
      current = nextByBeat;
      changed = true;
    }
  }

  return current.replace(/\s{2,}/g, ' ').trim();
}

export function formatTeachingHint(hint: PronunciationHintData): string {
  const rawText = hint.text.trim();
  if (!rawText) return '';
  const label = HINT_CONTEXT_LABELS[hint.code];
  if (!label) return rawText;

  const trimmedLabel = label.trim();
  const dedupedBody = stripLeadingPrefix(rawText, trimmedLabel);

  if (hint.code === 'heard_correct') {
    if (!dedupedBody) return trimmedLabel;
    return normalizeHintToken(dedupedBody) === normalizeHintToken(trimmedLabel)
      ? trimmedLabel
      : dedupedBody;
  }

  if (hint.code === 'missing_beat' || hint.code === 'extra_beat') {
    return trimmedLabel;
  }

  if (hint.code === 'nice_try_again' || hint.code === 'heard_retry') {
    if (!dedupedBody) return trimmedLabel;
    return normalizeHintToken(dedupedBody) === normalizeHintToken(trimmedLabel)
      ? trimmedLabel
      : dedupedBody;
  }

  if (!dedupedBody) return trimmedLabel;
  if (normalizeHintToken(dedupedBody) === normalizeHintToken(trimmedLabel)) {
    return trimmedLabel;
  }
  return `${trimmedLabel}: ${dedupedBody}`;
}
