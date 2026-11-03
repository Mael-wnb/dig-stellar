// src/api/pools.ts

import { apiFetch } from "./client";
import type {
  PoolDetailData,
  PoolFlows,
  PoolListItem,
  PoolSeries,
} from "../types/protocol";

export async function fetchPools(protocolId?: string): Promise<PoolListItem[]> {
  const query = protocolId ? `?protocol=${encodeURIComponent(protocolId)}` : "";
  return apiFetch<PoolListItem[]>(`/pools${query}`);
}

export async function fetchPoolById(poolId: string): Promise<PoolDetailData> {
  return apiFetch<PoolDetailData>(`/pools/${encodeURIComponent(poolId)}`);
}

// Inflows & outflows (Lot C). window ∈ {24h,7d,30d}. A covered=false response
// means the pool has no deposit/withdraw event coverage — the caller hides the
// section rather than rendering zeros.
export async function fetchPoolFlows(
  poolId: string,
  window: "24h" | "7d" | "30d" = "7d",
): Promise<PoolFlows> {
  return apiFetch<PoolFlows>(
    `/pools/${encodeURIComponent(poolId)}/flows?window=${window}`,
  );
}

// TVL history (Lot C). Covered for lending venues only today; a covered=false
// response means the caller shows the plain "TVL history not available" state
// (Lot PRE: no date unless `first` is set).
export async function fetchPoolSeries(poolId: string): Promise<PoolSeries> {
  return apiFetch<PoolSeries>(`/pools/${encodeURIComponent(poolId)}/series`);
}
