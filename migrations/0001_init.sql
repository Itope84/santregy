-- Users, one row per email (auth identity + config).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  anniversary_date TEXT NOT NULL, -- 'MM-DD', UTC
  x_value INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Magic-link tokens. Only the hash is stored; the raw token is never persisted.
CREATE TABLE magic_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_magic_tokens_user ON magic_tokens(user_id);

-- Login sessions, referenced by an HTTP-only cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Requests to send a magic link, logged for rate limiting by email and by IP.
CREATE TABLE magic_link_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_magic_link_requests_email ON magic_link_requests(email, created_at);
CREATE INDEX idx_magic_link_requests_ip ON magic_link_requests(ip, created_at);

-- Manual purchase log entries.
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  ticker TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  price_per_share REAL NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_purchases_user ON purchases(user_id);

-- Idempotency guard for the annual pick email: one row per (user, year sent).
CREATE TABLE sent_notifications (
  user_id TEXT NOT NULL REFERENCES users(id),
  anniversary_year INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, anniversary_year)
);

-- Single global row: the most recently computed screen, shared by all users.
CREATE TABLE screen_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  as_of_date TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  ranked_json TEXT NOT NULL
);

-- Single global row: most-recent-trading-day closes for whatever tickers appear in anyone's
-- purchase log, used only for the homepage "current value" column. Separate from
-- screen_cache because it tracks a different (and differently-scoped) set of tickers and a
-- different date target (today, not the screen's one-month-lagged window end).
CREATE TABLE latest_price_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  computed_at TEXT NOT NULL,
  prices_json TEXT NOT NULL
);
