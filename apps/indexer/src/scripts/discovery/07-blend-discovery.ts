import { saveJson, nowIso } from "./00-common";

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function main() {
  const deploymentsUrl =
    process.env.BLEND_DEPLOYMENTS_URL ??
    "https://docs.blend.capital/mainnet-deployments";

  const res = await fetch(deploymentsUrl);
  const html = await res.text();

  if (!res.ok) {
    throw new Error(`Failed to fetch Blend deployments page: ${res.status}`);
  }

  // Stellar contract/account style strings often start with C or G and are base32-ish.
  // This is intentionally permissive for discovery.
  const matches = html.match(/\b[CG][A-Z2-7]{40,120}\b/g) ?? [];
  const addresses = unique(matches).sort();

  const output = {
    fetchedAt: nowIso(),
    deploymentsUrl,
    addressesCount: addresses.length,
    addresses,
    htmlSample: html.slice(0, 3000),
  };

  console.dir(
    {
      deploymentsUrl,
      addressesCount: addresses.length,
      addressesPreview: addresses.slice(0, 20),
    },
    { depth: 4 }
  );

  await saveJson("07-blend-discovery.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});