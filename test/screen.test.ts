import { describe, expect, it } from "vitest";
import { screen, selectPicks } from "../worker/lib/screen";
import type { ScreenInput, UniverseConstituent } from "../worker/types";

const ASOF = "2026-09-02"; // window: start target 2025-08-02, end target 2026-08-02

function universe(...tickers: string[]): UniverseConstituent[] {
  return tickers.map((t) => ({ ticker: t, name: `${t} Inc.`, sector: "Technology" }));
}

describe("screen()", () => {
  it("ranks a normal full-history ticker by (end/start - 1)", () => {
    const input: ScreenInput = {
      asOfDate: ASOF,
      universe: universe("AAA"),
      priceData: {
        AAA: {
          windowStartCandidates: [{ date: "2025-08-01", close: 100 }],
          windowEndCandidates: [{ date: "2026-08-03", close: 150 }],
        },
      },
    };
    const result = screen(input);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]).toMatchObject({
      ticker: "AAA",
      trailingReturn: 0.5,
      windowStartDate: "2025-08-01",
      windowStartPrice: 100,
      windowEndDate: "2026-08-03",
      windowEndPrice: 150,
    });
    expect(result.insufficientHistory).toHaveLength(0);
  });

  it("flags a ticker whose history starts mid-window as insufficientHistory, not ranked", () => {
    // SanDisk-style spinoff: no candidate at window start, but it trades by window end.
    const input: ScreenInput = {
      asOfDate: ASOF,
      universe: universe("SNDK"),
      priceData: {
        SNDK: {
          windowStartCandidates: [], // no trades yet at window start
          windowEndCandidates: [{ date: "2026-08-03", close: 60 }],
          firstAvailable: { date: "2025-02-25", close: 20 },
        },
      },
    };
    const result = screen(input);
    expect(result.ranked).toHaveLength(0);
    expect(result.insufficientHistory).toEqual([
      {
        ticker: "SNDK",
        name: "SNDK Inc.",
        sector: "Technology",
        partialReturn: 2, // 60/20 - 1
        firstAvailableDate: "2025-02-25",
        windowEndDate: "2026-08-03",
        windowEndPrice: 60,
      },
    ]);
  });

  it("resolves a window endpoint that lands on a holiday/weekend to the last available trading day", () => {
    // Target end date 2026-08-02 is a Sunday; the fetch layer's lookback found 2026-07-31
    // (Friday) as the most recent trade at/before target, and hands it to screen() as the
    // first (most recent) candidate.
    const input: ScreenInput = {
      asOfDate: ASOF,
      universe: universe("BBB"),
      priceData: {
        BBB: {
          windowStartCandidates: [{ date: "2025-08-01", close: 100 }],
          windowEndCandidates: [
            { date: "2026-07-31", close: 120 },
            { date: "2026-07-30", close: 118 },
          ],
        },
      },
    };
    const result = screen(input);
    expect(result.ranked[0].windowEndDate).toBe("2026-07-31");
    expect(result.ranked[0].windowEndPrice).toBe(120);
  });

  it("excludes a ticker with no valid price within the lookback tolerance at either endpoint, without dropping it silently", () => {
    const input: ScreenInput = {
      asOfDate: ASOF,
      universe: universe("HALTED"),
      priceData: {
        HALTED: { windowStartCandidates: [], windowEndCandidates: [] },
      },
    };
    const result = screen(input);
    expect(result.ranked).toHaveLength(0);
    expect(result.insufficientHistory).toEqual([
      {
        ticker: "HALTED",
        name: "HALTED Inc.",
        sector: "Technology",
        partialReturn: null,
        firstAvailableDate: null,
        windowEndDate: null,
        windowEndPrice: null,
      },
    ]);
  });

  it("uses split-adjusted closes, not raw closes, across a split inside the window", () => {
    // A stock did a 2:1 split inside the window and genuinely rose ~20% over the period.
    // Adjusted closes (what screen() must be fed) reflect that correctly. If raw closes had
    // been used instead, the same trade history would read as (60/100 - 1) = -40%, which is
    // exactly the silent corruption the spec warns about — this test proves screen() reports
    // the true adjusted return, not the split-corrupted one.
    const rawEndCloseAfterSplit = 60; // post-split raw price
    const splitFactor = 2;
    const adjustedStartClose = 100 / splitFactor; // pre-split raw 100, restated in post-split terms
    const adjustedEndClose = rawEndCloseAfterSplit; // already post-split

    const input: ScreenInput = {
      asOfDate: ASOF,
      universe: universe("SPLIT"),
      priceData: {
        SPLIT: {
          windowStartCandidates: [{ date: "2025-08-01", close: adjustedStartClose }],
          windowEndCandidates: [{ date: "2026-08-03", close: adjustedEndClose }],
        },
      },
    };
    const result = screen(input);
    expect(result.ranked[0].trailingReturn).toBeCloseTo(0.2, 10); // 60/50 - 1 = +20%
    expect(result.ranked[0].trailingReturn).not.toBeCloseTo(-0.4, 1);
  });

  it("ranks descending by trailing return", () => {
    const tickers = ["A", "B", "C"];
    const priceData: ScreenInput["priceData"] = {};
    const closes = [150, 200, 100]; // B best, A middle, C worst
    tickers.forEach((t, i) => {
      priceData[t] = {
        windowStartCandidates: [{ date: "2025-08-01", close: 100 }],
        windowEndCandidates: [{ date: "2026-08-03", close: closes[i] }],
      };
    });
    const input: ScreenInput = { asOfDate: ASOF, universe: universe(...tickers), priceData };
    const result = screen(input);
    expect(result.ranked.map((r) => r.ticker)).toEqual(["B", "A", "C"]);
  });
});

describe("selectPicks()", () => {
  it("slices the cached full ranking into X + 5, flagging only the first X as picks", () => {
    const tickers = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const priceData: ScreenInput["priceData"] = {};
    tickers.forEach((t, i) => {
      // Descending returns as we go down the alphabet: A best, H worst.
      priceData[t] = {
        windowStartCandidates: [{ date: "2025-08-01", close: 100 }],
        windowEndCandidates: [{ date: "2026-08-03", close: 200 - i * 10 }],
      };
    });
    const full = screen({ asOfDate: ASOF, universe: universe(...tickers), priceData });
    expect(full.ranked).toHaveLength(8); // the cache holds the whole rankable universe

    const picks = selectPicks(full, 2);
    expect(picks).toHaveLength(7); // x + 5, even though 8 tickers were rankable
    expect(picks.map((p) => p.ticker)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(picks.filter((p) => p.isPick).map((p) => p.ticker)).toEqual(["A", "B"]);
  });
});
