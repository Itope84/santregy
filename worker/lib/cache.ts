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
