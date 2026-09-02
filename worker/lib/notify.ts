import type { Env } from "../env";
import { currentAnniversaryYear, isAnniversaryToday } from "./dates";
import { sendAnnualPicksEmail } from "./email";
import { getOrRefreshScreen } from "./refresh";
import { selectPicks } from "./screen";

interface UserRow {
  id: string;
  email: string;
  anniversary_date: string;
  x_value: number;
}

/** Atomically claims the (user, year) notification slot. Returns false if it was already
 * claimed (already sent, or a concurrent run got there first) — the caller must not send. */
async function claimNotification(db: Env["DB"], userId: string, year: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO sent_notifications (user_id, anniversary_year) VALUES (?, ?)")
    .bind(userId, year)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Releases a claim so a later retry can still send, used only when the send itself failed
 * after the claim succeeded (e.g. a transient Resend error) — never on a successful send. */
async function releaseClaim(db: Env["DB"], userId: string, year: number): Promise<void> {
  await db
    .prepare("DELETE FROM sent_notifications WHERE user_id = ? AND anniversary_year = ?")
    .bind(userId, year)
    .run();
}

/**
 * Daily cron entry point. Finds users whose anniversary is today (UTC), and sends each one
 * their picks — using the same cached screen path as the manual "run screen" button, per
 * spec, so the two never drift apart.
 */
export async function runAnnualNotifications(env: Env, todayDateStr: string): Promise<void> {
  const users = await env.DB.prepare(
    "SELECT id, email, anniversary_date, x_value FROM users",
  ).all<UserRow>();
  const due = (users.results ?? []).filter((u) => isAnniversaryToday(u.anniversary_date, todayDateStr));
  if (due.length === 0) return;

  const year = currentAnniversaryYear(todayDateStr);
  const { result } = await getOrRefreshScreen(env, todayDateStr);

  for (const user of due) {
    const claimed = await claimNotification(env.DB, user.id, year);
    if (!claimed) continue; // already sent for this (user, year)

    const entries = selectPicks(result, user.x_value);
    const picks = entries.filter((e) => e.isPick);
    const alternates = entries.filter((e) => !e.isPick);

    try {
      await sendAnnualPicksEmail(env, user.email, year, picks, alternates);
    } catch (err) {
      await releaseClaim(env.DB, user.id, year);
      console.error(`Failed to send annual picks email to user ${user.id}:`, err);
    }
  }
}
