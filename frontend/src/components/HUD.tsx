import { foodUnitsForCorrectWords, getRewardFoodOption, type RewardFood } from '../data/rewards';
import { getEarnedStarCount } from '../engine/starProgress';

interface HUDProps {
  timeRemaining: number;
  correctCount: number;
  totalCount: number;
  selectedFood: RewardFood;
}

const SCORE_PANEL = '/assets/ui/score_panel_no_star.session.v2.webp';
const SCORE_STAR = '/assets/ui/score_star.v2.webp';
const STAR_NUMBERS = [1, 2, 3] as const;
const SPARKLE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export function HUD({ timeRemaining, correctCount, totalCount, selectedFood }: HUDProps) {
  const isLowTime = timeRemaining <= 10;
  const food = getRewardFoodOption(selectedFood);
  const foodUnits = foodUnitsForCorrectWords(correctCount);
  const earnedStars = getEarnedStarCount(correctCount, totalCount);
  const accessibilityStatus = `${foodUnits} ${food.shortLabel.toLowerCase()}, ${earnedStars} of 3 stars earned`;

  return (
    <div className="hud">
      <div className="hud-center">
        <div className="hud-score-panel" role="group" aria-label={accessibilityStatus}>
          <img className="hud-score-panel-base" src={SCORE_PANEL} alt="" aria-hidden="true" />

          <div className="hud-reward-total" aria-hidden="true">
            <span className="hud-reward-icon-viewport">
              <img className="hud-reward-icon" src={food.baseImage} alt="" />
            </span>
            <span className="hud-reward-count">
              <span className="hud-reward-multiplier">×</span>
              {foodUnits}
            </span>
          </div>

          <div className="hud-stars" aria-hidden="true">
            {STAR_NUMBERS.slice(0, earnedStars).map(starNumber => (
              <div key={starNumber} className={`hud-star hud-star--${starNumber}`}>
                <div className="hud-star-visual">
                  <img className="hud-star-image" src={SCORE_STAR} alt="" />
                  <span className="hud-star-sparkles">
                    {SPARKLE_NUMBERS.map(sparkleNumber => (
                      <span
                        key={sparkleNumber}
                        className={`hud-star-sparkle hud-star-sparkle--${sparkleNumber}`}
                      />
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="hud-sr-only" aria-live="polite">
            {accessibilityStatus}
          </div>
        </div>

        <div className={`hud-timer ${isLowTime ? 'hud-timer--low' : ''}`}>
          {timeRemaining}
        </div>
      </div>
    </div>
  );
}
