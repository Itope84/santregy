import { env, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { writeScreenCache } from "../worker/lib/cache";
import { _setThrottleIntervalForTests } from "../worker/lib/polygon";
import { CACHE_TTL_HOURS, getOrRefreshScreen } from "../worker/lib/refresh";

const testEnv = env as unknown as Env;
const ASOF = "2026-09-02"; // window: start target 2025-08-02, end target 2026-08-02
const BLANK_RESULT = {
  asOfDate: ASOF,
  windowStartTarget: "2025-08-02",
  windowEndTarget: "2026-08-02",
  ranked: [],
  insufficientHistory: [],
};

let groupedDailyCalls = 0;

beforeAll(() => {
  _setThrottleIntervalForTests(0); // real ~12.5s/call throttle would make this test glacial
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://raw.githubusercontent.com")
    .intercept({ path: /constituents\.csv$/, method: "GET" })
    .reply(200, "Symbol,Security,GICS Sector\nAAA,AAA Inc.,Technology\n")
    .persist();

  fetchMock
    .get("https://api.polygon.io")
    .intercept({ path: /\/v2\/aggs\/grouped\/locale\/us\/market\/stocks\//, method: "GET" })
    .reply(200, () => {
      groupedDailyCalls++;
      return { status: "OK", resultsCount: 1, results: [{ T: "AAA", c: 100 }] };
    })
    .persist();
});

beforeEach(() => {
  groupedDailyCalls = 0;
});

describe("getOrRefreshScreen cache gating", () => {
  it("serves a cache younger than CACHE_TTL_HOURS without recomputing", async () => {
    await writeScreenCache(testEnv.DB, BLANK_RESULT, new Date().toISOString());

    const { fromCache } = await getOrRefreshScreen(testEnv, ASOF);

    expect(fromCache).toBe(true);
    expect(groupedDailyCalls).toBe(0);
  });

  it("recomputes once the cache is older than CACHE_TTL_HOURS", async () => {
    const staleComputedAt = new Date(
      Date.now() - (CACHE_TTL_HOURS + 1) * 3_600_000,
    ).toISOString();
    await writeScreenCache(testEnv.DB, BLANK_RESULT, staleComputedAt);

    const { fromCache, result } = await getOrRefreshScreen(testEnv, ASOF);

    expect(fromCache).toBe(false);
    expect(groupedDailyCalls).toBeGreaterThan(0);
    expect(result.ranked.map((r) => r.ticker)).toEqual(["AAA"]);
  });

  it("recomputes when there is no cache at all", async () => {
    const { fromCache } = await getOrRefreshScreen(testEnv, ASOF);
    expect(fromCache).toBe(false);
    expect(groupedDailyCalls).toBeGreaterThan(0);
  });
});
