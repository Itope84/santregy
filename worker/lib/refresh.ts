import type { Env } from "../env";
import type { ScreenResult, TickerPriceSeries } from "../types";
import {
  acquireRefreshLock,
  cacheAgeHours,
  type CachedScreen,
  readScreenCache,
  releaseRefreshLock,
  writeScreenCache,
} from "./cache";
import { fetchConstituents } from "./constituents";
import { subtractMonths } from "./dates";
import { firstAvailableBar, resolveWindowCandidates, tickerCikAsOf } from "./polygon";
import { screen } from "./screen";

/** Minimal duck-typed subset of Workers' ExecutionContext (just the one method used here) —
 * avoids depending on the exact ExecutionContext shape, which differs between
 * @cloudflare/workers-types and the one Hono's Context.executionCtx returns. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Spec-mandated freshness threshold: a cached result younger than this is served as-is. */
export const CACHE_TTL_HOURS = 24;

/**
 * A window-start-to-end move beyond this is implausible for an S&P 500 constituent and more
 * likely a data bug than a real one — Grouped Daily has no company-identity field, so a
 * ticker that was reused or renamed within the lookback window can silently attach an
 * unrelated company's old price to today's constituent (see git history: this is exactly
 * what happened with a since-renamed ticker showing a fake ~1500% return). Anything past this
 * threshold gets an extra identity check before it's trusted.
 */
const EXTREME_RETURN_THRESHOLD = 5; // 500%

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

  ctx.waitUntil(
    (async () => {
      try {
        const result = await computeScreen(env, asOfDate);
        await writeScreenCache(env.DB, result, new Date().toISOString());
      } catch (err) {
        console.error("Background screen refresh failed:", err);
      } finally {
        await releaseRefreshLock(env.DB);
      }
    })(),
  );

  return { status: "started", cached };
}

async function computeScreen(env: Env, asOfDate: string): Promise<ScreenResult> {
  const universe = await fetchConstituents();
  const tickers = new Set(universe.map((c) => c.ticker));

  const windowStartTarget = subtractMonths(asOfDate, 13);
  const windowEndTarget = subtractMonths(asOfDate, 1);

  // Sequential (not Promise.all): each call is itself a run of up to 5 throttled Polygon
  // requests, and there's no benefit to interleaving them.
  const startCandidates = await resolveWindowCandidates(
    windowStartTarget,
    tickers,
    env.POLYGON_API_KEY,
  );
  const endCandidates = await resolveWindowCandidates(
    windowEndTarget,
    tickers,
    env.POLYGON_API_KEY,
  );

  const priceData: Record<string, TickerPriceSeries> = {};
  for (const ticker of tickers) {
    priceData[ticker] = {
      windowStartCandidates: startCandidates.get(ticker) ?? [],
      windowEndCandidates: endCandidates.get(ticker) ?? [],
    };
  }

  // Implausible-return tickers get their window-start candidate identity-checked before
  // being trusted — see EXTREME_RETURN_THRESHOLD above. This only costs extra calls for the
  // rare ticker that actually trips the threshold (typically zero per refresh).
  for (const ticker of tickers) {
    const series = priceData[ticker];
    const start = series.windowStartCandidates[0];
    const end = series.windowEndCandidates[0];
    if (!start || !end) continue;
    const impliedReturn = end.close / start.close - 1;
    if (Math.abs(impliedReturn) <= EXTREME_RETURN_THRESHOLD) continue;

    const startCik = await tickerCikAsOf(ticker, start.date, env.POLYGON_API_KEY);
    const endCik = await tickerCikAsOf(ticker, end.date, env.POLYGON_API_KEY);
    if (!startCik || !endCik || startCik !== endCik) {
      console.warn(
        `Discarding window-start price for ${ticker}: implied ${(impliedReturn * 100).toFixed(0)}% return failed identity check (start CIK ${startCik ?? "?"}, end CIK ${endCik ?? "?"})`,
      );
      series.windowStartCandidates = [];
      series.windowStartIdentityMismatch = true;
    }
  }

  // Only chase a first-trade date for tickers we couldn't resolve at window start — this is
  // what keeps a refresh to a handful of Polygon calls instead of one per constituent. Skip
  // identity-mismatch tickers: unlike a genuine gap, Polygon's per-ticker range endpoint may
  // itself blend history across a reused symbol, so guessing a "first available" date there
  // risks compounding one unverified assumption with another — better to report unknown.
  const missingAtStart = [...tickers].filter(
    (t) => priceData[t].windowStartCandidates.length === 0 && !priceData[t].windowStartIdentityMismatch,
  );
  const lookbackFrom = subtractMonths(asOfDate, 25); // stays within Polygon's free 2yr history
  for (const ticker of missingAtStart) {
    const first = await firstAvailableBar(ticker, lookbackFrom, asOfDate, env.POLYGON_API_KEY);
    if (first) priceData[ticker].firstAvailable = first;
  }

  return screen({ asOfDate, universe, priceData });
}
