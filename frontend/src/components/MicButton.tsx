import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MicState } from '../hooks/useMicrophone';
import type { PracticeUnit, SessionPracticeUnits } from '../data/session';
import { pinyinUnitAudioUrl } from '../data/session';
import { REWARD_FOODS, type RewardFood } from '../data/rewards';
import type { ScriptSession, ScriptToken } from '../data/scriptSessions';
import { referenceAudioUrl } from '../audio/referenceAudio';

const HANZI_TOKEN_WEIGHT = 1;
const SENTENCE_PAUSE_WEIGHT = 1.6;
const PHRASE_PAUSE_WEIGHT = 0.8;
const OTHER_PUNCTUATION_WEIGHT = 0.35;
const SENTENCE_PAUSE_RE = /[。！？!?]/;
const PHRASE_PAUSE_RE = /[，、；：,;:]/;

interface VoiceMeterProps {
  micState: MicState;
  volume: number;
  sessionPracticeUnits: SessionPracticeUnits;
  scriptSession: ScriptSession;
  selectedFood: RewardFood;
  onSelectFood: (food: RewardFood) => void;
  onEnableMic: () => void | Promise<void>;
}

function SessionUnitChip({
  unit,
  onPlay,
  playingId,
}: {
  unit: PracticeUnit;
  onPlay: (unit: PracticeUnit) => void;
  playingId: string | null;
}) {
  const isPlaying = playingId === unit.id;
  return (
    <button
      type="button"
      className={`session-unit-chip${isPlaying ? ' session-unit-chip--playing' : ''}`}
      onClick={() => onPlay(unit)}
      aria-label={`Play unit ${unit.label}`}
    >
      <span className="session-unit-chip-label">{unit.label}</span>
      {unit.sequence.length > 1 && (
        <span className="session-unit-chip-seq">{unit.sequence.join(' + ')}</span>
      )}
    </button>
  );
}

function tokenTimingWeight(token: ScriptToken): number {
  if (token.pinyin) return HANZI_TOKEN_WEIGHT;
  if (SENTENCE_PAUSE_RE.test(token.text)) return SENTENCE_PAUSE_WEIGHT;
  if (PHRASE_PAUSE_RE.test(token.text)) return PHRASE_PAUSE_WEIGHT;
  return OTHER_PUNCTUATION_WEIGHT;
}

function estimateActiveTokenIndex(tokens: ScriptToken[], currentTime: number, duration: number): number | null {
  if (!tokens.length || !Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const totalWeight = tokens.reduce((total, token) => total + tokenTimingWeight(token), 0);
  if (totalWeight <= 0) return null;

  const targetWeight = Math.max(0, Math.min(1, currentTime / duration)) * totalWeight;
  let cumulativeWeight = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    cumulativeWeight += tokenTimingWeight(tokens[index]);
    if (targetWeight <= cumulativeWeight) return index;
  }
  return tokens.length - 1;
}

function hasAlignedTokenTimings(tokens: ScriptToken[]): boolean {
  return tokens.some(token => (
    token.timingSource === 'aligned' &&
    Number.isFinite(token.startSec) &&
    Number.isFinite(token.endSec)
  ));
}

function timedActiveTokenIndex(tokens: ScriptToken[], currentTime: number): number | null {
  if (!tokens.length || !Number.isFinite(currentTime)) return null;

  let latestPassedIndex: number | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!Number.isFinite(token.startSec) || !Number.isFinite(token.endSec)) continue;

    const startSec = token.startSec ?? 0;
    const endSec = token.endSec ?? startSec;
    if (currentTime >= startSec && currentTime <= endSec) {
      return index;
    }
    if (currentTime > endSec) {
      latestPassedIndex = index;
    }
  }

  return latestPassedIndex;
}

function activeScriptTokenIndex(tokens: ScriptToken[], currentTime: number, duration: number): number | null {
  if (hasAlignedTokenTimings(tokens)) {
    return timedActiveTokenIndex(tokens, currentTime);
  }
  return estimateActiveTokenIndex(tokens, currentTime, duration);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function activeScriptTokenProgress(tokens: ScriptToken[], activeTokenIndex: number | null, currentTime: number): number {
  if (activeTokenIndex === null) return 0;
  const token = tokens[activeTokenIndex];
  if (!token || !Number.isFinite(token.startSec) || !Number.isFinite(token.endSec)) return 1;

  const startSec = token.startSec ?? 0;
  const endSec = token.endSec ?? startSec;
  const duration = endSec - startSec;
  if (duration <= 0.02) return currentTime >= endSec ? 1 : 0;

  return clampProgress((currentTime - startSec) / duration);
}

function ScriptReadingText({
  tokens,
  activeTokenIndex,
  activeTokenProgress,
  isPlaying,
}: {
  tokens: ScriptToken[];
  activeTokenIndex: number | null;
  activeTokenProgress: number;
  isPlaying: boolean;
}) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const tokenRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const textElement = textRef.current;
    const activeElement = activeTokenIndex === null ? null : tokenRefs.current[activeTokenIndex];
    if (!isPlaying || activeTokenIndex === null || !textElement || !activeElement) {
      return undefined;
    }

    activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return undefined;
  }, [activeTokenIndex, isPlaying]);

  return (
    <span ref={textRef} className="script-reading-text">
      {tokens.map((token, index) => {
        const isActive = isPlaying && activeTokenIndex === index;
        const tokenStyle = isActive
          ? ({ '--karaoke-progress': `${activeTokenProgress * 100}%` } as CSSProperties)
          : undefined;
        return token.pinyin ? (
          <span
            key={`${token.text}-${index}`}
            ref={element => {
              tokenRefs.current[index] = element;
            }}
            data-token-index={index}
            className={`script-reading-token${isActive ? ' script-reading-token--active' : ''}`}
            style={tokenStyle}
          >
            <span className="script-reading-token-pinyin">{token.pinyin}</span>
            <span className="script-reading-token-hanzi">{token.text}</span>
          </span>
        ) : (
          <span
            key={`${token.text}-${index}`}
            ref={element => {
              tokenRefs.current[index] = element;
            }}
            data-token-index={index}
            className={`script-reading-punctuation${isActive ? ' script-reading-punctuation--active' : ''}`}
          >
            {token.text}
          </span>
        );
      })}
    </span>
  );
}

function SessionWordList({
  words,
  playingWordId,
  onPlayWord,
}: {
  words: ScriptSession['words'];
  playingWordId: string | null;
  onPlayWord: (word: ScriptSession['words'][number]) => void;
}) {
  return (
    <div className="session-word-list" aria-label="Words in this round">
      {words.map(word => (
        <button
          key={word.id}
          type="button"
          className={`session-word-card${playingWordId === word.id ? ' session-word-card--playing' : ''}`}
          onClick={() => onPlayWord(word)}
          aria-pressed={playingWordId === word.id}
          aria-label={`${playingWordId === word.id ? 'Stop' : 'Play'} ${word.hanzi}`}
        >
          <span className="session-word-pinyin">{word.pinyin}</span>
          <span className="session-word-hanzi">{word.hanzi}</span>
        </button>
      ))}
    </div>
  );
}

export function VoiceMeter({
  micState,
  volume,
  sessionPracticeUnits,
  scriptSession,
  selectedFood,
  onSelectFood,
  onEnableMic,
}: VoiceMeterProps) {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingUnitId, setPlayingUnitId] = useState<string | null>(null);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  const [isScriptPlaying, setIsScriptPlaying] = useState(false);
  const [scriptCurrentTime, setScriptCurrentTime] = useState(0);
  const [scriptDuration, setScriptDuration] = useState(0);
  const needsEnable = micState === 'idle' || micState === 'requesting';
  const currentScriptTokenIndex = isScriptPlaying
    ? activeScriptTokenIndex(scriptSession.scriptTokens, scriptCurrentTime, scriptDuration)
    : null;
  const currentScriptTokenProgress = isScriptPlaying
    ? activeScriptTokenProgress(scriptSession.scriptTokens, currentScriptTokenIndex, scriptCurrentTime)
    : 0;

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }
    setPlayingUnitId(null);
    setPlayingWordId(null);
    setIsScriptPlaying(false);
    setScriptCurrentTime(0);
    setScriptDuration(0);
  }, []);

  const playSequence = useCallback(
    async (sequence: string[]) => {
      for (const segment of sequence) {
        const audio = new Audio(pinyinUnitAudioUrl(segment));
        currentAudioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('error', onError);
          };
          const onEnded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error(`Failed to play unit segment ${segment}`));
          };
          audio.addEventListener('ended', onEnded);
          audio.addEventListener('error', onError);
          void audio.play().catch(reject);
        });
      }
    },
    [],
  );

  const handlePlayUnit = useCallback(
    async (unit: PracticeUnit) => {
      stopCurrentAudio();
      setIsScriptPlaying(false);
      setPlayingUnitId(unit.id);
      try {
        await playSequence(unit.sequence);
      } catch (error) {
        console.warn('[unit-audio] playback failed', unit, error);
      } finally {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.src = '';
          currentAudioRef.current = null;
        }
        setPlayingUnitId(null);
        setPlayingWordId(null);
      }
    },
    [playSequence, stopCurrentAudio],
  );

  const handlePlayWord = useCallback(
    (word: ScriptSession['words'][number]) => {
      if (playingWordId === word.id) {
        stopCurrentAudio();
        return;
      }

      stopCurrentAudio();
      const url = word.audioUrl || referenceAudioUrl(word.id);
      if (!word.audioUrl) {
        console.warn('[word-audio] missing script TTS; falling back to reference clip', word.id);
      }

      const audio = new Audio(url);
      currentAudioRef.current = audio;
      setPlayingWordId(word.id);

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
          setPlayingWordId(null);
        }
      };
      const onEnded = () => cleanup();
      const onError = () => {
        console.warn('[word-audio] playback failed', word);
        cleanup();
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      void audio.play().catch(error => {
        console.warn('[word-audio] playback failed', word, error);
        cleanup();
      });
    },
    [playingWordId, stopCurrentAudio],
  );

  const handleToggleScriptAudio = useCallback(() => {
    if (isScriptPlaying) {
      stopCurrentAudio();
      return;
    }

    stopCurrentAudio();
    if (!scriptSession.audioUrl) {
      console.warn('[script-audio] no audio URL for session', scriptSession.id);
      return;
    }

    const audio = new Audio(scriptSession.audioUrl);
    currentAudioRef.current = audio;
    setIsScriptPlaying(true);
    setScriptCurrentTime(0);
    setScriptDuration(0);
    let playbackFrame = 0;

    const cleanup = () => {
      if (playbackFrame) {
        window.cancelAnimationFrame(playbackFrame);
        playbackFrame = 0;
      }
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (currentAudioRef.current === audio) {
        currentAudioRef.current = null;
        setIsScriptPlaying(false);
        setScriptCurrentTime(0);
        setScriptDuration(0);
      }
    };
    const onPlaybackFrame = () => {
      setScriptCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration)) {
        setScriptDuration(audio.duration);
      }
      playbackFrame = window.requestAnimationFrame(onPlaybackFrame);
    };
    const onLoadedMetadata = () => {
      setScriptDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setScriptCurrentTime(audio.currentTime);
    };
    const onTimeUpdate = () => {
      setScriptCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration)) {
        setScriptDuration(audio.duration);
      }
    };
    const onEnded = () => cleanup();
    const onError = () => {
      console.warn('[script-audio] playback failed', scriptSession);
      cleanup();
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    void audio
      .play()
      .then(() => {
        playbackFrame = window.requestAnimationFrame(onPlaybackFrame);
      })
      .catch(error => {
        console.warn('[script-audio] playback failed', scriptSession, error);
        cleanup();
      });
  }, [isScriptPlaying, scriptSession, stopCurrentAudio]);

  const handleEnableMic = useCallback(() => {
    stopCurrentAudio();
    void onEnableMic();
  }, [onEnableMic, stopCurrentAudio]);

  useEffect(() => stopCurrentAudio, [stopCurrentAudio]);

  if (micState === 'denied') {
    return (
      <div className="mic-denied">
        Microphone access denied. Please allow mic access and reload.
      </div>
    );
  }

  const percent = Math.round(volume * 100);

  return (
    <div className={`voice-meter voice-meter--${micState}`}>
      <div className="voice-meter-header">
        <span>Practice before the game</span>
        <span className="voice-meter-percent">{percent}%</span>
      </div>
      <div className="voice-meter-track" aria-label="Voice volume meter">
        <div className="voice-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      {needsEnable && (
        <div className="session-practice">
          <button
            type="button"
            className={`script-reading-card${isScriptPlaying ? ' script-reading-card--playing' : ''}`}
            onClick={handleToggleScriptAudio}
            aria-pressed={isScriptPlaying}
            aria-label={`${isScriptPlaying ? 'Stop' : 'Play'} ${scriptSession.title} reading`}
          >
            <span className="script-reading-kicker">Listen first</span>
            <span className="script-reading-title">{scriptSession.title}</span>
            <span className="script-reading-source">{scriptSession.source.join(' · ')}</span>
            <ScriptReadingText
              tokens={scriptSession.scriptTokens}
              activeTokenIndex={currentScriptTokenIndex}
              activeTokenProgress={currentScriptTokenProgress}
              isPlaying={isScriptPlaying}
            />
            <span className="script-reading-action">{isScriptPlaying ? 'Tap to stop' : 'Tap to play slow reading'}</span>
          </button>

          <div className="session-practice-title">This Round Practice Units</div>
          <div className="session-practice-group">
            <div className="session-practice-label">Initials</div>
            <div className="session-practice-chips">
              {sessionPracticeUnits.initials.map(unit => (
                <SessionUnitChip
                  key={unit.id}
                  unit={unit}
                  onPlay={handlePlayUnit}
                  playingId={playingUnitId}
                />
              ))}
            </div>
          </div>
          <div className="session-practice-group">
            <div className="session-practice-label">Finals</div>
            <div className="session-practice-chips">
              {sessionPracticeUnits.finals.map(unit => (
                <SessionUnitChip
                  key={unit.id}
                  unit={unit}
                  onPlay={handlePlayUnit}
                  playingId={playingUnitId}
                />
              ))}
            </div>
          </div>

          <div className="session-practice-title session-practice-title--words">Words In This Round</div>
          <SessionWordList words={scriptSession.words} playingWordId={playingWordId} onPlayWord={handlePlayWord} />

          <div className="food-picker">
            <div className="food-picker-title">Select a food for the moles to enjoy after the game :)</div>
            <div className="food-picker-options">
              {REWARD_FOODS.map(food => {
                const isSelected = selectedFood === food.id;
                return (
                  <button
                    key={food.id}
                    type="button"
                    className={`food-option${isSelected ? ' food-option--selected' : ''}`}
                    onClick={() => onSelectFood(food.id)}
                    aria-pressed={isSelected}
                    aria-label={`Choose ${food.label}`}
                  >
                    <img className="food-option-image" src={food.image} alt="" />
                    <span>{food.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {needsEnable ? (
        <button className="voice-meter-button" onClick={handleEnableMic} disabled={micState === 'requesting'}>
          {micState === 'requesting' ? 'Opening mic...' : 'Ready? Set, Go!'}
        </button>
      ) : (
        <div className="voice-meter-hint">Speak louder to swing harder!</div>
      )}
    </div>
  );
}
