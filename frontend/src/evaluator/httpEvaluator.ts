import type { PronunciationEvaluator } from '../types/evaluator';
import type { Word } from '../types/word';
import type { EvalResult } from '../types/game';
import type { EvaluationAudio } from '../types/audio';
import { buildEvaluationFormData } from './evaluationFormData';

/**
 * Real backend evaluator. Replace FakeEvaluator with this in useGameEngine.ts
 * once the /evaluate endpoint is implemented.
 *
 * Expected request: multipart/form-data with audio bytes, target word fields,
 * and optional audio_format/sample_rate/channels metadata for PCM fast paths.
 * Expected response is transport-neutral so HTTP and future WebSocket
 * evaluation can feed the same EvalResult shape into GameEngine.
 */
export class HttpEvaluator implements PronunciationEvaluator {
  private static configLogged = false;
  private readonly baseUrl: string;
  private readonly evaluatePath: string;

  constructor(baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.evaluatePath = import.meta.env.VITE_EVALUATE_PATH ?? '/evaluate/local';
    if (!HttpEvaluator.configLogged) {
      HttpEvaluator.configLogged = true;
      this.logRuntimeConfigWarnings();
    }
  }

  private logRuntimeConfigWarnings(): void {
    console.log('[config] evaluator runtime', {
      mode: import.meta.env.MODE,
      baseUrl: this.baseUrl,
      evaluatePath: this.evaluatePath,
    });
    if (import.meta.env.PROD && /(localhost|127\.0\.0\.1)/.test(this.baseUrl)) {
      console.warn('[config] VITE_API_URL appears to be localhost in production', {
        baseUrl: this.baseUrl,
      });
    }
    if (this.evaluatePath !== '/evaluate/local') {
      console.warn('[config] VITE_EVALUATE_PATH is not /evaluate/local', {
        evaluatePath: this.evaluatePath,
      });
    }
  }

  async evaluate(audio: EvaluationAudio, word: Word): Promise<EvalResult> {
    const requestStartedAt = performance.now();
    try {
      const form = buildEvaluationFormData(audio, word);

      console.log('[latency] evaluator request start', {
        word: word.hanzi,
        pinyinRaw: word.pinyinRaw,
        bytes: audio.blob.size,
        audioFormat: audio.format,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        baseUrl: this.baseUrl,
        path: this.evaluatePath,
      });
      const res = await fetch(`${this.baseUrl}${this.evaluatePath}`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        success: boolean;
        confidence: number;
        word_id: string;
        transcript?: string;
        transcript_pinyin?: string;
        scores?: Record<string, number | null>;
        diagnostics?: Array<Record<string, string | number | boolean>>;
        hint_code?: string | null;
        hint_text?: string | null;
      };
      console.log('[latency] evaluator response received', {
        word: word.hanzi,
        success: data.success,
        confidence: data.confidence,
        transcript: data.transcript,
        elapsedMs: Math.round(performance.now() - requestStartedAt),
      });
      console.log('[latency] submit to evaluator response', {
        word: word.hanzi,
        elapsedMs: Math.round(performance.now() - requestStartedAt),
        success: data.success,
      });
      return {
        success: data.success,
        confidence: data.confidence,
        wordId: data.word_id,
        transcript: data.transcript,
        transcriptPinyin: data.transcript_pinyin,
        scores: data.scores,
        diagnostics: data.diagnostics,
        hintCode: data.hint_code,
        hintText: data.hint_text,
      };
    } catch (error) {
      console.warn('[latency] evaluator request failed', {
        word: word.hanzi,
        elapsedMs: Math.round(performance.now() - requestStartedAt),
        error,
      });
      console.warn('[latency] submit to evaluator response failed', {
        word: word.hanzi,
        elapsedMs: Math.round(performance.now() - requestStartedAt),
        error,
      });
      return { success: false, confidence: 0, wordId: word.id, error: true };
    }
  }
}
