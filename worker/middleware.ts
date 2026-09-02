import { getCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import type { Env } from "./env";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "./lib/auth";

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE);
  const user = sessionId ? await getSessionUser(c.env.DB, sessionId) : null;
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  c.set("user", user);
  await next();
}
