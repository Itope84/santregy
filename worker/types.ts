// Shared domain types. `screen()` and everything it touches lives in worker/lib/screen.ts
// and must stay free of I/O — these types describe data, not how it's fetched or stored.

export interface PricePoint {
  date: string; // 'YYYY-MM-DD'
  close: number; // split-adjusted close (Polygon `adjusted=true`); NOT dividend-adjusted
}

/**
 * Per-ticker prices handed to screen(). Candidates are the fetch layer's up-to-5-trading-day
 * lookback around each window endpoint, sorted most-recent-first, each already <= the target
 * date. `firstAvailable` is populated by the fetch layer only for tickers it couldn't resolve
 * at window start, so screen() can report a first-available date without a network call.
 */
export interface TickerPriceSeries {
  windowStartCandidates: PricePoint[];
  windowEndCandidates: PricePoint[];
  firstAvailable?: PricePoint;
  /**
   * Set by the fetch layer when a window-start candidate existed but implied an implausible
   * return and failed a ticker-identity check (the symbol likely belonged to a different
   * company at that date — e.g. a rename or a reused ticker) — the candidate was discarded
   * rather than trusted. screen() surfaces this as a distinct reason in insufficientHistory
   * instead of treating it like a recent IPO with no history yet.
   */
  windowStartIdentityMismatch?: boolean;
}

export interface UniverseConstituent {
  ticker: string;
  name: string;
  sector: string;
}

export interface ScreenInput {
  asOfDate: string; // 'YYYY-MM-DD'
  universe: UniverseConstituent[];
  priceData: Record<string, TickerPriceSeries>;
}

export interface RankedEntry {
  ticker: string;
  name: string;
  sector: string;
  trailingReturn: number;
  windowStartDate: string;
  windowStartPrice: number;
  windowEndDate: string;
  windowEndPrice: number;
}

export interface PickEntry extends RankedEntry {
  isPick: boolean;
}

export interface InsufficientHistoryEntry {
  ticker: string;
  name: string;
  sector: string;
  partialReturn: number | null;
  firstAvailableDate: string | null;
  windowEndDate: string | null;
  windowEndPrice: number | null;
  /** "no-history": no price found near window start at all (recent IPO/spinoff/addition).
   * "identity-mismatch": a price was found, but it implied an implausible return and failed
   * ticker-identity verification, so it was discarded rather than trusted. */
  reason: "no-history" | "identity-mismatch";
}

/**
 * The full ranked universe for one as-of date — this, unsliced, is what gets cached
 * globally. Per-user X-dependent slicing into picks/alternates happens after the cache
 * read (see selectPicks in worker/lib/screen.ts), not here.
 */
export interface ScreenResult {
  asOfDate: string;
  windowStartTarget: string;
  windowEndTarget: string;
  ranked: RankedEntry[];
  insufficientHistory: InsufficientHistoryEntry[];
}
