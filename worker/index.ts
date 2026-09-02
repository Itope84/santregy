import { Hono } from "hono";
import type { Env } from "./env";
import type { AppEnv } from "./middleware";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { screenRoutes } from "./routes/screen";
import { purchaseRoutes } from "./routes/purchases";
import { runAnnualNotifications } from "./lib/notify";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

app.route("/api/auth", authRoutes);
app.route("/api", userRoutes);
app.route("/api/screen", screenRoutes);
app.route("/api", purchaseRoutes);

// Anything that isn't an API route is the SPA — let Workers Assets serve static files and
// fall back to index.html for client-side routes (not_found_handling in wrangler.jsonc).
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    ctx.waitUntil(runAnnualNotifications(env, today));
  },
} satisfies ExportedHandler<Env>;
