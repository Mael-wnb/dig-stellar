import { loadJson, saveJson, nowIso } from "./00-common";

type RoleHint = {
  address: string;
  likelyRole: string;
  reasoning: string[];
};

async function main() {
  const roles = await loadJson<any>("17-blend-contract-role-map.json");
  const poolSummary = await loadJson<any>("16-blend-pool-token-summary.json");
  const userFlow = await loadJson<any>("13-blend-event-samples-by-type.json");

  const roleHints: RoleHint[] = roles?.roleHints ?? [];

  const registry = {
    generatedAt: nowIso(),
    venue: {
      slug: "blend",
      name: "Blend",
      chain: "stellar-mainnet",
    },
    primaryContracts: {
      primaryPoolLikeContract: roles?.notes?.primaryPoolLikeContract ?? null,
      primaryUserFlowContract: roles?.notes?.primaryUserFlowContract ?? null,
    },
    contracts: roleHints.map((r) => ({
      contractAddress: r.address,
      role: r.likelyRole,
      reasoning: r.reasoning,
    })),
    observedTokens: Object.keys(poolSummary?.tokenCounts ?? {}).map((token) => ({
      tokenAddress: token,
      seenCount: poolSummary.tokenCounts[token],
    })),
    eventCoverage: {
      poolEventCounts: poolSummary?.eventCounts ?? {},
      userFlowEventCounts: Object.fromEntries(
        Object.entries(userFlow?.byType ?? {}).map(([k, v]: any) => [k, v.count])
      ),
    },
  };

  console.dir(registry, { depth: 8 });
  await saveJson("18-blend-registry.json", registry);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});