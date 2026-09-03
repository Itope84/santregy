export interface User {
  id: string;
  email: string;
  anniversaryDate: string; // 'MM-DD'
  xValue: number;
}

export interface PickEntry {
  ticker: string;
  name: string;
  sector: string;
  trailingReturn: number;
  windowStartDate: string;
  windowStartPrice: number;
  windowEndDate: string;
  windowEndPrice: number;
  isPick: boolean;
}

export interface InsufficientHistoryEntry {
  ticker: string;
  name: string;
  sector: string;
  partialReturn: number | null;
  firstAvailableDate: string | null;
  windowEndDate: string | null;
  windowEndPrice: number | null;
  reason: "no-history" | "identity-mismatch";
}

export interface ScreenResponse {
  cached: boolean;
  fromCache?: boolean;
  computedAt?: string;
  asOfDate?: string;
  entries?: PickEntry[];
  insufficientHistory?: InsufficientHistoryEntry[];
}

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
  currentValue: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
}

export interface PortfolioResponse {
  positions: PositionRow[];
  totalCostBasis: number;
  totalCurrentValue: number;
  totalReturn: number;
  totalReturnPct: number | null;
  pricesComputedAt: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  requestMagicLink: (email: string) =>
    request<{ ok: true }>("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/me"),
  updateSettings: (patch: Partial<{ email: string; anniversaryDate: string; xValue: number }>) =>
    request<User>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  getScreen: () => request<ScreenResponse>("/api/screen"),
  runScreen: () => request<ScreenResponse>("/api/screen/run", { method: "POST" }),

  listPurchases: () => request<Purchase[]>("/api/purchases"),
  createPurchase: (p: Omit<Purchase, "id">) =>
    request<{ id: string }>("/api/purchases", { method: "POST", body: JSON.stringify(p) }),
  updatePurchase: (id: string, p: Omit<Purchase, "id">) =>
    request<{ ok: true }>(`/api/purchases/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deletePurchase: (id: string) =>
    request<{ ok: true }>(`/api/purchases/${id}`, { method: "DELETE" }),
  getPortfolio: () => request<PortfolioResponse>("/api/portfolio"),
};

export { ApiError };
