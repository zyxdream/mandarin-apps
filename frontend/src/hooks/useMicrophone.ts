import { useState, useRef, useCallback, useEffect } from 'react';

export type MicState = 'idle' | 'requesting' | 'listening' | 'denied';

export interface UseMicrophoneReturn {
  micState: MicState;
  volume: number;
  startListening: () => Promise<void>;
  stopListening: () => void;
  captureRecentAudio: () => Blob | null;
}

interface AudioChunk {
  blob: Blob;
  createdAt: number;
  isHeader: boolean;
}

const RECENT_AUDIO_WINDOW_MS = 1800;
const MAX_AUDIO_BUFFER_MS = 3200;

export function useMicrophone(): UseMicrophoneReturn {
  const [micState, setMicState] = useState<MicState>('idle');
  const [volume, setVolume] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<AudioChunk[]>([]);
  const animationRef = useRef<number | null>(null);
  const volumeRef = useRef(0);
  const lastVolumeLogRef = useRef(0);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      console.log('[mic] stream ready', {
        tracks: stream.getAudioTracks().map(track => ({
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });

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
      recorder.start(100);
      recorderRef.current = recorder;
      console.log('[mic] recorder started', { mimeType });

      setMicState('listening');
      sampleVolume();
    } catch (error) {
      console.error('[mic] failed to start', error);
      setMicState('denied');
    }
  }, [micState, sampleVolume]);

  useEffect(() => stopListening, [stopListening]);

  const captureRecentAudio = useCallback((): Blob | null => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.requestData();
    }

    const now = Date.now();
    const recentChunks = chunksRef.current.filter(chunk => chunk.isHeader || now - chunk.createdAt <= RECENT_AUDIO_WINDOW_MS);
    if (recentChunks.length === 0) {
      console.warn('[mic] no recent audio chunks to submit');
      return null;
    }

    const blob = new Blob(recentChunks.map(chunk => chunk.blob), {
      type: 'audio/webm',
    });
    console.log('[mic] captured recent audio', {
      chunks: recentChunks.length,
      bytes: blob.size,
      type: blob.type,
    });
    return blob;
  }, []);

  return { micState, volume, startListening, stopListening, captureRecentAudio };
}
