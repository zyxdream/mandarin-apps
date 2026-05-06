import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { GameState, MoleState } from '../types/game';
import { GameEngine } from '../engine/gameEngine';
import { HttpEvaluator } from '../evaluator/httpEvaluator';
import { WORDS } from '../data/words';
import { buildSessionPracticeUnits, buildSessionWords } from '../data/session';

interface LogicalSnapshot {
  screen: string;
  score: number;
  combo: number;
  timeRemaining: number;
  isEvaluating: boolean;
  animState: string | null;
  wordId: string | null;
  isSecondChance: boolean | null;
  strikeId: number | null;
  hasActiveMole: boolean;
  missedCount: number;
  hitCount: number;
  hintCode: string | null;
  hintText: string | null;
}

function extractLogical(state: GameState): LogicalSnapshot {
  return {
    screen: state.screen,
    score: state.score,
    combo: state.combo,
    timeRemaining: state.timeRemaining,
    isEvaluating: state.isEvaluating,
    animState: state.activeMole?.animState ?? null,
    wordId: state.activeMole?.word?.id ?? null,
    isSecondChance: state.activeMole?.isSecondChance ?? null,
    strikeId: state.activeMole?.strikeId ?? null,
    hasActiveMole: state.activeMole !== null,
    missedCount: state.wordsMissed.length,
    hitCount: state.wordsHit.length,
    hintCode: state.lastHint?.code ?? null,
    hintText: state.lastHint?.text ?? null,
  };
}

function logicalChanged(a: LogicalSnapshot | null, b: LogicalSnapshot): boolean {
  if (!a) return true;
  return (
    a.screen !== b.screen ||
    a.score !== b.score ||
    a.combo !== b.combo ||
    a.timeRemaining !== b.timeRemaining ||
    a.isEvaluating !== b.isEvaluating ||
    a.animState !== b.animState ||
    a.wordId !== b.wordId ||
    a.isSecondChance !== b.isSecondChance ||
    a.strikeId !== b.strikeId ||
    a.hasActiveMole !== b.hasActiveMole ||
    a.missedCount !== b.missedCount ||
    a.hitCount !== b.hitCount ||
    a.hintCode !== b.hintCode ||
    a.hintText !== b.hintText
  );
}

export function useGameEngine() {
  const engineRef = useRef<GameEngine | null>(null);
  const activeMoleRef = useRef<MoleState | null>(null);
  const prevLogicalRef = useRef<LogicalSnapshot | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const sessionWords = useMemo(() => buildSessionWords(WORDS), []);
  const sessionPracticeUnits = useMemo(() => buildSessionPracticeUnits(sessionWords), [sessionWords]);

  useEffect(() => {
    const evaluator = new HttpEvaluator();
    const engine = new GameEngine(sessionWords, evaluator);
    engineRef.current = engine;
    engine.setCanvasSize({ canvasWidth: window.innerWidth, canvasHeight: window.innerHeight });

    const unsub = engine.subscribe(event => {
      const state = event.type === 'stateChanged' ? event.state : event.finalState;

      activeMoleRef.current = state.activeMole;

      // Only update React state when logically important things change
      const snap = extractLogical(state);
      const isGameOver = event.type === 'gameOver';
      if (isGameOver || logicalChanged(prevLogicalRef.current, snap)) {
        prevLogicalRef.current = snap;
        if (snap.animState === 'hit' || state.wordsHit.length > 0) {
          console.log('[game-state] collected update', {
            animState: snap.animState,
            hitCount: state.wordsHit.length,
            lastHit: state.wordsHit.at(-1)?.hanzi ?? null,
            score: state.score,
          });
        }
        setGameState({ ...state });
      }
    });

    return () => {
      unsub();
      engine.stop();
    };
  }, [sessionWords]);

  const startGame = useCallback(() => engineRef.current?.start(), []);
  const setCanvasSize = useCallback((canvasWidth: number, canvasHeight: number) => {
    const safeWidth = Math.max(1, Math.round(canvasWidth));
    const safeHeight = Math.max(1, Math.round(canvasHeight));
    engineRef.current?.setCanvasSize({ canvasWidth: safeWidth, canvasHeight: safeHeight });
  }, []);
  const submitEvaluation = useCallback((blob: Blob) => {
    engineRef.current?.submitEvaluation(blob);
  }, []);

  return {
    gameState,
    activeMoleRef,
    sessionWords,
    sessionPracticeUnits,
    startGame,
    setCanvasSize,
    submitEvaluation,
  };
}
