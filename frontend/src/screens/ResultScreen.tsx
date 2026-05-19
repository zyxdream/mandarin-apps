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

const RESULT_AMBIENCE_AUDIO = '/audio/sound_effects/happy-logo-trim.mov';
const RESULT_AMBIENCE_VOLUME = 0.32;
const RESULT_AMBIENCE_DUCK_FACTOR = 0.3;
const RESULT_AMBIENCE_FADE_IN_MS = 900;
const RESULT_AMBIENCE_FADE_OUT_MS = 1800;

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
  const { wordsHit, wordsMissed, maxCombo } = finalState;
  const totalWords = wordsHit.length + wordsMissed.length;
  const accuracyRate = totalWords > 0 ? wordsHit.length / totalWords : 0;
  const accuracyPercent = Math.round(accuracyRate * 100);
  const earnedStars = totalWords > 0 && wordsHit.length === totalWords ? 3 : accuracyRate >= 0.3 ? 2 : 1;
  const food = getRewardFoodOption(selectedFood);
  const foodUnits = foodUnitsForCorrectWords(wordsHit.length);
  const maxFoodUnits = foodUnitsForCorrectWords(totalWords);
  const SCORE_STAR = '/assets/ui/score_star.v2.webp';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceFadeOutTimerRef = useRef<number | null>(null);
  const ambienceFadeRafRef = useRef<number | null>(null);
  const ambienceDuckedRef = useRef(false);
  const ambienceFadeGainRef = useRef(1);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  const [audioErrorWordId, setAudioErrorWordId] = useState<string | null>(null);

  const setAmbienceElementVolume = useCallback((volume: number) => {
    const ambience = ambienceAudioRef.current;
    if (!ambience) return;
    ambience.volume = Math.max(0, Math.min(1, volume));
  }, []);

  const applyAmbienceVolume = useCallback(() => {
    const duckGain = ambienceDuckedRef.current ? RESULT_AMBIENCE_DUCK_FACTOR : 1;
    const effectiveVolume = RESULT_AMBIENCE_VOLUME * ambienceFadeGainRef.current * duckGain;
    setAmbienceElementVolume(effectiveVolume);
  }, [setAmbienceElementVolume]);

  const cancelAmbienceFadeAnimation = useCallback(() => {
    if (ambienceFadeRafRef.current !== null) {
      cancelAnimationFrame(ambienceFadeRafRef.current);
      ambienceFadeRafRef.current = null;
    }
  }, []);

  const animateAmbienceFade = useCallback(
    (targetGain: number, durationMs: number) => {
      const to = Math.max(0, Math.min(1, targetGain));
      const from = Math.max(0, Math.min(1, ambienceFadeGainRef.current));
      const clampedDurationMs = Math.max(0, durationMs);
      if (Math.abs(from - to) < 0.001) {
        ambienceFadeGainRef.current = to;
        applyAmbienceVolume();
        return;
      }
      if (clampedDurationMs === 0) {
        ambienceFadeGainRef.current = to;
        applyAmbienceVolume();
        return;
      }

      cancelAmbienceFadeAnimation();
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.max(0, Math.min(1, (now - startedAt) / clampedDurationMs));
        ambienceFadeGainRef.current = from + (to - from) * progress;
        applyAmbienceVolume();
        if (progress < 1) {
          ambienceFadeRafRef.current = requestAnimationFrame(tick);
        } else {
          ambienceFadeRafRef.current = null;
        }
      };

      ambienceFadeRafRef.current = requestAnimationFrame(tick);
    },
    [applyAmbienceVolume, cancelAmbienceFadeAnimation],
  );

  const setAmbienceDucked = useCallback(
    (ducked: boolean) => {
      ambienceDuckedRef.current = ducked;
      applyAmbienceVolume();
    },
    [applyAmbienceVolume],
  );

  const restoreAmbienceVolume = useCallback(() => {
    setAmbienceDucked(false);
  }, [setAmbienceDucked]);

  const stopReferenceAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = '';
      audioRef.current = null;
    }
    setPlayingWordId(null);
    restoreAmbienceVolume();
  }, [restoreAmbienceVolume]);

  useEffect(() => () => stopReferenceAudio(), [stopReferenceAudio]);

  useEffect(() => {
    let disposed = false;
    const ambience = new Audio(RESULT_AMBIENCE_AUDIO);
    ambience.loop = false;
    ambience.preload = 'auto';
    ambienceAudioRef.current = ambience;
    ambienceFadeGainRef.current = 0;
    applyAmbienceVolume();

    const clearFadeOutTimer = () => {
      if (ambienceFadeOutTimerRef.current !== null) {
        window.clearTimeout(ambienceFadeOutTimerRef.current);
        ambienceFadeOutTimerRef.current = null;
      }
    };

    const scheduleFadeOut = () => {
      clearFadeOutTimer();
      const durationSec = ambience.duration;
      if (!Number.isFinite(durationSec) || durationSec <= 0) return;
      const fadeOutDelayMs = Math.max(0, Math.round(durationSec * 1000 - RESULT_AMBIENCE_FADE_OUT_MS));
      ambienceFadeOutTimerRef.current = window.setTimeout(() => {
        ambienceFadeOutTimerRef.current = null;
        animateAmbienceFade(0, RESULT_AMBIENCE_FADE_OUT_MS);
      }, fadeOutDelayMs);
    };

    const playAmbience = () => {
      if (disposed) return;
      clearFadeOutTimer();
      cancelAmbienceFadeAnimation();
      ambience.currentTime = 0;
      ambienceFadeGainRef.current = 0;
      setAmbienceDucked(ambienceDuckedRef.current);
      applyAmbienceVolume();
      void ambience.play().catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('[audio] result ambience play failed', error);
      });
      animateAmbienceFade(1, RESULT_AMBIENCE_FADE_IN_MS);
      scheduleFadeOut();
    };

    const handleEnded = () => {
      clearFadeOutTimer();
      playAmbience();
    };

    const handleLoadedMetadata = () => {
      if (ambience.currentTime <= 0.1 && !ambience.paused) {
        scheduleFadeOut();
      }
    };

    ambience.addEventListener('ended', handleEnded);
    ambience.addEventListener('loadedmetadata', handleLoadedMetadata);
    playAmbience();

    return () => {
      disposed = true;
      clearFadeOutTimer();
      cancelAmbienceFadeAnimation();
      ambience.removeEventListener('ended', handleEnded);
      ambience.removeEventListener('loadedmetadata', handleLoadedMetadata);
      ambience.pause();
      ambience.src = '';
      if (ambienceAudioRef.current === ambience) {
        ambienceAudioRef.current = null;
      }
    };
  }, [animateAmbienceFade, applyAmbienceVolume, cancelAmbienceFadeAnimation, setAmbienceDucked]);

  const playWord = useCallback(
    (word: Word) => {
      stopReferenceAudio();
      setAudioErrorWordId(null);
      const url = word.audioUrl || referenceAudioUrl(word.id);
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingWordId(word.id);
      setAmbienceDucked(true);
      a.addEventListener('ended', () => {
        if (audioRef.current === a) {
          setPlayingWordId(null);
          audioRef.current = null;
        }
        restoreAmbienceVolume();
      });
      a.addEventListener('error', () => {
        console.warn('[word-audio] failed to load', word.id, url);
        setAudioErrorWordId(word.id);
        if (audioRef.current === a) {
          setPlayingWordId(null);
          audioRef.current = null;
        }
        restoreAmbienceVolume();
      });
      void a.play().catch(() => {
        setAudioErrorWordId(word.id);
        setPlayingWordId(null);
        audioRef.current = null;
        restoreAmbienceVolume();
      });
    },
    [restoreAmbienceVolume, setAmbienceDucked, stopReferenceAudio],
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
          <div className="result-star-header" aria-label={`${earnedStars} of 3 stars earned`}>
            <div className="result-star-crown" aria-hidden="true">
              {[0, 1, 2].map(index => {
                const starNumber = index + 1;
                const isEarned = starNumber <= earnedStars;
                return (
                  <img
                    key={starNumber}
                    className={`result-star${isEarned ? ' result-star--earned' : ' result-star--muted'}`}
                    src={SCORE_STAR}
                    alt=""
                    style={isEarned ? { animationDelay: `${index * 0.22}s` } : undefined}
                  />
                );
              })}
            </div>
            <div className="result-round-label">{scriptSession.title}</div>
          </div>

          <div className="result-food-score">
            <img src={food.baseImage} alt="" />
            <span className="result-food-score-amount">
              <span className="result-food-score-earned">{foodUnits}</span>
              <span className="result-food-score-total">of {maxFoodUnits}</span>
            </span>
          </div>
          <div className="result-score-label">{food.shortLabel} earned</div>

          <div className="result-stats">
            <div className="result-stat">
              <span className="result-stat-value result-stat-value--hit">{wordsHit.length}</span>
              <span className="result-stat-label">Whacked</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-value result-stat-value--food">{`${accuracyPercent}%`}</span>
              <span className="result-stat-label">Accuracy</span>
            </div>
            <div className="result-stat">
              <span className="result-stat-value result-stat-value--combo">{maxCombo}</span>
              <span className="result-stat-label">Best Streak</span>
            </div>
          </div>

          <div className="result-missed">
            <h3 className="result-missed-title">Words missed:</h3>
            {wordsMissed.length > 0 ? (
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
            ) : (
              <div className="result-missed-empty">None - perfect round!</div>
            )}
          </div>

          <div className="result-navigation">
            <button
              className="result-nav-button result-nav-button--previous"
              onClick={() => handleNavigate(onPreviousGame)}
            >
              <span>Previous Game</span>
              <small>{previousScriptSession.title}</small>
            </button>
            <button className="result-nav-button result-nav-button--primary" onClick={() => handleNavigate(onReplay)}>
              <span>Replay</span>
              <small>Replay: {scriptSession.title}</small>
            </button>
            <button className="result-nav-button" onClick={() => handleNavigate(onNextGame)}>
              <span>Next Game</span>
              <small>{nextScriptSession.title}</small>
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
