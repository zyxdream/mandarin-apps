interface StartScreenProps {
  onStart: () => void;
}

export function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="start-title">
          <span className="start-hanzi">打地鼠拼音</span>
          <span className="start-subtitle">Whack-a-Mole Mandarin</span>
        </div>

        <div className="start-instructions">
          <p>Enter the game, then enable mic.</p>
          <p>Speak the pinyin to swing the hammer.</p>
          <p>Whack, collect, combo, and try again!</p>
        </div>

        <div className="start-tips">
          <div className="tip">
            <span className="tip-dot tip-dot--red" /> Tone 1 — flat
          </div>
          <div className="tip">
            <span className="tip-dot tip-dot--orange" /> Tone 2 — rising
          </div>
          <div className="tip">
            <span className="tip-dot tip-dot--green" /> Tone 3 — dip
          </div>
          <div className="tip">
            <span className="tip-dot tip-dot--blue" /> Tone 4 — falling
          </div>
        </div>

        <button className="start-button" onClick={onStart}>
          Enter Game
        </button>
      </div>
    </div>
  );
}
