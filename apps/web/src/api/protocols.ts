// src/api/protocols.ts
//
// Q4 (Lot Q): /v1/protocols — per-venue aggregates + top underlying assets by
// TVL. The protocols page uses it to enrich the per-protocol cards (Type from
// venue_type, up to 3 asset marks + "+N"); pools remain the source for the
// table itself.

import { apiFetch } from "./client";
import type { ProtocolListItem } from "../types/protocol";

export async function fetchProtocols(): Promise<ProtocolListItem[]> {
  return apiFetch<ProtocolListItem[]>(`/protocols`);
}
