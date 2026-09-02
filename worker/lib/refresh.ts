import type { Env } from "../env";
import type { ScreenResult, TickerPriceSeries } from "../types";
import { cacheAgeHours, readScreenCache, writeScreenCache } from "./cache";
import { fetchConstituents } from "./constituents";
import { subtractMonths } from "./dates";
import { firstAvailableBar, resolveWindowCandidates } from "./polygon";
import { screen } from "./screen";

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

  // Only chase a first-trade date for tickers we couldn't resolve at window start — this is
  // what keeps a refresh to a handful of Polygon calls instead of one per constituent.
  const missingAtStart = [...tickers].filter(
    (t) => priceData[t].windowStartCandidates.length === 0,
  );
  const lookbackFrom = subtractMonths(asOfDate, 25); // stays within Polygon's free 2yr history
  for (const ticker of missingAtStart) {
    const first = await firstAvailableBar(ticker, lookbackFrom, asOfDate, env.POLYGON_API_KEY);
    if (first) priceData[ticker].firstAvailable = first;
  }

  return screen({ asOfDate, universe, priceData });
}
