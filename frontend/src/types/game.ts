import type { Word } from './word';

export type GameScreen = 'start' | 'game' | 'result';

export type MoleAnimState =
  | 'emerging'
  | 'active'
  | 'listening'
  | 'hit'
  | 'retry'
  | 'escaping'
  | 'hidden';

export type MoleReaction = 'idle' | 'angry' | 'laugh' | 'dizzy';

export interface MoleState {
  word: Word;
  animState: MoleAnimState;
  reaction: MoleReaction;
  slotIndex: number;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  isSecondChance: boolean;
  strikeId: number;
}

export interface GameState {
  screen: GameScreen;
  activeMole: MoleState | null;
  score: number;
  combo: number;
  timeRemaining: number;
  wordsHit: Word[];
  wordsMissed: Word[];
  secondChanceQueue: Word[];
  consecutiveMissCount: number;
  lastHint: PronunciationHint | null;
  isEvaluating: boolean;
}

export interface EvalResult {
  success: boolean;
  confidence: number;
  wordId: string;
  error?: boolean;
  transcript?: string;
  transcriptPinyin?: string;
  scores?: Record<string, number | null>;
  diagnostics?: Array<Record<string, string | number | boolean>>;
  hintCode?: string | null;
  hintText?: string | null;
}

export interface PronunciationHint {
  code: string;
  text: string;
  transcript?: string;
  confidence: number;
}
