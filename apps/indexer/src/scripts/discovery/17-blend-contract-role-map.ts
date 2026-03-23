import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const topics = await loadJson<any>("10-blend-topic-inventory.json");
  const caqq = await loadJson<any>("13-blend-event-samples-by-type.json");
  const cas3 = await loadJson<any>("15-blend-pool-event-samples.json");

  const roleHints: Array<{
    address: string;
    likelyRole: string;
    reasoning: string[];
  }> = [];

  const contracts: Array<{ address: string; topicCounts: Record<string, number> }> =
    topics?.contracts?.map((c: any) => ({
      address: c.address,
      topicCounts: c.topicCounts ?? {},
    })) ?? [];

  for (const c of contracts) {
    const keys = Object.keys(c.topicCounts);
    const reasoning: string[] = [];
    let likelyRole = "unknown";

    if (keys.includes("POOL") || keys.includes("approve") || keys.includes("transfer")) {
      likelyRole = "pool_or_token_contract";
      reasoning.push("emits POOL / approve / transfer-style events");
    }

    if (
      keys.includes("deposit") ||
      keys.includes("claim") ||
      keys.includes("withdraw") ||
      keys.includes("queue_withdrawal")
    ) {
      likelyRole = "user_facing_rewards_or_strategy_contract";
      reasoning.push("emits deposit / claim / withdraw / queue_withdrawal");
    }

    if (keys.length === 0) {
      likelyRole = "factory_or_inactive_or_non_event_contract";
      reasoning.push("no recent events seen");
    }

    roleHints.push({
      address: c.address,
      likelyRole,
      reasoning,
    });
  }

  const output = {
    generatedAt: nowIso(),
    roleHints,
    notes: {
      primaryUserFlowContract: caqq?.contractId ?? null,
      primaryPoolLikeContract: cas3?.contractId ?? null,
    },
  };

  console.dir(output, { depth: 8 });
  await saveJson("17-blend-contract-role-map.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});