import { env, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { _setThrottleIntervalForTests } from "../worker/lib/polygon";
import { getOrRefreshScreen } from "../worker/lib/refresh";

const testEnv = env as unknown as Env;
const ASOF = "2026-09-02";
// Exact window-start/end targets for ASOF (see test/dates.test.ts) — resolveWindowCandidates
// tries the target date itself first, so mocking anything else would need a fake weekend/
// holiday walk-back too; using the real target dates keeps this test focused on identity
// verification instead.
const START_DATE = "2025-08-02";
const END_DATE = "2026-08-02";

// REUSED: implied return is way past the extreme threshold, and its CIK differs between
// window start and window end — must be demoted to insufficientHistory as identity-mismatch,
// exactly like the real BNY case this test is modeling.
// VERIFIED: also an extreme implied return, but the SAME CIK both times — a legitimately huge
// move must still be ranked, not blanket-rejected just for being large.
// NORMAL: an unremarkable return — must never trigger an identity check at all.
const GROUPED_DAILY_CLOSES: Record<string, number> = {
  REUSED: 9.48,
  VERIFIED: 10,
  NORMAL: 100,
};
const GROUPED_DAILY_END_CLOSES: Record<string, number> = {
  REUSED: 90, // 90/9.48 - 1 ≈ +849%
  VERIFIED: 70, // 70/10 - 1 = +600%
  NORMAL: 110, // +10%
};
const CIKS: Record<string, { start: string; end: string }> = {
  REUSED: { start: "0001111111", end: "0002222222" },
  VERIFIED: { start: "0003333333", end: "0003333333" },
};

let identityCheckCalls: string[] = [];

beforeAll(() => {
  _setThrottleIntervalForTests(0);
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://raw.githubusercontent.com")
    .intercept({ path: /constituents\.csv$/, method: "GET" })
    .reply(
      200,
      "Symbol,Security,GICS Sector\n" +
        "REUSED,Reused Co,Financials\n" +
        "VERIFIED,Verified Co,Technology\n" +
        "NORMAL,Normal Co,Industrials\n",
    )
    .persist();

  // resolveWindowCandidates walks back up to 5 trading days from the target, so every date
  // it might land on needs a response, not just the exact target date. Start and end targets
  // fall in different years (2025 vs 2026) here, which is a safe, simple way to tell them
  // apart across that whole walk-back range without enumerating every date.
  fetchMock
    .get("https://api.polygon.io")
    .intercept({
      path: (p) =>
        p.startsWith(`/v2/aggs/grouped/locale/us/market/stocks/${START_DATE.slice(0, 4)}-`),
      method: "GET",
    })
    .reply(200, {
      status: "OK",
      resultsCount: 3,
      results: Object.entries(GROUPED_DAILY_CLOSES).map(([T, c]) => ({ T, c })),
    })
    .persist();

  fetchMock
    .get("https://api.polygon.io")
    .intercept({
      path: (p) =>
        p.startsWith(`/v2/aggs/grouped/locale/us/market/stocks/${END_DATE.slice(0, 4)}-`),
      method: "GET",
    })
    .reply(200, {
      status: "OK",
      resultsCount: 3,
      results: Object.entries(GROUPED_DAILY_END_CLOSES).map(([T, c]) => ({ T, c })),
    })
    .persist();

  fetchMock
    .get("https://api.polygon.io")
    .intercept({ path: /\/v3\/reference\/tickers\//, method: "GET" })
    .reply(200, (opts) => {
      identityCheckCalls.push(opts.path);
      const match = opts.path.match(/^\/v3\/reference\/tickers\/([^?]+)\?date=([^&]+)/);
      const ticker = match?.[1] as keyof typeof CIKS;
      const date = match?.[2];
      const cik = date === START_DATE ? CIKS[ticker]?.start : CIKS[ticker]?.end;
      return cik
        ? { status: "OK", results: { cik } }
        : { status: "NOT_FOUND", results: null };
    })
    .persist();
});

beforeEach(async () => {
  identityCheckCalls = [];
  // Each test needs a real recompute, not a cache hit from a previous test in this file.
  await testEnv.DB.prepare("DELETE FROM screen_cache").run();
});

describe("ticker-identity verification for implausible returns", () => {
  it("demotes a ticker to insufficientHistory when an extreme return fails identity verification", async () => {
    const { result } = await getOrRefreshScreen(testEnv, ASOF);

    expect(result.ranked.map((r) => r.ticker)).not.toContain("REUSED");
    const entry = result.insufficientHistory.find((e) => e.ticker === "REUSED");
    expect(entry).toMatchObject({
      reason: "identity-mismatch",
      firstAvailableDate: null, // never guessed via firstAvailableBar for this reason
      partialReturn: null,
    });
  });

  it("keeps a legitimately large return ranked when identity verification confirms the same company", async () => {
    const { result } = await getOrRefreshScreen(testEnv, ASOF);

    const entry = result.ranked.find((r) => r.ticker === "VERIFIED");
    expect(entry).toBeDefined();
    expect(entry?.trailingReturn).toBeCloseTo(6.0, 5);
  });

  it("never runs an identity check for a ticker whose return isn't extreme", async () => {
    await getOrRefreshScreen(testEnv, ASOF);

    expect(identityCheckCalls.some((p) => p.startsWith("/v3/reference/tickers/NORMAL"))).toBe(
      false,
    );
    // Exactly REUSED and VERIFIED each get checked at both endpoints, nothing else.
    expect(identityCheckCalls).toHaveLength(4);
  });
});
