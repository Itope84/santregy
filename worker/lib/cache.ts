import type { Env } from "../env";
import type { ScreenResult } from "../types";

export interface CachedScreen {
  computedAt: string; // ISO datetime
  result: ScreenResult;
}

export async function readScreenCache(db: Env["DB"]): Promise<CachedScreen | null> {
  const row = await db
    .prepare("SELECT computed_at, ranked_json FROM screen_cache WHERE id = 1")
    .first<{ computed_at: string; ranked_json: string }>();
  if (!row) return null;
  return { computedAt: row.computed_at, result: JSON.parse(row.ranked_json) };
}

export async function writeScreenCache(
  db: Env["DB"],
  result: ScreenResult,
  computedAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO screen_cache (id, as_of_date, computed_at, ranked_json) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET as_of_date = excluded.as_of_date,
         computed_at = excluded.computed_at, ranked_json = excluded.ranked_json`,
    )
    .bind(result.asOfDate, computedAt, JSON.stringify(result))
    .run();
}

export function cacheAgeHours(computedAt: string, now: Date): number {
  return (now.getTime() - new Date(computedAt).getTime()) / 3_600_000;
}

// A refresh can take a couple of minutes (throttled Polygon calls). If the Worker instance
// running it is ever torn down mid-refresh without reaching the `finally` that releases the
// lock (a crash, not a normal error path — those are caught), this is how long a stuck lock
// blocks further refreshes before it's treated as abandoned and cleared.
const REFRESH_LOCK_STALE_MS = 10 * 60 * 1000;

/** Atomically claims the "a refresh is running" lock. Returns false if one is already held
 * and not yet stale — the caller must not start a second background refresh. */
export async function acquireRefreshLock(db: Env["DB"], now: Date): Promise<boolean> {
  const staleThreshold = new Date(now.getTime() - REFRESH_LOCK_STALE_MS).toISOString();
  await db.prepare("DELETE FROM screen_refresh_lock WHERE id = 1 AND started_at < ?").bind(staleThreshold).run();
  const result = await db
    .prepare("INSERT OR IGNORE INTO screen_refresh_lock (id, started_at) VALUES (1, ?)")
    .bind(now.toISOString())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseRefreshLock(db: Env["DB"]): Promise<void> {
  await db.prepare("DELETE FROM screen_refresh_lock WHERE id = 1").run();
}

export async function isRefreshInProgress(db: Env["DB"], now: Date): Promise<boolean> {
  const staleThreshold = new Date(now.getTime() - REFRESH_LOCK_STALE_MS).toISOString();
  const row = await db
    .prepare("SELECT 1 FROM screen_refresh_lock WHERE id = 1 AND started_at >= ?")
    .bind(staleThreshold)
    .first();
  return row !== null;
}
