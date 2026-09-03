import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { getLastRefreshError, isRefreshInProgress, readScreenCache, type CachedScreen } from "../lib/cache";
import { triggerScreenRefresh } from "../lib/refresh";
import { selectPicks } from "../lib/screen";

export const screenRoutes = new Hono<AppEnv>();

screenRoutes.use("*", requireAuth);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cachedScreenResponse(
  cached: CachedScreen | null,
  xValue: number,
  refreshing: boolean,
  lastError: { error: string; at: string } | null,
) {
  const errorFields = lastError ? { lastError: lastError.error, lastErrorAt: lastError.at } : {};
  if (!cached) return { cached: false, refreshing, ...errorFields };
  return {
    cached: true,
    refreshing,
    computedAt: cached.computedAt,
    asOfDate: cached.result.asOfDate,
    entries: selectPicks(cached.result, xValue),
    insufficientHistory: cached.result.insufficientHistory,
    ...errorFields,
  };
}

/** Read-only: whatever is already cached, for initial page load and for the client to poll
 * after triggering a refresh. Never triggers a fetch itself — "running" the screen is an
 * explicit user action (see POST /run). Also reports whether a refresh is in progress and,
 * if the last attempt failed, why — so a failed background run is visible in the UI instead
 * of only in the Workers logs. */
screenRoutes.get("/", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const [cached, refreshing, lastError] = await Promise.all([
    readScreenCache(c.env.DB),
    isRefreshInProgress(c.env.DB, now),
    getLastRefreshError(c.env.DB),
  ]);
  return c.json(cachedScreenResponse(cached, user.xValue, refreshing, lastError));
});

/**
 * The explicit "run screen" action. If the cache is already fresh (<24h), returns it
 * immediately. Otherwise it does NOT wait for the refresh — a real run makes ~10 Polygon
 * calls paced ~13s apart to respect the free-tier rate limit, which can take a couple of
 * minutes and risks the HTTP request itself timing out even though the Worker keeps running
 * regardless. Instead this kicks the refresh off in the background (ctx.waitUntil) and
 * returns right away with whatever's currently cached (possibly stale) plus a status the
 * client uses to decide whether to start polling GET / for the fresh result.
 */
screenRoutes.post("/run", async (c) => {
  const user = c.get("user");
  const trigger = await triggerScreenRefresh(c.env, todayUtc(), c.executionCtx);
  const lastError = trigger.status === "started" ? null : await getLastRefreshError(c.env.DB);
  return c.json({
    status: trigger.status,
    ...cachedScreenResponse(trigger.cached, user.xValue, trigger.status !== "served-cache", lastError),
  });
});
