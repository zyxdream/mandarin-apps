import type { Word } from './word.js';
import type { EvalResult } from './game.js';
import type { EvaluationAudio } from './audio.js';

/**
 * Seam between V1 (fake) and V2 (real backend).
 * Swap the constructor call in useGameEngine.ts to switch implementations.
 * Must never throw — return { success: false, confidence: 0, wordId: word.id } on error.
 */
export interface PronunciationEvaluator {
  evaluate(audio: EvaluationAudio, word: Word): Promise<EvalResult>;
}
