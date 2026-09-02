#!/usr/bin/env node
// Throwaway validation script — NOT run automatically, and NOT part of the app.
//
//   POLYGON_API_KEY=your_key node scripts/validate-polygon-adjustment.mjs
//
// Two checks:
//
// 1. PLAN COVERAGE (the actual go/no-go question): does Grouped Daily — the bulk endpoint
//    the app calls for every screen refresh — actually return data at the dates the app
//    needs? That's a ROLLING window relative to today (~13 months back for the screen's
//    window start, ~1 month back for window end), not any fixed calendar date. An earlier
//    version of this script hardcoded AAPL's 2020 split and got a 403 "plan doesn't include
//    this timeframe" — that only proved a Basic-plan 2-year rolling window doesn't reach
//    6-year-old data, which the app never asks for anyway. This version tests what the app
//    actually requests.
//
// 2. SPLIT ADJUSTMENT: does `adjusted=true` really rewrite historical closes onto the
//    current share count (proving the "2:1 split reads as -50%" corruption the spec warns
//    about can't happen), or is it a no-op? Validated against a split discovered live from
//    Polygon's own /v3/reference/splits endpoint — not a date hardcoded from memory, which is
//    exactly what produced the false failure above, and which would go stale again as more
//    time passes and today's "recent" split ages out of the plan's rolling window.
//
// Does NOT check dividend adjustment — per the approved design change, this app uses
// Polygon's split-adjusted-only close and computes price return, not total return.

const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error("Set POLYGON_API_KEY first (get a free key at polygon.io).");
  process.exit(1);
}

const BASE = "https://api.polygon.io";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function subtractMonths(dateStr, months) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetIndex = m - 1 - months;
  const year = y + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month, Math.min(d, daysInTargetMonth))));
}

function addDays(dateStr, days) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoDate(dt);
}

async function polygonGet(path) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ---------- Check 1: is Grouped Daily authorized at the dates the app actually needs? ----------

async function checkGroupedDailyReachable(label, targetDate) {
  console.log(`\n[1] Grouped Daily near ${targetDate} (${label})`);
  let cursor = targetDate;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { ok, status, json } = await polygonGet(
      `/v2/aggs/grouped/locale/us/market/stocks/${cursor}`,
    );
    if (!ok) {
      console.log(`  ${cursor}: FAIL (${status}) ${json.message ?? JSON.stringify(json)}`);
      return false;
    }
    if (json.status === "OK" && (json.resultsCount ?? 0) > 0) {
      console.log(`  ${cursor}: OK — ${json.resultsCount} tickers returned`);
      return true;
    }
    // Empty result on an authorized date just means a weekend/holiday — step back a day.
    console.log(`  ${cursor}: no results (likely a non-trading day), trying the day before`);
    cursor = addDays(cursor, -1);
  }
  console.log(`  Gave up after 10 days without finding a trading day — investigate manually.`);
  return false;
}

// ---------- Check 2: does adjusted=true really rewrite prices across a real, recent split? ----------

async function findRecentSplit() {
  const { ok, status, json } = await polygonGet(
    "/v3/reference/splits?limit=10&order=desc&sort=execution_date",
  );
  if (!ok) {
    console.log(`  Couldn't fetch splits reference: (${status}) ${json.message ?? JSON.stringify(json)}`);
    return null;
  }
  const results = json.results ?? [];
  // Prefer a split well inside a 2-year plan window, but still take the most recent one
  // available if nothing is younger than 18 months.
  const eighteenMonthsAgo = subtractMonths(isoDate(new Date()), 18);
  const candidate =
    results.find((s) => s.execution_date >= eighteenMonthsAgo) ?? results[0] ?? null;
  return candidate;
}

async function checkSplitAdjustment() {
  console.log(`\n[2] Split adjustment`);
  const split = await findRecentSplit();
  if (!split) {
    console.log("  FAIL: no split found via /v3/reference/splits to test against.");
    return false;
  }

  const factor = split.split_to / split.split_from;
  const from = addDays(split.execution_date, -10);
  const to = addDays(split.execution_date, 10);
  console.log(
    `  Testing ${split.ticker}'s ${split.split_to}:${split.split_from} split (execution date ${split.execution_date})`,
  );

  const [adjRes, rawRes] = await Promise.all([
    polygonGet(`/v2/aggs/ticker/${split.ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50`),
    polygonGet(`/v2/aggs/ticker/${split.ticker}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50`),
  ]);
  if (!adjRes.ok || !rawRes.ok) {
    console.log(`  FAIL: aggs request failed — adjusted:(${adjRes.status}) raw:(${rawRes.status})`);
    return false;
  }

  const toBars = (json) =>
    (json.results ?? []).map((b) => ({ date: isoDate(new Date(b.t)), close: b.c }));
  const adjusted = toBars(adjRes.json);
  const raw = toBars(rawRes.json);

  // Last trading day strictly before the split's execution date.
  const preSplitDate = [...adjusted].reverse().find((b) => b.date < split.execution_date)?.date;
  const adjPre = adjusted.find((b) => b.date === preSplitDate);
  const rawPre = raw.find((b) => b.date === preSplitDate);
  if (!adjPre || !rawPre) {
    console.log("  FAIL: couldn't find a pre-split trading day in the returned range.");
    return false;
  }

  const ratio = rawPre.close / adjPre.close;
  const maxDrop = (bars) => {
    let worst = 0;
    for (let i = 1; i < bars.length; i++) worst = Math.max(worst, 1 - bars[i].close / bars[i - 1].close);
    return worst;
  };
  const rawDrop = maxDrop(raw);
  const adjDrop = maxDrop(adjusted);

  console.log(`  ${preSplitDate} close — raw: ${rawPre.close}, adjusted: ${adjPre.close}`);
  console.log(`  ratio (raw/adjusted): ${ratio.toFixed(3)} (expect ~${factor})`);
  console.log(`  max single-day drop — raw: ${(rawDrop * 100).toFixed(1)}%, adjusted: ${(adjDrop * 100).toFixed(1)}%`);

  const ratioOk = Math.abs(ratio - factor) < Math.max(0.15, factor * 0.05);
  const cliffOk = rawDrop > adjDrop + 0.2; // raw shows a real cliff the adjusted series doesn't
  if (ratioOk && cliffOk) {
    console.log("  PASS");
    return true;
  }
  console.log("  FAIL: adjustment did not behave as expected.");
  return false;
}

// ---------- Run both checks ----------

const today = isoDate(new Date());
const windowStartOk = await checkGroupedDailyReachable("screen window start, ~13mo back", subtractMonths(today, 13));
const windowEndOk = await checkGroupedDailyReachable("screen window end, ~1mo back", subtractMonths(today, 1));
const splitOk = await checkSplitAdjustment();

console.log("\n" + "=".repeat(60));
console.log(`Grouped Daily @ window start: ${windowStartOk ? "PASS" : "FAIL"}`);
console.log(`Grouped Daily @ window end:   ${windowEndOk ? "PASS" : "FAIL"}`);
console.log(`Split adjustment:             ${splitOk ? "PASS" : "FAIL"}`);

if (windowStartOk && windowEndOk && splitOk) {
  console.log("\nAll checks passed — Polygon's free tier covers what this app needs.");
  process.exit(0);
} else {
  console.log(
    "\nAt least one check failed. If it's the Grouped Daily checks, Polygon's plan does not " +
      "cover the app's required date range and a different provider is needed. If it's just " +
      "the split check, investigate before trusting return calculations.",
  );
  process.exit(1);
}
