#!/usr/bin/env node
// Throwaway validation script — NOT run automatically, and NOT part of the app.
//
// This sandboxed build session could not reach api.polygon.io (blocked by the environment's
// egress policy), so this script has NOT been executed against live data. Run it yourself
// with a free Polygon API key before trusting the app's adjusted-close data:
//
//   POLYGON_API_KEY=your_key node scripts/validate-polygon-adjustment.mjs
//
// It fetches AAPL's daily bars across its 4-for-1 split (effective 2020-08-31) two ways —
// with adjusted=true and adjusted=false — and checks that:
//   1. The unadjusted (raw) close on the last pre-split day is ~4x the adjusted close for
//      that same day (proving Polygon rewrites historical closes onto the current share
//      count, i.e. split adjustment is real, not a no-op flag).
//   2. The adjusted series has no artificial cliff across the split date, while the raw
//      series does — this is the exact "2:1 split reads as -50%" corruption the build spec
//      warns about, made visible.
// It does NOT check dividend adjustment — per the approved design change, this app uses
// Polygon's split-adjusted-only close and computes price return, not total return.

const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error("Set POLYGON_API_KEY first (get a free key at polygon.io).");
  process.exit(1);
}

const TICKER = "AAPL";
const FROM = "2020-08-20";
const TO = "2020-09-10";
const SPLIT_FACTOR = 4;
const PRE_SPLIT_DATE = "2020-08-28"; // last trading day before the 2020-08-31 split

async function fetchBars(adjusted) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${TICKER}/range/1/day/${FROM}/${TO}?adjusted=${adjusted}&sort=asc&limit=50&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.status !== "OK" && json.status !== "DELAYED") {
    throw new Error(`Unexpected Polygon response status: ${json.status} — ${JSON.stringify(json)}`);
  }
  return (json.results ?? []).map((bar) => ({
    date: new Date(bar.t).toISOString().slice(0, 10),
    close: bar.c,
  }));
}

function maxDayOverDayDrop(bars) {
  let worst = 0;
  for (let i = 1; i < bars.length; i++) {
    const drop = 1 - bars[i].close / bars[i - 1].close;
    if (drop > worst) worst = drop;
  }
  return worst;
}

const [adjusted, raw] = await Promise.all([fetchBars(true), fetchBars(false)]);

const adjPreSplit = adjusted.find((b) => b.date === PRE_SPLIT_DATE);
const rawPreSplit = raw.find((b) => b.date === PRE_SPLIT_DATE);

console.log(`${TICKER} close on ${PRE_SPLIT_DATE} (last day before the ${SPLIT_FACTOR}:1 split):`);
console.log(`  raw (adjusted=false):      ${rawPreSplit?.close}`);
console.log(`  adjusted (adjusted=true):  ${adjPreSplit?.close}`);

if (!adjPreSplit || !rawPreSplit) {
  console.error("FAIL: couldn't find the expected pre-split date in Polygon's response.");
  process.exit(1);
}

const ratio = rawPreSplit.close / adjPreSplit.close;
console.log(`  ratio (raw / adjusted):    ${ratio.toFixed(3)} (expect ~${SPLIT_FACTOR})`);

const rawDrop = maxDayOverDayDrop(raw);
const adjDrop = maxDayOverDayDrop(adjusted);
console.log(`\nMax single-day drop across the window:`);
console.log(`  raw series:      ${(rawDrop * 100).toFixed(1)}% (expect ~${((1 - 1 / SPLIT_FACTOR) * 100).toFixed(0)}%, the split cliff)`);
console.log(`  adjusted series: ${(adjDrop * 100).toFixed(1)}% (expect small, no cliff)`);

const ratioOk = Math.abs(ratio - SPLIT_FACTOR) < 0.15;
const cliffOk = rawDrop > 0.5 && adjDrop < 0.15;

if (ratioOk && cliffOk) {
  console.log("\nPASS: Polygon's adjusted=true closes are split-adjusted.");
  process.exit(0);
} else {
  console.error("\nFAIL: adjustment did not behave as expected — do not trust this provider without investigating further.");
  process.exit(1);
}
