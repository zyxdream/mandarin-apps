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
  const gameStateRef = useRef<GameState | null>(gameState);
  const lastStrikeIdRef = useRef(0);
  const lastAnimStateRef = useRef<string | null>(null);
  const wasEvaluatingRef = useRef(false);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (!enabled) return;

    const context = getAudioContext(contextRef);
    void context.resume();

    if (musicTimerRef.current === null) {
      musicTimerRef.current = window.setInterval(() => {
        const mole = gameStateRef.current?.activeMole;
        if (mole && (mole.animState === 'active' || mole.animState === 'listening')) {
          return;
        }
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

    if (
      mole.animState === 'retry' &&
      lastAnimStateRef.current !== 'retry' &&
      mole.reaction !== 'idle'
    ) {
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

function playSweep(
  context: AudioContext,
  fromFrequency: number,
  toFrequency: number,
  startDelay: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
) {
  const now = context.currentTime + startDelay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(fromFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(toFrequency, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
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
  playTone(context, NOTE_FREQ[note], 0, 0.12, downbeat ? 0.032 : 0.024, 'triangle');
}

function playChecking(context: AudioContext) {
  playTone(context, 740, 0, 0.045, 0.016, 'sine');
  playTone(context, 920, 0.06, 0.05, 0.014, 'sine');
}

function playHit(context: AudioContext) {
  playNoise(context, 0.16, 0.15);
  playSweep(context, 180, 70, 0, 0.18, 0.13, 'square');
  playTone(context, 520, 0.035, 0.12, 0.075, 'triangle');
  playTone(context, 880, 0.13, 0.16, 0.07, 'square');
  playTone(context, 1320, 0.24, 0.12, 0.045, 'triangle');
}

function playMiss(context: AudioContext) {
  // Short airy slip — suggests something sliding off / dropping
  playNoise(context, 0.04, 0.038);
  // Main “fall”: smooth sine glide (failure / weight dropping)
  playSweep(context, 380, 58, 0.02, 0.4, 0.095, 'sine');
  // Landing thud + faint upper partial for a dull “wrong” knock
  playTone(context, 58, 0.38, 0.22, 0.072, 'sine');
  playTone(context, 92, 0.4, 0.14, 0.028, 'sine');
}
