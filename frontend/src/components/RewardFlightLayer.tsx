import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  advanceRewardFlightElapsed,
  createRewardFlightPath,
  getRewardFlightPhase,
  getRewardFlightProgress,
  headingOnRewardFlightPath,
  pointOnRewardFlightPath,
  resolveRewardFlightTarget,
  type RewardFlightPath,
} from '../engine/rewardFlight';

const FLIGHT_SPARKLES = [1, 2, 3, 4] as const;

export interface RewardFlightEvent {
  id: number;
  sourceX: number;
  sourceY: number;
  foodImage: string;
  launchDelayMs: number;
  targetCorrectCount: number;
}

interface RewardFlightLayerProps {
  flights: RewardFlightEvent[];
  isPaused: boolean;
  getTargetRect: () => DOMRect | null;
  onArrive: (flight: RewardFlightEvent) => void;
}

interface RewardFlightProps {
  flight: RewardFlightEvent;
  isPaused: boolean;
  prefersReducedMotion: boolean;
  getTargetRect: () => DOMRect | null;
  onArrive: (flight: RewardFlightEvent) => void;
}

function getInitialReducedMotionPreference(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function RewardFlight({
  flight,
  isPaused,
  prefersReducedMotion,
  getTargetRect,
  onArrive,
}: RewardFlightProps) {
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLSpanElement | null>(null);
  const tumbleRef = useRef<HTMLSpanElement | null>(null);
  const elapsedMsRef = useRef(0);
  const lastFrameAtRef = useRef<number | null>(null);
  const pathRef = useRef<RewardFlightPath | null>(null);
  const arrivedRef = useRef(false);
  const [hasLaunched, setHasLaunched] = useState(false);

  useEffect(() => {
    if (isPaused || arrivedRef.current) return;

    if (prefersReducedMotion) {
      arrivedRef.current = true;
      onArrive(flight);
      return;
    }

    let frameId = 0;
    const settle = () => {
      if (arrivedRef.current) return;
      arrivedRef.current = true;
      onArrive(flight);
    };

    const renderFrame = (frameAt: number) => {
      const previousFrameAt = lastFrameAtRef.current;
      lastFrameAtRef.current = frameAt;
      const deltaMs = previousFrameAt === null ? 0 : Math.max(0, frameAt - previousFrameAt);
      elapsedMsRef.current = advanceRewardFlightElapsed(elapsedMsRef.current, deltaMs, false);

      const phase = getRewardFlightPhase(elapsedMsRef.current, flight.launchDelayMs);
      if (phase === 'waiting') {
        frameId = window.requestAnimationFrame(renderFrame);
        return;
      }

      if (!pathRef.current) {
        const target = resolveRewardFlightTarget(getTargetRect());
        if (!target) {
          settle();
          return;
        }
        pathRef.current = createRewardFlightPath(
          { x: flight.sourceX, y: flight.sourceY },
          target,
        );
        setHasLaunched(true);
      }

      if (phase === 'landed') {
        settle();
        return;
      }

      const progress = getRewardFlightProgress(elapsedMsRef.current, flight.launchDelayMs);
      const point = pointOnRewardFlightPath(pathRef.current, progress);
      const scale = 1 - progress * 0.42;
      const heading = headingOnRewardFlightPath(pathRef.current, progress);
      const tumble = progress * 360;
      const tumblePulse = 1 + Math.sin(progress * Math.PI) * 0.05;
      const token = tokenRef.current;
      if (token) {
        token.style.visibility = 'visible';
        token.style.opacity = String(1 - Math.max(0, progress - 0.9) * 2.5);
        token.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) scale(${scale})`;
      }
      if (headingRef.current) {
        headingRef.current.style.transform = `rotate(${heading}deg)`;
      }
      if (tumbleRef.current) {
        tumbleRef.current.style.transform = `rotate(${tumble}deg) scale(${tumblePulse})`;
      }

      frameId = window.requestAnimationFrame(renderFrame);
    };

    lastFrameAtRef.current = null;
    frameId = window.requestAnimationFrame(renderFrame);
    return () => {
      window.cancelAnimationFrame(frameId);
      lastFrameAtRef.current = null;
    };
  }, [flight, getTargetRect, isPaused, onArrive, prefersReducedMotion]);

  return (
    <div
      ref={tokenRef}
      className={`reward-flight-token${hasLaunched ? ' reward-flight-token--active' : ''}${isPaused ? ' reward-flight-token--paused' : ''}`}
      style={{ visibility: hasLaunched ? 'visible' : 'hidden' } as CSSProperties}
      aria-hidden="true"
    >
      <span ref={headingRef} className="reward-flight-heading">
        <span className="reward-flight-trail" />
        <span className="reward-flight-sparkles">
          {FLIGHT_SPARKLES.map(sparkleNumber => (
            <span
              key={sparkleNumber}
              className={`reward-flight-sparkle reward-flight-sparkle--${sparkleNumber}`}
            />
          ))}
        </span>
      </span>
      <span ref={tumbleRef} className="reward-flight-tumble">
        <span className="reward-flight-token-glow" />
        <span className="reward-flight-token-viewport">
          <img className="reward-flight-token-image" src={flight.foodImage} alt="" />
        </span>
      </span>
    </div>
  );
}

export function RewardFlightLayer({
  flights,
  isPaused,
  getTargetRect,
  onArrive,
}: RewardFlightLayerProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getInitialReducedMotionPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  if (flights.length === 0) return null;

  return (
    <div className="reward-flight-overlay" aria-hidden="true">
      {flights.map(flight => (
        <RewardFlight
          key={flight.id}
          flight={flight}
          isPaused={isPaused}
          prefersReducedMotion={prefersReducedMotion}
          getTargetRect={getTargetRect}
          onArrive={onArrive}
        />
      ))}
    </div>
  );
}
