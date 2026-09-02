import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../middleware";
import {
  checkAndRecordRateLimit,
  consumeMagicLinkToken,
  createSession,
  isValidEmail,
  normalizeEmail,
  issueMagicLinkToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../lib/auth";
import { sendMagicLinkEmail } from "../lib/email";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/request", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return c.json({ error: "Enter a valid email address" }, 400);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const allowed = await checkAndRecordRateLimit(c.env.DB, email, ip);
  if (!allowed) {
    return c.json({ error: "Too many requests. Try again later." }, 429);
  }

  const rawToken = await issueMagicLinkToken(c.env.DB, email);
  const url = `${c.env.APP_BASE_URL}/api/auth/callback?token=${rawToken}`;
  await sendMagicLinkEmail(c.env, email, url);

  return c.json({ ok: true });
});

authRoutes.get("/callback", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.text("Missing token", 400);

  const userId = await consumeMagicLinkToken(c.env.DB, token);
  if (!userId) return c.text("This link is invalid, expired, or already used.", 400);

  const sessionId = await createSession(c.env.DB, userId);
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect("/");
});

authRoutes.post("/logout", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
