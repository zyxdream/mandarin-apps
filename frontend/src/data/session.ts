import type { Word } from '../types/word';
import { shuffleWords } from './words';

export const SESSION_WORD_COUNT = 8;

export interface PracticeUnit {
  id: string;
  label: string;
  sequence: string[];
}

export interface SessionPracticeUnits {
  initials: PracticeUnit[];
  finals: PracticeUnit[];
}

const PINYIN_INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
] as const;

// Mirrors frontend/public/audio/pinyin_units/*.m4a.
const AVAILABLE_UNITS = new Set(
  'a ai an ang ao b c ch chi ci d e ei en eng er f g h i ie in ing iu j k l m n o ong ou p q r ri s sh shi si t u ui un v ve vn w wu x y ye yi yin ying yu yuan yue yun z zh zhi zi'
    .split(' '),
);

const FINAL_SEQUENCE_FALLBACKS: Record<string, string[]> = {
  ia: ['i', 'a'],
  ian: ['i', 'an'],
  iao: ['i', 'ao'],
  iang: ['i', 'ang'],
  ua: ['u', 'a'],
  uo: ['u', 'o'],
  uai: ['u', 'ai'],
  uang: ['u', 'ang'],
  ue: ['ve'],
};

function normalizeSyllable(rawSyllable: string): string {
  return rawSyllable.toLowerCase().replace(/[1-5]/g, '').replace('ü', 'v');
}

function splitSyllables(pinyinRaw: string): string[] {
  return pinyinRaw
    .trim()
    .split(/\s+/)
    .map(normalizeSyllable)
    .filter(Boolean);
}

function splitInitialFinal(syllable: string): { initial: string; final: string } {
  const initial = PINYIN_INITIALS.find(candidate => syllable.startsWith(candidate)) ?? '';
  return {
    initial,
    final: syllable.slice(initial.length),
  };
}

function finalToPlaybackSequence(final: string): string[] {
  if (!final) return [];
  if (AVAILABLE_UNITS.has(final)) return [final];

  const mapped = FINAL_SEQUENCE_FALLBACKS[final];
  if (mapped && mapped.every(unit => AVAILABLE_UNITS.has(unit))) {
    return mapped;
  }

  // Keep session UI robust even if an unknown final appears later.
  const chars = final.split('').filter(char => AVAILABLE_UNITS.has(char));
  return chars.length > 0 ? chars : [final];
}

function buildInitialUnits(words: Word[]): PracticeUnit[] {
  const initials = new Set<string>();

  for (const word of words) {
    for (const syllable of splitSyllables(word.pinyinRaw)) {
      const { initial } = splitInitialFinal(syllable);
      if (!initial) continue;
      if (!AVAILABLE_UNITS.has(initial)) continue;
      initials.add(initial);
    }
  }

  return [...initials]
    .sort((a, b) => a.localeCompare(b))
    .map(initial => ({
      id: `initial-${initial}`,
      label: initial,
      sequence: [initial],
    }));
}

function buildFinalUnits(words: Word[]): PracticeUnit[] {
  const finalUnits = new Set<string>();

  for (const word of words) {
    for (const syllable of splitSyllables(word.pinyinRaw)) {
      const { final } = splitInitialFinal(syllable);
      if (!final) continue;

      const sequence = finalToPlaybackSequence(final);
      if (sequence.length === 0) continue;
      if (sequence.some(unit => !AVAILABLE_UNITS.has(unit))) continue;
      for (const unit of sequence) {
        if (AVAILABLE_UNITS.has(unit)) {
          finalUnits.add(unit);
        }
      }
    }
  }

  return [...finalUnits]
    .sort((a, b) => a.localeCompare(b))
    .map(unit => ({
      id: `final-unit-${unit}`,
      label: unit,
      sequence: [unit],
    }));
}

export function buildSessionWords(words: Word[], count = SESSION_WORD_COUNT): Word[] {
  return shuffleWords(words).slice(0, Math.max(1, count));
}

export function buildSessionPracticeUnits(words: Word[]): SessionPracticeUnits {
  return {
    initials: buildInitialUnits(words),
    finals: buildFinalUnits(words),
  };
}

export function pinyinUnitAudioUrl(unit: string): string {
  return `/audio/pinyin_units/${encodeURIComponent(unit)}.m4a`;
}
