import type { Env } from "../env";
import type { ScreenResult, TickerPriceSeries } from "../types";
import {
  acquireRefreshLock,
  cacheAgeHours,
  type CachedScreen,
  markRefreshComplete,
  readScreenCache,
  writeScreenCache,
} from "./cache";
import { fetchConstituents } from "./constituents";
import { subtractMonths } from "./dates";
import { firstAvailableBar, resolveWindowCandidates } from "./polygon";
import { screen } from "./screen";

/** Minimal duck-typed subset of Workers' ExecutionContext (just the one method used here) —
 * avoids depending on the exact ExecutionContext shape, which differs between
 * @cloudflare/workers-types and the one Hono's Context.executionCtx returns. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Spec-mandated freshness threshold: a cached result younger than this is served as-is. */
export const CACHE_TTL_HOURS = 24;

export interface ScreenRunResult {
  result: ScreenResult;
  computedAt: string;
  fromCache: boolean;
}

/**
 * The single cached path for both the user-triggered "run screen" button and the daily
 * notification cron (per spec: they must not diverge into two screening code paths).
 * Recomputes only when there's no cache, the as-of date changed, or the cache has aged
 * past CACHE_TTL_HOURS.
 */
export async function getOrRefreshScreen(env: Env, asOfDate: string): Promise<ScreenRunResult> {
  const cached = await readScreenCache(env.DB);
  const now = new Date();
  if (
    cached &&
    cached.result.asOfDate === asOfDate &&
    cacheAgeHours(cached.computedAt, now) < CACHE_TTL_HOURS
  ) {
    return { result: cached.result, computedAt: cached.computedAt, fromCache: true };
  }

  const result = await computeScreen(env, asOfDate);
  const computedAt = now.toISOString();
  await writeScreenCache(env.DB, result, computedAt);
  return { result, computedAt, fromCache: false };
}

export interface TriggerRefreshResult {
  /** "served-cache": already fresh, nothing to do. "started": a background refresh was just
   * kicked off. "already-running": one was already in flight (e.g. a double-click); not
   * started again. */
  status: "served-cache" | "started" | "already-running";
  /** Whatever is currently cached, possibly stale — the caller shows this immediately rather
   * than blocking on the refresh, which can take a couple of minutes (throttled Polygon
   * calls) and would otherwise risk the HTTP request itself timing out client-side even
   * though the Worker keeps running and writes the cache regardless. */
  cached: CachedScreen | null;
}

/**
 * The HTTP-facing entry point for the "run screen" button. Never blocks on the actual
 * refresh — returns immediately, and the caller (see worker/routes/screen.ts) must pass its
 * ExecutionContext so the refresh can run via ctx.waitUntil after the response is sent.
 * The cron/notification path uses getOrRefreshScreen directly instead, since it needs the
 * real result synchronously to build the email — this function is only for a UI that will
 * poll GET /api/screen afterward.
 */
export async function triggerScreenRefresh(
  env: Env,
  asOfDate: string,
  ctx: WaitUntilContext,
): Promise<TriggerRefreshResult> {
  const cached = await readScreenCache(env.DB);
  const now = new Date();
  if (
    cached &&
    cached.result.asOfDate === asOfDate &&
    cacheAgeHours(cached.computedAt, now) < CACHE_TTL_HOURS
  ) {
    return { status: "served-cache", cached };
  }

  const acquired = await acquireRefreshLock(env.DB, now);
  if (!acquired) {
    return { status: "already-running", cached };
  }

  const startedAt = Date.now();
  console.log(`[screen-refresh] starting: asOfDate=${asOfDate}`);

  ctx.waitUntil(
    (async () => {
      try {
        const result = await computeScreen(env, asOfDate);
        await writeScreenCache(env.DB, result, new Date().toISOString());
        console.log(
          `[screen-refresh] done in ${Date.now() - startedAt}ms: ` +
            `ranked=${result.ranked.length} insufficientHistory=${result.insufficientHistory.length}`,
        );
        await markRefreshComplete(env.DB, true, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[screen-refresh] failed after ${Date.now() - startedAt}ms:`, err);
        await markRefreshComplete(env.DB, false, message);
      }
    })(),
  );

  return { status: "started", cached };
}

async function computeScreen(env: Env, asOfDate: string): Promise<ScreenResult> {
  const universe = await fetchConstituents();
  const tickers = new Set(universe.map((c) => c.ticker));
  console.log(`[screen-refresh] fetched ${universe.length} constituents`);

  const windowStartTarget = subtractMonths(asOfDate, 13);
  const windowEndTarget = subtractMonths(asOfDate, 1);

  // Sequential (not Promise.all): each call is itself a run of up to 5 throttled Polygon
  // requests, and there's no benefit to interleaving them.
  console.log(`[screen-refresh] resolving window start (target ${windowStartTarget})`);
  const startCandidates = await resolveWindowCandidates(
    windowStartTarget,
    tickers,
    env.POLYGON_API_KEY,
  );
  console.log(
    `[screen-refresh] window start resolved for ${startCandidates.size}/${tickers.size} tickers`,
  );

  console.log(`[screen-refresh] resolving window end (target ${windowEndTarget})`);
  const endCandidates = await resolveWindowCandidates(
    windowEndTarget,
    tickers,
    env.POLYGON_API_KEY,
  );
  console.log(
    `[screen-refresh] window end resolved for ${endCandidates.size}/${tickers.size} tickers`,
  );

  const priceData: Record<string, TickerPriceSeries> = {};
  for (const ticker of tickers) {
    priceData[ticker] = {
      windowStartCandidates: startCandidates.get(ticker) ?? [],
      windowEndCandidates: endCandidates.get(ticker) ?? [],
    };
  }

  // Only chase a first-trade date for tickers we couldn't resolve at window start — this is
  // what keeps a refresh to a handful of Polygon calls instead of one per constituent.
  const missingAtStart = [...tickers].filter(
    (t) => priceData[t].windowStartCandidates.length === 0,
  );
  console.log(
    `[screen-refresh] ${missingAtStart.length} tickers missing at window start; ` +
      `chasing first-available dates`,
  );
  const lookbackFrom = subtractMonths(asOfDate, 25); // stays within Polygon's free 2yr history
  for (const ticker of missingAtStart) {
    const first = await firstAvailableBar(ticker, lookbackFrom, asOfDate, env.POLYGON_API_KEY);
    if (first) priceData[ticker].firstAvailable = first;
  }

  return screen({ asOfDate, universe, priceData });
}
