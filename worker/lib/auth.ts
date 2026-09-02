import type { Env } from "../env";

export const SESSION_COOKIE = "session";
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Generous for a 1-2 user personal tool, but bounded: a request every few seconds can't
// spam an inbox or brute-force tokens.
const EMAIL_RATE_LIMIT = { max: 5, windowMinutes: 60 };
const IP_RATE_LIMIT = { max: 20, windowMinutes: 60 };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Deliberately simple: good enough to catch typos, not a full RFC 5322 validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Returns true if the request is within the per-email and per-IP rate limits. Also logs
 * this attempt, so the check itself counts toward the limit (fail closed). */
export async function checkAndRecordRateLimit(
  db: Env["DB"],
  email: string,
  ip: string,
): Promise<boolean> {
  const emailSince = new Date(Date.now() - EMAIL_RATE_LIMIT.windowMinutes * 60_000).toISOString();
  const ipSince = new Date(Date.now() - IP_RATE_LIMIT.windowMinutes * 60_000).toISOString();

  const [emailCount, ipCount] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM magic_link_requests WHERE email = ? AND created_at > ?",
      )
      .bind(email, emailSince)
      .first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM magic_link_requests WHERE ip = ? AND created_at > ?")
      .bind(ip, ipSince)
      .first<{ n: number }>(),
  ]);

  if ((emailCount?.n ?? 0) >= EMAIL_RATE_LIMIT.max || (ipCount?.n ?? 0) >= IP_RATE_LIMIT.max) {
    return false;
  }

  await db
    .prepare("INSERT INTO magic_link_requests (email, ip) VALUES (?, ?)")
    .bind(email, ip)
    .run();
  return true;
}

/** Finds or creates the user for this email, issues a single-use magic-link token, and
 * returns the raw token (never persisted — only its hash is stored). */
export async function issueMagicLinkToken(db: Env["DB"], email: string): Promise<string> {
  let user = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (!user) {
    const id = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const anniversary = today.slice(5); // 'MM-DD', defaults to signup date per spec
    await db
      .prepare("INSERT INTO users (id, email, anniversary_date, x_value) VALUES (?, ?, ?, 2)")
      .bind(id, email, anniversary)
      .run();
    user = { id };
  }

  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO magic_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, user.id, expiresAt)
    .run();

  return rawToken;
}

/** Atomically consumes a magic-link token (single use, must be unexpired) and returns the
 * user id it belonged to, or null if the token is invalid, expired, or already used. */
export async function consumeMagicLinkToken(
  db: Env["DB"],
  rawToken: string,
): Promise<string | null> {
  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE magic_tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING user_id`,
    )
    .bind(nowIso, tokenHash, nowIso)
    .first<{ user_id: string }>();
  return result?.user_id ?? null;
}

export async function createSession(db: Env["DB"], userId: string): Promise<string> {
  const id = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expiresAt)
    .run();
  return id;
}

export interface SessionUser {
  id: string;
  email: string;
  anniversaryDate: string;
  xValue: number;
}

export async function getSessionUser(db: Env["DB"], sessionId: string): Promise<SessionUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id AS id, u.email AS email, u.anniversary_date AS anniversaryDate,
              u.x_value AS xValue
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sessionId, new Date().toISOString())
    .first<SessionUser>();
  return row ?? null;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
