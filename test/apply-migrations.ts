import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per isolated test file, giving each one a freshly migrated D1 to work with.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);
