import { subtractMonths } from "./dates";
import type {
  InsufficientHistoryEntry,
  PickEntry,
  RankedEntry,
  ScreenInput,
  ScreenResult,
  TickerPriceSeries,
} from "../types";

/**
 * Core momentum screen. Pure: no network calls, no D1/KV reads, no clock reads. All price
 * data and the as-of date are supplied by the caller (see worker/lib/refresh.ts for the
 * fetch-and-cache orchestration that surrounds this).
 *
 * Ranks the FULL universe — no X here. X-dependent pick/alternate slicing happens after the
 * cache read, via selectPicks() below, so the cache holds one shared result for every user.
 *
 * Window: [asOfDate - 13mo, asOfDate - 1mo] (12mo measurement, 1mo skip before as-of).
 * Return: (windowEndPrice / windowStartPrice) - 1, using split-adjusted closes.
 * Note: Polygon's free-tier adjusted closes are split-adjusted only, not dividend-adjusted,
 * so this is a price return rather than the total return the original spec described. That
 * substitution was an explicit, approved change (see README "Data provider" section) — it is
 * not a simplification made in the course of implementing this function.
 */
export function screen(input: ScreenInput): ScreenResult {
  const { asOfDate, universe, priceData } = input;
  const windowStartTarget = subtractMonths(asOfDate, 13);
  const windowEndTarget = subtractMonths(asOfDate, 1);

  const ranked: RankedEntry[] = [];
  const insufficientHistory: InsufficientHistoryEntry[] = [];

  for (const constituent of universe) {
    const series: TickerPriceSeries | undefined = priceData[constituent.ticker];
    const startPoint = resolveEndpoint(series?.windowStartCandidates);
    const endPoint = resolveEndpoint(series?.windowEndCandidates);

    if (startPoint && endPoint) {
      ranked.push({
        ticker: constituent.ticker,
        name: constituent.name,
        sector: constituent.sector,
        trailingReturn: endPoint.close / startPoint.close - 1,
        windowStartDate: startPoint.date,
        windowStartPrice: startPoint.close,
        windowEndDate: endPoint.date,
        windowEndPrice: endPoint.close,
      });
      continue;
    }

    // Not cleanly rankable (recent IPO/spinoff/addition, or a data gap) — never silently
    // dropped, always surfaced with whatever we do know.
    const firstAvailable = series?.firstAvailable ?? null;
    const partialReturn =
      firstAvailable && endPoint ? endPoint.close / firstAvailable.close - 1 : null;
    insufficientHistory.push({
      ticker: constituent.ticker,
      name: constituent.name,
      sector: constituent.sector,
      partialReturn,
      firstAvailableDate: firstAvailable?.date ?? null,
      windowEndDate: endPoint?.date ?? null,
      windowEndPrice: endPoint?.close ?? null,
    });
  }

  ranked.sort((a, b) => b.trailingReturn - a.trailingReturn);

  return {
    asOfDate,
    windowStartTarget,
    windowEndTarget,
    ranked,
    insufficientHistory,
  };
}

/**
 * Slice a cached, already-ranked ScreenResult down to one user's X + 5 entries (the first X
 * flagged as picks, the rest as alternates). Pure and cheap — safe to call per-request.
 */
export function selectPicks(result: ScreenResult, x: number): PickEntry[] {
  return result.ranked.slice(0, x + 5).map((entry, i) => ({ ...entry, isPick: i < x }));
}

/**
 * Last available close on or before the target date, searching back up to 5 trading days.
 * `candidates` holds this ticker's own trades near the target, most-recent-first, each
 * already <= target — so the first entry (if any) is the resolved endpoint.
 */
function resolveEndpoint(
  candidates: TickerPriceSeries["windowStartCandidates"] | undefined,
): { date: string; close: number } | null {
  if (!candidates || candidates.length === 0) return null;
  return candidates[0];
}
