import { loadJson, saveJson, nowIso } from "./00-common";

function scaleAmount(raw: string | null, decimals: number | null): string | null {
  if (!raw || decimals === null || !Number.isFinite(decimals)) return null;

  const rawStr = String(raw);
  const d = Number(decimals);

  if (d === 0) return rawStr;

  const padded = rawStr.padStart(d + 1, "0");
  const intPart = padded.slice(0, -d);
  const fracPart = padded.slice(-d).replace(/0+$/, "");

  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function main() {
  const dbReady = await loadJson<any>("22-blend-events-db-ready.json");
  const resolvedAssets = await loadJson<any>("27-blend-assets-resolved.json");

  const rows = dbReady?.rows ?? [];
  const assets = resolvedAssets?.assets ?? [];

  const decimalsMap = new Map<string, number>();
  for (const asset of assets) {
    if (typeof asset.contractAddress === "string" && typeof asset.decimals === "number") {
      decimalsMap.set(asset.contractAddress, asset.decimals);
    }
  }

  const scaledRows = rows.map((row: any) => {
    const tokenInDecimals =
      typeof row.tokenIn === "string" ? decimalsMap.get(row.tokenIn) ?? null : null;
    const tokenOutDecimals =
      typeof row.tokenOut === "string" ? decimalsMap.get(row.tokenOut) ?? null : null;

    return {
      ...row,
      tokenAmountInScaled: scaleAmount(row.tokenAmountIn, tokenInDecimals),
      tokenAmountOutScaled: scaleAmount(row.tokenAmountOut, tokenOutDecimals),
      tokenInDecimals,
      tokenOutDecimals,
    };
  });

  const output = {
    generatedAt: nowIso(),
    count: scaledRows.length,
    scaledRows,
  };

  console.dir(
    {
      count: scaledRows.length,
      firstScaledRow: scaledRows[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("28-blend-events-scaled.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});