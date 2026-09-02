import { useEffect, useState } from "react";
import { api, ApiError, type PortfolioResponse, type Purchase } from "../api";
import { formatCurrency, formatDateTime, formatPct } from "../format";
import { PurchaseForm, type PurchaseFormValues } from "./PurchaseForm";

export function PortfolioTable() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const [p, pf] = await Promise.all([api.listPurchases(), api.getPortfolio()]);
    setPurchases(p);
    setPortfolio(pf);
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load"));
  }, []);

  async function handleAdd(values: PurchaseFormValues) {
    await api.createPurchase(values);
    setAdding(false);
    await reload();
  }

  async function handleEdit(id: string, values: PurchaseFormValues) {
    await api.updatePurchase(id, values);
    setEditingId(null);
    await reload();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this purchase?")) return;
    await api.deletePurchase(id);
    await reload();
  }

  const rowsById = new Map(portfolio?.positions.map((r) => [r.id, r]));

  return (
    <section>
      <h2>Purchases</h2>
      {portfolio && (
        <p className="meta">Prices as of {formatDateTime(portfolio.pricesComputedAt)}</p>
      )}
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Purchase date</th>
            <th className="numeric">Cost basis</th>
            <th className="numeric">Current value</th>
            <th className="numeric">Total return</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((p) => {
            if (editingId === p.id) {
              return (
                <tr key={p.id}>
                  <td colSpan={6}>
                    <PurchaseForm
                      initial={p}
                      submitLabel="Save"
                      onCancel={() => setEditingId(null)}
                      onSubmit={(values) => handleEdit(p.id, values)}
                    />
                  </td>
                </tr>
              );
            }
            const row = rowsById.get(p.id);
            return (
              <tr key={p.id}>
                <td>{p.ticker}</td>
                <td>{p.purchaseDate}</td>
                <td className="numeric">{formatCurrency(row?.costBasis ?? null)}</td>
                <td className="numeric">{formatCurrency(row?.currentValue ?? null)}</td>
                <td className="numeric">
                  {formatCurrency(row?.totalReturn ?? null)}
                  {row?.totalReturnPct != null ? ` (${formatPct(row.totalReturnPct)})` : ""}
                </td>
                <td>
                  <button className="link" onClick={() => setEditingId(p.id)}>
                    Edit
                  </button>{" "}
                  <button className="link" onClick={() => handleDelete(p.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        {portfolio && purchases.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="numeric">{formatCurrency(portfolio.totalCostBasis)}</td>
              <td className="numeric">{formatCurrency(portfolio.totalCurrentValue)}</td>
              <td className="numeric">
                {formatCurrency(portfolio.totalReturn)}
                {portfolio.totalReturnPct != null ? ` (${formatPct(portfolio.totalReturnPct)})` : ""}
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>

      {adding ? (
        <div style={{ marginTop: 16 }}>
          <PurchaseForm submitLabel="Add" onCancel={() => setAdding(false)} onSubmit={handleAdd} />
        </div>
      ) : (
        <button className="secondary" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>
          Add purchase
        </button>
      )}
    </section>
  );
}
