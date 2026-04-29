import { useState, useCallback } from 'react';
import type { GameScreen, GameState } from './types/game';
import { StartScreen } from './screens/StartScreen';
import { GameScreen as GameScreenView } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';
import './styles/game.css';
import './styles/animations.css';

export default function App() {
  const [screen, setScreen] = useState<GameScreen>('start');
  const [finalState, setFinalState] = useState<GameState | null>(null);

  const handleStart = useCallback(() => {
    setFinalState(null);
    setScreen('game');
  }, []);

  const handleGameOver = useCallback((state: GameState) => {
    setFinalState(state);
    setScreen('result');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setFinalState(null);
    setScreen('game');
  }, []);

  if (screen === 'game') {
    return <GameScreenView onGameOver={handleGameOver} />;
  }

  if (screen === 'result' && finalState) {
    return <ResultScreen finalState={finalState} onPlayAgain={handlePlayAgain} />;
  }

  return <StartScreen onStart={handleStart} />;
}
