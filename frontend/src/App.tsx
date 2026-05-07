import { useState, useCallback } from 'react';
import type { GameState } from './types/game';
import { StartScreen } from './screens/StartScreen';
import { GameScreen as GameScreenView } from './screens/GameScreen';
import { CelebrationScreen } from './screens/CelebrationScreen';
import { ResultScreen } from './screens/ResultScreen';
import { DEFAULT_REWARD_FOOD, type RewardFood } from './data/rewards';
import { getNextScriptSessionIndex, getPreviousScriptSessionIndex, getScriptSession } from './data/scriptSessions';
import './styles/game.css';
import './styles/animations.css';

type AppScreen = 'start' | 'game' | 'celebration' | 'result';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('start');
  const [finalState, setFinalState] = useState<GameState | null>(null);
  const [selectedFood, setSelectedFood] = useState<RewardFood>(DEFAULT_REWARD_FOOD);
  const [scriptSessionIndex, setScriptSessionIndex] = useState(0);
  const scriptSession = getScriptSession(scriptSessionIndex);
  const previousScriptSession = getScriptSession(getPreviousScriptSessionIndex(scriptSessionIndex));
  const nextScriptSession = getScriptSession(getNextScriptSessionIndex(scriptSessionIndex));

  const handleStart = useCallback(() => {
    setFinalState(null);
    setScreen('game');
  }, []);

  const handleGameOver = useCallback((state: GameState) => {
    setFinalState(state);
    setScreen('celebration');
  }, []);

  const handleCelebrationComplete = useCallback(() => {
    setScreen('result');
  }, []);

  const handleReplay = useCallback(() => {
    setFinalState(null);
    setScreen('game');
  }, []);

  const handlePreviousGame = useCallback(() => {
    setFinalState(null);
    setScriptSessionIndex(index => getPreviousScriptSessionIndex(index));
    setScreen('game');
  }, []);

  const handleNextGame = useCallback(() => {
    setFinalState(null);
    setScriptSessionIndex(index => getNextScriptSessionIndex(index));
    setScreen('game');
  }, []);

  if (screen === 'game') {
    return (
      <GameScreenView
        selectedFood={selectedFood}
        onSelectFood={setSelectedFood}
        scriptSession={scriptSession}
        onGameOver={handleGameOver}
      />
    );
  }

  if (screen === 'celebration' && finalState) {
    return (
      <CelebrationScreen
        finalState={finalState}
        selectedFood={selectedFood}
        onComplete={handleCelebrationComplete}
      />
    );
  }

  if (screen === 'result' && finalState) {
    return (
      <ResultScreen
        finalState={finalState}
        selectedFood={selectedFood}
        previousScriptSession={previousScriptSession}
        scriptSession={scriptSession}
        nextScriptSession={nextScriptSession}
        onPreviousGame={handlePreviousGame}
        onReplay={handleReplay}
        onNextGame={handleNextGame}
      />
    );
  }

  return <StartScreen onStart={handleStart} />;
}
