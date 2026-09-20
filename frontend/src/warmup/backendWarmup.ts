const DEEP_STALE_TTL_MS = 7 * 60 * 1000;
const DEEP_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 5000;

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export type WarmupPhase = 'session_list' | 'ready_click' | 'game_session_start' | 'game_keepalive';
type WarmupEndpoint = 'deep' | 'health';
export type DeepWarmupStatus = 'stale' | 'warming' | 'ready' | 'failed';

export interface WarmupResult {
  phase: WarmupPhase;
  endpoint: WarmupEndpoint;
  elapsedMs: number;
  ok: boolean;
  status: number | null;
  skipped?: boolean;
}

export interface DeepWarmupSnapshot {
  status: DeepWarmupStatus;
  ready: boolean;
  warming: boolean;
  stale: boolean;
  failed: boolean;
  lastSuccessAt: number;
  lastResult: WarmupResult | null;
}

let deepInFlight: Promise<WarmupResult> | null = null;
let healthInFlight: Promise<WarmupResult> | null = null;
let lastDeepSuccessAt = 0;
let lastDeepFailed = false;
let lastDeepResult: WarmupResult | null = null;
const deepWarmupListeners = new Set<(snapshot: DeepWarmupSnapshot) => void>();

function buildUrl(path: string): string {
  try {
    const normalized = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
    return new URL(path.replace(/^\//, ''), normalized).toString();
  } catch {
    return `${apiBaseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

const deepWarmupUrl = buildUrl('/evaluate/local/warmup');
const healthUrl = buildUrl('/health');

function isDeepWarmupStale(now = Date.now()): boolean {
  return lastDeepSuccessAt === 0 || now - lastDeepSuccessAt > DEEP_STALE_TTL_MS;
}

function shouldRunDeepWarmup(now = Date.now()): boolean {
  return lastDeepFailed || isDeepWarmupStale(now);
}

export function getDeepWarmupSnapshot(now = Date.now()): DeepWarmupSnapshot {
  const warming = Boolean(deepInFlight);
  const stale = isDeepWarmupStale(now);
  let status: DeepWarmupStatus = 'stale';
  if (warming) {
    status = 'warming';
  } else if (lastDeepFailed) {
    status = 'failed';
  } else if (!stale) {
    status = 'ready';
  }

  return {
    status,
    ready: status === 'ready',
    warming,
    stale,
    failed: status === 'failed',
    lastSuccessAt: lastDeepSuccessAt,
    lastResult: lastDeepResult,
  };
}

function notifyDeepWarmupListeners(): void {
  const snapshot = getDeepWarmupSnapshot();
  deepWarmupListeners.forEach(listener => listener(snapshot));
}

export function subscribeDeepWarmup(listener: (snapshot: DeepWarmupSnapshot) => void): () => void {
  deepWarmupListeners.add(listener);
  listener(getDeepWarmupSnapshot());
  return () => {
    deepWarmupListeners.delete(listener);
  };
}

async function runWarmupFetch(
  endpoint: WarmupEndpoint,
  phase: WarmupPhase,
  url: string,
  timeoutMs: number,
): Promise<WarmupResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const result: WarmupResult = {
      phase,
      endpoint,
      elapsedMs,
      ok: response.ok,
      status: response.status,
    };
    console.log('[warmup]', result);
    return result;
  } catch (error) {
    const result: WarmupResult = {
      phase,
      endpoint,
      elapsedMs: Math.round(performance.now() - startedAt),
      ok: false,
      status: null,
    };
    console.warn('[warmup]', { ...result, error });
    return result;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function warmupDeep(phase: WarmupPhase, options?: { force?: boolean }): Promise<WarmupResult> {
  if (!options?.force && !shouldRunDeepWarmup()) {
    const result: WarmupResult = {
      phase,
      endpoint: 'deep',
      elapsedMs: 0,
      ok: true,
      status: null,
      skipped: true,
    };
    lastDeepResult = result;
    console.log('[warmup]', result);
    notifyDeepWarmupListeners();
    return result;
  }

  if (!deepInFlight) {
    deepInFlight = runWarmupFetch('deep', phase, deepWarmupUrl, DEEP_TIMEOUT_MS).finally(() => {
      deepInFlight = null;
    });
    notifyDeepWarmupListeners();
  }

  const result = await deepInFlight;
  lastDeepResult = result;
  if (result.ok) {
    lastDeepSuccessAt = Date.now();
    lastDeepFailed = false;
  } else {
    lastDeepFailed = true;
  }
  notifyDeepWarmupListeners();
  return result;
}

export async function warmupDeepIfStaleOrFailed(phase: WarmupPhase): Promise<WarmupResult> {
  return warmupDeep(phase, { force: false });
}

export async function pingHealthWarmup(phase: WarmupPhase): Promise<WarmupResult> {
  if (!healthInFlight) {
    healthInFlight = runWarmupFetch('health', phase, healthUrl, HEALTH_TIMEOUT_MS).finally(() => {
      healthInFlight = null;
    });
  }
  return healthInFlight;
}
