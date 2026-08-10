// apps/indexer/src/scripts/bootstrap/seed-logos.ts
//
// F3 (Lot F) — one-shot, idempotent seed of backend-served brand/asset logos.
// Sets venues.logo_url (by slug) and assets.logo_url (by symbol, case-insensitive
// so testnet + mainnet issuers of the same symbol share one logo). Re-runnable:
// every write is an UPDATE to a fixed value, and only non-null URLs are applied.
//
//   pnpm -C apps/indexer bootstrap:logos
//
// DECISION (beta-first): hotlink stable official/mirror URLs — no runtime TOML or
// stellar.expert resolution, no scraping. Vendoring images into our own hosting is
// a post-beta hardening line. Every URL below was verified 200 + image content-type
// on 2026-08-10. Where no stable official image URL exists yet (AQUA, yXLM,
// Allbridge), logo_url stays null and the UI shows its monogram / bundled fallback —
// we do not seed a guessed URL. Fill those in once an official asset is confirmed.

import { createPgClient } from '../shared/db';

// TrustWallet assets — stable GitHub-raw mirror of official brand marks.
// SOURCE: https://github.com/trustwallet/assets (blockchains/<chain>/.../logo.png)
// USDC/EURC/PYUSD use the Ethereum-chain Circle/PayPal marks; they are the SAME
// brand logo as the Stellar-issued versions (Circle/PayPal issue on both chains).
const TW = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';
const XLM_LOGO = `${TW}/stellar/info/logo.png`;
const USDC_LOGO = `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`;
const EURC_LOGO = `${TW}/ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png`;
const PYUSD_LOGO = `${TW}/ethereum/assets/0x6c3ea9036406852006290770BEdFcAbA0e23A0e8/logo.png`;

// Venue logo by slug. Venues with a bundled web SVG (blend/soroswap/aquarius/
// defindex) intentionally stay null here — the frontend already renders their
// vendored logo and would only fall back to a backend URL if one is set. The
// Stellar-native DEX has no bundled logo, so it gets the official Stellar mark.
const VENUE_LOGOS: Record<string, string> = {
  'stellar-native': XLM_LOGO, // SOURCE: TrustWallet stellar/info/logo.png
  // 'blend':      null (bundled web SVG)
  // 'soroswap':   null (bundled web SVG)
  // 'aquarius':   null (bundled web SVG)
  // 'defindex':   null (bundled web SVG)
  // 'allbridge':  null — TODO: no stable official image URL confirmed yet
};

// Asset logo by symbol (case-insensitive match). Whitelisted assets only.
const ASSET_LOGOS: Record<string, string> = {
  XLM: XLM_LOGO,
  native: XLM_LOGO, // the native asset is stored with symbol 'native' in the v1 pipeline
  USDC: USDC_LOGO,
  EURC: EURC_LOGO,
  PYUSD: PYUSD_LOGO,
  // AQUA:  TODO — no stable official image URL confirmed yet (monogram fallback)
  // yXLM:  TODO — no stable official image URL confirmed yet (monogram fallback)
};

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    // Self-sufficient: ensure the columns exist even if stellar_v1_logos.sql
    // wasn't applied separately. Additive + idempotent.
    await client.query('alter table if exists venues add column if not exists logo_url text');
    await client.query('alter table if exists assets add column if not exists logo_url text');

    await client.query('begin');

    let venueUpdates = 0;
    const venuesMissing: string[] = [];
    for (const [slug, url] of Object.entries(VENUE_LOGOS)) {
      const res = await client.query(
        'update venues set logo_url = $1, updated_at = now() where slug = $2',
        [url, slug],
      );
      if (res.rowCount && res.rowCount > 0) venueUpdates += res.rowCount;
      else venuesMissing.push(slug);
    }

    let assetRowsUpdated = 0;
    const assetsMissing: string[] = [];
    for (const [symbol, url] of Object.entries(ASSET_LOGOS)) {
      const res = await client.query(
        'update assets set logo_url = $1, updated_at = now() where lower(symbol) = lower($2)',
        [url, symbol],
      );
      if (res.rowCount && res.rowCount > 0) assetRowsUpdated += res.rowCount;
      else assetsMissing.push(symbol);
    }

    await client.query('commit');

    console.log({
      ok: true,
      venueUpdates,
      assetRowsUpdated,
      // Symbols/slugs with no matching row in this DB (e.g. an asset not yet
      // ingested on this network) — informational, not an error.
      venuesNotMatched: venuesMissing,
      assetsNotMatched: assetsMissing,
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
