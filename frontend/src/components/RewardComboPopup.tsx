import type { AnimationEvent, CSSProperties } from 'react';
import { REWARD_FLIGHT_LANDING_MS } from '../engine/rewardFlight';

interface RewardParticleVector {
  dx: number;
  dy: number;
  delayMs: number;
  scale: number;
  accentClass: 'combo-reward-particle--gold' | 'combo-reward-particle--strawberry' | 'combo-reward-particle--green';
}

const PARTICLE_VECTORS: RewardParticleVector[] = [
  { dx: -78, dy: -54, delayMs: 10, scale: 1.04, accentClass: 'combo-reward-particle--gold' },
  { dx: -52, dy: -88, delayMs: 28, scale: 0.9, accentClass: 'combo-reward-particle--strawberry' },
  { dx: -18, dy: -92, delayMs: 16, scale: 0.78, accentClass: 'combo-reward-particle--green' },
  { dx: 22, dy: -96, delayMs: 22, scale: 0.84, accentClass: 'combo-reward-particle--gold' },
  { dx: 60, dy: -78, delayMs: 18, scale: 0.94, accentClass: 'combo-reward-particle--strawberry' },
  { dx: 86, dy: -44, delayMs: 30, scale: 1.02, accentClass: 'combo-reward-particle--gold' },
  { dx: 44, dy: -20, delayMs: 42, scale: 0.7, accentClass: 'combo-reward-particle--green' },
  { dx: -44, dy: -18, delayMs: 38, scale: 0.74, accentClass: 'combo-reward-particle--strawberry' },
];

const DEFAULT_POPUP_LIFETIME_MS = 980;
const STACK_POPUP_LIFETIME_MS = REWARD_FLIGHT_LANDING_MS;

function stableBaoziTilt(triggerId: number): number {
  const seeded = Math.imul(triggerId + 17, 1103515245) >>> 0;
  const direction = (seeded & 1) === 0 ? -1 : 1;
  const magnitude = 4 + ((seeded % 1000) / 1000) * 2.4;
  return Number((direction * magnitude).toFixed(2));
}

export type RewardComboPopupVariant = 'default' | 'baozi_focus';

export interface RewardComboPopupProps {
  triggerId: number;
  x: number;
  y: number;
  foodLabel: string;
  foodImage: string;
  amount: number;
  variant?: RewardComboPopupVariant;
  showFoodLabel?: boolean;
  onDone?: () => void;
}

export function RewardComboPopup({
  triggerId,
  x,
  y,
  foodLabel,
  foodImage,
  amount,
  variant = 'default',
  showFoodLabel = true,
  onDone,
}: RewardComboPopupProps) {
  const isBaoziFocus = variant === 'baozi_focus';
  const popupLifetimeMs = isBaoziFocus ? STACK_POPUP_LIFETIME_MS : DEFAULT_POPUP_LIFETIME_MS;
  const baoziTilt = stableBaoziTilt(triggerId);
  const srBonusText = `${foodLabel} bonus`;

  const anchorStyle = {
    '--combo-reward-x': `${Math.round(x)}px`,
    '--combo-reward-y': `${Math.round(y)}px`,
  } as CSSProperties;
  const baoziStyle = {
    '--combo-baozi-tilt': `${baoziTilt}deg`,
  } as CSSProperties;
  const popupStyle = {
    '--combo-reward-lifetime': `${popupLifetimeMs}ms`,
  } as CSSProperties;
  const popupClassName = `combo-reward-popup${isBaoziFocus ? ' combo-reward-popup--baozi-focus' : ''}`;
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (
      event.animationName !== 'combo-reward-popup-life' &&
      event.animationName !== 'combo-reward-popup-life-baozi-hold'
    ) return;
    onDone?.();
  };

  return (
    <div className="combo-reward-popup-anchor" style={anchorStyle}>
      <div
        key={triggerId}
        className={popupClassName}
        style={popupStyle}
        aria-live="polite"
        aria-atomic="true"
        onAnimationEnd={handleAnimationEnd}
      >
        {isBaoziFocus ? (
          <>
            <span className="combo-reward-sr-only">{srBonusText}</span>
            <div className="combo-reward-baozi-group" style={baoziStyle} aria-hidden="true">
              <div className="combo-reward-baozi-stack">
                <img className="combo-reward-baozi-image combo-reward-baozi-image--base" src={foodImage} alt="" />
                <img className="combo-reward-baozi-image combo-reward-baozi-image--puff-one" src={foodImage} alt="" />
                <img className="combo-reward-baozi-image combo-reward-baozi-image--puff-two" src={foodImage} alt="" />
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="combo-reward-flare" aria-hidden="true" />
            <span className="combo-reward-flare combo-reward-flare--alt" aria-hidden="true" />

            <div className="combo-reward-particles" aria-hidden="true">
              {PARTICLE_VECTORS.map((particle, index) => {
                const particleStyle = {
                  '--particle-dx': `${particle.dx}px`,
                  '--particle-dy': `${particle.dy}px`,
                  '--particle-delay': `${particle.delayMs}ms`,
                  '--particle-scale-peak': (particle.scale * 1.06).toFixed(3),
                  '--particle-scale-end': (particle.scale * 0.74).toFixed(3),
                } as CSSProperties;
                return (
                  <span
                    key={`${triggerId}-${index}`}
                    className={`combo-reward-particle ${particle.accentClass}`}
                    style={particleStyle}
                  />
                );
              })}
            </div>

            <img className="combo-reward-food-image" src={foodImage} alt="" />
            <div className="combo-reward-copy">
              {showFoodLabel ? <span className="combo-reward-food-label">{foodLabel}</span> : null}
              <span className="combo-reward-amount">+{amount}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
