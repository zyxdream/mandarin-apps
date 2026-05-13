import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameState } from '../types/game';
import { useGameEngine } from '../hooks/useGameEngine';
import { useGameAudio } from '../hooks/useGameAudio';
import { useMicrophone } from '../hooks/useMicrophone';
import { MoleCanvas } from '../components/MoleCanvas';
import { HUD } from '../components/HUD';
import { VoiceMeter } from '../components/MicButton';
import { DevEvalCenterPanel, PedagogyHint } from '../components/PronunciationHint';
import type { UiDockLayout } from '../engine/uiDockLayout';
import type { RewardFood } from '../data/rewards';
import type { ScriptSession } from '../data/scriptSessions';

const WARMUP_PING_INTERVAL_MS = 3 * 60 * 1000;
const WARMUP_PING_TIMEOUT_MS = 5000;

function buildHealthUrl(baseUrl: string): string {
  try {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL('health', normalized).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, '')}/health`;
  }
}

interface GameScreenProps {
  selectedFood: RewardFood;
  onSelectFood: (food: RewardFood) => void;
  scriptSession: ScriptSession;
  onGameOver: (finalState: GameState) => void;
  onBackToSessionSelect: () => void;
}

export function GameScreen({
  selectedFood,
  onSelectFood,
  scriptSession,
  onGameOver,
  onBackToSessionSelect,
}: GameScreenProps) {
  const {
    gameState,
    activeMoleRef,
    sessionPracticeUnits,
    startGame,
    setCanvasSize,
    submitEvaluation,
    togglePause,
  } = useGameEngine(scriptSession);
  const { micState, volume, startListening, captureRecentAudio, resetCaptureBuffer } = useMicrophone();
  const calledGameOverRef = useRef(false);
  const startedRoundRef = useRef(false);
  const lastStrikeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const speechPeakVolumeRef = useRef(0);
  const voiceCandidateStartedAtRef = useRef(0);
  const noiseFloorRef = useRef(0.018);
  const warmupInFlightRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [resizeTarget, setResizeTarget] = useState<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockLayout, setDockLayout] = useState<UiDockLayout>({ dockHeightPx: 0, safeBottomPx: 0 });
  const [hasRoundStarted, setHasRoundStarted] = useState(false);
  const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
  const healthUrl = buildHealthUrl(apiBaseUrl);
  const activeWordId = gameState?.activeMole?.word.id ?? null;
  const handleCanvasHostRef = useCallback((node: HTMLDivElement | null) => {
    canvasHostRef.current = node;
    setResizeTarget(node);
  }, []);

  useEffect(() => {
    if (micState !== 'listening' || startedRoundRef.current) return;
    startedRoundRef.current = true;
    setHasRoundStarted(true);
    startGame();
  }, [micState, startGame]);

  useEffect(() => {
    if (gameState?.screen === 'result' && !calledGameOverRef.current) {
      calledGameOverRef.current = true;
      onGameOver(gameState);
    }
  }, [gameState, onGameOver]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const resizeToHost = () => {
      const rect = host.getBoundingClientRect();
      setCanvasSize(rect.width, rect.height);
    };

    resizeToHost();

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      setCanvasSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);

    return () => observer.disconnect();
  }, [setCanvasSize]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const updateDockLayout = () => {
      const height = Math.max(0, Math.round(dock.getBoundingClientRect().height));
      setDockLayout(prev => {
        if (prev.dockHeightPx === height) return prev;
        return { dockHeightPx: height, safeBottomPx: 0 };
      });
    };

    updateDockLayout();
    const observer = new ResizeObserver(() => updateDockLayout());
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeWordId) return;
    isSpeakingRef.current = false;
    voiceCandidateStartedAtRef.current = 0;
    speechPeakVolumeRef.current = 0;
    resetCaptureBuffer();
  }, [activeWordId, resetCaptureBuffer]);

  const combo = gameState?.combo ?? 0;
  const timeRemaining = gameState?.timeRemaining ?? 45;
  const collectedWords = gameState?.wordsHit ?? [];
  const rootStyle = {
    '--ui-dock-height': `${dockLayout.dockHeightPx}px`,
    '--ui-dock-safe-bottom': `${dockLayout.safeBottomPx}px`,
  } as CSSProperties;
  const pedagogyHintStyle = gameState?.activeMole ? {
    '--hint-anchor-x': `${Math.round(gameState.activeMole.x)}px`,
    '--hint-anchor-y': `${Math.round(gameState.activeMole.y)}px`,
  } as CSSProperties : undefined;
  const isMicStartScreen = !hasRoundStarted && micState !== 'listening';
  const showPauseButton = hasRoundStarted && micState === 'listening';
  const isGamePaused = Boolean(gameState?.isPaused);
  const pauseControlLabel = isGamePaused ? '▶' : '||';
  const pauseControlAriaLabel = isGamePaused ? 'Resume' : 'Pause';
  const handleTogglePause = useCallback(() => {
    togglePause();
  }, [togglePause]);

  useGameAudio(gameState, micState === 'listening' && gameState?.screen === 'game');

  const sendWarmupPing = useCallback(async (reason: 'session_start' | 'keepalive') => {
    if (warmupInFlightRef.current) return;
    warmupInFlightRef.current = true;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), WARMUP_PING_TIMEOUT_MS);
    console.log('[warmup] ping start', { reason, url: healthUrl });
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      console.log('[warmup] ping complete', {
        reason,
        status: response.status,
        ok: response.ok,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      console.warn('[warmup] ping failed', {
        reason,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      });
    } finally {
      window.clearTimeout(timeoutId);
      warmupInFlightRef.current = false;
    }
  }, [healthUrl]);

  useEffect(() => {
    const isWarmupActive =
      micState === 'listening' &&
      gameState?.screen === 'game' &&
      !isGamePaused;
    if (!isWarmupActive) return;
    void sendWarmupPing('session_start');
    const timer = window.setInterval(() => {
      void sendWarmupPing('keepalive');
    }, WARMUP_PING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [gameState?.screen, isGamePaused, micState, sendWarmupPing]);

  useEffect(() => {
    if (micState !== 'listening' || !gameState?.activeMole) return;
    if (isGamePaused) {
      isSpeakingRef.current = false;
      voiceCandidateStartedAtRef.current = 0;
      speechPeakVolumeRef.current = 0;
      resetCaptureBuffer();
      return;
    }

    const now = Date.now();
    const activeMole = gameState.activeMole;
    const speechStartThreshold = Math.max(0.09, noiseFloorRef.current * 3.1);
    const speechEndThreshold = Math.max(0.04, noiseFloorRef.current * 1.45);
    const speechStartHoldMs = 160;
    const speechEndSilenceMs = 280;
    const strikeCooldownMs = 1200;
    const minSpeechDurationMs = 440;
    const minSpeechPeakVolume = Math.max(0.115, speechStartThreshold + 0.025);
    const minSpeechAverageVolume = Math.max(0.058, noiseFloorRef.current + 0.018);
    const minSpeechRiseOverNoise = Math.max(0.05, noiseFloorRef.current * 1.35);

    if (!isSpeakingRef.current) {
      const blended = noiseFloorRef.current * 0.975 + volume * 0.025;
      noiseFloorRef.current = Math.max(0.008, Math.min(0.14, blended));
    }

    if (isSpeakingRef.current) {
      speechPeakVolumeRef.current = Math.max(speechPeakVolumeRef.current, volume);
    }

    if (volume >= speechStartThreshold) {
      if (!voiceCandidateStartedAtRef.current) {
        voiceCandidateStartedAtRef.current = now;
      }
      if (!isSpeakingRef.current && now - voiceCandidateStartedAtRef.current < speechStartHoldMs) {
        return;
      }
      if (!isSpeakingRef.current) {
        console.log('[speech] start', {
          word: activeMole.word.hanzi,
          volume: Number(volume.toFixed(3)),
          speechStartThreshold: Number(speechStartThreshold.toFixed(3)),
          noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        });
        speechStartedAtRef.current = voiceCandidateStartedAtRef.current;
        speechPeakVolumeRef.current = volume;
      }
      isSpeakingRef.current = true;
      lastVoiceAtRef.current = now;
      return;
    }

    voiceCandidateStartedAtRef.current = 0;
    if (!isSpeakingRef.current || volume > speechEndThreshold) return;
    if (now - lastVoiceAtRef.current < speechEndSilenceMs) return;
    if (now - lastStrikeRef.current < strikeCooldownMs) return;

    isSpeakingRef.current = false;
    lastStrikeRef.current = now;
    const speechDurationMs = now - speechStartedAtRef.current;
    const speechPeakVolume = speechPeakVolumeRef.current;

    if (speechDurationMs < minSpeechDurationMs || speechPeakVolume < minSpeechPeakVolume) {
      console.log('[speech] skipped weak utterance', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
        durationMs: speechDurationMs,
        peakVolume: Number(speechPeakVolume.toFixed(3)),
        noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        speechStartThreshold: Number(speechStartThreshold.toFixed(3)),
        speechEndThreshold: Number(speechEndThreshold.toFixed(3)),
        minSpeechDurationMs,
        minSpeechPeakVolume: Number(minSpeechPeakVolume.toFixed(3)),
        minSpeechRiseOverNoise: Number(minSpeechRiseOverNoise.toFixed(3)),
      });
      resetCaptureBuffer();
      return;
    }

    const capture = captureRecentAudio({
      sinceMs: speechStartedAtRef.current,
      preRollMs: 220,
      untilMs: lastVoiceAtRef.current,
      postRollMs: 90,
    });
    if (!capture) {
      console.warn('[speech] skipped: no captured audio', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
      });
      return;
    }
    const { blob: audio, stats } = capture;
    const peakRiseOverNoise = stats.peakVolume - noiseFloorRef.current;
    if (
      stats.durationMs < minSpeechDurationMs ||
      stats.peakVolume < minSpeechPeakVolume ||
      stats.averageVolume < minSpeechAverageVolume ||
      peakRiseOverNoise < minSpeechRiseOverNoise
    ) {
      console.log('[speech] skipped capture quality gate', {
        word: activeMole.word.hanzi,
        pinyinRaw: activeMole.word.pinyinRaw,
        durationMs: stats.durationMs,
        peakVolume: Number(stats.peakVolume.toFixed(3)),
        averageVolume: Number(stats.averageVolume.toFixed(3)),
        noiseFloor: Number(noiseFloorRef.current.toFixed(3)),
        peakRiseOverNoise: Number(peakRiseOverNoise.toFixed(3)),
        minSpeechDurationMs,
        minSpeechPeakVolume: Number(minSpeechPeakVolume.toFixed(3)),
        minSpeechAverageVolume: Number(minSpeechAverageVolume.toFixed(3)),
        minSpeechRiseOverNoise: Number(minSpeechRiseOverNoise.toFixed(3)),
      });
      resetCaptureBuffer();
      return;
    }
    const speechEndedAt = now;
    console.log('[speech] end, submitting audio', {
      bytes: audio.size,
      type: audio.type,
      word: activeMole.word.hanzi,
      pinyinRaw: activeMole.word.pinyinRaw,
      captureDurationMs: stats.durationMs,
      capturePeakVolume: Number(stats.peakVolume.toFixed(3)),
      captureAverageVolume: Number(stats.averageVolume.toFixed(3)),
    });
    console.log('[latency] utterance submit', {
      word: activeMole.word.hanzi,
      speechDurationMs,
      silenceWaitMs: speechEndedAt - lastVoiceAtRef.current,
      peakVolume: Number(speechPeakVolume.toFixed(3)),
      averageVolume: Number(stats.averageVolume.toFixed(3)),
      bytes: audio.size,
    });
    console.log('[latency] speech end to submit', {
      word: activeMole.word.hanzi,
      elapsedMs: Math.max(0, Date.now() - speechEndedAt),
    });
    submitEvaluation(audio);
  }, [captureRecentAudio, gameState?.activeMole, isGamePaused, micState, resetCaptureBuffer, submitEvaluation, volume]);

  return (
    <div
      className={`game-root${isMicStartScreen ? ' game-root--mic-start' : ''}`}
      style={rootStyle}
    >
      <div className="game-scene-shell">
        <div
          className="bubble-canvas-wrapper"
          ref={handleCanvasHostRef}
        >
          <MoleCanvas
            gameState={gameState}
            activeMoleRef={activeMoleRef}
            volume={volume}
            resizeTarget={resizeTarget}
          />
        </div>

        <div className="hud-overlay">
          <HUD
            combo={combo}
            timeRemaining={timeRemaining}
            collectedWords={collectedWords}
            selectedFood={selectedFood}
          />
        </div>

        <div className="hint-overlay hint-overlay--pedagogy" style={pedagogyHintStyle}>
          {!gameState?.isEvaluating && gameState?.activeMole && gameState?.lastHint ? (
            <PedagogyHint
              key={`${gameState.lastHint.code}-${gameState.lastHint.text}-${gameState.lastHint.transcriptPinyin ?? ''}-${Math.round(gameState.lastHint.confidence * 100)}`}
              hint={gameState.lastHint}
            />
          ) : null}
        </div>

        {gameState && (gameState.isEvaluating || gameState.lastHint) ? (
          <div className="hint-overlay hint-overlay--dev-center">
            <DevEvalCenterPanel isEvaluating={gameState.isEvaluating} hint={gameState.lastHint} />
          </div>
        ) : null}
      </div>

      <div className="game-controls-dock" ref={dockRef}>
        <div className="mic-overlay">
          <VoiceMeter
            micState={micState}
            volume={volume}
            sessionPracticeUnits={sessionPracticeUnits}
            scriptSession={scriptSession}
            selectedFood={selectedFood}
            onSelectFood={onSelectFood}
            onEnableMic={startListening}
          />
        </div>
        {!isMicStartScreen ? (
          <div className="gameplay-actions gameplay-actions--gameplay">
            <button
              type="button"
              className="session-select-back-button gameplay-action-button"
              onClick={onBackToSessionSelect}
              aria-label="Back to session list"
            >
              X
            </button>
            {showPauseButton ? (
              <button
                type="button"
                className="session-select-back-button gameplay-action-button"
                onClick={handleTogglePause}
                aria-label={pauseControlAriaLabel}
              >
                {pauseControlLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isMicStartScreen ? (
        <div className="ready-back-anchor">
          <button
            type="button"
            className="session-select-back-button gameplay-action-button"
            onClick={onBackToSessionSelect}
            aria-label="Back to session list"
          >
            X
          </button>
        </div>
      ) : null}
    </div>
  );
}
