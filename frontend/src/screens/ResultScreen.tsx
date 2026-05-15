import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types/game';
import type { Word } from '../types/word';
import { referenceAudioUrl } from '../audio/referenceAudio';
import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';
import type { ScriptSession } from '../data/scriptSessions';

interface ResultScreenProps {
  finalState: GameState;
  selectedFood: RewardFood;
  previousScriptSession: ScriptSession;
  scriptSession: ScriptSession;
  nextScriptSession: ScriptSession;
  onPreviousGame: () => void;
  onReplay: () => void;
  onNextGame: () => void;
  onBackToSessionSelect: () => void;
}

export function ResultScreen({
  finalState,
  selectedFood,
  previousScriptSession,
  scriptSession,
  nextScriptSession,
  onPreviousGame,
  onReplay,
  onNextGame,
  onBackToSessionSelect,
}: ResultScreenProps) {
  const { wordsHit, wordsMissed, combo } = finalState;
  const total = wordsHit.length + wordsMissed.length;
  const accuracy = total > 0 ? Math.round((wordsHit.length / total) * 100) : 0;
  const food = getRewardFoodOption(selectedFood);
  const foodUnits = foodUnitsForCorrectWords(wordsHit.length);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  const [audioErrorWordId, setAudioErrorWordId] = useState<string | null>(null);

  const stopReferenceAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = '';
      audioRef.current = null;
    }
    setPlayingWordId(null);
  }, []);

  useEffect(() => () => stopReferenceAudio(), [stopReferenceAudio]);

  const playWord = useCallback(
    (word: Word) => {
      stopReferenceAudio();
      setAudioErrorWordId(null);
      const url = word.audioUrl || referenceAudioUrl(word.id);
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingWordId(word.id);
      a.addEventListener('ended', () => {
        if (audioRef.current === a) {
          setPlayingWordId(null);
          audioRef.current = null;
        }
      });
      a.addEventListener('error', () => {
        console.warn('[word-audio] failed to load', word.id, url);
        setAudioErrorWordId(word.id);
        if (audioRef.current === a) {
          setPlayingWordId(null);
          audioRef.current = null;
        }
      });
      void a.play().catch(() => {
        setAudioErrorWordId(word.id);
        setPlayingWordId(null);
        audioRef.current = null;
      });
    },
    [stopReferenceAudio],
  );

  const handleNavigate = useCallback(
    (navigate: () => void) => {
      stopReferenceAudio();
      navigate();
    },
    [stopReferenceAudio],
  );

  return (
    <div className="result-screen">
      <div className="result-stack">
        <div className="result-content">
          <h1 className="result-title">Round Over!</h1>
          <div className="result-round-label">Finished: {scriptSession.title}</div>

          <div className="result-food-score">
            <img src={food.image} alt="" />
            <span>{foodUnits}</span>
          </div>
          <div className="result-score-label">{food.shortLabel} earned</div>

          <div className="result-stats">
            <div className="result-stat">
              <span className="result-stat-value result-stat-value--hit">{wordsHit.length}</span>
              <span className="result-stat-label">Whacked</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-value">{accuracy}%</span>
              <span className="result-stat-label">Accuracy</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-value result-stat-value--combo">{combo > 0 ? `x${combo}` : '—'}</span>
              <span className="result-stat-label">Last Combo</span>
            </div>
          </div>

          {wordsMissed.length > 0 && (
            <div className="result-missed">
              <h3 className="result-missed-title">Words to practice:</h3>
              <div className="result-missed-list">
                {wordsMissed.map((word, index) => {
                  const isPlaying = playingWordId === word.id;
                  const hasError = audioErrorWordId === word.id;
                  return (
                    <button
                      key={`${word.id}-${index}`}
                      type="button"
                      className={`result-missed-word result-missed-word--playable${isPlaying ? ' result-missed-word--playing' : ''}${hasError ? ' result-missed-word--error' : ''}`}
                      onClick={() => playWord(word)}
                      aria-label={`Play pronunciation: ${word.hanzi}`}
                    >
                      <span className="result-missed-hanzi">{word.hanzi}</span>
                      <span className="result-missed-pinyin">{word.pinyin}</span>
                      {hasError && (
                        <span className="result-missed-audio-hint" title="Reference clip missing or blocked">
                          ?
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="result-navigation">
            <button className="result-nav-button" onClick={() => handleNavigate(onPreviousGame)}>
              <span>Previous Game</span>
              <small>Previous: {previousScriptSession.title}</small>
            </button>
            <button className="result-nav-button result-nav-button--primary" onClick={() => handleNavigate(onReplay)}>
              <span>Replay</span>
              <small>Replay: {scriptSession.title}</small>
            </button>
            <button className="result-nav-button" onClick={() => handleNavigate(onNextGame)}>
              <span>Next Game</span>
              <small>Next: {nextScriptSession.title}</small>
            </button>
          </div>
        </div>
        <div className="result-back-unit">
          <button
            type="button"
            className="session-select-back-button result-back-button"
            onClick={() => handleNavigate(onBackToSessionSelect)}
            aria-label="Back to session list"
          >
            ↩
          </button>
        </div>
      </div>
    </div>
  );
}
