import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { MicState } from '../hooks/useMicrophone';
import type { PracticeUnit, SessionPracticeUnits } from '../data/session';
import { pinyinUnitAudioUrl } from '../data/session';
import { REWARD_FOODS, type RewardFood } from '../data/rewards';
import type { ScriptSession, ScriptToken } from '../data/scriptSessions';
import { referenceAudioUrl } from '../audio/referenceAudio';
import type { DeepWarmupStatus } from '../warmup/backendWarmup';

const HANZI_TOKEN_WEIGHT = 1;
const SENTENCE_PAUSE_WEIGHT = 1.6;
const PHRASE_PAUSE_WEIGHT = 0.8;
const OTHER_PUNCTUATION_WEIGHT = 0.35;
const SENTENCE_PAUSE_RE = /[。！？!?]/;
const PHRASE_PAUSE_RE = /[，、；：,;:]/;
const READY_PANEL_DEFAULT_WIDTH = 760;
const READY_PANEL_DEFAULT_MAX_HEIGHT = 520;
const READY_PANEL_MIN_WIDTH = 240;
const READY_PANEL_MIN_MAX_HEIGHT = 260;
const READY_PANEL_MAX_WIDTH_CAP = 1200;
const READY_PANEL_MAX_HEIGHT_CAP = 1300;

interface VoiceMeterProps {
  micState: MicState;
  volume: number;
  sessionPracticeUnits: SessionPracticeUnits;
  scriptSession: ScriptSession;
  selectedFood: RewardFood;
  onSelectFood: (food: RewardFood) => void;
  onEnableMic: () => void | Promise<void>;
  isPreparingGame: boolean;
  asrWarmupStatus: DeepWarmupStatus;
}

interface ReadyPanelSize {
  widthPx: number;
  maxHeightPx: number;
}

type ReadyPanelResizeAnchor = 'top-left' | 'top-right';

interface ReadyPanelBounds {
  minWidth: number;
  maxWidth: number;
  minMaxHeight: number;
  maxMaxHeight: number;
}

function clampPanelSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getReadyPanelBounds(viewportWidth: number, viewportHeight: number): ReadyPanelBounds {
  const maxWidth = clampPanelSize(Math.round(viewportWidth * 0.98), READY_PANEL_MIN_WIDTH, READY_PANEL_MAX_WIDTH_CAP);
  const minWidth = clampPanelSize(Math.round(viewportWidth * 0.3), READY_PANEL_MIN_WIDTH, maxWidth);
  const minMaxHeight = clampPanelSize(Math.round(viewportHeight * 0.28), READY_PANEL_MIN_MAX_HEIGHT, READY_PANEL_MAX_HEIGHT_CAP);
  const maxMaxHeight = READY_PANEL_MAX_HEIGHT_CAP;
  return { minWidth, maxWidth, minMaxHeight, maxMaxHeight };
}

function getDefaultReadyPanelSize(): ReadyPanelSize {
  if (typeof window === 'undefined') {
    return { widthPx: READY_PANEL_DEFAULT_WIDTH, maxHeightPx: READY_PANEL_DEFAULT_MAX_HEIGHT };
  }
  const bounds = getReadyPanelBounds(window.innerWidth, window.innerHeight);
  return {
    widthPx: clampPanelSize(READY_PANEL_DEFAULT_WIDTH, bounds.minWidth, bounds.maxWidth),
    maxHeightPx: clampPanelSize(READY_PANEL_DEFAULT_MAX_HEIGHT, bounds.minMaxHeight, bounds.maxMaxHeight),
  };
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
  isPreparingGame,
  asrWarmupStatus,
}: VoiceMeterProps) {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingUnitId, setPlayingUnitId] = useState<string | null>(null);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  const [isScriptPlaying, setIsScriptPlaying] = useState(false);
  const [scriptCurrentTime, setScriptCurrentTime] = useState(0);
  const [scriptDuration, setScriptDuration] = useState(0);
  const needsEnable = micState === 'idle' || micState === 'requesting';
  const showReadyPanel = needsEnable || isPreparingGame;
  const [readyPanelSize, setReadyPanelSize] = useState<ReadyPanelSize>(() => getDefaultReadyPanelSize());
  const [isResizingReadyPanel, setIsResizingReadyPanel] = useState(false);
  const readyPanelDragRef = useRef<{
    anchor: ReadyPanelResizeAnchor;
    startX: number;
    startY: number;
    startWidth: number;
    startMaxHeight: number;
    bounds: ReadyPanelBounds;
  } | null>(null);
  const wasReadyPanelVisibleRef = useRef(showReadyPanel);
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

  const clampReadyPanelSizeToViewport = useCallback((size: ReadyPanelSize): ReadyPanelSize => {
    if (typeof window === 'undefined') return size;
    const bounds = getReadyPanelBounds(window.innerWidth, window.innerHeight);
    return {
      widthPx: clampPanelSize(size.widthPx, bounds.minWidth, bounds.maxWidth),
      maxHeightPx: clampPanelSize(size.maxHeightPx, bounds.minMaxHeight, bounds.maxMaxHeight),
    };
  }, []);

  const handleResizeStart = useCallback((anchor: ReadyPanelResizeAnchor, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!showReadyPanel || typeof window === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();

    readyPanelDragRef.current = {
      anchor,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: readyPanelSize.widthPx,
      startMaxHeight: readyPanelSize.maxHeightPx,
      bounds: getReadyPanelBounds(window.innerWidth, window.innerHeight),
    };

    setIsResizingReadyPanel(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [readyPanelSize.maxHeightPx, readyPanelSize.widthPx, showReadyPanel]);

  useEffect(() => {
    if (showReadyPanel && !wasReadyPanelVisibleRef.current) {
      setReadyPanelSize(getDefaultReadyPanelSize());
    }
    wasReadyPanelVisibleRef.current = showReadyPanel;
  }, [showReadyPanel]);

  useEffect(() => {
    if (!showReadyPanel) return undefined;
    const handleViewportResize = () => {
      setReadyPanelSize(current => clampReadyPanelSizeToViewport(current));
    };

    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [clampReadyPanelSizeToViewport, showReadyPanel]);

  useEffect(() => {
    if (!isResizingReadyPanel) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = readyPanelDragRef.current;
      if (!dragState) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      const widthDelta = dragState.anchor === 'top-left' ? -deltaX : deltaX;
      setReadyPanelSize({
        widthPx: clampPanelSize(dragState.startWidth + widthDelta, dragState.bounds.minWidth, dragState.bounds.maxWidth),
        maxHeightPx: clampPanelSize(
          dragState.startMaxHeight - deltaY,
          dragState.bounds.minMaxHeight,
          dragState.bounds.maxMaxHeight,
        ),
      });
    };

    const stopResizing = () => {
      readyPanelDragRef.current = null;
      setIsResizingReadyPanel(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [isResizingReadyPanel]);

  useEffect(() => stopCurrentAudio, [stopCurrentAudio]);

  if (micState === 'denied') {
    return (
      <div className="mic-denied">
        Microphone access denied. Please allow mic access and reload.
      </div>
    );
  }

  const readyPanelStyle: (CSSProperties & {
    '--ready-panel-width': string;
    '--ready-panel-max-height': string;
  }) | undefined = showReadyPanel
    ? {
      '--ready-panel-width': `${readyPanelSize.widthPx}px`,
      '--ready-panel-max-height': `${readyPanelSize.maxHeightPx}px`,
    }
    : undefined;
  const volumePercent = Math.round(Math.max(0, Math.min(100, volume * 100)));
  const isWarmupPending = isPreparingGame && asrWarmupStatus !== 'ready' && asrWarmupStatus !== 'failed';
  const readyButtonDisabled = micState === 'requesting' || (isPreparingGame && asrWarmupStatus !== 'failed');
  const readyButtonLabel = (() => {
    if (micState === 'requesting') return 'Opening mic...';
    if (isPreparingGame && asrWarmupStatus === 'failed') return 'Try again';
    if (isPreparingGame && asrWarmupStatus === 'ready' && micState === 'listening') return 'Starting...';
    if (isWarmupPending) return 'Loading pronunciation...';
    return 'Ready? Set, Go!';
  })();

  return (
    <div
      className={`voice-meter voice-meter--${micState}${showReadyPanel ? ' voice-meter--ready' : ''}${isResizingReadyPanel ? ' voice-meter--resizing' : ''}`}
      style={readyPanelStyle}
    >
      <div className="voice-meter-header">
        <span>{showReadyPanel ? 'Practice before the game' : 'Voice meter'}</span>
      </div>
      {showReadyPanel && (
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
                    <img className="food-option-image" src={food.baseImage} alt="" />
                    <span>{food.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {showReadyPanel && (
        <>
          <button
            type="button"
            className="voice-meter-resize-handle voice-meter-resize-handle--top-left"
            onPointerDown={event => handleResizeStart('top-left', event)}
            aria-label="Drag top-left corner to resize panel"
            title="Drag to resize panel"
          />
          <button
            type="button"
            className="voice-meter-resize-handle voice-meter-resize-handle--top-right"
            onPointerDown={event => handleResizeStart('top-right', event)}
            aria-label="Drag top-right corner to resize panel"
            title="Drag to resize panel"
          />
        </>
      )}
      {showReadyPanel ? (
        <button className="voice-meter-button" onClick={handleEnableMic} disabled={readyButtonDisabled}>
          {readyButtonLabel}
        </button>
      ) : (
        <>
          <div className="voice-meter-percent">{volumePercent}%</div>
          <div className="voice-meter-track" aria-hidden="true">
            <div className="voice-meter-fill" style={{ width: `${volumePercent}%` }} />
          </div>
          <div className="voice-meter-hint">Speak louder to swing harder!</div>
        </>
      )}
    </div>
  );
}
