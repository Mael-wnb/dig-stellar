import { loadJson, nowIso, saveJson } from './00-common';

function scale(raw: string | null | undefined, decimals: number | null | undefined): string | null {
  if (!raw || decimals === null || decimals === undefined) return null;

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;

  if (decimals === 0) return raw;

  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals) || '0';
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;

  return negative ? `-${out}` : out;
}

async function main() {
  const shape = await loadJson<any>('57-soroswap-active-pair-db-shape.json');

  if (!shape) {
    throw new Error('Missing 57-soroswap-active-pair-db-shape.json');
  }

  const [reserve0Raw, reserve1Raw] = shape.reserves ?? [];
  const [asset0, asset1] = shape.assets ?? [];

  if (!asset0 || !asset1) {
    throw new Error('Missing assets in 57-soroswap-active-pair-db-shape.json');
  }

  const rows = [
    {
      generatedAt: nowIso(),
      venueSlug: 'soroswap',
      entitySlug: shape.entitySlug,
      assetId: asset0.contractId,
      symbol: asset0.symbol,
      name: asset0.name,
      decimals: asset0.decimals,
      enabled: true,
      dSupplyRaw: reserve0Raw ? String(reserve0Raw) : null,
      bSupplyRaw: null,
      backstopCreditRaw: null,
      dSupplyScaled: scale(reserve0Raw ? String(reserve0Raw) : null, asset0.decimals),
      bSupplyScaled: null,
      backstopCreditScaled: null,
      supplyCapRaw: null,
      supplyCapScaled: null,
      borrowApr: null,
      estBorrowApy: null,
      supplyApr: null,
      estSupplyApy: null,
    },
    {
      generatedAt: nowIso(),
      venueSlug: 'soroswap',
      entitySlug: shape.entitySlug,
      assetId: asset1.contractId,
      symbol: asset1.symbol,
      name: asset1.name,
      decimals: asset1.decimals,
      enabled: true,
      dSupplyRaw: reserve1Raw ? String(reserve1Raw) : null,
      bSupplyRaw: null,
      backstopCreditRaw: null,
      dSupplyScaled: scale(reserve1Raw ? String(reserve1Raw) : null, asset1.decimals),
      bSupplyScaled: null,
      backstopCreditScaled: null,
      supplyCapRaw: null,
      supplyCapScaled: null,
      borrowApr: null,
      estBorrowApy: null,
      supplyApr: null,
      estSupplyApy: null,
    },
  ];

  const output = {
    generatedAt: nowIso(),
    entitySlug: shape.entitySlug,
    reserveCount: rows.length,
    rows,
    firstReserveRow: rows[0] ?? null,
  };

  console.dir(
    {
      reserveCount: output.reserveCount,
      entitySlug: output.entitySlug,
      firstReserveRow: output.firstReserveRow,
    },
    { depth: 8 }
  );

  await saveJson('61-soroswap-reserve-snapshots-db-ready.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});