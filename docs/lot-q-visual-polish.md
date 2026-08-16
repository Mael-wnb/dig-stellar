# Lot Q — Visual Polish (token logos, naming, protocols page)

Execution brief for Claude Code. Founder review 2026-08-16, post-Lot P: four visual
items before the demo video. Web-only + registry display names — NO API logic
changes, NO action paths, NO slug changes. Evidence: `docs/evidence/lot-q/`
(headless-Chrome before/after captures per item, the H2/H3 CDP method).

## Q1 — Token logos: circles, not rounded-square tiles

- Asset/token logos currently render inside a rounded-square tile; the industry
  standard is a plain **circle** (circular crop, `object-fit: cover`), which is
  also what makes overlapping pair logos read cleanly.
- Change the ASSET variant of the logo component (`BrandLogo` or equivalent) to
  circular. Overlapping `PairLogo` gets a thin background-colored ring (~2px) on
  the front logo so the overlap has clean separation.
- **Protocol/venue logos KEEP the rounded-square tile** — tokens are round, apps
  are square; do not circle those.
- Sweep every usage: pools table, pair logos, position chips (H6), the Portfolio
  Assets card (W3), the swap token selector, alert-modal targets, bridge rows.

## Q2 — 'native' never renders to users

Pool names like "native-USDC aquarius pool" leak the internal symbol. Two layers:

- **Registry display names**: rename entity display names in `core-registry.json`
  to venue-style naming ("XLM/USDC" etc.). Slugs are stable identifiers
  (deep-links, alert payloads) — DISPLAY ONLY, never touch slugs. Local re-seed
  to verify; VPS pickup is pull + `bootstrap:core` (note it in the evidence).
- **Web `displaySymbol` helper**: `'native' → 'XLM'` applied anywhere a raw
  symbol renders (mirror of the API-side helper in the alerts families module).
  Grep-sweep `apps/web` for remaining user-visible 'native' occurrences; the
  venue "Stellar Native DEX" label is a proper noun and stays.

## Q3 — Protocol logos: remove the double frame

- Observed: venue logos show a frame-within-a-frame — outer tile + the actual
  logo small in the middle inside its own intermediate frame. **Diagnose first**:
  is the inner frame baked into the image asset, or are two components nesting
  tiles? State which in the evidence.
- Fix so ONE tile remains with the logo filling it — remove the outer wrapper
  (founder's stated preference: keep the intermediate frame) or crop the padded
  asset, whichever the diagnosis dictates. Apply everywhere venue logos render:
  dashboard protocol cards, protocols page, pool rows, pool detail header.

## Q4 — Protocols page layout

Per-protocol row/card:

- protocol logo (post-Q3) + name in the protocol column;
- a new **Type** column from `venue_type`, honest per venue: Lending / AMM /
  DEX (orderbook) / Yield vaults;
- underlying assets as up to **3 asset logos** (top by TVL within the protocol,
  circular per Q1) + a "+N" overflow chip when there are more (Blend has 8
  reserves — never truncate silently);
- keep the existing metrics/columns otherwise. This is arrangement, not new
  data — if the protocols payload lacks the per-venue asset list, extend the
  API response additively (same pattern as H6's legs), nothing else.

## Constraints & sequencing

- Q1 → Q2 → Q3 → Q4, STOP-and-report after each pair (Q1+Q2, then Q3+Q4).
  Q1+Q2 are the demo-visible half — if time pressure hits, the cut line falls
  there and the product is already better.
- Web 111 baseline stays green; adjust component tests only where cheap.
- Before/after captures per item into `docs/evidence/lot-q/`.
- Founder commits manually. Web deploys via Vercel on push — independent of the
  VPS; only the Q2 registry rename needs a VPS `bootstrap:core` at deploy.

## Out of scope

New logo sourcing · theming changes · any data-pipeline change beyond registry
display names · API changes beyond the additive Q4 payload extension · slugs.
