import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const poolProbe = await loadJson<any>("26-blend-pool-read-method-probe.json");
  const assetsResolved = await loadJson<any>("27-blend-assets-resolved.json");

  const getTokensResult =
    poolProbe?.results?.find((r: any) => r.method === "get_tokens") ?? null;

  const poolTokens: string[] = Array.isArray(getTokensResult?.decoded)
    ? getTokensResult.decoded
    : [];

  const resolvedAssets = assetsResolved?.assets ?? [];

  const byAddress = Object.fromEntries(
    resolvedAssets.map((a: any) => [a.contractAddress, a])
  );

  const output = {
    generatedAt: nowIso(),
    poolTokens,
    resolvedPoolTokens: poolTokens.map((addr) => ({
      contractAddress: addr,
      asset: byAddress[addr] ?? null,
    })),
  };

  console.dir(output, { depth: 8 });
  await saveJson("29-blend-pool-token-coherence.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});