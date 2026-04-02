// src/api/pools.ts

import { apiFetch } from './client'
import type { PoolDetailData, PoolListItem } from '../types/protocol'

export async function fetchPools(protocolId?: string): Promise<PoolListItem[]> {
  const query = protocolId ? `?protocol=${encodeURIComponent(protocolId)}` : ''
  return apiFetch<PoolListItem[]>(`/pools${query}`)
}

export async function fetchPoolById(poolId: string): Promise<PoolDetailData> {
  return apiFetch<PoolDetailData>(`/pools/${encodeURIComponent(poolId)}`)
}