import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ScreenResponse } from "../api";
import { formatCurrency, formatDateTime, formatPct } from "../format";

const POLL_INTERVAL_MS = 5000;

export function ScreenPanel() {
  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const latest = await api.getScreen();
        setScreen(latest);
        if (!latest.refreshing) stopPolling();
      } catch {
        // Transient — the next tick will retry.
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    // Read-only on load — running the screen is an explicit action, never automatic. If a
    // refresh triggered earlier (by this user or the cron) is still in flight, pick up
    // polling for it rather than leaving the page looking idle.
    api.getScreen().then((s) => {
      setScreen(s);
      if (s.refreshing) startPolling();
    }, () => {});
    return stopPolling;
  }, []);

  async function run() {
    setStarting(true);
    setError("");
    try {
      const response = await api.runScreen();
      setScreen(response);
      if (response.refreshing) startPolling();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run the screen");
    } finally {
      setStarting(false);
    }
  }

  const refreshing = screen?.refreshing ?? false;
  const entries = screen?.entries ?? [];
  const picks = entries.filter((e) => e.isPick);
  const alternates = entries.filter((e) => !e.isPick);
  const insufficient = screen?.insufficientHistory ?? [];

  return (
    <section>
      <h2>This year's screen</h2>
      {screen?.computedAt && (
        <p className="meta">Last computed {formatDateTime(screen.computedAt)}</p>
      )}
      {refreshing ? (
        <p className="meta">
          Refreshing — this pulls a couple hundred prices through a rate-limited API, so it
          typically takes a few minutes. This page will update on its own.
        </p>
      ) : !screen?.computedAt ? (
        <p className="meta">No screen has been run yet.</p>
      ) : null}
      <button className="primary" onClick={run} disabled={starting || refreshing}>
        {refreshing ? "Refreshing..." : starting ? "Starting..." : "Run screen"}
      </button>
      {error && <p className="error">{error}</p>}

      {picks.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Picks</h3>
          <RankedTable rows={picks} />
        </>
      )}

      {alternates.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Alternates</h3>
          <RankedTable rows={alternates} />
        </>
      )}

      {insufficient.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Insufficient history</h3>
          <p className="meta">Not ranked — see reason per row.</p>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Sector</th>
                <th>Reason</th>
                <th>First available</th>
                <th className="numeric">Partial return</th>
              </tr>
            </thead>
            <tbody>
              {insufficient.map((e) => (
                <tr key={e.ticker}>
                  <td>{e.ticker}</td>
                  <td>{e.name}</td>
                  <td>{e.sector}</td>
                  <td>
                    {e.reason === "identity-mismatch"
                      ? "Ticker changed hands — price unverifiable"
                      : "Recent IPO, spinoff, or index addition"}
                  </td>
                  <td>{e.firstAvailableDate ?? "—"}</td>
                  <td className="numeric">{formatPct(e.partialReturn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function RankedTable({ rows }: { rows: ScreenResponse["entries"] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Company</th>
          <th>Sector</th>
          <th>Window start</th>
          <th>Window end</th>
          <th className="numeric">Trailing return</th>
        </tr>
      </thead>
      <tbody>
        {(rows ?? []).map((e) => (
          <tr key={e.ticker}>
            <td>{e.ticker}</td>
            <td>{e.name}</td>
            <td>{e.sector}</td>
            <td>
              {e.windowStartDate} @ {formatCurrency(e.windowStartPrice)}
            </td>
            <td>
              {e.windowEndDate} @ {formatCurrency(e.windowEndPrice)}
            </td>
            <td className="numeric">{formatPct(e.trailingReturn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
