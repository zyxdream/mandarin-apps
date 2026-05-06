export type SceneFitMode = 'contain' | 'cover';

export interface SceneRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface SceneProjectionInput {
  containerWidth: number;
  containerHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  fitMode?: SceneFitMode;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export const DEFAULT_SCENE_FIT_MODE: SceneFitMode = 'cover';

export function computeSceneRenderRect({
  containerWidth,
  containerHeight,
  sceneWidth,
  sceneHeight,
  fitMode = DEFAULT_SCENE_FIT_MODE,
}: SceneProjectionInput): SceneRenderRect {
  const safeContainerWidth = Math.max(1, containerWidth);
  const safeContainerHeight = Math.max(1, containerHeight);
  const safeSceneWidth = Math.max(1, sceneWidth);
  const safeSceneHeight = Math.max(1, sceneHeight);

  const widthScale = safeContainerWidth / safeSceneWidth;
  const heightScale = safeContainerHeight / safeSceneHeight;
  const scale = fitMode === 'cover'
    ? Math.max(widthScale, heightScale)
    : Math.min(widthScale, heightScale);

  const width = safeSceneWidth * scale;
  const height = safeSceneHeight * scale;

  return {
    x: (safeContainerWidth - width) / 2,
    y: (safeContainerHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function projectNormalizedPoint(renderRect: SceneRenderRect, point: NormalizedPoint): NormalizedPoint {
  return {
    x: renderRect.x + renderRect.width * point.x,
    y: renderRect.y + renderRect.height * point.y,
  };
}
