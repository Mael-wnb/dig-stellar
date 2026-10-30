// apps/indexer/src/scripts/bootstrap/xoxno-upsert-core.ts
//
// Bootstrap XOXNO Lending (Lot XO, XO-1) into the raw SQL v1 product pipeline:
// venue `xoxno` (lending) + ONE entity per hub (Blend pattern: entity = hub,
// reserve_snapshots row = market) + the 25 market assets + entity_assets links.
// Idempotent. After running it against the source DB, regenerate the committed
// registry (`pnpm -C apps/indexer bootstrap:export`) so a fresh clone / the
// container's `bootstrap:core` replays it.
//
//   pnpm -C apps/indexer exec tsx src/scripts/bootstrap/xoxno-upsert-core.ts
//
// Provenance (step-0 recon, 2026-10-26, read-only; XOXNO/rs-lending-xlm is
// PolyForm Noncommercial — nothing below was taken from that repository):
//   - controller / pool / NFT / aggregator addresses: Position-NFT instance
//     storage (`Controller`), controller storage (`Pool`, `PositionNft`,
//     `PriceAggregator`), confirmed by simulating controller.get_pool_address()
//     and controller.price_aggregator().
//   - market list: the pool's own ledger entries — exactly 25 ("Params",
//     HubAssetKey) + 25 ("State", HubAssetKey) keys (stellar.expert contract-data
//     enumeration, decoded with the SDK), cross-checked against the
//     `market|batch_params_update` pool events of the creation window and
//     against the registry XOXNO publishes for DefiLlama (25 = 25, 0 diff).
//     The pipeline itself never calls api.xoxno.com.
//   - hub names (Core / RWA / AMM): NOT on-chain (the controller has no hub-name
//     view) — hand-seeded from XOXNO's public registry / UI labels.
//   - token symbol / name / decimals: SEP-41 `symbol()` / `name()` / `decimals()`
//     of each token contract, matching MarketParamsRaw.asset_decimals (7, 8, 9
//     and 18 all present). The Aquarius LP tokens all answer "POOL" / "Pool
//     Share Token", so they are labelled by pair composition instead.
//   - existing asset rows (XLM = 'native', USDC, EURC, …) are NEVER renamed: the
//     product keys pricing rules by symbol. Insert-if-missing only.
//
// Hub `3` holds Aquarius LP tokens as collateral: their value is ALSO inside the
// Aquarius pools we track (≈ $730 at recon time). Kept, documented, no exclusion
// (founder decision; docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md).
import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import {
  XOXNO_CONTROLLER_CONTRACT,
  XOXNO_POOL_CONTRACT,
  XOXNO_POSITION_NFT_CONTRACT,
  XOXNO_PRICE_AGGREGATOR_CONTRACT,
  XOXNO_VENUE_NAME,
  XOXNO_VENUE_SLUG,
  type XoxnoHubEntityMetadata,
  type XoxnoMarketSeed,
} from '../../lib/protocols/xoxno/types';

const CHAIN = 'stellar-mainnet';
const SOURCE = 'xoxno_bootstrap';

type HubSeed = {
  hubId: number;
  hubName: string;
  entitySlug: string;
  markets: XoxnoMarketSeed[];
};

const m = (asset: string, symbol: string, name: string, decimals: number): XoxnoMarketSeed => ({ asset, symbol, name, decimals });

export const XOXNO_HUBS: HubSeed[] = [
  {
    hubId: 1,
    hubName: 'Core',
    entitySlug: 'xoxno-core-hub',
    markets: [
      m('CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA', 'native', 'native', 7),
      m('CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75', 'USDC', 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', 7),
      m('CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV', 'EURC', 'EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2', 7),
      m('CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF', 'USDT0', 'USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q', 7),
      m('CCCRWH6Q3FNP3I2I57BDLM5AFAT7O6OF6GKQOC6SSJNDAVRZ57SPHGU2', 'PYUSD', 'PYUSD:GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5', 7),
      m('CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN', 'SolvBTC', 'Solv BTC', 8),
      m('CAUP7NFABXE5TJRL3FKTPMWRLC7IAXYDCTHQRFSCLR5TMGKHOOQO772J', 'xSolvBTC', 'xSolvBTC', 8),
    ],
  },
  {
    hubId: 2,
    hubName: 'RWA',
    entitySlug: 'xoxno-rwa-hub',
    markets: [
      m('CAL6ER2TI6CTRAY6BFXWNWA7WTYXUXTQCHUBCIBU5O6KM3HJFG6Z6VXV', 'CETES', 'CETES:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC', 7),
      m('CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR', 'USTRY', 'USTRY:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC', 7),
      m('CB3YA656OYIHU57657I5KGSBRHE5I3OZU4VFC22PYAOANFZHEWNYGAGP', 'USDY', 'USDY:GAJMPX5NBOG6TQFPQGRABJEEB2YE7RFRLUKJDZAZGAD5GFX4J7TADAZ6', 7),
      m('CBZ4DCE7PYMUTOAKKUTRSUPT3FJFVOWCSKWUM5A72D6SAVMUJE5JN2PJ', 'USST', 'STBL_USST - USST Token', 18),
      m('CC2RBGYNCFBCVENIDL5BFBWPH4OUZM2UA3OD2K2N54GLMWCC4KWPVAGO', 'XAUM', 'Matrixdock Gold', 9),
      m('CBI7UCH5KGSVQRO5H4SUCZUTZABCITZLRHQQZTWL2TK4RZ72TAR6IHRV', 'deJTRSY', 'deJTRSY', 18),
      m('CC64WBDGS6QQP22QTTIACYIXT3WF7BBQEYOQPLTP7GTKYY7PZ74QYGSL', 'deJAAA', 'deJAAA', 18),
    ],
  },
  {
    hubId: 3,
    hubName: 'AMM',
    entitySlug: 'xoxno-amm-hub',
    markets: [
      m('CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK', 'AQUA', 'AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', 7),
      // Aquarius pool share tokens (SEP-41 symbol "POOL"): labelled by pair.
      m('CAVKLYY4RWFQBRA2YI5GTGGXKUKJQI3JLAHDGXMS7L5RDH6X6A47NMOZ', 'XLM-USDC-LP', 'Aquarius LP XLM/USDC', 7),
      m('CBOHAVUYKQD4C7FIVXEDJCVLUZYUO6RN3VIKEDOTIJGDDV3QN33Y4T4D', 'XLM-AQUA-LP', 'Aquarius LP XLM/AQUA', 7),
      m('CAPPL34NF6X7M3EQFIPDXZHQX2PT3EOE2LYCDORH3PF2LTRDSFGWV6NL', 'XLM-SolvBTC-LP', 'Aquarius LP XLM/SolvBTC', 7),
      m('CDOY7ILRR7PDGLBXZUPSENB6XOET77PR2JY3HXDGQS3TS4T764OYBUGO', 'AQUA-USDC-LP', 'Aquarius LP AQUA/USDC', 7),
      m('CB2WUVUP2SKZVFZFNU33EZCISH65DKHQP4WBEHJ4WE3BF7QOABYGCQMS', 'CETES-USDC-LP', 'Aquarius LP CETES/USDC', 7),
      m('CCLJBNY2KMUOSAW7URIZHREO5ORQREDX7NIHLFRAT6KAZ5GO7652OA4I', 'USTRY-USDC-LP', 'Aquarius LP USTRY/USDC', 7),
      m('CCYD4C2WFWIIDF235SCDXEWL5RT6S53WQWLDHUTQ5USZ5VNF5NHJGVW7', 'USDY-USDC-LP', 'Aquarius LP USDY/USDC', 7),
      m('CD3EQXQGRYUKM7LZ6MZVTXSW74ROXU6YI2SXHJ6KTB5BQ425E5KXRDBC', 'PYUSD-USDC-LP', 'Aquarius LP PYUSD/USDC', 7),
      m('CACO4IS27ANIDC45UN5LWTYZYEELSJWA3WVWGI6QAF6Q2ZY4ZMZFSJRW', 'USDC-XAUM-LP', 'Aquarius LP USDC/XAUM', 7),
      m('CDZ4QRNY63YKJY7FLBTJUVPX3Z3U56JY5KHNHQEYI5F5MYLMC5YNRIXE', 'xSolvBTC-SolvBTC-LP', 'Aquarius LP xSolvBTC/SolvBTC', 7),
    ],
  },
];

const PROVENANCE = {
  recon: 'docs/evidence/lot-xo/ (step-0 recon 2026-10-26, read-only simulations)',
  marketList: 'pool ledger entries ("Params"/"State", HubAssetKey) = 25, cross-checked vs pool market|batch_params_update events and XOXNO public registry (0 diff)',
  hubNames: 'hand-seeded (no on-chain hub-name view): Core / RWA / AMM',
  tokenLabels: 'SEP-41 symbol()/name()/decimals(); Aquarius LP tokens labelled by pair (they all answer POOL)',
  licence: 'XOXNO/rs-lending-xlm is PolyForm Noncommercial — contracts read on-chain only, no code copied',
};

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    await client.query('begin');

    const venueRes = await client.query(
      `
      insert into venues (slug, name, chain, venue_type, metadata)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (slug)
      do update set
        name = excluded.name,
        chain = excluded.chain,
        venue_type = excluded.venue_type,
        metadata = excluded.metadata,
        updated_at = now()
      returning id
      `,
      [
        XOXNO_VENUE_SLUG,
        XOXNO_VENUE_NAME,
        CHAIN,
        'lending',
        JSON.stringify({
          source: SOURCE,
          category: 'lending',
          pool: XOXNO_POOL_CONTRACT,
          controller: XOXNO_CONTROLLER_CONTRACT,
          positionNft: XOXNO_POSITION_NFT_CONTRACT,
          priceAggregator: XOXNO_PRICE_AGGREGATOR_CONTRACT,
          provenance: PROVENANCE,
        }),
      ]
    );
    const venueId = venueRes.rows[0].id as string;

    let assetsInserted = 0;
    let linkCount = 0;

    for (const hub of XOXNO_HUBS) {
      const metadata: XoxnoHubEntityMetadata = {
        source: SOURCE,
        hubId: hub.hubId,
        hubName: hub.hubName,
        pool: XOXNO_POOL_CONTRACT,
        controller: XOXNO_CONTROLLER_CONTRACT,
        positionNft: XOXNO_POSITION_NFT_CONTRACT,
        priceAggregator: XOXNO_PRICE_AGGREGATOR_CONTRACT,
        markets: hub.markets,
        provenance: PROVENANCE,
      };

      const entityRes = await client.query(
        `
        insert into entities (venue_id, slug, name, entity_type, contract_address, metadata, is_active)
        values ($1, $2, $3, $4, $5, $6::jsonb, true)
        on conflict (slug)
        do update set
          venue_id = excluded.venue_id,
          name = excluded.name,
          entity_type = excluded.entity_type,
          contract_address = excluded.contract_address,
          -- keep refresh-written fields (appVersion, lastRefreshAt…), replace the seed
          metadata = entities.metadata || excluded.metadata,
          updated_at = now()
        returning id
        `,
        [venueId, hub.entitySlug, `${hub.hubName} hub`, 'lending_pool', XOXNO_POOL_CONTRACT, JSON.stringify(metadata)]
      );
      const entityId = entityRes.rows[0].id as string;

      for (const market of hub.markets) {
        // Insert-if-missing: never rename an existing asset (pricing rules key on symbol).
        const assetRes = await client.query(
          `
          insert into assets (chain, contract_address, asset_type, symbol, name, decimals, metadata)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb)
          on conflict (contract_address)
          do update set
            decimals = coalesce(assets.decimals, excluded.decimals),
            updated_at = now()
          returning id, (xmax = 0) as inserted
          `,
          [CHAIN, market.asset, 'soroban_token', market.symbol, market.name, market.decimals, JSON.stringify({ source: SOURCE, hubId: hub.hubId })]
        );
        const assetId = assetRes.rows[0].id as string;
        if (assetRes.rows[0].inserted) assetsInserted += 1;

        await client.query(
          `
          insert into entity_assets (entity_id, asset_id, role, metadata)
          values ($1, $2, $3, $4::jsonb)
          on conflict (entity_id, asset_id, role)
          do update set metadata = excluded.metadata
          `,
          [entityId, assetId, 'reserve', JSON.stringify({ source: SOURCE, hubId: hub.hubId })]
        );
        linkCount += 1;
      }
    }

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      venueId,
      venueSlug: XOXNO_VENUE_SLUG,
      hubs: XOXNO_HUBS.map((h) => `${h.entitySlug} (hub ${h.hubId}, ${h.markets.length} markets)`),
      markets: XOXNO_HUBS.reduce((n, h) => n + h.markets.length, 0),
      assetsInserted,
      entityAssetLinks: linkCount,
    });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
