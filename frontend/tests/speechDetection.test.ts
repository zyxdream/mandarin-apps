import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendNoiseFloor,
  computeSpeechThresholds,
  shouldSkipCaptureQuality,
  shouldSkipWeakUtterance,
} from '../src/engine/speechDetection.js';

test('noise floor blending clamps to configured max to resist drift', () => {
  const clamped = blendNoiseFloor(0.1, 1.0);
  assert.equal(clamped, 0.1);
});

test('speech thresholds are relaxed for low-noise quiet speech', () => {
  const thresholds = computeSpeechThresholds(0.012);
  assert.equal(Number(thresholds.speechStartThreshold.toFixed(3)), 0.062);
  assert.equal(Number(thresholds.speechEndThreshold.toFixed(3)), 0.028);
  assert.equal(Number(thresholds.minSpeechPeakVolume.toFixed(3)), 0.082);
});

test('quiet utterance above relaxed gate is accepted', () => {
  const thresholds = computeSpeechThresholds(0.012);
  const isWeak = shouldSkipWeakUtterance(340, 0.086, thresholds);
  assert.equal(isWeak, false);
});

test('brief volume spike is rejected as weak utterance', () => {
  const thresholds = computeSpeechThresholds(0.02);
  const isWeak = shouldSkipWeakUtterance(120, 0.2, thresholds);
  assert.equal(isWeak, true);
});

test('capture quality gate rejects noise-like peak without enough rise over floor', () => {
  const thresholds = computeSpeechThresholds(0.06);
  const shouldSkip = shouldSkipCaptureQuality(
    {
      durationMs: 500,
      peakVolume: 0.07,
      averageVolume: 0.06,
    },
    0.06,
    thresholds,
  );
  assert.equal(shouldSkip, true);
});

test('quiet but clear capture passes quality gate', () => {
  const thresholds = computeSpeechThresholds(0.02);
  const shouldSkip = shouldSkipCaptureQuality(
    {
      durationMs: 420,
      peakVolume: 0.09,
      averageVolume: 0.045,
    },
    0.02,
    thresholds,
  );
  assert.equal(shouldSkip, false);
});
