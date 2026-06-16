export type EvaluationAudioFormat = 'pcm_s16le' | 'webm_opus';

export interface AudioCaptureStats {
  durationMs: number;
  peakVolume: number;
  averageVolume: number;
  peakRms: number;
  averageRms: number;
  chunks: number;
}

export interface EvaluationAudio {
  blob: Blob;
  format: EvaluationAudioFormat;
  sampleRate: number | null;
  channels: number | null;
  mimeType: string;
  filename: string;
  stats: AudioCaptureStats;
}
