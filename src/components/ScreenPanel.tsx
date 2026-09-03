import { useEffect, useState } from "react";
import { api, ApiError, type ScreenResponse } from "../api";
import { formatCurrency, formatDateTime, formatPct } from "../format";

export function ScreenPanel() {
  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Read-only on load — running the screen is an explicit action, never automatic.
    api.getScreen().then(setScreen, () => {});
  }, []);

  async function run() {
    setRunning(true);
    setError("");
    try {
      setScreen(await api.runScreen());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run the screen");
    } finally {
      setRunning(false);
    }
  }

  const entries = screen?.entries ?? [];
  const picks = entries.filter((e) => e.isPick);
  const alternates = entries.filter((e) => !e.isPick);
  const insufficient = screen?.insufficientHistory ?? [];

  return (
    <section>
      <h2>This year's screen</h2>
      {screen?.computedAt ? (
        <p className="meta">
          Last computed {formatDateTime(screen.computedAt)}
          {screen.fromCache === false ? " (just refreshed)" : ""}
        </p>
      ) : (
        <p className="meta">No screen has been run yet.</p>
      )}
      <button className="primary" onClick={run} disabled={running}>
        {running ? "Running..." : "Run screen"}
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
