import type { EvaluationAudio } from '../types/audio.js';
import type { Word } from '../types/word.js';

export function buildEvaluationFormData(audio: EvaluationAudio, word: Word): FormData {
  const form = new FormData();
  form.append('audio', audio.blob, audio.filename);
  form.append('word_id', word.id);
  form.append('pinyin_raw', word.pinyinRaw);
  form.append('hanzi', word.hanzi);
  form.append('eval_mode', 'realtime');
  form.append('audio_format', audio.format);
  if (audio.sampleRate !== null) {
    form.append('sample_rate', String(audio.sampleRate));
  }
  if (audio.channels !== null) {
    form.append('channels', String(audio.channels));
  }
  return form;
}
