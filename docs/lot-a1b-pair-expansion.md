# Lot A1b — Mainnet Pair Expansion — Implementation Brief

Execution brief for Claude Code. Serves **T3-D2** (mainnet swaps + adoption KPIs): more *reliably
fillable* pairs → more usable product → more usage inside the KPI window. Companion docs:
`docs/security-invariants.md` (INV-4.3 whitelist is the enforcement point being extended) and
`docs/lot-a1-mainnet-swap.md` (the gating regime this builds on). Deadline context: internal
target Aug 15 — this lot is 1–2 days, config-heavy, code-light.

**Principle: pairs are vetted by on-chain reality, not product preference.** A pair is offered
only if the DIRECT (single-hop) order book actually fills it at launch-cap size within the
widget's 5% slippage tolerance — same methodology as the testnet vetting in
`config/testnetSwapPairs.ts`. A displayed pair that fails on-chain is worse than no pair.

## Step 1 — Run the liquidity probe (tool provided)

`tools/probe-mainnet-pairs.mjs` (no dependencies, Node 18+, network required — run locally):

```bash
node tools/probe-mainnet-pairs.mjs                # discovery via stellar.expert top-volume
node tools/probe-mainnet-pairs.mjs --top 30
node tools/probe-mainnet-pairs.mjs --candidates c.json   # if discovery parsing drifts
```

It probes XLM→asset AND asset→XLM at 10 XLM and at 100 XLM (the launch cap), direct routes only,
and reports rate degradation + each issuer's `home_domain`. If the stellar.expert discovery
response shape has drifted, fix the parse or fall back to `--candidates` with a hand-built list
(likely candidates to include: Circle USDC — already live — and EURC, AQUA, yXLM, yUSDC, major
anchor assets; resolve their issuers in step 2, never from memory).

## Step 2 — Issuer verification (human-grade, per asset — do not skip)

Liquidity alone NEVER whitelists an asset. For each PASS candidate:

1. `home_domain` (from the probe output) must match the issuing organization's real domain
   (e.g. `centre.io`/`circle.com` for Circle assets, `aqua.network` for AQUA, `ultrastellar.com`
   for y-assets). Cross-check on stellar.expert (verification/domain badges) and, for Circle
   assets, against Circle's official contract-addresses documentation.
2. Reject anything with no home_domain, a look-alike domain, or an unverifiable issuer — even
   with deep liquidity. Scam tokens with seeded books are exactly the attack INV-4.3 exists for.
3. Record the evidence (issuer, domain, source link) in the config comments (same style as the
   testnet vetting block).

## Step 3 — Selection

- Offer a pair only if **both directions are PASS** (the widget has an invert button; a one-way
  pair may be included deliberately with a `note` explaining the thin direction — prefer not to
  at launch).
- Target: the 3–6 strongest survivors. Quality over count; every entry is removable later by
  deleting config lines.
- Keep XLM as one leg of every vetted pair. Non-XLM↔non-XLM combos (e.g. USDC→EURC) remain
  selectable in the widget and resolve through the quote's clean "no liquidity" state if their
  direct book is empty — same behavior as testnet today. Do NOT probe/promise those combos.

## Step 4 — Code changes (small, then config-only forever after)

1. **Generalize the API whitelist** (`network-registry.ts`): replace the hardcoded XLM+USDC
   check with a `MAINNET_ASSET_WHITELIST: ReadonlyArray<{ code, issuer }>` (XLM/native stays
   implicitly allowed; the issuer-less legacy `'USDC'` special case stays, resolving to Circle).
   `isWhitelistedMainnetAsset` checks code AND issuer against the list. Adding a pair later =
   one array entry.
2. **Web config** (`config/mainnetSwapPairs.ts`): one `MAINNET_SWAP_PAIRS` entry per vetted
   pair, with the vetting evidence in comments (probe date, degradation numbers, issuer
   verification source). `MAINNET_SWAP_ASSETS` derives automatically.
3. **Both sides must agree**: every web pair's `(code, issuer)` must be in the API whitelist —
   add a comment cross-reference both ways. (A web pair missing from the whitelist would 400 at
   build time — caught by manual test, but don't rely on it.)
4. **Fold in the A1 review nit**: the cap error message says "XLM" but applies to any send
   asset — reword to name the actual send asset code (e.g. `cap of ${cap} ${from.code}`).

## Definition of done

- Probe report (the stdout table + JSON) saved to `docs/evidence/pair-vetting-YYYY-MM-DD.md` —
  this is claim evidence for T3-D2's security story.
- `pnpm -C apps/web test` (23) · `pnpm -C apps/web build` · `pnpm -C apps/api build` all green.
- Flags unset: byte-for-byte current behavior (testnet untouched, mainnet 403).
- With flags set locally: quote succeeds for every vetted pair on mainnet; a non-whitelisted
  asset still 400s; over-cap still 400s.

## Out of scope

Multi-hop routing (only reconsider if the probe shows the direct books can't support 3+ good
pairs) · non-XLM↔non-XLM pairs · changing the cap or slippage · Blend deposit (Lot A2).
