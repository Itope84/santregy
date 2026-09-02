import type { PricePoint } from "../types";

export interface Purchase {
  id: string;
  ticker: string;
  purchaseDate: string;
  pricePerShare: number;
  quantity: number;
}

export interface PositionRow {
  id: string;
  ticker: string;
  purchaseDate: string;
  costBasis: number;
  currentValue: number | null; // null if we have no current price for this ticker
  totalReturn: number | null; // currency
  totalReturnPct: number | null;
}

export interface PortfolioSummary {
  positions: PositionRow[];
  totalCostBasis: number;
  totalCurrentValue: number; // sums only positions with a known current price
  totalReturn: number;
  totalReturnPct: number | null;
}

/**
 * Pure. Deliberately produces only the fields the homepage table is allowed to show: cost
 * basis, current value, and total return since purchase. No day/period change, no
 * sorting-by-performance — the caller must keep positions sorted by purchase date.
 */
export function buildPortfolioSummary(
  purchases: Purchase[],
  latestPrices: Record<string, PricePoint>,
): PortfolioSummary {
  const positions: PositionRow[] = purchases.map((p) => {
    const costBasis = p.pricePerShare * p.quantity;
    const price = latestPrices[p.ticker]?.close ?? null;
    const currentValue = price !== null ? price * p.quantity : null;
    const totalReturn = currentValue !== null ? currentValue - costBasis : null;
    const totalReturnPct =
      currentValue !== null && costBasis > 0 ? currentValue / costBasis - 1 : null;
    return {
      id: p.id,
      ticker: p.ticker,
      purchaseDate: p.purchaseDate,
      costBasis,
      currentValue,
      totalReturn,
      totalReturnPct,
    };
  });

  const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
  const totalCurrentValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
  const knownValueCostBasis = positions
    .filter((p) => p.currentValue !== null)
    .reduce((sum, p) => sum + p.costBasis, 0);
  const totalReturn = totalCurrentValue - knownValueCostBasis;
  const totalReturnPct = knownValueCostBasis > 0 ? totalCurrentValue / knownValueCostBasis - 1 : null;

  return { positions, totalCostBasis, totalCurrentValue, totalReturn, totalReturnPct };
}
