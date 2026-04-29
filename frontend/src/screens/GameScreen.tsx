import { useEffect, useRef } from 'react';
import type { GameState } from '../types/game';
import { useGameEngine } from '../hooks/useGameEngine';
import { useGameAudio } from '../hooks/useGameAudio';
import { useMicrophone } from '../hooks/useMicrophone';
import { MoleCanvas } from '../components/BubbleCanvas';
import { HUD } from '../components/HUD';
import { VoiceMeter } from '../components/MicButton';
import { PronunciationHint } from '../components/PronunciationHint';

interface GameScreenProps {
  onGameOver: (finalState: GameState) => void;
}

export function GameScreen({ onGameOver }: GameScreenProps) {
  const { gameState, activeMoleRef, startGame, submitEvaluation } = useGameEngine();
  const { micState, volume, startListening, captureRecentAudio } = useMicrophone();
  const calledGameOverRef = useRef(false);
  const startedRoundRef = useRef(false);
  const lastStrikeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const speechPeakVolumeRef = useRef(0);

  useEffect(() => {
    if (micState !== 'listening' || startedRoundRef.current) return;
    startedRoundRef.current = true;
    startGame();
  }, [micState, startGame]);

  useEffect(() => {
    if (gameState?.screen === 'result' && !calledGameOverRef.current) {
      calledGameOverRef.current = true;
      onGameOver(gameState);
    }
  }, [gameState, onGameOver]);

  const score = gameState?.score ?? 0;
  const combo = gameState?.combo ?? 0;
  const timeRemaining = gameState?.timeRemaining ?? 45;
  const collectedWords = gameState?.wordsHit ?? [];
  useGameAudio(gameState, micState === 'listening' && gameState?.screen === 'game');

  useEffect(() => {
    if (micState !== 'listening' || !gameState?.activeMole) return;

    const now = Date.now();
    const speechStartThreshold = 0.04;
    const speechEndThreshold = 0.02;
    const speechEndSilenceMs = 200;
    const strikeCooldownMs = 950;
    const minSpeechDurationMs = 260;
    const minSpeechPeakVolume = 0.045;

    if (isSpeakingRef.current) {
      speechPeakVolumeRef.current = Math.max(speechPeakVolumeRef.current, volume);
    }

    if (volume >= speechStartThreshold) {
      if (!isSpeakingRef.current) {
        console.log('[speech] start', { volume: Number(volume.toFixed(3)) });
        speechStartedAtRef.current = now;
        speechPeakVolumeRef.current = volume;
      }
      isSpeakingRef.current = true;
      lastVoiceAtRef.current = now;
      return;
    }

    if (!isSpeakingRef.current || volume > speechEndThreshold) return;
    if (now - lastVoiceAtRef.current < speechEndSilenceMs) return;
    if (now - lastStrikeRef.current < strikeCooldownMs) return;

    isSpeakingRef.current = false;
    lastStrikeRef.current = now;
    const speechDurationMs = now - speechStartedAtRef.current;
    const speechPeakVolume = speechPeakVolumeRef.current;

    if (speechDurationMs < minSpeechDurationMs || speechPeakVolume < minSpeechPeakVolume) {
      console.log('[speech] skipped weak utterance', {
        durationMs: speechDurationMs,
        peakVolume: Number(speechPeakVolume.toFixed(3)),
        minSpeechDurationMs,
        minSpeechPeakVolume,
      });
      return;
    }

    const audio = captureRecentAudio();
    if (!audio) return;
    const speechEndedAt = now;
    console.log('[speech] end, submitting audio', {
      bytes: audio.size,
      type: audio.type,
      word: gameState.activeMole.word.hanzi,
      pinyinRaw: gameState.activeMole.word.pinyinRaw,
    });
    console.log('[latency] utterance submit', {
      word: gameState.activeMole.word.hanzi,
      speechDurationMs,
      silenceWaitMs: speechEndedAt - lastVoiceAtRef.current,
      peakVolume: Number(speechPeakVolume.toFixed(3)),
      bytes: audio.size,
    });
    submitEvaluation(audio);
  }, [captureRecentAudio, gameState?.activeMole, micState, submitEvaluation, volume]);

  return (
    <div className="game-root">
      <div className="bubble-canvas-wrapper">
        <MoleCanvas gameState={gameState} activeMoleRef={activeMoleRef} volume={volume} />
      </div>

      <div className="hud-overlay">
        <HUD score={score} combo={combo} timeRemaining={timeRemaining} collectedWords={collectedWords} />
      </div>

      <div className="hint-overlay">
        <PronunciationHint
          hint={gameState?.isEvaluating
            ? { code: 'checking', text: '...Checking pronunciation', confidence: 0 }
            : (gameState?.lastHint ?? null)}
        />
      </div>

      <div className="mic-overlay">
        <VoiceMeter micState={micState} volume={volume} onEnableMic={startListening} />
      </div>
    </div>
  );
}
