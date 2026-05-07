import type { Word } from '../types/word';
import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';

interface HUDProps {
  combo: number;
  timeRemaining: number;
  collectedWords: Word[];
  selectedFood: RewardFood;
}

export function HUD({ combo, timeRemaining, collectedWords, selectedFood }: HUDProps) {
  const isLowTime = timeRemaining <= 10;
  const recentWords = collectedWords.slice(-5);
  const food = getRewardFoodOption(selectedFood);
  const foodUnits = foodUnitsForCorrectWords(collectedWords.length);

  return (
    <div className="hud">
      <div className="hud-left" aria-hidden="true" />

      <div className="hud-center">
        <div className="hud-reward-cluster">
          <div className="collected-bar">
            <div className="collected-title">Collected Words</div>
            <div className="collected-list">
              {recentWords.length > 0 ? recentWords.map((word, index) => (
                <div key={`${word.id}-${index}`} className="collected-banner">
                  <span>{word.pinyin}</span>
                  <strong>{word.hanzi}</strong>
                </div>
              )) : (
                <div className="collected-empty">Whack moles to collect banners</div>
              )}
            </div>
          </div>

          <div className="hud-food-panel">
            <div className="hud-food">
              <img className="hud-food-icon" src={food.image} alt="" />
              <span className="hud-food-count">{foodUnits}</span>
            </div>
            <div className="hud-label">{food.shortLabel}</div>
          </div>
        </div>

        <div className={`hud-timer ${isLowTime ? 'hud-timer--low' : ''}`}>
          {timeRemaining}
        </div>
      </div>

      <div className="hud-right">
        {combo >= 2 && (
          <div className="hud-combo">
            <span className="hud-combo-count">x{combo}</span>
            <span className="hud-combo-label">COMBO</span>
          </div>
        )}
      </div>
    </div>
  );
}
