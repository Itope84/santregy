import { env, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { writeScreenCache } from "../worker/lib/cache";
import { runAnnualNotifications } from "../worker/lib/notify";
import type { PickEntry } from "../worker/types";

const testEnv = env as unknown as Env;
const TODAY = "2026-09-02";

const sampleEntry: PickEntry = {
  ticker: "AAA",
  name: "AAA Inc.",
  sector: "Tech",
  trailingReturn: 0.1,
  windowStartDate: "2025-08-01",
  windowStartPrice: 100,
  windowEndDate: "2026-08-01",
  windowEndPrice: 110,
  isPick: true,
};

let resendCalls = 0;
let nextResendStatus = 200;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://api.resend.com")
    .intercept({ path: "/emails", method: "POST" })
    .reply(() => {
      resendCalls++;
      return { statusCode: nextResendStatus, data: { id: "test" } };
    })
    .persist();
});

beforeEach(async () => {
  resendCalls = 0;
  nextResendStatus = 200;
  // Pre-seed a fresh screen cache for TODAY so runAnnualNotifications' call into
  // getOrRefreshScreen is served from cache and never touches the network (that path is
  // covered separately in refresh-cache.test.ts).
  await writeScreenCache(
    testEnv.DB,
    {
      asOfDate: TODAY,
      windowStartTarget: "2025-08-02",
      windowEndTarget: "2026-08-02",
      ranked: [sampleEntry],
      insufficientHistory: [],
    },
    new Date().toISOString(),
  );
});

async function insertUser(email: string, anniversaryDate: string): Promise<string> {
  const id = crypto.randomUUID();
  await testEnv.DB.prepare(
    "INSERT INTO users (id, email, anniversary_date, x_value) VALUES (?, ?, ?, 2)",
  )
    .bind(id, email, anniversaryDate)
    .run();
  return id;
}

describe("runAnnualNotifications idempotency", () => {
  it("sends exactly once per (user, year) even when run twice for the same day", async () => {
    const userId = await insertUser("due@example.com", "09-02");

    await runAnnualNotifications(testEnv, TODAY);
    await runAnnualNotifications(testEnv, TODAY);

    expect(resendCalls).toBe(1);
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM sent_notifications WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("does not email a user whose anniversary is not today", async () => {
    await insertUser("not-due@example.com", "01-01");

    await runAnnualNotifications(testEnv, TODAY);

    expect(resendCalls).toBe(0);
  });

  it("does not keep the claim if the send itself fails, so a retry can still succeed", async () => {
    const userId = await insertUser("flaky@example.com", "09-02");
    nextResendStatus = 500;

    await runAnnualNotifications(testEnv, TODAY); // Resend fails, claim released
    nextResendStatus = 200;
    await runAnnualNotifications(testEnv, TODAY); // retry succeeds

    expect(resendCalls).toBe(2);
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM sent_notifications WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
