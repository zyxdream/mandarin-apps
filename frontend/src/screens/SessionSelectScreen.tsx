import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, WheelEvent as ReactWheelEvent } from 'react';
import type { ScriptSession } from '../data/scriptSessions';
import { warmupDeep } from '../warmup/backendWarmup';

interface SessionSelectScreenProps {
  sessions: ReadonlyArray<ScriptSession>;
  onSelectSession: (sessionIndex: number) => void;
  onBack: () => void;
}

const DIRT_HOLE = '/assets/objects/dirt_hole_1.v2.webp';
const SESSION_LIST_TOP_PANEL = '/assets/objects/cover_word_banner_top.v2.webp';
const SESSION_LIST_SECOND_PANEL = '/assets/ui/second_session_list_panel.v2.webp';
const MAP_SIDE_PADDING = 168;
const MAP_NODE_STEP = 280;
const MAP_HEIGHT = 320;
const MAP_TOP_PADDING = 68;
const MAP_BOTTOM_PADDING = 40;
const MAP_NODE_X_JITTER = 12;
const MAP_HOLE_Y_JITTER = 8;
const MAP_ROUTE_VARIANCE = 24;
const MAP_ROUTE_WAYPOINT_MIN = 7;
const MAP_ROUTE_WAYPOINT_MAX = 15;
const MAP_HOLE_RIM_OFFSET = 84;

interface SessionMapNode {
  sessionNumber: number;
  title: string;
  x: number;
  y: number;
}

interface SessionMapConnectorPath {
  key: string;
  d: string;
}

interface RoutePoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sampleRouteY(routePoints: RoutePoint[], x: number): number {
  if (routePoints.length === 0) return MAP_HEIGHT / 2;
  if (routePoints.length === 1) return routePoints[0].y;
  if (x <= routePoints[0].x) return routePoints[0].y;
  if (x >= routePoints[routePoints.length - 1].x) return routePoints[routePoints.length - 1].y;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const current = routePoints[index];
    const next = routePoints[index + 1];
    if (x >= current.x && x <= next.x) {
      const t = (x - current.x) / Math.max(1, next.x - current.x);
      return lerp(current.y, next.y, t);
    }
  }

  return routePoints[routePoints.length - 1].y;
}

export function SessionSelectScreen({ sessions, onSelectSession, onBack }: SessionSelectScreenProps) {
  const headingRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);

  const sessionCount = sessions.length;

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

  const mapWidth = useMemo(
    () => Math.max(1180, MAP_SIDE_PADDING * 2 + Math.max(0, sessionCount - 1) * MAP_NODE_STEP + 80),
    [sessionCount],
  );

  const masterRoutePoints = useMemo<RoutePoint[]>(
    () => {
      const random = createDeterministicRandom((sessionCount + 43) * 2246822519);
      const usableHeight = MAP_HEIGHT - MAP_TOP_PADDING - MAP_BOTTOM_PADDING;
      const bandCenters = [
        MAP_TOP_PADDING + usableHeight * 0.18,
        MAP_TOP_PADDING + usableHeight * 0.52,
        MAP_TOP_PADDING + usableHeight * 0.86,
      ];
      const waypointCount = clamp(
        Math.max(MAP_ROUTE_WAYPOINT_MIN, Math.ceil(sessionCount * 0.7) + 4),
        MAP_ROUTE_WAYPOINT_MIN,
        MAP_ROUTE_WAYPOINT_MAX,
      );
      const routeStartX = MAP_SIDE_PADDING;
      const routeEndX = mapWidth - MAP_SIDE_PADDING;
      const xStep = waypointCount > 1 ? (routeEndX - routeStartX) / (waypointCount - 1) : 0;
      const introPattern = random() < 0.5 ? [1, 0, 2, 1] : [1, 2, 0, 1];
      const cadenceBase = random() < 0.5 ? [0, 2, 1, 2] : [2, 0, 1, 0];
      const bandSequence: number[] = [];

      for (let index = 0; index < waypointCount; index += 1) {
        if (index < introPattern.length) {
          bandSequence.push(introPattern[index]);
          continue;
        }

        const recent = bandSequence.slice(Math.max(0, index - 3), index);
        const hasTop = recent.includes(0);
        const hasBottom = recent.includes(2);
        const previous = bandSequence[index - 1];
        const twoBack = bandSequence[index - 2];
        const candidates = [0, 1, 2].filter(band => band !== previous);
        const filtered = candidates.filter(band => !(previous === 1 && band === 1));

        let nextBand: number | null = null;
        if (!hasTop) {
          nextBand = 0;
        } else if (!hasBottom) {
          nextBand = 2;
        } else {
          const preferred = cadenceBase[(index - introPattern.length) % cadenceBase.length];
          if (filtered.includes(preferred)) {
            nextBand = preferred;
          } else if (twoBack !== undefined && filtered.includes(twoBack)) {
            nextBand = twoBack;
          } else if (filtered.includes(1) && random() < 0.25) {
            nextBand = 1;
          } else {
            const extremes = filtered.filter(band => band !== 1);
            if (extremes.length > 0) {
              nextBand = extremes[Math.floor(random() * extremes.length)];
            } else {
              nextBand = filtered[0] ?? 1;
            }
          }
        }

        const safeBand = nextBand === previous ? (nextBand === 0 ? 2 : 0) : nextBand;
        bandSequence.push(safeBand ?? 1);
      }

      return Array.from({ length: waypointCount }, (_, index) => {
        const bandIndex = bandSequence[index] ?? 1;
        const baseBandY = bandCenters[bandIndex];
        const variance = (random() - 0.5) * MAP_ROUTE_VARIANCE * 2;
        const shapeNudge = Math.sin((index + 1) * 1.16 + bandIndex * 0.9) * 6;
        return {
          x: routeStartX + index * xStep,
          y: clamp(baseBandY + variance + shapeNudge, MAP_TOP_PADDING + 6, MAP_HEIGHT - MAP_BOTTOM_PADDING - 6),
        };
      });
    },
    [mapWidth, sessionCount],
  );

  const mapNodes = useMemo<SessionMapNode[]>(
    () => {
      const random = createDeterministicRandom((sessionCount + 17) * 3266489917);
      const anchorStep = sessionCount > 1 ? (mapWidth - MAP_SIDE_PADDING * 2) / (sessionCount - 1) : 0;
      return sessions.map((session, index) => {
        const sessionNumber = index + 1;
        const anchorX = sessionCount === 1 ? mapWidth / 2 : MAP_SIDE_PADDING + index * anchorStep;
        const xJitter = index === 0 || index === sessions.length - 1 ? 0 : (random() - 0.5) * MAP_NODE_X_JITTER * 2;
        const x = clamp(anchorX + xJitter, MAP_SIDE_PADDING, mapWidth - MAP_SIDE_PADDING);
        const routeY = sampleRouteY(masterRoutePoints, x);
        const yJitter = (random() - 0.5) * MAP_HOLE_Y_JITTER * 2;
        const y = clamp(routeY + yJitter, MAP_TOP_PADDING, MAP_HEIGHT - MAP_BOTTOM_PADDING);
        return {
          sessionNumber,
          title: session.title,
          x,
          y,
        };
      });
    },
    [mapWidth, masterRoutePoints, sessionCount, sessions],
  );

  const connectorPaths = useMemo<SessionMapConnectorPath[]>(
    () =>
      mapNodes.slice(1).map((node, index) => {
        const prev = mapNodes[index];
        const startX = prev.x + MAP_HOLE_RIM_OFFSET;
        const startY = prev.y - 2;
        const endX = node.x - MAP_HOLE_RIM_OFFSET;
        const endY = node.y - 2;
        const linearMidX = (startX + endX) / 2;
        const linearMidY = (startY + endY) / 2;
        const midRouteY = sampleRouteY(masterRoutePoints, linearMidX);
        const deltaY = Math.abs(endY - startY);
        let d: string;

        if (deltaY < 6) {
          d = `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`;
        } else {
          const scale = index % 2 === 0 ? 1.35 : 0.62;
          const minBend = index % 2 === 0 ? 16 : 8;
          const rawControlY = linearMidY + (midRouteY - linearMidY) * scale;
          let controlY = rawControlY;
          const bend = Math.abs(rawControlY - linearMidY);
          const fallbackDirection = index % 4 < 2 ? 1 : -1;
          const routeDirection = midRouteY === linearMidY ? fallbackDirection : Math.sign(midRouteY - linearMidY);
          if (bend < minBend) {
            controlY = linearMidY + routeDirection * minBend;
          }

          controlY = clamp(controlY, MAP_TOP_PADDING + 4, MAP_HEIGHT - MAP_BOTTOM_PADDING - 6);
          d = `M ${startX.toFixed(2)} ${startY.toFixed(2)} Q ${linearMidX.toFixed(2)} ${controlY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
        }

        return {
          key: `path-${index}`,
          d,
        };
      }),
    [mapNodes, masterRoutePoints],
  );

  const handleMapWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const mapCanvasStyle: CSSProperties = {
    width: `${mapWidth}px`,
    height: `${MAP_HEIGHT}px`,
  };

  return (
    <div className="session-select-screen">
      <div className="session-select-content">
        <div className="session-select-head" ref={headingRef}>
          <div className="session-select-cover-panels" aria-hidden="true">
            <img
              className="session-select-cover-panel session-select-cover-panel--top"
              src={SESSION_LIST_TOP_PANEL}
              alt=""
            />
            <img
              className="session-select-cover-panel session-select-cover-panel--lower"
              src={SESSION_LIST_SECOND_PANEL}
              alt=""
            />
          </div>
        </div>

        <div className="session-select-map-frame">
          <div className="session-map-viewport" ref={mapViewportRef} onWheel={handleMapWheel}>
            <div className="session-map-canvas" style={mapCanvasStyle} role="list" aria-label="Game sessions">
              <svg className="session-map-path-overlay" viewBox={`0 0 ${mapWidth} ${MAP_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                {connectorPaths.map(connector => (
                  <path
                    key={connector.key}
                    className="session-map-connector"
                    d={connector.d}
                  />
                ))}
              </svg>

              {mapNodes.map(node => {
                const nodeStyle = {
                  '--node-x': `${node.x}px`,
                  '--node-y': `${node.y}px`,
                } as CSSProperties;
                return (
                  <button
                    key={node.sessionNumber}
                    type="button"
                    role="listitem"
                    className="session-map-node"
                    style={nodeStyle}
                    onClick={() => onSelectSession(node.sessionNumber - 1)}
                    aria-label={`${node.title} #${node.sessionNumber}`}
                  >
                    <div className="session-map-hole-wrap">
                      <img className="session-map-hole-image" src={DIRT_HOLE} alt="" />
                      <div className="session-map-hole-label">
                        <span className="session-map-hole-label-line">#{node.sessionNumber}</span>
                        <span className="session-map-hole-label-line">{node.title}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      <div className="session-select-back-anchor">
        <div className="session-select-back-unit">
          <button ref={backRef} type="button" className="session-select-back-button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
