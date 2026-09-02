export function formatPct(x: number | null): string {
  if (x === null) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

export function formatCurrency(x: number | null): string {
  if (x === null) return "—";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
