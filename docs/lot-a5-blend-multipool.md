# Lot A5 — Multi-pool Blend actions (supply + withdraw on every indexed pool)

Execution brief for Claude Code. Fixes the label/action mismatch found 2026-08-14 (the modal
titles the CLICKED pool but the card is hardcoded to the single registry pool) by doing the
real thing: **supply and withdraw work on every Blend pool we index**, not just Fixed. Driver
is product completeness for the demo walkthrough — a product that lists 4 pools and can only
act on 1 reads as broken. Written 2026-08-14. MONEY PATH — same review bar as A2/A3.
Pattern: `docs/lot-a2-blend-mainnet.md` + `docs/lot-a3-blend-withdraw.md`.
Contract: `docs/security-invariants.md`.

## What makes this bounded (read before scoping)

- **SACs are per-ASSET, not per-pool.** The USDC SAC (`CCW67TSZ…`) and native SAC
  (`CAS3J7GY…`) are network-level constants shared by every pool. So per-pool config is
  just: pool contract id + display name + which assets that pool actually has reserves for.
  No new cryptographic SAC derivation unless a new ASSET enters scope (see next point).
- **Asset scope stays XLM | USDC in this lot.** A pool that also has reserves we don't
  support (EURC, yXLM, …) is still fully usable for the assets we do support; the others are
  listed as unavailable with honest copy ("in-app actions cover XLM and USDC — manage <asset>
  on blend.capital"). Adding an asset means verifying its SAC + decimals + trustline path,
  which is its own change, not this one.
- The kill-switch, the cap regime, the gates and the 2-step trustline flow all carry over
  unchanged — this lot generalizes a pool constant into a pool registry.

## 1. Pool inventory + verification (do this FIRST, never from memory)

Enumerate the indexed perimeter from the DB (`entities` join `venues` where venue slug
`blend`, `entity_type = 'lending_pool'`, `is_active`) — that is the source of truth for what
the product claims to cover. For EACH pool:

- record slug, display name, contract id;
- **cross-verify the contract id against blend.capital** (the pool's own page) — the A2 rule:
  an id that cannot be verified is EXCLUDED, not guessed;
- confirm it is a **V2** pool (the builder uses `PoolContractV2` / `PoolV2`);
- record which of XLM / USDC it actually has reserves for (read the pool's reserves via the
  SDK — do not assume both);
- note any pool deliberately excluded and why (e.g. the Forex pool was excluded from indexing
  for a frozen oracle — if it is not in `entities`, it is out of scope here too).

Write the inventory table into the evidence doc BEFORE writing code.

## 2. API — pool-aware actions

- `network-registry.ts`: replace the single `MAINNET_BLEND_POOL` constant with a per-network
  **pool registry** (slug → { poolId, label, assets: ('XLM'|'USDC')[] }), plus a default
  (Fixed) for backward compatibility when no pool is specified. Testnet keeps its single pool.
- `getBlendConfig(network)` → `resolveBlendPool(network, poolSlug?)`: unknown slug → **400**
  (never silently fall back to another pool — falling back is exactly the bug we're fixing).
  The mainnet kill-switch check is unchanged and applies to all pools.
- `buildBlendDeposit` / `buildBlendWithdraw` / `getBlendPosition` take the resolved pool.
  An asset not in that pool's asset list → **400** (with the pool named in the message).
- Controller: `blend/deposit`, `blend/withdraw`, `blend/position` accept an optional `pool`
  (slug). Absent = the default pool, so existing clients keep working. Cap unchanged on
  deposit, still no cap on withdraw (INV-2.15).
- `getBlendPosition` returns positions keyed by asset for THAT pool (+ the pool's slug/label
  in the payload so the UI can assert it got what it asked for).

## 3. Web — client registry is the security anchor

- `config/blendPools.ts`: the SAME per-pool registry, client-side (slug → poolId + label +
  assets). This — never the API response — is what the gates pin. Keep the two registries
  textually adjacent in review: a divergence between them must be obvious.
- `BlendDepositCard` takes a `poolSlug` prop from `ActionModal`'s context:
  - the card's header names the pool **it will act on**, always equal to the modal title;
  - the asset selector lists only that pool's supported assets;
  - if the slug is absent from the client registry → do NOT render the form; honest note +
    blend.capital link (this is the safe fallback that also covers a future pool the
    indexer adds before the registry does);
  - deposit AND withdraw both build with `pool: poolSlug` and validate against
    `blendPools[poolSlug].poolId`.
- `ActionModal` passes the clicked pool's slug through for `kind === 'lending'`.
- Position read is per-pool (the withdraw pane shows the position in THAT pool).

## 4. The new critical red tests (cross-pool)

Mirroring A3's cross-type pair, add to `validateDepositXdr.spec.ts`:

- a deposit XDR built for pool A **FAILS** the gate when the intent pins pool B
  (`pool contract mismatch`) — for at least two real pool ids from the registry;
- same for withdraw;
- a withdraw XDR for pool A fails a deposit intent for pool A (cross-type still holds);
- an asset not in the pool's list is rejected client-side before any build.

These are what prove the generalization did not weaken the gate: pool pinning must be as
strict per-pool as it was when there was only one.

## 5. Also in this lot (small, related)

- Locale bug: the "Supplied to this pool" line uses `toLocaleString(undefined, …)` and renders
  `16,0000019 XLM` under a French browser locale — use `'en-US'` (or
  `formatTokenAmountCompact` + exact on hover, like the position chips).

## 6. Validation & evidence

- Pool inventory table (§1) with the blend.capital verification per pool.
- `pnpm -C apps/web test` green incl. the new cross-pool red tests; both builds green.
- Testnet: supply + withdraw re-verified on the testnet pool (unchanged path).
- Mainnet curls per pool: unknown slug → 400; asset not in pool → 400; position read returns
  that pool's reserves; flag off → 403 for every pool.
- **Then Maël does ONE small real supply on a NON-Fixed pool** (YieldBlox, a few XLM) from the
  dashboard + a withdraw, so the demo shows two different pools working. Hashes into
  `docs/evidence/lot-a5-blend-multipool.md`.
- Docs: security-invariants (pool-pinning invariant generalized — note that the registry now
  holds N pools and the gate pins the REQUESTED one), runbooks (per-pool ungating checklist),
  status-board + current-state flagged.

## Out of scope

Borrow / repay (A4, after) · assets beyond XLM|USDC · pools not in the indexed perimeter ·
new flags · any change to the cap/kill-switch regime.
