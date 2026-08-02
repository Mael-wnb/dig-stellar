#!/usr/bin/env node
// tools/probe-mainnet-pairs.mjs
//
// Vets MAINNET SDEX pairs for the swap widget (T3-D2 pair expansion — Lot A1b).
// Probes DIRECT (single-hop) strict-send liquidity on Horizon Pubnet — the same
// oracle the backend /v1/actions/sdex/quote uses — in BOTH directions
// (XLM→asset, asset→XLM), at a small size and at the launch-cap size, and
// reports rate degradation (depth). Pairs the product can't reliably fill must
// never be offered: this script is the acceptance oracle, exactly like the
// testnet vetting documented in apps/web/src/config/testnetSwapPairs.ts.
//
// Verdicts per direction:
//   PASS  — both sizes quote a direct route AND cap-size rate ≥ 95% of small-size
//           rate (≤5% depth degradation, matching the widget's slippage tolerance)
//   THIN  — routes exist but degradation > 5% (fills small, bad UX at cap size)
//   FAIL  — no direct route at one of the sizes
//
// The script also fetches each asset's home_domain from Horizon /assets so the
// issuer can be verified against the issuing organization (Circle, Aquarius, …).
// The script VETS LIQUIDITY ONLY — issuer legitimacy is a human/reviewer step.
//
// Usage (Node 18+, no dependencies; run from anywhere with network access):
//   node tools/probe-mainnet-pairs.mjs                     # discover top assets via stellar.expert
//   node tools/probe-mainnet-pairs.mjs --top 30            # widen discovery
//   node tools/probe-mainnet-pairs.mjs --candidates c.json # skip discovery; c.json =
//       [{ "code": "USDC", "issuer": "GA5Z…" }, …]
//
// NOTE: the stellar.expert response shape may drift — if discovery fails, use
// --candidates (the probe itself only depends on Horizon).

const HORIZON = 'https://horizon.stellar.org';
const EXPERT = 'https://api.stellar.expert/explorer/public';

// Sizes in XLM: a small retail swap, and the mainnet launch cap
// (ACTIONS_MAINNET_MAX_SEND_XLM default — keep in sync if the cap changes).
const SMALL_XLM = '10';
const CAP_XLM = '100';
const MAX_DEGRADATION = 0.05; // 5%, matches the widget's slippage tolerance
const PAUSE_MS = 350; // stay friendly with Horizon rate limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { top: 20, candidates: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--top') args.top = parseInt(argv[++i], 10) || 20;
    else if (argv[i] === '--candidates') args.candidates = argv[++i];
  }
  return args;
}

async function jget(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Top mainnet assets by 7-day volume via stellar.expert (discovery only). */
async function discoverTopAssets(n) {
  const json = await jget(`${EXPERT}/asset?limit=${n}&sort=volume7d&order=desc`);
  const records = json?._embedded?.records ?? [];
  const out = [];
  for (const rec of records) {
    const parts = String(rec.asset ?? '').split('-');
    if (parts.length < 2) continue; // native XLM or unexpected shape
    const [code, issuer] = parts;
    if (!/^[A-Za-z0-9]{1,12}$/.test(code)) continue;
    if (!/^G[A-Z2-7]{55}$/.test(issuer)) continue;
    out.push({ code, issuer, expertDomain: rec.domain ?? '' });
  }
  return out;
}

/** Best DIRECT (empty-path) strict-send record, or null. */
async function bestDirect({ from, amount, to }) {
  const p = new URLSearchParams();
  if (from === 'native') {
    p.set('source_asset_type', 'native');
  } else {
    p.set(
      'source_asset_type',
      from.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
    );
    p.set('source_asset_code', from.code);
    p.set('source_asset_issuer', from.issuer);
  }
  p.set('source_amount', amount);
  p.set('destination_assets', to === 'native' ? 'native' : `${to.code}:${to.issuer}`);

  const json = await jget(`${HORIZON}/paths/strict-send?${p.toString()}`);
  const direct = (json?._embedded?.records ?? []).filter(
    (r) => (r.path ?? []).length === 0,
  );
  if (direct.length === 0) return null;
  return direct.reduce((a, b) =>
    parseFloat(b.destination_amount) > parseFloat(a.destination_amount) ? a : b,
  );
}

/** Probes one direction at two sizes; returns { verdict, rateSmall, rateLarge, degradation }. */
async function probeDirection(from, to, smallAmount, largeAmount) {
  const small = await bestDirect({ from, amount: smallAmount, to });
  await sleep(PAUSE_MS);
  const large = await bestDirect({ from, amount: largeAmount, to });
  await sleep(PAUSE_MS);

  if (!small || !large) {
    return { verdict: 'FAIL', reason: !small ? 'no direct route (small)' : 'no direct route (cap size)' };
  }
  const rateSmall = parseFloat(small.destination_amount) / parseFloat(smallAmount);
  const rateLarge = parseFloat(large.destination_amount) / parseFloat(largeAmount);
  const degradation = 1 - rateLarge / rateSmall;
  const verdict = degradation <= MAX_DEGRADATION ? 'PASS' : 'THIN';
  return {
    verdict,
    rateSmall: rateSmall.toPrecision(6),
    rateLarge: rateLarge.toPrecision(6),
    degradationPct: (degradation * 100).toFixed(2),
    smallOut: small.destination_amount,
    largeOut: large.destination_amount,
  };
}

/** home_domain from Horizon /assets — for the human issuer-verification step. */
async function homeDomain(code, issuer) {
  try {
    const json = await jget(
      `${HORIZON}/assets?asset_code=${code}&asset_issuer=${issuer}`,
    );
    const rec = json?._embedded?.records?.[0];
    return rec?.home_domain ?? rec?._links?.toml?.href ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const args = parseArgs(process.argv);

  let candidates;
  if (args.candidates) {
    const { readFileSync } = await import('node:fs');
    candidates = JSON.parse(readFileSync(args.candidates, 'utf8'));
    console.error(`Probing ${candidates.length} candidate(s) from ${args.candidates}\n`);
  } else {
    console.error(`Discovering top ${args.top} mainnet assets via stellar.expert…\n`);
    candidates = await discoverTopAssets(args.top);
  }

  const results = [];
  for (const asset of candidates) {
    const label = `${asset.code}:${asset.issuer.slice(0, 6)}…`;
    process.stderr.write(`probing ${label} `);

    const domain = await homeDomain(asset.code, asset.issuer);
    await sleep(PAUSE_MS);

    // XLM → asset at 10 and 100 XLM.
    const fwd = await probeDirection('native', asset, SMALL_XLM, CAP_XLM);

    // asset → XLM: reuse the forward outputs as source sizes so both directions
    // describe the same economic size. Falls back to FAIL when forward failed.
    let rev = { verdict: 'SKIP', reason: 'forward failed' };
    if (fwd.smallOut && fwd.largeOut) {
      rev = await probeDirection(asset, 'native', fwd.smallOut, fwd.largeOut);
    }

    process.stderr.write(`→ fwd ${fwd.verdict} / rev ${rev.verdict}\n`);
    results.push({ ...asset, homeDomain: domain, xlmToAsset: fwd, assetToXlm: rev });
  }

  // Human-readable summary (stdout) + full JSON for the record.
  console.log('\n| Asset | Issuer | home_domain | XLM→asset | deg% | asset→XLM | deg% |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.code} | ${r.issuer.slice(0, 8)}… | ${r.homeDomain || '—'} | ${r.xlmToAsset.verdict} | ${
        r.xlmToAsset.degradationPct ?? '—'
      } | ${r.assetToXlm.verdict} | ${r.assetToXlm.degradationPct ?? '—'} |`,
    );
  }
  console.log('\nFull results (JSON):');
  console.log(JSON.stringify(results, null, 2));
  console.log(
    '\nAcceptance bar: offer a pair only if BOTH directions are PASS (or knowingly ' +
      'accept a one-way pair with a UI note). Issuer legitimacy (home_domain vs the ' +
      'issuing org, stellar.expert verification) is a separate human step — liquidity ' +
      'alone is NOT sufficient to whitelist an asset.',
  );
}

main().catch((err) => {
  console.error('probe failed:', err.message);
  process.exit(1);
});
