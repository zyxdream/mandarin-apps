export interface SpeechDetectionConfig {
  readonly noiseFloorMin: number;
  readonly noiseFloorMax: number;
  readonly noiseBlendCarry: number;
  readonly noiseBlendIncoming: number;
  readonly speechStartBase: number;
  readonly speechStartNoiseMultiple: number;
  readonly speechEndBase: number;
  readonly speechEndNoiseMultiple: number;
  readonly speechStartHoldMs: number;
  readonly strikeCooldownMs: number;
  readonly minSpeechDurationMs: number;
  readonly minSpeechPeakBase: number;
  readonly minSpeechPeakOffset: number;
  readonly minSpeechAverageBase: number;
  readonly minSpeechAverageOffset: number;
  readonly minSpeechRiseBase: number;
  readonly minSpeechRiseMultiple: number;
}

export const HIGH_SENSITIVITY_SPEECH_CONFIG: SpeechDetectionConfig = {
  noiseFloorMin: 0.006,
  noiseFloorMax: 0.1,
  noiseBlendCarry: 0.982,
  noiseBlendIncoming: 0.018,
  speechStartBase: 0.062,
  speechStartNoiseMultiple: 2.3,
  speechEndBase: 0.028,
  speechEndNoiseMultiple: 1.15,
  speechStartHoldMs: 120,
  strikeCooldownMs: 1050,
  minSpeechDurationMs: 320,
  minSpeechPeakBase: 0.082,
  minSpeechPeakOffset: 0.012,
  minSpeechAverageBase: 0.036,
  minSpeechAverageOffset: 0.009,
  minSpeechRiseBase: 0.026,
  minSpeechRiseMultiple: 0.95,
};

export interface SpeechThresholds {
  readonly speechStartThreshold: number;
  readonly speechEndThreshold: number;
  readonly minSpeechPeakVolume: number;
  readonly minSpeechAverageVolume: number;
  readonly minSpeechRiseOverNoise: number;
  readonly speechStartHoldMs: number;
  readonly strikeCooldownMs: number;
  readonly minSpeechDurationMs: number;
}

export interface SpeechCaptureTiming {
  readonly speechEndSilenceMs: number;
  readonly preRollMs: number;
  readonly postRollMs: number;
}

export interface ActiveSpeechEndpoint {
  readonly lastVoiceAtMs: number;
  readonly hasEnded: boolean;
}

const SINGLE_SYLLABLE_END_SILENCE_MS = 350;
const MULTI_SYLLABLE_END_SILENCE_MS = 600;
const SPEECH_PRE_ROLL_MS = 220;
const SPEECH_POST_ROLL_MS = 150;
const NUMBERED_PINYIN_SYLLABLE = /^[a-züv:]+[1-5]$/i;

export interface SpeechCaptureStats {
  readonly durationMs: number;
  readonly peakVolume: number;
  readonly averageVolume: number;
}

export function blendNoiseFloor(
  noiseFloor: number,
  observedVolume: number,
  config: SpeechDetectionConfig = HIGH_SENSITIVITY_SPEECH_CONFIG,
): number {
  const blended = (noiseFloor * config.noiseBlendCarry) + (observedVolume * config.noiseBlendIncoming);
  return Math.max(config.noiseFloorMin, Math.min(config.noiseFloorMax, blended));
}

export function computeSpeechThresholds(
  noiseFloor: number,
  config: SpeechDetectionConfig = HIGH_SENSITIVITY_SPEECH_CONFIG,
): SpeechThresholds {
  const speechStartThreshold = Math.max(config.speechStartBase, noiseFloor * config.speechStartNoiseMultiple);
  const speechEndThreshold = Math.max(config.speechEndBase, noiseFloor * config.speechEndNoiseMultiple);
  const minSpeechPeakVolume = Math.max(config.minSpeechPeakBase, speechStartThreshold + config.minSpeechPeakOffset);
  const minSpeechAverageVolume = Math.max(config.minSpeechAverageBase, noiseFloor + config.minSpeechAverageOffset);
  const minSpeechRiseOverNoise = Math.max(config.minSpeechRiseBase, noiseFloor * config.minSpeechRiseMultiple);

  return {
    speechStartThreshold,
    speechEndThreshold,
    minSpeechPeakVolume,
    minSpeechAverageVolume,
    minSpeechRiseOverNoise,
    speechStartHoldMs: config.speechStartHoldMs,
    strikeCooldownMs: config.strikeCooldownMs,
    minSpeechDurationMs: config.minSpeechDurationMs,
  };
}

export function resolveSpeechCaptureTiming(pinyinRaw?: string | null): SpeechCaptureTiming {
  const syllables = (pinyinRaw ?? '').trim().split(/\s+/).filter(Boolean);
  const hasValidSyllables = syllables.length > 0 && syllables.every(syllable => NUMBERED_PINYIN_SYLLABLE.test(syllable));
  const isSingleSyllable = hasValidSyllables && syllables.length === 1;

  return {
    speechEndSilenceMs: isSingleSyllable
      ? SINGLE_SYLLABLE_END_SILENCE_MS
      : MULTI_SYLLABLE_END_SILENCE_MS,
    preRollMs: SPEECH_PRE_ROLL_MS,
    postRollMs: SPEECH_POST_ROLL_MS,
  };
}

export function advanceSpeechEndpoint(
  currentLastVoiceAtMs: number,
  nowMs: number,
  volume: number,
  speechEndThreshold: number,
  speechEndSilenceMs: number,
): ActiveSpeechEndpoint {
  if (volume > speechEndThreshold) {
    return {
      lastVoiceAtMs: nowMs,
      hasEnded: false,
    };
  }

  return {
    lastVoiceAtMs: currentLastVoiceAtMs,
    hasEnded: nowMs - currentLastVoiceAtMs >= speechEndSilenceMs,
  };
}

export function shouldSkipWeakUtterance(
  durationMs: number,
  speechPeakVolume: number,
  thresholds: SpeechThresholds,
): boolean {
  return durationMs < thresholds.minSpeechDurationMs || speechPeakVolume < thresholds.minSpeechPeakVolume;
}

export function shouldSkipCaptureQuality(
  stats: SpeechCaptureStats,
  noiseFloor: number,
  thresholds: SpeechThresholds,
): boolean {
  const peakRiseOverNoise = stats.peakVolume - noiseFloor;
  return (
    stats.durationMs < thresholds.minSpeechDurationMs ||
    stats.peakVolume < thresholds.minSpeechPeakVolume ||
    stats.averageVolume < thresholds.minSpeechAverageVolume ||
    peakRiseOverNoise < thresholds.minSpeechRiseOverNoise
  );
}
