import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { readScreenCache } from "../lib/cache";
import { getOrRefreshScreen } from "../lib/refresh";
import { selectPicks } from "../lib/screen";

export const screenRoutes = new Hono<AppEnv>();

screenRoutes.use("*", requireAuth);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read-only: whatever is already cached, for initial page load. Never triggers a fetch —
 * "running" the screen is an explicit user action (see POST /run). */
screenRoutes.get("/", async (c) => {
  const user = c.get("user");
  const cached = await readScreenCache(c.env.DB);
  if (!cached) return c.json({ cached: false });
  return c.json({
    cached: true,
    computedAt: cached.computedAt,
    asOfDate: cached.result.asOfDate,
    entries: selectPicks(cached.result, user.xValue),
    insufficientHistory: cached.result.insufficientHistory,
  });
});

/** The explicit "run screen" action. Serves the cache if it's fresh (<24h), otherwise
 * re-fetches and recomputes — same cache-gated path the daily notification cron uses. */
screenRoutes.post("/run", async (c) => {
  const user = c.get("user");
  const { result, computedAt, fromCache } = await getOrRefreshScreen(c.env, todayUtc());
  return c.json({
    cached: true,
    fromCache,
    computedAt,
    asOfDate: result.asOfDate,
    entries: selectPicks(result, user.xValue),
    insufficientHistory: result.insufficientHistory,
  });
});
