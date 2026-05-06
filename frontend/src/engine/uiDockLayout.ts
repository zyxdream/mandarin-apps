export interface UiDockLayout {
  dockHeightPx: number;
  safeBottomPx: number;
}

export interface GameplayLaneInput {
  viewportHeightPx: number;
  dock: UiDockLayout;
  minGameplayHeightPx?: number;
}

export function computeGameplayLaneHeight({
  viewportHeightPx,
  dock,
  minGameplayHeightPx = 220,
}: GameplayLaneInput): number {
  const safeViewportHeight = Math.max(1, viewportHeightPx);
  const dockReserve = Math.max(0, dock.dockHeightPx) + Math.max(0, dock.safeBottomPx);
  return Math.max(minGameplayHeightPx, safeViewportHeight - dockReserve);
}
