import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { GameState } from '../types/game';

type NoteName = 'C5' | 'E5' | 'G5' | 'A5' | 'C6';

const NOTE_FREQ: Record<NoteName, number> = {
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
};

const MELODY: NoteName[] = ['C5', 'E5', 'G5', 'E5', 'A5', 'G5', 'E5', 'C6'];

export function useGameAudio(gameState: GameState | null, enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const musicTimerRef = useRef<number | null>(null);
  const musicStepRef = useRef(0);
  const lastStrikeIdRef = useRef(0);
  const lastAnimStateRef = useRef<string | null>(null);
  const wasEvaluatingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const context = getAudioContext(contextRef);
    void context.resume();

    if (musicTimerRef.current === null) {
      musicTimerRef.current = window.setInterval(() => {
        playMusicTick(context, musicStepRef.current);
        musicStepRef.current += 1;
      }, 340);
    }

    return () => {
      if (musicTimerRef.current !== null) {
        window.clearInterval(musicTimerRef.current);
        musicTimerRef.current = null;
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !gameState) return;
    const context = getAudioContext(contextRef);

    if (gameState.isEvaluating && !wasEvaluatingRef.current) {
      playChecking(context);
    }
    wasEvaluatingRef.current = gameState.isEvaluating;

    const mole = gameState.activeMole;
    if (!mole) {
      lastAnimStateRef.current = null;
      return;
    }

    if (mole.strikeId !== lastStrikeIdRef.current) {
      lastStrikeIdRef.current = mole.strikeId;
      playHit(context);
    }

    if (mole.animState === 'retry' && lastAnimStateRef.current !== 'retry') {
      playMiss(context);
    }
    lastAnimStateRef.current = mole.animState;
  }, [enabled, gameState]);

  useEffect(() => () => {
    if (musicTimerRef.current !== null) {
      window.clearInterval(musicTimerRef.current);
    }
    void contextRef.current?.close();
  }, []);
}

function getAudioContext(contextRef: MutableRefObject<AudioContext | null>) {
  if (!contextRef.current) {
    contextRef.current = new AudioContext();
  }
  return contextRef.current;
}

function playTone(
  context: AudioContext,
  frequency: number,
  startDelay: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'square',
) {
  const now = context.currentTime + startDelay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playNoise(context: AudioContext, duration: number, volume: number) {
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = context.createBufferSource();
  const gain = context.createGain();
  const now = context.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(context.destination);
  source.start(now);
  source.stop(now + duration);
}

function playMusicTick(context: AudioContext, step: number) {
  const note = MELODY[step % MELODY.length];
  const downbeat = step % 4 === 0;
  playTone(context, NOTE_FREQ[note], 0, 0.11, downbeat ? 0.018 : 0.012, 'triangle');
}

function playChecking(context: AudioContext) {
  playTone(context, 740, 0, 0.06, 0.025, 'sine');
  playTone(context, 920, 0.065, 0.07, 0.02, 'sine');
}

function playHit(context: AudioContext) {
  playNoise(context, 0.08, 0.08);
  playTone(context, 160, 0, 0.1, 0.07, 'square');
  playTone(context, 420, 0.03, 0.11, 0.05, 'triangle');
  playTone(context, 720, 0.11, 0.12, 0.04, 'square');
}

function playMiss(context: AudioContext) {
  playTone(context, 360, 0, 0.09, 0.035, 'sawtooth');
  playTone(context, 240, 0.08, 0.12, 0.028, 'sawtooth');
}
