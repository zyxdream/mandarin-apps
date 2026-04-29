import type { PronunciationEvaluator } from '../types/evaluator';
import type { Word } from '../types/word';
import type { EvalResult } from '../types/game';

/**
 * Real backend evaluator. Replace FakeEvaluator with this in useGameEngine.ts
 * once the /evaluate endpoint is implemented.
 *
 * Expected request: multipart/form-data { audio: Blob, word_id: string, pinyin_raw: string }
 * Expected response is transport-neutral so HTTP and future WebSocket
 * evaluation can feed the same EvalResult shape into GameEngine.
 */
export class HttpEvaluator implements PronunciationEvaluator {
  private readonly baseUrl: string;

  constructor(baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async evaluate(audioBlob: Blob, word: Word): Promise<EvalResult> {
    const requestStartedAt = performance.now();
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'recording.webm');
      form.append('word_id', word.id);
      form.append('pinyin_raw', word.pinyinRaw);
      form.append('hanzi', word.hanzi);
      form.append('eval_mode', 'realtime');

      console.log('[latency] evaluator request start', {
        word: word.hanzi,
        pinyinRaw: word.pinyinRaw,
        bytes: audioBlob.size,
      });
      const res = await fetch(`${this.baseUrl}/evaluate`, { method: 'POST', body: form });
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
      return { success: false, confidence: 0, wordId: word.id };
    }
  }
}
