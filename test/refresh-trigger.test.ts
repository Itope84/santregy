import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { getLastRefreshError, isRefreshInProgress, readScreenCache } from "../worker/lib/cache";
import { _setThrottleIntervalForTests } from "../worker/lib/polygon";
import { triggerScreenRefresh } from "../worker/lib/refresh";

const testEnv = env as unknown as Env;
const ASOF = "2026-09-02";

let failGroupedDaily = false;

beforeAll(() => {
  _setThrottleIntervalForTests(0);
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
    .reply((): { statusCode: number; data: Record<string, unknown> } =>
      failGroupedDaily
        ? { statusCode: 500, data: { status: "ERROR", message: "simulated failure" } }
        : { statusCode: 200, data: { status: "OK", resultsCount: 1, results: [{ T: "AAA", c: 100 }] } },
    )
    .persist();
});

beforeEach(async () => {
  failGroupedDaily = false;
  await testEnv.DB.prepare("DELETE FROM screen_cache").run();
  await testEnv.DB.prepare("DELETE FROM screen_refresh_lock").run();
});

describe("triggerScreenRefresh", () => {
  it("returns immediately with 'started' rather than blocking on the refresh", async () => {
    const ctx = createExecutionContext();
    const result = await triggerScreenRefresh(testEnv, ASOF, ctx);

    expect(result.status).toBe("started");
    expect(result.cached).toBeNull(); // nothing cached yet, and this call didn't wait for it

    await waitOnExecutionContext(ctx); // let the ctx.waitUntil background work finish

    const cached = await readScreenCache(testEnv.DB);
    expect(cached?.result.asOfDate).toBe(ASOF);
    expect(cached?.result.ranked.map((r) => r.ticker)).toEqual(["AAA"]);

    expect(await isRefreshInProgress(testEnv.DB, new Date())).toBe(false);
    expect(await getLastRefreshError(testEnv.DB)).toBeNull(); // succeeded, so no error recorded
  });

  it("does not start a second background refresh while one is already in flight", async () => {
    const ctx1 = createExecutionContext();
    const first = await triggerScreenRefresh(testEnv, ASOF, ctx1);
    expect(first.status).toBe("started");

    // A second call (e.g. a double-click) before the first has finished must not kick off a
    // duplicate — the lock row from the first call is already committed by this point.
    const ctx2 = createExecutionContext();
    const second = await triggerScreenRefresh(testEnv, ASOF, ctx2);
    expect(second.status).toBe("already-running");

    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);
  });

  it("serves the cache immediately, without starting a refresh, once it's fresh", async () => {
    const ctx0 = createExecutionContext();
    await triggerScreenRefresh(testEnv, ASOF, ctx0);
    await waitOnExecutionContext(ctx0);

    const ctx = createExecutionContext();
    const result = await triggerScreenRefresh(testEnv, ASOF, ctx);

    expect(result.status).toBe("served-cache");
    expect(result.cached?.result.asOfDate).toBe(ASOF);
  });

  it("records a failed refresh's error so it's visible without checking the logs, and allows a retry", async () => {
    failGroupedDaily = true;
    const ctx1 = createExecutionContext();
    await triggerScreenRefresh(testEnv, ASOF, ctx1);
    await waitOnExecutionContext(ctx1);

    expect(await isRefreshInProgress(testEnv.DB, new Date())).toBe(false);
    const failure = await getLastRefreshError(testEnv.DB);
    expect(failure?.error).toContain("Polygon request failed");

    // A subsequent trigger must not be stuck behind the failed attempt's row.
    failGroupedDaily = false;
    const ctx2 = createExecutionContext();
    const retry = await triggerScreenRefresh(testEnv, ASOF, ctx2);
    expect(retry.status).toBe("started");
    await waitOnExecutionContext(ctx2);

    expect(await getLastRefreshError(testEnv.DB)).toBeNull(); // cleared by the successful retry
    const cached = await readScreenCache(testEnv.DB);
    expect(cached?.result.asOfDate).toBe(ASOF);
  });
});
