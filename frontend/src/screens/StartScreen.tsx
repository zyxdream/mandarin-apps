interface StartScreenProps {
  onStart: () => void;
}

export function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="start-screen">
      <div className="start-cover-panels" aria-hidden="true">
        <img
          className="start-cover-panel start-cover-panel--top"
          src="/assets/objects/cover_word_banner_top.v2.webp"
          alt=""
        />
        <img
          className="start-cover-panel start-cover-panel--lower"
          src="/assets/objects/cover_word_banner_lower.v2.webp"
          alt=""
        />
      </div>

      <div className="start-content">
        <span className="start-subtitle">Whack-a-Mole Mandarin</span>

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
