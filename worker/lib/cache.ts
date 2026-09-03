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
// running it is ever torn down mid-refresh without reaching the `finally` that marks it done
// (a crash, not a normal error path — those are caught and recorded), this is how long an
// unfinished row blocks further refreshes before it's treated as abandoned and cleared.
const REFRESH_LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * Atomically claims the "a refresh is running" slot. Returns false if one is already running
 * and not yet stale — the caller must not start a second background refresh. Also clears any
 * previous row first (whether it finished successfully, failed, or went stale mid-run) so a
 * fresh attempt always starts from a clean row rather than layering on old status fields.
 */
export async function acquireRefreshLock(db: Env["DB"], now: Date): Promise<boolean> {
  const staleThreshold = new Date(now.getTime() - REFRESH_LOCK_STALE_MS).toISOString();
  await db
    .prepare(
      "DELETE FROM screen_refresh_lock WHERE id = 1 AND (finished_at IS NOT NULL OR started_at < ?)",
    )
    .bind(staleThreshold)
    .run();
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO screen_refresh_lock (id, started_at, finished_at, ok, error) VALUES (1, ?, NULL, NULL, NULL)",
    )
    .bind(now.toISOString())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Records how a background refresh ended. Called from a `finally`, so this runs whether the
 * refresh succeeded or threw — never leaves the row silently "still running" after it's done. */
export async function markRefreshComplete(
  db: Env["DB"],
  ok: boolean,
  error: string | null,
): Promise<void> {
  await db
    .prepare("UPDATE screen_refresh_lock SET finished_at = ?, ok = ?, error = ? WHERE id = 1")
    .bind(new Date().toISOString(), ok ? 1 : 0, error)
    .run();
}

export async function isRefreshInProgress(db: Env["DB"], now: Date): Promise<boolean> {
  const staleThreshold = new Date(now.getTime() - REFRESH_LOCK_STALE_MS).toISOString();
  const row = await db
    .prepare(
      "SELECT 1 FROM screen_refresh_lock WHERE id = 1 AND finished_at IS NULL AND started_at >= ?",
    )
    .bind(staleThreshold)
    .first();
  return row !== null;
}

export interface LastRefreshError {
  error: string;
  at: string;
}

/** The most recent refresh's error, if it failed and no newer attempt has started since
 * (acquireRefreshLock clears this the moment a new refresh begins). Null if the last known
 * attempt succeeded, or none has run yet. */
export async function getLastRefreshError(db: Env["DB"]): Promise<LastRefreshError | null> {
  const row = await db
    .prepare(
      "SELECT finished_at, error FROM screen_refresh_lock WHERE id = 1 AND finished_at IS NOT NULL AND ok = 0",
    )
    .first<{ finished_at: string; error: string | null }>();
  if (!row) return null;
  return { error: row.error ?? "Unknown error", at: row.finished_at };
}
