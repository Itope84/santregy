-- Extends the refresh lock (migration 0002) to also record how the last attempt ended, so
-- a failure is visible in the UI (GET /api/screen) instead of only in the Workers logs.
-- finished_at IS NULL means still running; ok/error are only meaningful once finished.
ALTER TABLE screen_refresh_lock ADD COLUMN finished_at TEXT;
ALTER TABLE screen_refresh_lock ADD COLUMN ok INTEGER;
ALTER TABLE screen_refresh_lock ADD COLUMN error TEXT;
