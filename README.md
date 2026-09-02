# Santregy

A personal S&P 500 momentum screener. Once a year, on a fixed anniversary date, it screens
for the top-performing S&P 500 names over a trailing 12-month window, emails the picks, and
lets you record what you actually bought. It does not place trades and does not give advice.

See the original build spec for the full feature list. This file covers what's specific to
this implementation: the data provider decision, how it differs from the spec's original
wording, and how to run/deploy it.

## Data provider — read this before trusting the numbers

**This app uses [Polygon.io](https://polygon.io)'s free tier**, not a provider that returns a
full adjusted daily time series per ticker. The design:

- **Constituent list + GICS sector**: fetched from a community-maintained, weekly-refreshed
  GitHub CSV (`datasets/s-and-p-500-companies`) — free, keyless, no rate limit. Verified
  reachable and correctly formatted from this build's environment.
- **Prices**: Polygon's **Grouped Daily** endpoint returns every US ticker's OHLC for a single
  date in one call. The screen only needs two prices per ticker (window start, window end), so
  a full refresh costs roughly 10 Polygon calls (up to 5 trading-day lookback per endpoint),
  not 503 — comfortably inside the free tier's 5 calls/minute limit.
- **Adjustment**: Polygon's `adjusted=true` closes are **split-adjusted only, not
  dividend-adjusted**.

### Spec deviation: price return, not total return

The original spec calls for total return from split- **and dividend-adjusted** closes. No
free provider found gives dividend-adjusted bulk/grouped data without either a paid tier or
503 individual per-ticker calls/day. **This was an explicit, approved change**: the screen
computes **price return** — `(windowEndClose / windowStartClose) - 1` using split-adjusted
closes only. For the kind of high-momentum names this screen tends to surface (low or no
dividend yield), the difference from total return is usually small, and this matches how
S&P Dow Jones Indices ranks its own published price-return lists.

### Validation status — action required

**This sandboxed build session could not reach `api.polygon.io`** (blocked by the
environment's network egress policy — only a small allowlist of domains, mainly package
registries and GitHub, is reachable from here). The split-adjustment behavior described above
is Polygon's documented behavior, **not something this session verified against live data**.

Before deploying, run the throwaway validation script yourself:

```
POLYGON_API_KEY=your_key node scripts/validate-polygon-adjustment.mjs
```

It fetches AAPL's daily bars across its 2020-08-31 4-for-1 split with `adjusted=true` and
`adjusted=false`, and checks that the adjusted series shows no artificial cliff across the
split while the raw series does. It does not check dividend adjustment (the app doesn't rely
on that). If it fails, do not deploy against Polygon without investigating further.

### Ticker normalization

The GitHub constituent list and Polygon both use dot notation for share classes (`BRK.B`).
`normalizeTicker()` (`worker/lib/constituents.ts`) trims and uppercases every ticker from both
sources before joining them, so a stray case/whitespace mismatch can't silently drop a name
from the ranking.

### Refresh consistency

A single refresh always fetches both window endpoints together in one `computeScreen()` call
(`worker/lib/refresh.ts`). Polygon's adjusted prices are restated onto the *current* share
count, so mixing window-start and window-end prices from different cache generations across
an intervening split would silently corrupt the return — never read the two endpoints from
separately-cached data.

## Beyond the screen: "current value" needs its own price cache

The spec's caching section describes one global cache for the screen (window-start/end
prices, one-month-lagged by the screen's own design). The purchase log's homepage table also
needs each holding's **current** price, which is a different set of tickers (whatever's been
bought, not necessarily the current S&P 500) and a different target date (today, not
one-month-lagged). This is a second, small, similarly-cache-gated table
(`latest_price_cache`, `worker/lib/latestPrice.ts`) — same TTL, same "show when it was last
computed" UI treatment, and it reuses Grouped Daily (which covers the whole US market, not
just S&P 500 constituents, so it works for any ticker in the purchase log).

## Stack

Hono + Vite + React (SPA) on Cloudflare Workers, via `@cloudflare/vite-plugin` (one `vite
build` produces both the Worker script and the static client bundle). Cloudflare D1 for
everything, including the screen and price caches (a single-row table each, per the spec's
"D1 if that's simpler" option — no KV binding needed). Resend for email. Cloudflare Cron
Triggers for the daily anniversary check.

## Setup

```
npm install
npx wrangler d1 create santregy        # then paste the returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply santregy --local    # or --remote once deployed
npx wrangler secret put POLYGON_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM_EMAIL   # e.g. "Santregy <picks@yourdomain.com>"
```

Set `APP_BASE_URL` in `wrangler.jsonc` to your deployed origin (used to build magic-link
URLs). Adjust the cron hour in `wrangler.jsonc` (`triggers.crons`) if you want the daily
anniversary check to run at a different UTC hour.

```
npm run dev       # vite dev, local
npm run deploy     # vite build && wrangler deploy
npm test           # vitest, via @cloudflare/vitest-pool-workers (D1 + fetch mocked)
npm run typecheck
```

## Testing notes

Tests run inside a real `workerd` isolate via `@cloudflare/vitest-pool-workers`, with D1
migrations applied per test file and outbound `fetch()` intercepted with `fetchMock` (undici's
`MockAgent`) rather than `vi.mock` — module-level mocking of local files did not take effect
inside this pool during development, so tests mock at the network boundary instead. Polygon's
real throttle (~12.5s between calls, to respect the 5 calls/min free-tier limit) is bypassed
in tests via `_setThrottleIntervalForTests()`, a test-only export.

Covers, per the spec's testing section: `screen()` against fixtures (normal ticker, mid-window
history start, a holiday-landing endpoint, a split inside the window), cache
serve-when-fresh/refresh-when-stale, and notification idempotency (including that a failed
send releases its claim so a retry can still go out, without ever double-sending on success).

## Deferred (not built, per the spec)

AI-assisted pick selection, backtesting/point-in-time constituent data, sector-concentration
warnings, price-threshold alerts, sell-side tracking, multiple strategies, alternate index
universes, per-user timezones, dividend/tax-lot accounting, public/shared portfolios, mobile
app or push notifications, and any charts.

## Noted but not built (out of scope, flagged during the build)

- **Grouped Daily response size in a request path**: the spec author flagged that the Grouped
  Daily response (every US ticker for one date) is several MB, and parsing it inside an HTTP
  request handler risks the Workers CPU limit. `computeScreen()` currently runs from both the
  manual "run screen" POST route and the cron handler, per spec's "same cached path"
  requirement — no queue/Durable Object was added to move this off the request path, since
  that wasn't requested and cache-gating (>=24h between real recomputes) keeps it rare in
  practice for a 1-2 user deployment. Worth watching if it ever times out in production.
