-- Single global row, present only while a screen refresh is running in the background
-- (kicked off via ctx.waitUntil so the triggering HTTP request can return immediately
-- instead of blocking on ~10 throttled Polygon calls). Absence of a row means "not running".
CREATE TABLE screen_refresh_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
