// apps/indexer/src/lib/protocols/stellar-native/fetch-pools.ts
import "dotenv/config";
import { getEnv } from "../../../scripts/discovery/00-common";
import { HorizonPool, HorizonPoolsResult } from "./types";

export async function fetchHorizonPools(
  limit = 50
): Promise<HorizonPoolsResult> {
  const horizonUrl = getEnv(
    "HORIZON_URL",
    "https://horizon.stellar.org"
  );

  const url = new URL("/liquidity_pools", horizonUrl);

  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "desc");

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `Failed Horizon request ${res.status}`
    );
  }

  const json: any = await res.json();

  const pools: HorizonPool[] =
    json?._embedded?.records ?? [];

  return {
    fetchedAt: new Date().toISOString(),
    count: pools.length,
    pools,
  };
}