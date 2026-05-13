import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { warmupDeep } from '../warmup/backendWarmup';

interface SessionSelectScreenProps {
  sessionCount: number;
  onSelectSession: (sessionIndex: number) => void;
  onBack: () => void;
}

const SCORE_PANEL_NO_STAR = '/assets/ui/score_panel_no_star.session.v2.webp';
const PANEL_ASPECT_RATIO = 1478 / 358;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

interface SessionGridLayout {
  cols: number;
  cardHeight: number;
  gap: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SessionSelectScreen({ sessionCount, onSelectSession, onBack }: SessionSelectScreenProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  const sessions = useMemo(() => Array.from({ length: sessionCount }, (_, index) => index + 1), [sessionCount]);
  const [layout, setLayout] = useState<SessionGridLayout>({
    cols: 2,
    cardHeight: 42,
    gap: 6,
  });

  const computeLayout = useCallback(() => {
    const content = contentRef.current;
    const heading = headingRef.current;
    const backButton = backRef.current;
    if (!content || !heading || !backButton) return;

    const styles = window.getComputedStyle(content);
    const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);

    const innerWidth = Math.max(220, content.clientWidth - paddingX);
    const innerHeight = Math.max(220, content.clientHeight - paddingY);
    const headerHeight = heading.offsetHeight;
    const backHeight = backButton.offsetHeight;
    const fixedVerticalBudget = headerHeight + backHeight + 18;
    const availableGridHeight = Math.max(120, innerHeight - fixedVerticalBudget);
    const baseGap = clamp(Math.round(innerHeight * 0.008), 4, 10);

    let resolved: SessionGridLayout | null = null;
    for (let cols = MIN_COLUMNS; cols <= MAX_COLUMNS; cols += 1) {
      const rows = Math.ceil(sessionCount / cols);
      const cardWidth = (innerWidth - baseGap * (cols - 1)) / cols;
      if (cardWidth <= 0) continue;
      const cardHeight = cardWidth / PANEL_ASPECT_RATIO;
      const totalHeight = rows * cardHeight + (rows - 1) * baseGap;
      if (totalHeight <= availableGridHeight) {
        resolved = {
          cols,
          cardHeight: Math.max(26, cardHeight),
          gap: baseGap,
        };
        break;
      }
    }

    if (!resolved) {
      const cols = MAX_COLUMNS;
      const rows = Math.ceil(sessionCount / cols);
      const cardWidth = (innerWidth - baseGap * (cols - 1)) / cols;
      const maxHeightPerRow = (availableGridHeight - (rows - 1) * baseGap) / rows;
      resolved = {
        cols,
        cardHeight: Math.max(24, Math.min(cardWidth / PANEL_ASPECT_RATIO, maxHeightPerRow)),
        gap: baseGap,
      };
    }

    setLayout(current => {
      if (
        current.cols === resolved.cols &&
        Math.abs(current.cardHeight - resolved.cardHeight) < 0.5 &&
        current.gap === resolved.gap
      ) {
        return current;
      }
      return resolved;
    });
  }, [sessionCount]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void warmupDeep('session_list');
      }, 200);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    const schedule = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(computeLayout);
    };

    schedule();
    window.addEventListener('resize', schedule);

    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [computeLayout]);

  const gridStyle: CSSProperties & {
    '--session-cols': string;
    '--session-card-height': string;
    '--session-gap': string;
  } = {
    '--session-cols': String(layout.cols),
    '--session-card-height': `${layout.cardHeight.toFixed(2)}px`,
    '--session-gap': `${layout.gap}px`,
  };

  return (
    <div className="session-select-screen">
      <div className="session-select-content" ref={contentRef}>
        <div className="session-select-head" ref={headingRef}>
          <h1 className="session-select-title">Choose A Session</h1>
          <p className="session-select-subtitle">Pick a round to start.</p>
        </div>

        <div className="session-select-grid" style={gridStyle} role="list" aria-label="Game sessions">
          {sessions.map(sessionNumber => (
            <button
              key={sessionNumber}
              type="button"
              role="listitem"
              className="session-select-card"
              onClick={() => onSelectSession(sessionNumber - 1)}
              aria-label={`Open Session ${sessionNumber}`}
            >
              <img className="session-select-card-image" src={SCORE_PANEL_NO_STAR} alt="" />
              <span className="session-select-card-label">Session {sessionNumber}</span>
            </button>
          ))}
        </div>

        <button ref={backRef} type="button" className="session-select-back-button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
