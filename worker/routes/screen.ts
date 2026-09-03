import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { isRefreshInProgress, readScreenCache, type CachedScreen } from "../lib/cache";
import { triggerScreenRefresh } from "../lib/refresh";
import { selectPicks } from "../lib/screen";

export const screenRoutes = new Hono<AppEnv>();

screenRoutes.use("*", requireAuth);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cachedScreenResponse(cached: CachedScreen | null, xValue: number, refreshing: boolean) {
  if (!cached) return { cached: false, refreshing };
  return {
    cached: true,
    refreshing,
    computedAt: cached.computedAt,
    asOfDate: cached.result.asOfDate,
    entries: selectPicks(cached.result, xValue),
    insufficientHistory: cached.result.insufficientHistory,
  };
}

/** Read-only: whatever is already cached, for initial page load and for the client to poll
 * after triggering a refresh. Never triggers a fetch itself — "running" the screen is an
 * explicit user action (see POST /run). */
screenRoutes.get("/", async (c) => {
  const user = c.get("user");
  const [cached, refreshing] = await Promise.all([
    readScreenCache(c.env.DB),
    isRefreshInProgress(c.env.DB, new Date()),
  ]);
  return c.json(cachedScreenResponse(cached, user.xValue, refreshing));
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
  return c.json({
    status: trigger.status,
    ...cachedScreenResponse(trigger.cached, user.xValue, trigger.status !== "served-cache"),
  });
});
