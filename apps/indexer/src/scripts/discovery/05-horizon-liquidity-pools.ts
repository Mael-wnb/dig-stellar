import { getEnv, fetchJson, saveJson, nowIso } from "./00-common";

async function main() {
  const horizonUrl = getEnv("HORIZON_URL", "https://horizon.stellar.org");
  const limit = Number(process.env.HORIZON_LIMIT ?? 20);
  const order = process.env.HORIZON_ORDER ?? "desc";
  const cursor = process.env.HORIZON_CURSOR ?? "";

  const url = new URL("/liquidity_pools", horizonUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", order);

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const result = await fetchJson<any>(url.toString());

  const records = result?._embedded?.records ?? [];

  const output = {
    fetchedAt: nowIso(),
    horizonUrl,
    requestUrl: url.toString(),
    count: records.length,
    next:
      result?._links?.next?.href ??
      result?._links?.next ??
      null,
    firstRecord: records[0] ?? null,
    records,
  };

  console.dir(
    {
      count: records.length,
      firstRecord: records[0] ?? null,
      next: output.next,
    },
    { depth: 6 }
  );

  await saveJson("05-horizon-liquidity-pools.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});