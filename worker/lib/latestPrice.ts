import type { Env } from "../env";
import type { PricePoint } from "../types";
import { cacheAgeHours } from "./cache";
import { resolveWindowCandidates } from "./polygon";
import { CACHE_TTL_HOURS } from "./refresh";

interface LatestPriceCacheRow {
  computed_at: string;
  prices_json: string;
}

/**
 * Most-recent-trading-day close for each of `tickers` (any US-listed symbol, not just
 * current S&P 500 constituents — Grouped Daily covers the whole market), used only for the
 * purchase log's "current value" column. Cached the same way as the screen: reused if
 * younger than CACHE_TTL_HOURS and it already covers every requested ticker, otherwise
 * refetched for the full requested set.
 */
export interface LatestPricesResult {
  prices: Record<string, PricePoint>;
  computedAt: string;
}

export async function getOrRefreshLatestPrices(
  env: Env,
  asOfDate: string,
  tickers: string[],
): Promise<LatestPricesResult> {
  if (tickers.length === 0) return { prices: {}, computedAt: new Date().toISOString() };

  const row = await env.DB.prepare(
    "SELECT computed_at, prices_json FROM latest_price_cache WHERE id = 1",
  ).first<LatestPriceCacheRow>();

  if (row) {
    const cached: Record<string, PricePoint> = JSON.parse(row.prices_json);
    const fresh = cacheAgeHours(row.computed_at, new Date()) < CACHE_TTL_HOURS;
    const coversAll = tickers.every((t) => t in cached);
    if (fresh && coversAll) return { prices: cached, computedAt: row.computed_at };
  }

  const resolved = await resolveWindowCandidates(
    asOfDate,
    new Set(tickers),
    env.POLYGON_API_KEY,
    1, // only need the single most recent trading day
  );
  const prices: Record<string, PricePoint> = {};
  for (const ticker of tickers) {
    const candidates = resolved.get(ticker);
    if (candidates && candidates.length > 0) prices[ticker] = candidates[0];
  }

  const computedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO latest_price_cache (id, computed_at, prices_json) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET computed_at = excluded.computed_at, prices_json = excluded.prices_json`,
  )
    .bind(computedAt, JSON.stringify(prices))
    .run();

  return { prices, computedAt };
}
