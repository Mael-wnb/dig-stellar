// apps/indexer/src/lib/protocols/stellar-native/fetch-pools.ts
import "dotenv/config";
import { fetchJson, getEnv, joinUrl } from "../../../scripts/discovery/00-common";
import { HorizonPool, HorizonPoolsResult } from "./types";

// Horizon's GET /liquidity_pools has NO server-side sort by liquidity: the
// `order` param only paginates by pool id, and `sort=total_value_xlm` does not
// exist (Horizon silently ignores it). Fetching one id-ordered page therefore
// returns an arbitrary slice that misses the large pools (they sit deep in the
// 6000+ pool set). To ingest the *most liquid* pools, we instead query Horizon's
// `reserves` filter for a curated allowlist of the largest Stellar mainnet pairs.
// Issuers below are verified live against Horizon. (T1-D2 — curated allowlist.)
const ASSETS = {
  XLM: "native",
  USDC: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  EURC: "EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  AQUA: "AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA",
  yXLM: "yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
  yUSDC: "yUSDC:GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF",
} as const;

// Curated liquid pairs (each verified to return a real pool on Horizon mainnet).
const LIQUID_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [ASSETS.XLM, ASSETS.USDC],
  [ASSETS.XLM, ASSETS.yXLM],
  [ASSETS.XLM, ASSETS.AQUA],
  [ASSETS.XLM, ASSETS.EURC],
  [ASSETS.XLM, ASSETS.yUSDC],
  [ASSETS.USDC, ASSETS.AQUA],
  [ASSETS.USDC, ASSETS.EURC],
  [ASSETS.AQUA, ASSETS.yXLM],
  [ASSETS.yXLM, ASSETS.yUSDC],
];

type HorizonPoolsResponse = {
  _embedded?: { records?: HorizonPool[] };
};

function assetCode(asset: string): string {
  return asset === "native" ? "XLM" : asset.split(":")[0];
}

export async function fetchHorizonPools(
  limit = 50
): Promise<HorizonPoolsResult> {
  const horizonUrl = getEnv("HORIZON_URL", "https://horizon.stellar.org");

  // Dedupe across pairs by pool id (a pool can match more than one filter).
  const byId = new Map<string, HorizonPool>();

  for (const [a, b] of LIQUID_PAIRS) {
    if (byId.size >= limit) break;

    const url = new URL(joinUrl(horizonUrl, "liquidity_pools"));
    url.searchParams.set("reserves", `${a},${b}`);
    url.searchParams.set("limit", "5");

    try {
      const json = await fetchJson<HorizonPoolsResponse>(url.toString());
      const records = json?._embedded?.records ?? [];
      for (const pool of records) {
        if (!byId.has(pool.id)) {
          byId.set(pool.id, pool);
        }
      }
    } catch (err) {
      // A single missing/invalid pair must not abort the whole ingestion.
      console.warn(
        `[stellar-native] liquidity_pools fetch failed for pair ` +
          `${assetCode(a)}/${assetCode(b)}: ${
            err instanceof Error ? err.message : String(err)
          }`
      );
    }
  }

  const pools = Array.from(byId.values()).slice(0, limit);

  return {
    fetchedAt: new Date().toISOString(),
    count: pools.length,
    pools,
  };
}
