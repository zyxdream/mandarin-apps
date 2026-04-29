import type { MicState } from '../hooks/useMicrophone';

interface VoiceMeterProps {
  micState: MicState;
  volume: number;
  onEnableMic: () => void | Promise<void>;
}

export function VoiceMeter({ micState, volume, onEnableMic }: VoiceMeterProps) {
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
