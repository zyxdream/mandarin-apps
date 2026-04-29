import type { Word } from '../types/word';

export function scoreForResult(word: Word, combo: number): number {
  const multiplier = combo >= 5 ? 2 : combo >= 3 ? 1.5 : 1;
  return Math.round(word.scoreValue * multiplier);
}
