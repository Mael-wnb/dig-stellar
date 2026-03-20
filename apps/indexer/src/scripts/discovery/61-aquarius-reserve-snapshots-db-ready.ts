import { loadJson, nowIso, saveJson } from './00-common';

async function main() {
  const shape = await loadJson<any>('57-aquarius-active-pool-db-shape.json');
  if (!shape) {
    throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  }

  const rows = (shape.reserveRows ?? []).map((row: any) => ({
    generatedAt: nowIso(),
    venueSlug: 'aquarius',
    entitySlug: shape.entitySlug,
    assetId: row.contractId,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    enabled: true,
    dSupplyRaw: row.reserveRaw,
    bSupplyRaw: null,
    backstopCreditRaw: null,
    dSupplyScaled: row.reserveScaled,
    bSupplyScaled: null,
    backstopCreditScaled: null,
    supplyCapRaw: null,
    supplyCapScaled: null,
    borrowApr: null,
    estBorrowApy: null,
    supplyApr: null,
    estSupplyApy: null,
  }));

  const output = {
    generatedAt: nowIso(),
    entitySlug: shape.entitySlug,
    reserveCount: rows.length,
    rows,
    firstReserveRow: rows[0] ?? null,
  };

  console.dir(output, { depth: 8 });
  await saveJson('61-aquarius-reserve-snapshots-db-ready.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});