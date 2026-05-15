import { useEffect } from 'react';
import type { CSSProperties } from 'react';

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

const BAOZI_EXTRA_PARTICLE_VECTORS: RewardParticleVector[] = [
  { dx: -104, dy: -34, delayMs: 12, scale: 0.76, accentClass: 'combo-reward-particle--gold' },
  { dx: -92, dy: -74, delayMs: 24, scale: 0.66, accentClass: 'combo-reward-particle--green' },
  { dx: -68, dy: -110, delayMs: 36, scale: 0.78, accentClass: 'combo-reward-particle--strawberry' },
  { dx: -6, dy: -126, delayMs: 18, scale: 0.7, accentClass: 'combo-reward-particle--gold' },
  { dx: 56, dy: -114, delayMs: 26, scale: 0.72, accentClass: 'combo-reward-particle--green' },
  { dx: 92, dy: -72, delayMs: 34, scale: 0.8, accentClass: 'combo-reward-particle--strawberry' },
  { dx: 108, dy: -26, delayMs: 22, scale: 0.74, accentClass: 'combo-reward-particle--gold' },
  { dx: 0, dy: -58, delayMs: 42, scale: 0.62, accentClass: 'combo-reward-particle--strawberry' },
];

const POPUP_LIFETIME_MS = 980;
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
  useEffect(() => {
    if (!onDone) return;
    const timer = window.setTimeout(() => {
      onDone();
    }, POPUP_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [onDone, triggerId]);

  const anchorStyle = {
    '--combo-reward-x': `${Math.round(x)}px`,
    '--combo-reward-y': `${Math.round(y)}px`,
  } as CSSProperties;
  const particles = variant === 'baozi_focus'
    ? [...PARTICLE_VECTORS, ...BAOZI_EXTRA_PARTICLE_VECTORS]
    : PARTICLE_VECTORS;
  const popupClassName = `combo-reward-popup${variant === 'baozi_focus' ? ' combo-reward-popup--baozi-focus' : ''}`;

  return (
    <div className="combo-reward-popup-anchor" style={anchorStyle}>
      <div key={triggerId} className={popupClassName} aria-live="polite" aria-atomic="true">
        <span className="combo-reward-flare" aria-hidden="true" />
        <span className="combo-reward-flare combo-reward-flare--alt" aria-hidden="true" />

        <div className="combo-reward-particles" aria-hidden="true">
          {particles.map((particle, index) => {
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
      </div>
    </div>
  );
}
