import { useState, useRef, useCallback, useEffect } from 'react';

export type MicState = 'idle' | 'requesting' | 'listening' | 'denied';

export interface AudioCaptureStats {
  durationMs: number;
  peakVolume: number;
  averageVolume: number;
  peakRms: number;
  averageRms: number;
  chunks: number;
}

export interface CapturedAudio {
  blob: Blob;
  stats: AudioCaptureStats;
}

export interface UseMicrophoneReturn {
  micState: MicState;
  volume: number;
  startListening: () => Promise<void>;
  stopListening: () => void;
  captureRecentAudio: (options?: { sinceMs?: number; preRollMs?: number }) => CapturedAudio | null;
  resetCaptureBuffer: () => void;
}

interface AudioChunk {
  blob: Blob;
  createdAt: number;
  isHeader: boolean;
}

interface VolumeSample {
  createdAt: number;
  rms: number;
  volume: number;
}

const RECENT_AUDIO_WINDOW_MS = 1800;
const MAX_AUDIO_BUFFER_MS = 3200;
const TARGET_SAMPLE_RATE = 16000;

function buildPreferredAudioConstraints(): MediaTrackConstraints {
  const supported = navigator.mediaDevices.getSupportedConstraints();
  const constraints: MediaTrackConstraints = {};

  if (supported.channelCount) {
    constraints.channelCount = { ideal: 1 };
  }
  if (supported.sampleRate) {
    constraints.sampleRate = { ideal: TARGET_SAMPLE_RATE };
  }
  if (supported.echoCancellation) {
    constraints.echoCancellation = { ideal: true };
  }
  if (supported.noiseSuppression) {
    constraints.noiseSuppression = { ideal: true };
  }
  if (supported.autoGainControl) {
    constraints.autoGainControl = { ideal: true };
  }

  return constraints;
}

export function useMicrophone(): UseMicrophoneReturn {
  const [micState, setMicState] = useState<MicState>('idle');
  const [volume, setVolume] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<AudioChunk[]>([]);
  const volumeSamplesRef = useRef<VolumeSample[]>([]);
  const animationRef = useRef<number | null>(null);
  const volumeRef = useRef(0);
  const lastVolumeLogRef = useRef(0);
  const mimeTypeRef = useRef('audio/webm');

  const createRecorder = useCallback((stream: MediaStream, mimeType: string) => {
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = event => {
      if (event.data.size === 0) return;
      const now = Date.now();
      const isHeader = chunksRef.current.length === 0;
      chunksRef.current = [
        ...chunksRef.current.filter(chunk => chunk.isHeader || now - chunk.createdAt <= MAX_AUDIO_BUFFER_MS),
        { blob: event.data, createdAt: now, isHeader },
      ];
    };
    return recorder;
  }, []);

  const stopListening = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    volumeSamplesRef.current = [];
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    volumeRef.current = 0;
    setVolume(0);
    setMicState('idle');
  }, []);

  const sampleVolume = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / data.length);
      const target = Math.min(1, Math.max(0, rms - 0.01) * 12);
      volumeRef.current = volumeRef.current * 0.62 + target * 0.38;
      setVolume(volumeRef.current);

      const now = Date.now();
      volumeSamplesRef.current = [
        ...volumeSamplesRef.current.filter(sample => now - sample.createdAt <= MAX_AUDIO_BUFFER_MS),
        { createdAt: now, rms, volume: volumeRef.current },
      ];
      if (now - lastVolumeLogRef.current > 600) {
        lastVolumeLogRef.current = now;
        console.log('[mic] volume', {
          rms: Number(rms.toFixed(4)),
          volume: Number(volumeRef.current.toFixed(3)),
        });
      }
      animationRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, []);

  const startListening = useCallback(async () => {
    if (micState === 'listening' || micState === 'requesting') return;
    setMicState('requesting');
    console.log('[mic] requesting permission');

    try {
      const preferredAudioConstraints = buildPreferredAudioConstraints();
      const requestedAudio = Object.keys(preferredAudioConstraints).length
        ? preferredAudioConstraints
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: requestedAudio });
      streamRef.current = stream;
      chunksRef.current = [];
      volumeSamplesRef.current = [];
      console.log('[mic] stream ready', {
        tracks: stream.getAudioTracks().map(track => ({
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
        requestedAudio,
      });
      const firstTrack = stream.getAudioTracks()[0];
      if (firstTrack && requestedAudio !== true) {
        try {
          await firstTrack.applyConstraints(preferredAudioConstraints);
        } catch (constraintError) {
          console.warn('[mic] applyConstraints failed; continuing with browser defaults', constraintError);
        }
        console.log('[mic] active track settings', firstTrack.getSettings());
      }

      const audioContext = new AudioContext();
      console.log('[mic] audio context created', { state: audioContext.state });
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('[mic] audio context resumed', { state: audioContext.state });
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeTypeRef.current = mimeType;
      const recorder = createRecorder(stream, mimeType);
      recorder.start(100);
      recorderRef.current = recorder;
      console.log('[mic] recorder started', { mimeType });

      setMicState('listening');
      sampleVolume();
    } catch (error) {
      console.error('[mic] failed to start', error);
      setMicState('denied');
    }
  }, [createRecorder, micState, sampleVolume]);

  useEffect(() => stopListening, [stopListening]);

  const captureRecentAudio = useCallback((options?: { sinceMs?: number; preRollMs?: number }): CapturedAudio | null => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.requestData();
    }

    const now = Date.now();
    const fromMs = options?.sinceMs
      ? Math.max(0, options.sinceMs - (options.preRollMs ?? 180))
      : now - RECENT_AUDIO_WINDOW_MS;
    const recentChunks = chunksRef.current.filter(chunk => chunk.isHeader || chunk.createdAt >= fromMs);
    if (recentChunks.length === 0) {
      console.warn('[mic] no recent audio chunks to submit');
      return null;
    }

    const blob = new Blob(recentChunks.map(chunk => chunk.blob), {
      type: 'audio/webm',
    });
    const recentSamples = volumeSamplesRef.current.filter(sample => sample.createdAt >= fromMs);
    const peakVolume = recentSamples.reduce((peak, sample) => Math.max(peak, sample.volume), 0);
    const peakRms = recentSamples.reduce((peak, sample) => Math.max(peak, sample.rms), 0);
    const averageVolume = recentSamples.length
      ? recentSamples.reduce((total, sample) => total + sample.volume, 0) / recentSamples.length
      : 0;
    const averageRms = recentSamples.length
      ? recentSamples.reduce((total, sample) => total + sample.rms, 0) / recentSamples.length
      : 0;
    const nonHeaderChunks = recentChunks.filter(chunk => !chunk.isHeader);
    const firstChunkAt = nonHeaderChunks[0]?.createdAt ?? fromMs;
    const lastChunkAt = nonHeaderChunks[nonHeaderChunks.length - 1]?.createdAt ?? now;
    const durationMs = Math.max(0, lastChunkAt - firstChunkAt + 100);
    const stats: AudioCaptureStats = {
      durationMs,
      peakVolume,
      averageVolume,
      peakRms,
      averageRms,
      chunks: recentChunks.length,
    };
    console.log('[mic] captured recent audio', {
      chunks: recentChunks.length,
      bytes: blob.size,
      type: blob.type,
      bounded: Boolean(options?.sinceMs),
      durationMs: stats.durationMs,
      peakVolume: Number(stats.peakVolume.toFixed(3)),
      averageVolume: Number(stats.averageVolume.toFixed(3)),
      peakRms: Number(stats.peakRms.toFixed(4)),
      averageRms: Number(stats.averageRms.toFixed(4)),
    });
    return { blob, stats };
  }, []);

  const resetCaptureBuffer = useCallback(() => {
    const stream = streamRef.current;
    const currentRecorder = recorderRef.current;
    if (!stream || !currentRecorder || micState !== 'listening') return;

    try {
      if (currentRecorder.state !== 'inactive') {
        currentRecorder.ondataavailable = null;
        currentRecorder.stop();
      }
    } catch (error) {
      console.warn('[mic] recorder stop during reset failed', error);
    }

    chunksRef.current = [];
    volumeSamplesRef.current = [];
    const nextRecorder = createRecorder(stream, mimeTypeRef.current);
    nextRecorder.start(100);
    recorderRef.current = nextRecorder;
    console.log('[mic] capture buffer reset for new word');
  }, [createRecorder, micState]);

  return { micState, volume, startListening, stopListening, captureRecentAudio, resetCaptureBuffer };
}
