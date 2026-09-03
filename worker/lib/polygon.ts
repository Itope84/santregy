import type { PricePoint } from "../types";
import { addDays, compareDates } from "./dates";

const BASE = "https://api.polygon.io";

/**
 * Polygon free tier allows 5 calls/minute. This module is the only place that calls
 * Polygon, so a single module-level throttle keeps every caller safely under that limit
 * without each call site having to know about it.
 */
let lastCallAt = 0;
let MIN_INTERVAL_MS = 12_500; // ~4.8 calls/min, a small margin under the 5/min cap

/** Test-only escape hatch: real Polygon throttling (~12.5s/call) would make cache/notify
 * tests take minutes even with mocked responses. Never called from application code. */
export function _setThrottleIntervalForTests(ms: number): void {
  MIN_INTERVAL_MS = ms;
}

// A mutex chain, not just a shared timestamp: two throttle() calls started concurrently
// (e.g. from parallel resolveWindowCandidates calls) would otherwise both read the same
// `lastCallAt` before either updates it and slip past the interval together.
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

async function polygonFetch(path: string, apiKey: string): Promise<any> {
  await throttle();
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polygon request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return res.json();
}

interface GroupedDailyResult {
  T: string; // ticker
  c: number; // close
}

/** One Grouped Daily call: every US ticker's adjusted close for a single date. */
async function groupedDaily(date: string, apiKey: string): Promise<Map<string, number>> {
  const json = await polygonFetch(
    `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
    apiKey,
  );
  const closes = new Map<string, number>();
  if (json.status === "OK" && Array.isArray(json.results)) {
    for (const r of json.results as GroupedDailyResult[]) {
      closes.set(r.T, r.c);
    }
  }
  return closes;
}

/**
 * Resolve up to `maxTradingDays` most-recent market trading days on or before `target`
 * (walking back through calendar days and skipping any with no Grouped Daily results, i.e.
 * weekends/holidays), and return each requested ticker's close on each of those days.
 *
 * Cost: exactly `maxTradingDays` Grouped Daily calls (one per trading day found), regardless
 * of universe size — this is the whole point of using the bulk endpoint.
 */
export async function resolveWindowCandidates(
  target: string,
  tickers: Set<string>,
  apiKey: string,
  maxTradingDays = 5,
  maxCalendarDaysBack = 20,
): Promise<Map<string, PricePoint[]>> {
  const byTicker = new Map<string, PricePoint[]>();
  let cursor = target;
  let tradingDaysFound = 0;
  let calendarDaysWalked = 0;

  while (tradingDaysFound < maxTradingDays && calendarDaysWalked < maxCalendarDaysBack) {
    if (compareDates(cursor, target) <= 0) {
      const closes = await groupedDaily(cursor, apiKey);
      if (closes.size > 0) {
        for (const ticker of tickers) {
          const close = closes.get(ticker);
          if (close === undefined) continue;
          const list = byTicker.get(ticker) ?? [];
          list.push({ date: cursor, close });
          byTicker.set(ticker, list);
        }
        tradingDaysFound++;
      }
    }
    cursor = addDays(cursor, -1);
    calendarDaysWalked++;
  }

  return byTicker;
}

/**
 * The CIK (a stable SEC company identifier) a ticker symbol pointed to as of `date`, or null
 * if it can't be determined (no active ticker on that date, or the lookup itself failed).
 * Used to catch ticker-symbol reuse/renames: Grouped Daily carries no company-identity field,
 * only the ticker string, so a symbol that changed hands within the lookback window would
 * otherwise silently attach an unrelated company's historical price to today's constituent.
 * Returns null rather than throwing on failure so a caller can treat "couldn't verify" the
 * same as "verification failed" — safer than assuming an unverifiable price is fine.
 */
export async function tickerCikAsOf(
  ticker: string,
  date: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const json = await polygonFetch(
      `/v3/reference/tickers/${encodeURIComponent(ticker)}?date=${date}`,
      apiKey,
    );
    if (json.status !== "OK" || !json.results?.cik) return null;
    return json.results.cik as string;
  } catch {
    return null;
  }
}

/** First-ever daily bar for a single ticker within [from, to]. Used only for the small
 * number of tickers that fail window-start resolution (recent IPOs/spinoffs/additions). */
export async function firstAvailableBar(
  ticker: string,
  from: string,
  to: string,
  apiKey: string,
): Promise<PricePoint | null> {
  const json = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=1`,
    apiKey,
  );
  const bar = json?.results?.[0];
  if (!bar) return null;
  const date = new Date(bar.t).toISOString().slice(0, 10);
  return { date, close: bar.c };
}
