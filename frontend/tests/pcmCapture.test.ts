import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downsampleFloat32,
  encodeFloat32ToPcm16,
  wrapPcm16AsWav,
} from '../src/audio/pcmCapture.js';
import { buildEvaluationFormData } from '../src/evaluator/evaluationFormData.js';
import type { EvaluationAudio } from '../src/types/audio.js';
import type { Word } from '../src/types/word.js';

test('Float32 samples encode as little-endian signed 16-bit PCM', () => {
  const buffer = encodeFloat32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]));
  const view = new DataView(buffer);

  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => view.getInt16(index * 2, true)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
});

test('downsampling supports 48 kHz and 44.1 kHz sources', () => {
  assert.equal(downsampleFloat32(new Float32Array(48_000), 48_000, 16_000).length, 16_000);
  assert.equal(downsampleFloat32(new Float32Array(44_100), 44_100, 16_000).length, 16_000);
});

test('evaluation FormData includes PCM metadata', () => {
  const audio: EvaluationAudio = {
    blob: new Blob([new ArrayBuffer(3200)], { type: 'application/octet-stream' }),
    format: 'pcm_s16le',
    sampleRate: 16_000,
    channels: 1,
    mimeType: 'application/octet-stream',
    filename: 'recording.pcm',
    stats: {
      durationMs: 100,
      peakVolume: 0.8,
      averageVolume: 0.4,
      peakRms: 0.1,
      averageRms: 0.05,
      chunks: 2,
    },
  };
  const word: Word = {
    id: 'wm-test',
    hanzi: '一个',
    pinyin: 'yi ge',
    pinyinRaw: 'yi2 ge4',
    tone: 2,
    difficulty: 'easy',
    creatureName: 'Test',
    scoreValue: 10,
  };

  const form = buildEvaluationFormData(audio, word);

  assert.equal(form.get('audio_format'), 'pcm_s16le');
  assert.equal(form.get('sample_rate'), '16000');
  assert.equal(form.get('channels'), '1');
});

test('evaluation FormData marks WebM fallback explicitly', () => {
  const audio: EvaluationAudio = {
    blob: new Blob(['webm'], { type: 'audio/webm' }),
    format: 'webm_opus',
    sampleRate: null,
    channels: null,
    mimeType: 'audio/webm',
    filename: 'recording.webm',
    stats: {
      durationMs: 500,
      peakVolume: 0.8,
      averageVolume: 0.4,
      peakRms: 0.1,
      averageRms: 0.05,
      chunks: 1,
    },
  };
  const word: Word = {
    id: 'wm-test',
    hanzi: '一个',
    pinyin: 'yi ge',
    pinyinRaw: 'yi2 ge4',
    tone: 2,
    difficulty: 'easy',
    creatureName: 'Test',
    scoreValue: 10,
  };

  const form = buildEvaluationFormData(audio, word);

  assert.equal(form.get('audio_format'), 'webm_opus');
  assert.equal(form.has('sample_rate'), false);
  assert.equal(form.has('channels'), false);
});

test('WAV wrapper writes a valid RIFF/WAVE header around PCM', () => {
  const pcm = encodeFloat32ToPcm16(new Float32Array([0, 0.5, -0.5]));
  const wav = wrapPcm16AsWav(pcm, 16_000, 1);
  const bytes = new Uint8Array(wav);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const view = new DataView(wav);

  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), pcm.byteLength);
});
