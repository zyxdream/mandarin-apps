const PCM_TARGET_SAMPLE_RATE = 16000;
const HIGH_PASS_CUTOFF_HZ = 80;

/*
Current:
Analog sound
    ↓
Browser mic (often 48 kHz, processed by AEC/AGC)
    ↓
MediaRecorder encodes → WebM container + Opus codec  (compressed)
    ↓
HTTP POST
    ↓
ffmpeg: decode Opus → resample 16k → mono → filter → WAV file
    ↓
Python: WAV Int16 → Float32 numpy array
    ↓
VAD → Sherpa ASR

Recommended:
Analog sound
    ↓
Browser mic
    ↓
AudioWorklet: Float32 blocks → resample 16k → Int16 PCM  (uncompressed)
    ↓
HTTP POST (raw bytes + metadata: sample_rate=16000, channels=1, format=int16)
    ↓
Python: Int16 bytes → Float32 numpy array   (same math you already use)
    ↓
VAD (optional / maybe skippable) → Sherpa ASR
*/

export function highPassFloat32(
  input: Float32Array,
  sampleRate: number,
  cutoffHz = HIGH_PASS_CUTOFF_HZ,
): Float32Array {
  if (input.length === 0 || sampleRate <= 0 || cutoffHz <= 0) {
    return new Float32Array(input);
  }

  const output = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  let previousInput = input[0] ?? 0;
  let previousOutput = 0;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index] ?? 0;
    const filtered = alpha * (previousOutput + current - previousInput);
    output[index] = filtered;
    previousInput = current;
    previousOutput = filtered;
  }

  return output;
}

export function downsampleFloat32(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = PCM_TARGET_SAMPLE_RATE,
): Float32Array {
  if (input.length === 0) return new Float32Array();
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error('Sample rates must be positive.');
  }
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(input);
  }

  const targetLength = Math.max(1, Math.round((input.length * targetSampleRate) / sourceSampleRate));
  const output = new Float32Array(targetLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let outputIndex = 0; outputIndex < targetLength; outputIndex += 1) {
    const sourceStart = outputIndex * ratio;
    const sourceEnd = Math.min(input.length, sourceStart + ratio);
    const firstIndex = Math.floor(sourceStart);
    const lastIndex = Math.min(input.length - 1, Math.ceil(sourceEnd) - 1);
    let weightedSum = 0;
    let weightTotal = 0;

    for (let sourceIndex = firstIndex; sourceIndex <= lastIndex; sourceIndex += 1) {
      const overlapStart = Math.max(sourceStart, sourceIndex);
      const overlapEnd = Math.min(sourceEnd, sourceIndex + 1);
      const weight = Math.max(0, overlapEnd - overlapStart);
      weightedSum += (input[sourceIndex] ?? 0) * weight;
      weightTotal += weight;
    }

    output[outputIndex] = weightTotal > 0 ? weightedSum / weightTotal : 0;
  }

  return output;
}

export function encodeFloat32ToPcm16(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    view.setInt16(index * 2, intSample, true);
  }

  return buffer;
}

export function preparePcm16Audio(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = PCM_TARGET_SAMPLE_RATE,
): { buffer: ArrayBuffer; sampleRate: number; sampleCount: number; durationMs: number } {
  const filtered = highPassFloat32(input, sourceSampleRate);
  const downsampled = downsampleFloat32(filtered, sourceSampleRate, targetSampleRate);
  return {
    buffer: encodeFloat32ToPcm16(downsampled),
    sampleRate: targetSampleRate,
    sampleCount: downsampled.length,
    durationMs: Math.round((downsampled.length / targetSampleRate) * 1000),
  };
}

export function wrapPcm16AsWav(
  pcmBuffer: ArrayBuffer,
  sampleRate: number,
  channels: number,
): ArrayBuffer {
  if (sampleRate <= 0 || channels <= 0) {
    throw new Error('Sample rate and channels must be positive.');
  }

  const headerBytes = 44;
  const wavBuffer = new ArrayBuffer(headerBytes + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);
  const bytes = new Uint8Array(wavBuffer);
  bytes.set(new Uint8Array(pcmBuffer), headerBytes);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBuffer.byteLength, true);

  return wavBuffer;
}
