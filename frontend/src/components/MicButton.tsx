import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicState } from '../hooks/useMicrophone';
import type { PracticeUnit, SessionPracticeUnits } from '../data/session';
import { pinyinUnitAudioUrl } from '../data/session';

interface VoiceMeterProps {
  micState: MicState;
  volume: number;
  sessionPracticeUnits: SessionPracticeUnits;
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

export function VoiceMeter({
  micState,
  volume,
  sessionPracticeUnits,
  onEnableMic,
}: VoiceMeterProps) {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingUnitId, setPlayingUnitId] = useState<string | null>(null);

  const stopCurrentAudio = useCallback(() => {
    if (!currentAudioRef.current) return;
    currentAudioRef.current.pause();
    currentAudioRef.current.src = '';
    currentAudioRef.current = null;
    setPlayingUnitId(null);
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
      }
    },
    [playSequence, stopCurrentAudio],
  );

  useEffect(() => stopCurrentAudio, [stopCurrentAudio]);

  if (micState === 'denied') {
    return (
      <div className="mic-denied">
        Microphone access denied. Please allow mic access and reload.
      </div>
    );
  }

  const percent = Math.round(volume * 100);
  const needsEnable = micState === 'idle' || micState === 'requesting';

  return (
    <div className={`voice-meter voice-meter--${micState}`}>
      <div className="voice-meter-header">
        <span>Your voice powers the hammer</span>
        <span className="voice-meter-percent">{percent}%</span>
      </div>
      <div className="voice-meter-track" aria-label="Voice volume meter">
        <div className="voice-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      {needsEnable && (
        <div className="session-practice">
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
        </div>
      )}
      {needsEnable ? (
        <button className="voice-meter-button" onClick={onEnableMic} disabled={micState === 'requesting'}>
          {micState === 'requesting' ? 'Opening mic...' : 'Enable mic'}
        </button>
      ) : (
        <div className="voice-meter-hint">Speak louder to swing harder!</div>
      )}
    </div>
  );
}
