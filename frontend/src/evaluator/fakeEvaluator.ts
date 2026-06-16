import type { PronunciationEvaluator } from '../types/evaluator';
import type { Word } from '../types/word';
import type { EvalResult } from '../types/game';
import type { EvaluationAudio } from '../types/audio';

export interface FakeEvaluatorConfig {
  successProbability: number;
  latencyMs: number;
}

export class FakeEvaluator implements PronunciationEvaluator {
  private readonly config: FakeEvaluatorConfig;

  constructor(config: Partial<FakeEvaluatorConfig> = {}) {
    this.config = {
      successProbability: config.successProbability ?? 0.65,
      latencyMs: config.latencyMs ?? 220,
    };
  }

  async evaluate(_audio: EvaluationAudio, word: Word): Promise<EvalResult> {
    await new Promise(r => setTimeout(r, this.config.latencyMs));
    const success = Math.random() < this.config.successProbability;
    return {
      success,
      confidence: success ? 0.75 + Math.random() * 0.25 : Math.random() * 0.4,
      wordId: word.id,
    };
  }
}
