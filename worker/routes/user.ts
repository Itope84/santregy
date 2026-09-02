import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { isValidEmail, normalizeEmail } from "../lib/auth";

export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", requireAuth);

userRoutes.get("/me", (c) => c.json(c.get("user")));

const MM_DD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

userRoutes.put("/settings", async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ email?: string; anniversaryDate?: string; xValue?: number }>()
    .catch(() => ({}) as Record<string, never>);

  const email = body.email !== undefined ? normalizeEmail(body.email) : user.email;
  const anniversaryDate = body.anniversaryDate ?? user.anniversaryDate;
  const xValue = body.xValue ?? user.xValue;

  if (!isValidEmail(email)) return c.json({ error: "Enter a valid email address" }, 400);
  if (!MM_DD_RE.test(anniversaryDate)) {
    return c.json({ error: "Anniversary date must be MM-DD" }, 400);
  }
  if (!Number.isInteger(xValue) || xValue < 1 || xValue > 10) {
    return c.json({ error: "X must be an integer between 1 and 10" }, 400);
  }

  try {
    await c.env.DB.prepare(
      "UPDATE users SET email = ?, anniversary_date = ?, x_value = ? WHERE id = ?",
    )
      .bind(email, anniversaryDate, xValue, user.id)
      .run();
  } catch (err) {
    return c.json({ error: "That email is already in use" }, 409);
  }

  return c.json({ id: user.id, email, anniversaryDate, xValue });
});
