// src/lib/protocols/stellar-native/asset-utils.ts
import { Asset, Networks } from "@stellar/stellar-sdk";

// Resolve a Horizon reserve asset ("native" or "CODE:ISSUER") to its Stellar
// Asset Contract (SAC) id. The assets table is keyed by the SAC contract (C…),
// not by the classic issuer (G…), so this is what we must use to price legs.
// Returns null if the asset string can't be parsed into a valid SAC.
export function horizonAssetToSacContractId(asset: string): string | null {
  try {
    if (asset === "native") {
      return Asset.native().contractId(Networks.PUBLIC);
    }
    const [code, issuer] = asset.split(":");
    if (!code || !issuer) return null;
    return new Asset(code, issuer).contractId(Networks.PUBLIC);
  } catch {
    return null;
  }
}

export function parseHorizonAsset(asset: string) {
    if (asset === "native") {
      return {
        symbol: "native",
        contractAddress: "native",
        assetType: "native",
      };
    }
  
    const [symbol, issuer] = asset.split(":");
  
    return {
      symbol,
      contractAddress: issuer,
      assetType: "stellar-asset",
    };
  }
  
  export function buildEntitySlug(
    left: string,
    right: string
  ) {
    return `stellar-native-${left.toLowerCase()}-${right.toLowerCase()}-pool`;
  }