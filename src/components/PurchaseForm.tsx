import { useState } from "react";
import type { Purchase } from "../api";

export interface PurchaseFormValues {
  ticker: string;
  purchaseDate: string;
  pricePerShare: number;
  quantity: number;
}

export function PurchaseForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Purchase;
  onSubmit: (values: PurchaseFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate ?? "");
  const [pricePerShare, setPricePerShare] = useState(initial?.pricePerShare?.toString() ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity?.toString() ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        ticker: ticker.trim().toUpperCase(),
        purchaseDate,
        pricePerShare: Number(pricePerShare),
        quantity: Number(quantity),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <div>
        <label>Ticker</label>
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} required />
      </div>
      <div>
        <label>Purchase date</label>
        <input
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          required
        />
      </div>
      <div>
        <label>Price / share</label>
        <input
          type="number"
          step="any"
          min="0"
          value={pricePerShare}
          onChange={(e) => setPricePerShare(e.target.value)}
          required
        />
      </div>
      <div>
        <label>Quantity</label>
        <input
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="primary" disabled={submitting}>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <p className="error" style={{ gridColumn: "1 / -1" }}>{error}</p>}
    </form>
  );
}
