# Lot A5 — Multi-pool Blend actions: evidence

Brief: `docs/lot-a5-blend-multipool.md`. MONEY PATH. Started 2026-08-14.

---

## §1 Pool inventory + verification (done BEFORE any code)

### Indexed perimeter (source of truth for what the product claims to cover)

`entities` join `venues` where `venue.slug = 'blend'`, `entity_type = 'lending_pool'`,
`is_active = true` — 4 pools, no others:

| slug | name | contract id | TVL (indexed) |
|---|---|---|---|
| `blend-fixed-pool` | Fixed | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | ≈ $182.2M |
| `blend-yieldblox-pool` | YieldBlox | `CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS` | ≈ $3.14M |
| `blend-orbit-pool` | Orbit | `CAE7QVOMBLZ53CDRGK3UNRRHG5EZ5NQA7HHTFASEMYBWHG6MDFZTYHXC` | ≈ $286k |
| `blend-etherfuse-pool` | Etherfuse | `CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI` | ≈ $163k |

No Blend `lending_pool` entity is inactive or otherwise excluded. The **Forex** pool the brief
mentions is **not in `entities` at all** (excluded from indexing for a frozen oracle), so it is
out of scope here — nothing to exclude at this layer.

### Verification result

| pool | factory `is_pool` | backstop reward zone | wasm hash | V2 load | on-chain name | XLM | USDC | verdict |
|---|---|---|---|---|---|---|---|---|
| Fixed | ✅ true | ✅ yes | `a41fc53d…` | ✅ `PoolV2.load` OK | `Fixed` | ✅ enabled | ✅ enabled | **VERIFIED** |
| YieldBlox | ✅ true | ✅ yes | `a41fc53d…` | ✅ `PoolV2.load` OK | `YieldBlox` | ✅ enabled | ✅ enabled | **VERIFIED** |
| Orbit | ✅ true | ✅ yes | `a41fc53d…` | ✅ `PoolV2.load` OK | `Orbit` | ✅ enabled | ❌ **absent** | **VERIFIED — XLM only** |
| Etherfuse | ✅ true | ✅ yes | `a41fc53d…` | ✅ `PoolV2.load` OK | `Etherfuse` | ✅ enabled | ✅ enabled | **VERIFIED** |

All four pass. Nothing is excluded for failed verification.

### How they were verified (and a deliberate substitution)

The brief says "cross-verify the contract id against blend.capital (the pool's own page)".
`mainnet.blend.capital` is a client-rendered SPA and `api.blend.capital` does not resolve, so a
fetch returns an empty shell — **a screenshot of it would have been verification theatre.** I
verified against Blend's own authoritative sources instead, which is strictly stronger:

1. **Official Blend V2 Pool Factory** — address `CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU`
   taken from Blend's own docs (docs.blend.capital mainnet deployments). Called `is_pool(<id>)`
   on-chain for each of the 4 ids → **all `true`**. The factory itself attests it deployed them.
2. **Backstop reward zone** — backstop `CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7`
   (same docs page). All 4 pools are in the reward zone (6 pools total) — i.e. Blend
   *governance* recognises them.
3. **Identical wasm hash** — stellar.expert reports the same code hash `a41fc53d6753b6c0…` for
   all four, i.e. byte-identical contract code to the Fixed pool already vetted in A2 and
   already live with real funds.
4. **Name binding read from the contract**, not from a page: `PoolV2.load(...).metadata.name`
   returns `Fixed` / `YieldBlox` / `Orbit` / `Etherfuse`, matching `entities.name` exactly. This
   is what actually binds an id to a display name — a webpage could not do it better.
5. **V2 confirmation** — `PoolV2.load` succeeding IS the V2 confirmation (the builder uses
   `PoolContractV2`); all four load.

Vanity-address corroboration: the Orbit pool's deployer is
`GBIWJGAOSFC4KUPHXM573TKTWHMI7VW7D4GCHYZYH243Q6HVBV7ORBIT` (ends `ORBIT`).

### Reserve read — the finding that changes the design

Read live via `PoolV2.load` per the brief ("do not assume both"). **Orbit has no USDC reserve.**

```
Fixed      XLM: enabled=true decimals=7    USDC: enabled=true decimals=7
YieldBlox  XLM: enabled=true decimals=7    USDC: enabled=true decimals=7
Orbit      XLM: enabled=true decimals=7    USDC: ABSENT
Etherfuse  XLM: enabled=true decimals=7    USDC: enabled=true decimals=7
```

The DB *does* carry a USDC `reserve_snapshots` row for Orbit — but its `snapshot_at` is
**2026-04-01**, stale, while Orbit's live rows are from 2026-08-13. Had the registry been built
from the DB (the obvious shortcut) Orbit would have been given a USDC asset it does not have,
and every Orbit USDC deposit would have failed at simulation on the money path. This is exactly
the failure the brief's "read via the SDK" instruction exists to prevent.

All reserves are `decimals = 7` and `enabled = true`; the SACs are the network-level per-asset
constants already in the registry (XLM `CAS3J7GY…`, USDC `CCW67TSZ…`) — unchanged, no new SAC
derivation needed, as the brief predicted.

### Registry consequence

| slug | label | assets |
|---|---|---|
| `blend-fixed-pool` | Fixed | XLM, USDC |
| `blend-yieldblox-pool` | YieldBlox | XLM, USDC |
| `blend-orbit-pool` | Orbit | **XLM only** |
| `blend-etherfuse-pool` | Etherfuse | XLM, USDC |

Default pool (backward compatibility when no `pool` is specified): `blend-fixed-pool`.

Verification commands are reproducible from `apps/indexer` with `pnpm exec tsx` (probe scripts
loaded `PoolV2` / `PoolFactoryContractV2` / `Backstop` against mainnet RPC).

---

## §2 API — pool-aware actions

`network-registry.ts`: `MAINNET_BLEND_POOLS` (4 entries above) + `TESTNET_BLEND_POOLS` (1),
`resolveBlendPool(network, poolSlug?)` replacing `getBlendConfig(network)`, plus
`assertPoolSupportsAsset(cfg, asset)`.

- absent slug → the network default (`blend-fixed-pool`), so **every pre-A5 client keeps
  working unchanged**;
- unknown slug → **400**, never a fallback;
- asset not in that pool's reserve set → **400** naming the pool;
- SACs stay per-ASSET network constants — one USDC SAC and one XLM SAC shared by every pool
  on a network (asserted by a test).

`actions.service.ts`: all three Blend methods take `poolSlug`. The pool-contract cache was keyed
by **network** — which would have handed pool A's contract to a pool B request — and is now keyed
by **pool id**. `getBlendPosition` echoes `poolSlug` / `poolLabel` / `assets` so the UI can assert
it got the pool it asked for.

`actions.controller.ts`: `blend/deposit`, `blend/withdraw`, `blend/position` accept an optional
`pool`. Cap unchanged on deposit; still no cap on withdraw (INV-2.15). The kill-switch is checked
**before** pool resolution, so with the flag off every pool 403s.

## §3 Web — the client registry is the security anchor

`config/blendPools.ts` mirrors the API registry entry-for-entry and gains `slug`. `blendPoolFor`
now takes an optional slug and returns **`null`** for an unknown one.

`BlendDepositCard` takes a `poolSlug` prop:
- the header names the pool it will act on (`poolLabel` + short contract id), always equal to the
  modal title;
- the asset selector lists only that pool's assets, and a watcher moves the selection off an
  asset the pool lacks (arriving at Orbit with USDC selected falls back to XLM);
- **unknown slug → no form at all**, just an honest note + blend.capital link;
- deposit, withdraw AND the position read all send `pool: <slug resolved from the CLIENT
  registry>` and validate against `blendPools[slug].poolId`.

`ActionContext` gains an explicit optional `poolSlug`, kept separate from the display `slug`
(which is also used for non-pool CTA ids like `'blend'` / `'sdex-swap'` that must not be looked up
in the pool registry). `PoolDetailView` and `GetStartedCard` pass the clicked pool; the dashboard's
generic Deposit CTA passes nothing and therefore still gets the default pool.

## §4 Cross-pool red tests — the acceptance gate

Added to `validateDepositXdr.spec.ts`, bound to the **real** registry (not fixtures), so a bad
registry edit fails the suite:

- deposit built for pool A vs intent pinning pool B — **every ordered pair** of the 4 real pools;
- the same for withdraw;
- cross-TYPE re-proven **per pool** (withdraw XDR vs deposit intent, and vice versa);
- registry properties: known slug resolves, **unknown slug → null** (never a fallback), default is
  Fixed, slugs/ids unique, Orbit offers XLM only, one SAC per asset across all pools.

**Mutation-tested** — the point of a red test is that it can go red. With the pool-pinning check
removed from `validateSubmitXdr`, **28 tests fail**; restored, 111/111 pass. The gate is real.

```
pnpm -C apps/web test     111 passed (111)   [was 49 before A5]
```

## §5 Locale bug

`toLocaleString(undefined, …)` in the balance and "Supplied to this pool" lines rendered
`16,0000019 XLM` under a French browser locale. Replaced with the H7 pattern:
`formatTokenAmountCompact` for display + `formatTokenAmountExact` on the hover title. Locale-fixed
(`en-US` grouping) and honest — the exact stored amount is one hover away.

## §6 Validation

Builds/tests:

```
pnpm -C apps/api build     green
pnpm -C apps/api test      42/42 green
pnpm -C apps/web build     green (vue-tsc)
pnpm -C apps/web test      111/111 green (incl. the cross-pool red tests)
```

Mainnet curl matrix (`ACTIONS_MAINNET_BLEND_ENABLED=true`, port 3011):

| request | result |
|---|---|
| deposit, `pool: blend-does-not-exist` | **400** `unknown Blend pool "blend-does-not-exist" on mainnet (known: …)` |
| deposit, Orbit + USDC | **400** `Orbit does not have a USDC reserve (supported: XLM)` |
| withdraw, Orbit + USDC | **400** same |
| position, `blend-yieldblox-pool` | 200 `poolSlug=blend-yieldblox-pool assets=[XLM, USDC]` |
| position, `blend-orbit-pool` | 200 `poolSlug=blend-orbit-pool assets=[XLM]` |
| position, no `pool` key | 200 `poolSlug=blend-fixed-pool` (default preserved) |

Kill-switch OFF: **403 for all 4 pools × 3 endpoints (12/12)** — the switch is evaluated before
pool resolution, so an unknown slug on a disabled network still 403s rather than leaking a 400
that enumerates the registry.

Testnet unchanged: `blend/position` with no `pool` resolves `CCEBVDYM…HPQ44HGF`
(`blend-testnet-pool`), byte-for-byte the pre-A5 pool.

### Still open (needs Maël)

- ONE small real supply + withdraw on a **non-Fixed** pool (YieldBlox, a few XLM) from the
  dashboard, so the demo shows two different pools working. Hashes to be recorded here.
- Testnet supply + withdraw re-verified end-to-end (path unchanged, but unproven since A5).

---

## Verification task — do the `reserve_snapshots` readers count dead reserves?

Flagged by the §1 finding (Fixed still has CETES/TESOURO/USTRY rows from 2026-04-01). Checked
whether each reader takes the latest row **per asset** (which keeps counting removed reserves) or
the latest snapshot **batch** per entity.

| reader | pattern | verdict |
|---|---|---|
| API pool-detail reserves breakdown (`stellar.service.ts` ~L425) | `rs.snapshot_at = (select max(...) where entity_id = rs.entity_id)` | ✅ **batch — correct** |
| API pool TVL history (`stellar.service.ts` ~L799) | `group by rs.snapshot_at` | ✅ **batch — correct** |
| **Blend pool metrics / TVL** (`indexer/lib/protocols/blend/compute-pool-metrics.ts` L54) | `distinct on (rs.asset_id) … order by rs.asset_id, rs.snapshot_at desc` | ❌ **latest-per-asset — counts dead reserves** |
| Soroswap pool metrics (`ingest/66-soroswap-pool-metrics-v1.ts`) | `distinct on (rs.asset_id)` | ❌ same defect |
| Aquarius pool metrics (`ingest/69-aquarius-persist-pool-metrics.ts`) | `distinct on (rs.asset_id)` | ❌ same defect |

### Does Blend TVL currently include a removed reserve? YES.

Computed both ways from the live dev DB (b_supply_scaled × latest price):

| pool | TVL as computed today | TVL, latest batch only | overcount | dead reserves counted |
|---|---|---|---|---|
| Fixed | $182,246,549 | $182,071,583 | **+$174,966** (+0.10%) | CETES, TESOURO, USTRY |
| Orbit | $285,976 | $190,769 | **+$95,207 (+49.9%)** | TESOURO, USDC |
| YieldBlox | $3,137,451 | $3,137,451 | — | none |
| Etherfuse | $163,465 | $163,465 | — | none |
| **Blend total** | **$185,833,441** | **$185,563,268** | **+$270,173** | |

So the dashboard's "Blend $185.8M" is ≈$270k too high, and **Orbit's TVL is inflated by ~50%**.

There is also an internal inconsistency on one screen: the pool-detail **reserves table** is
batch-filtered and correctly shows Fixed's 3 live reserves, while the **TVL headline** beside it
was computed over 6 assets.

### Not fixed in this lot — deliberately

It looks like a one-line filter, but it is **not clearly safe**, so per the instruction it is
reported rather than fixed:

1. The same pattern is in **three** writers (Blend, Soroswap, Aquarius). Fixing only Blend makes
   venues inconsistent with each other, and the frozen-reserves hotfix (Lot E) shows these paths
   need to be changed together and re-validated against venue UIs.
2. It **moves headline numbers** — total TVL, protocol metrics, the network-TVL chart and the
   dashboard hero. That deserves its own before/after validation against blend.capital, not a
   side effect of a money-path lot.
3. A batch filter assumes every refresh writes **all** of a pool's reserves under one
   `snapshot_at`. If a refresh can partially fail mid-pool, batch filtering would *undercount*
   instead. That needs checking before switching.

Suggested scope for its own lot: switch all three writers to latest-batch, verify each venue's TVL
against its own UI before/after, and decide whether to prune superseded `reserve_snapshots` rows or
keep them for history. **Lot A5 changed none of these readers** — the registry it introduces
deliberately reads pool reserves live from the SDK, so A5's own money path is unaffected by this
defect.
