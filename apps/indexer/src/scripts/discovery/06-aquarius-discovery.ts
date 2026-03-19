import { fetchJson, saveJson, nowIso } from "./00-common";

type ProbeResult = {
  endpoint: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
};

async function probe(baseUrl: string, endpoint: string): Promise<ProbeResult> {
  const url = new URL(endpoint, baseUrl).toString();

  try {
    const res = await fetch(url);
    const text = await res.text();

    if (!res.ok) {
      return {
        endpoint: url,
        ok: false,
        status: res.status,
        error: text.slice(0, 500),
      };
    }

    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text
    }

    return {
      endpoint: url,
      ok: true,
      status: res.status,
      data,
    };
  } catch (err) {
    return {
      endpoint: url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const baseUrl =
    process.env.AQUARIUS_API_BASE ??
    "https://backend.aqua.network";

  const candidates = [
    "/",
    "/api",
    "/api/health",
    "/api/pools",
    "/api/pools?limit=10",
    "/api/v1/pools",
    "/api/v1/pools?limit=10",
    "/api/marketkeys",
    "/api/assets",
    "/api/v1/assets",
  ];

  const results: ProbeResult[] = [];
  for (const endpoint of candidates) {
    results.push(await probe(baseUrl, endpoint));
  }

  const okResults = results.filter((r) => r.ok);

  const output = {
    fetchedAt: nowIso(),
    baseUrl,
    totalProbes: results.length,
    successCount: okResults.length,
    okEndpoints: okResults.map((r) => r.endpoint),
    results,
  };

  console.dir(
    {
      baseUrl,
      successCount: okResults.length,
      okEndpoints: okResults.map((r) => r.endpoint),
    },
    { depth: 6 }
  );

  await saveJson("06-aquarius-discovery.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});