import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { normalizeTicker } from "../lib/constituents";
import { getOrRefreshLatestPrices } from "../lib/latestPrice";
import { buildPortfolioSummary, type Purchase } from "../lib/portfolio";

export const purchaseRoutes = new Hono<AppEnv>();

purchaseRoutes.use("*", requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PurchaseBody {
  ticker?: string;
  purchaseDate?: string;
  pricePerShare?: number;
  quantity?: number;
}

function validatePurchase(body: PurchaseBody): string | null {
  if (!body.ticker || normalizeTicker(body.ticker).length === 0) return "Ticker is required";
  if (!body.purchaseDate || !DATE_RE.test(body.purchaseDate)) {
    return "Purchase date must be YYYY-MM-DD";
  }
  if (typeof body.pricePerShare !== "number" || body.pricePerShare <= 0) {
    return "Price per share must be a positive number";
  }
  if (typeof body.quantity !== "number" || body.quantity <= 0) {
    return "Quantity must be a positive number";
  }
  return null;
}

async function loadPurchases(db: D1Database, userId: string): Promise<Purchase[]> {
  const rows = await db
    .prepare(
      "SELECT id, ticker, purchase_date, price_per_share, quantity FROM purchases WHERE user_id = ? ORDER BY purchase_date ASC",
    )
    .bind(userId)
    .all<{ id: string; ticker: string; purchase_date: string; price_per_share: number; quantity: number }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    purchaseDate: r.purchase_date,
    pricePerShare: r.price_per_share,
    quantity: r.quantity,
  }));
}

purchaseRoutes.get("/purchases", async (c) => {
  const purchases = await loadPurchases(c.env.DB, c.get("user").id);
  return c.json(purchases);
});

purchaseRoutes.post("/purchases", async (c) => {
  const body = await c.req.json<PurchaseBody>().catch(() => ({}) as PurchaseBody);
  const error = validatePurchase(body);
  if (error) return c.json({ error }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO purchases (id, user_id, ticker, purchase_date, price_per_share, quantity) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      c.get("user").id,
      normalizeTicker(body.ticker!),
      body.purchaseDate,
      body.pricePerShare,
      body.quantity,
    )
    .run();

  return c.json({ id }, 201);
});

purchaseRoutes.put("/purchases/:id", async (c) => {
  const body = await c.req.json<PurchaseBody>().catch(() => ({}) as PurchaseBody);
  const error = validatePurchase(body);
  if (error) return c.json({ error }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE purchases SET ticker = ?, purchase_date = ?, price_per_share = ?, quantity = ? WHERE id = ? AND user_id = ?",
  )
    .bind(
      normalizeTicker(body.ticker!),
      body.purchaseDate,
      body.pricePerShare,
      body.quantity,
      c.req.param("id"),
      c.get("user").id,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

purchaseRoutes.delete("/purchases/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM purchases WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

/** Homepage table data: cost basis, current value, and total return per position, plus
 * portfolio totals. Current prices are cache-gated the same way as the screen. */
purchaseRoutes.get("/portfolio", async (c) => {
  const purchases = await loadPurchases(c.env.DB, c.get("user").id);
  const tickers = [...new Set(purchases.map((p) => p.ticker))];
  const today = new Date().toISOString().slice(0, 10);
  const { prices, computedAt } = await getOrRefreshLatestPrices(c.env, today, tickers);
  const summary = buildPortfolioSummary(purchases, prices);
  return c.json({ ...summary, pricesComputedAt: computedAt });
});
