const DEEP_STALE_TTL_MS = 7 * 60 * 1000;
const DEEP_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 5000;

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

type WarmupPhase = 'session_list' | 'ready_click' | 'game_session_start' | 'game_keepalive';
type WarmupEndpoint = 'deep' | 'health';

interface WarmupResult {
  phase: WarmupPhase;
  endpoint: WarmupEndpoint;
  elapsedMs: number;
  ok: boolean;
  status: number | null;
  skipped?: boolean;
}

let deepInFlight: Promise<WarmupResult> | null = null;
let healthInFlight: Promise<WarmupResult> | null = null;
let lastDeepSuccessAt = 0;
let lastDeepFailed = false;

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
    console.log('[warmup]', result);
    return result;
  }

  if (!deepInFlight) {
    deepInFlight = runWarmupFetch('deep', phase, deepWarmupUrl, DEEP_TIMEOUT_MS).finally(() => {
      deepInFlight = null;
    });
  }

  const result = await deepInFlight;
  if (result.ok) {
    lastDeepSuccessAt = Date.now();
    lastDeepFailed = false;
  } else {
    lastDeepFailed = true;
  }
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
