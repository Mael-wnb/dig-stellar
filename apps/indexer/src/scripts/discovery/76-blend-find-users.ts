// apps/indexer/src/scripts/discovery/76-blend-find-users.ts
//
// Recover real Blend mainnet user addresses by scanning the pool's on-chain
// events, then probing each candidate through the SAME resolver path used in
// 75-blend-user-position-probe.ts. Classifies each live position as:
//   - borrower      → has liabilities → HEALTH FACTOR non-null
//   - supplier-only → collateral/supply but no debt → HEALTH FACTOR null
//
// The point is to hand back at least one of each (a borrower with HF, and a
// collateral-only supplier with HF null) with the FULL 56-char G... address,
// after a test wallet was wiped from the DB.
//
// Usage:
//   POOL_ID=<pool> SCAN_LEDGERS=120000 MAX_CANDIDATES=40 \
//     pnpm -C apps/indexer exec tsx src/scripts/discovery/76-blend-find-users.ts

import { getEnv, rpcCall, decodeTopicList, decodeScValBase64, nowIso, saveJson } from './00-common';
import { fetchBlendUserPositions } from '../../lib/protocols/blend/fetch-user-positions';
import { resolveBlendUserHealth } from '../../lib/protocols/blend/resolve-user-health';

type RpcEnvelope<T> = { jsonrpc: '2.0'; id: string; result?: T; error?: unknown };

function collectAddresses(value: unknown, out: Set<string>): void {
  if (value == null) return;
  if (typeof value === 'string') {
    // G... = account (56 chars). We only want signing-capable accounts, not
    // C... contracts (those are pool/token contracts, not user wallets).
    if (/^G[A-Z2-7]{55}$/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAddresses(v, out);
    return;
  }
  if (typeof value === 'object') {
    // ScVal natives decode to Address objects with a toString(); also walk plain maps.
    const s = (value as { toString?: () => string }).toString?.();
    if (s && /^G[A-Z2-7]{55}$/.test(s)) out.add(s);
    for (const v of Object.values(value as Record<string, unknown>)) collectAddresses(v, out);
  }
}

async function main() {
  const rpcUrl = getEnv('STELLAR_RPC_URL');
  const poolId =
    process.env.POOL_ID ??
    process.env.BLEND_POOL_ID ??
    'CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS';

  const scanLedgers = Number(process.env.SCAN_LEDGERS ?? 120_000);
  const pageLimit = Number(process.env.EVENTS_LIMIT ?? 200);
  const maxPages = Number(process.env.MAX_PAGES ?? 30);
  const maxCandidates = Number(process.env.MAX_CANDIDATES ?? 40);

  const latest = await rpcCall<RpcEnvelope<{ sequence: number }>>(rpcUrl, 'getLatestLedger');
  const latestLedger = latest.result?.sequence;
  if (!latestLedger) throw new Error('Could not retrieve latest ledger');

  const startLedger = Math.max(1, latestLedger - scanLedgers);
  console.log({ poolId, latestLedger, startLedger, scanLedgers });

  const candidates = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;

  while (pages < maxPages && candidates.size < maxCandidates * 4) {
    const params: Record<string, unknown> = cursor
      ? { filters: [{ contractIds: [poolId] }], pagination: { limit: pageLimit, cursor } }
      : { startLedger, filters: [{ contractIds: [poolId] }], pagination: { limit: pageLimit } };

    const resp = await rpcCall<RpcEnvelope<{ events: any[]; cursor?: string }>>(
      rpcUrl,
      'getEvents',
      params,
    );
    const events = resp.result?.events ?? [];
    for (const ev of events) {
      collectAddresses(decodeTopicList(ev.topic ?? []), candidates);
      collectAddresses(decodeScValBase64(ev.value), candidates);
    }
    pages += 1;
    cursor = resp.result?.cursor;
    console.log({ page: pages, gotEvents: events.length, uniqueAddresses: candidates.size });
    if (!cursor || events.length === 0) break;
  }

  const list = Array.from(candidates).slice(0, maxCandidates);
  console.log(`\nProbing ${list.length} candidate addresses against pool ${poolId}…\n`);

  const borrowers: any[] = [];
  const suppliers: any[] = [];
  const probed: any[] = [];

  for (const userAddress of list) {
    try {
      const positions = await fetchBlendUserPositions({ poolId, userAddress });
      if (!positions.hasPosition) continue;
      const health = resolveBlendUserHealth(positions);
      const row = {
        userAddress,
        healthFactor: health.healthFactor,
        totalCollateralUsd: Number(health.totalCollateralUsd.toFixed(2)),
        totalDebtUsd: Number(health.totalDebtUsd.toFixed(2)),
        reserves: positions.reserves.map((r) => ({
          assetId: r.assetId,
          collateral: r.collateral,
          supply: r.supply,
          liabilities: r.liabilities,
        })),
      };
      probed.push(row);
      if (health.healthFactor !== null) borrowers.push(row);
      else suppliers.push(row);
      console.log(
        `${userAddress}  HF=${health.healthFactor === null ? 'null (no debt)' : health.healthFactor.toFixed(3)}  ` +
          `collateral=$${row.totalCollateralUsd}  debt=$${row.totalDebtUsd}`,
      );
    } catch (err) {
      console.log(`${userAddress}  (probe error: ${(err as Error).message})`);
    }
    if (borrowers.length >= 3 && suppliers.length >= 3) break;
  }

  const pickBorrower = borrowers.sort((a, b) => a.healthFactor - b.healthFactor)[0] ?? null;
  const pickSupplier = suppliers.sort((a, b) => b.totalCollateralUsd - a.totalCollateralUsd)[0] ?? null;

  console.log('\n=== RESULT ===');
  console.log('Borrower (HF non-null):', pickBorrower?.userAddress ?? 'none found');
  if (pickBorrower) console.log('  HF =', pickBorrower.healthFactor.toFixed(3), ' debt = $' + pickBorrower.totalDebtUsd);
  console.log('Supplier (collateral-only, HF null):', pickSupplier?.userAddress ?? 'none found');
  if (pickSupplier) console.log('  collateral = $' + pickSupplier.totalCollateralUsd);

  await saveJson('76-blend-find-users.json', {
    generatedAt: nowIso(),
    poolId,
    latestLedger,
    startLedger,
    candidatesScanned: list.length,
    pickBorrower,
    pickSupplier,
    borrowers,
    suppliers,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
