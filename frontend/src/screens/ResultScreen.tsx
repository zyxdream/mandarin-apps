import type { GameState } from '../types/game';

interface ResultScreenProps {
  finalState: GameState;
  onPlayAgain: () => void;
}

export function ResultScreen({ finalState, onPlayAgain }: ResultScreenProps) {
  const { score, wordsHit, wordsMissed, combo } = finalState;
  const total = wordsHit.length + wordsMissed.length;
  const accuracy = total > 0 ? Math.round((wordsHit.length / total) * 100) : 0;

  return (
    <div className="result-screen">
      <div className="result-content">
        <h1 className="result-title">Round Over!</h1>

        <div className="result-score">{score}</div>
        <div className="result-score-label">FINAL SCORE</div>

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
              {wordsMissed.map((word, index) => (
                <div key={`${word.id}-${index}`} className="result-missed-word">
                  <span className="result-missed-hanzi">{word.hanzi}</span>
                  <span className="result-missed-pinyin">{word.pinyin}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="start-button" onClick={onPlayAgain}>
          Whack Again
        </button>
      </div>
    </div>
  );
}
