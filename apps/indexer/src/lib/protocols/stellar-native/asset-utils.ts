// src/lib/protocols/stellar-native/asset-utils.ts
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