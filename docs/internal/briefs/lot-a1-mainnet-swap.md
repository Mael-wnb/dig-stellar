# Lot A1 — Mainnet SDEX Swap Enablement (T3-D2) — Implementation Brief

Execution brief for Claude Code. Serves **T3-D2 — Non-Custodial Mainnet Actions** (SCF criteria:
mainnet swaps from the dashboard, strict non-custodial security, clean execution feedback; KPIs
50+ wallets / 200+ txs). Companion contract: `docs/security-invariants.md` (section 4 = this lot).
Written 2026-08-01 against the current `main`; re-verify file states before editing.

**Principle: gate replacement, not gate removal.** With every flag unset (the default), behavior
must be byte-for-byte today's: testnet-only widget, API rejecting mainnet. The Blend deposit stays
testnet-only in this lot regardless of flags (Lot A2).

## Scope

`apps/api/src/modules/actions/` + `apps/web` swap surfaces. No indexer changes. No new tables.

### 1. API — network registry (new file `network-registry.ts`)

- `type ActionNetwork = 'testnet' | 'mainnet'`.
- Per-network config: rpcUrl, horizonUrl (`https://horizon.stellar.org`), networkPassphrase
  (`Networks.PUBLIC`), label. Testnet values re-exported from `testnet-registry.ts` unchanged.
- Env: `ACTIONS_MAINNET_ENABLED` ("true" = on; kill-switch, INV-4.1),
  `ACTIONS_MAINNET_MAX_SEND_XLM` (default 100, INV-4.2),
  `ACTIONS_MAINNET_RPC_URL` (default `https://mainnet.sorobanrpc.com`).
- **Mainnet asset whitelist (INV-4.3 — the critical piece):** the controller accepts arbitrary
  `{code, issuer}`; on mainnet the server must reject anything outside its own whitelist. Launch
  whitelist: native XLM + Circle USDC. Circle's canonical mainnet USDC issuer is
  `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` — **re-verify against Circle's
  official docs before committing** (this brief was written offline; treat the value as unverified).
- Legacy issuer-less `'USDC'` string resolves per network to that network's vetted issuer.

### 2. API — `actions.service.ts`

- `quoteSdexSwap` / `buildSdexSwap` take `network: ActionNetwork`; per-network `Horizon.Server` /
  `rpc.Server` instances (lazy map). Constructor's testnet servers stay dedicated to the Blend
  deposit (untouched).
- `resolveAsset(ref, network)` — native → `Asset.native()`; issuer-less `'USDC'` → the network's
  vetted issuer; explicit `{code, issuer}` passes through (whitelist enforcement lives in the
  controller/service boundary for mainnet).
- `hasClassicTrustline` takes the network's Horizon server (it currently uses `this.horizonServer`;
  both swap and Blend call sites updated — Blend keeps testnet).
- `TransactionBuilder` networkPassphrase from config; error-message labels say the actual network.

### 3. API — `actions.controller.ts`

- `resolveSwapNetwork(body.network)`: absent/'testnet' → testnet; 'mainnet' → 403
  (`ForbiddenException`) unless `ACTIONS_MAINNET_ENABLED === 'true'`; anything else → 400.
  Applied to `sdex/quote` + `sdex/swap`. `blend/deposit` keeps its hard testnet-only 400.
- Mainnet only: reject non-whitelisted assets (400, name the asset) and enforce the send-amount
  cap (400 with the cap in the message). Testnet behavior unchanged (no cap, client-vetted assets).

### 4. Web — config + widget

- New `config/mainnetSwapPairs.ts` mirroring the testnet shape: single vetted pair XLM ↔ USDC
  (Circle mainnet issuer — same re-verify caveat; it must equal the API whitelist). Keep
  `testnetSwapPairs.ts` untouched.
- `SdexSwapWidget.vue`:
  - `MAINNET_SWAP_ENABLED = import.meta.env.VITE_ACTIONS_MAINNET_ENABLED === 'true'`;
    `mainnetBlocked = isMainnet && !MAINNET_SWAP_ENABLED`. Replace every hard `isMainnet` block
    (canSwap, quote watch, onSwap guard, template notice) with `mainnetBlocked`. Flag off →
    today's UI exactly.
  - Asset list follows the network (testnet list vs mainnet list); reset selections on network
    switch.
  - `loadBalances` uses the network's Horizon (currently hardcoded testnet Horizon + early-returns
    unless testnet).
  - When mainnet is live: warning banner ("Mainnet — this swap moves real funds. A per-transaction
    cap applies during the launch period."), stellar.expert link uses `public` vs `testnet`
    (INV-6.1), quote "no liquidity" copy names the actual network.
  - The validation gate (`validateSwapXdr` + `allowTrustlineFor`) needs **no change** — intent
    already derives from the per-network config, and `RECOGNIZED_NETWORKS` already includes PUBLIC.

### 5. Docs (same change set)

- `docs/security-invariants.md`: flip section-4 items 🔲 → ✅ as they land.
- `docs/runbooks.md`: add a "Mainnet actions (T3-D2) — gating regime" section: the four env vars
  (api: kill-switch / cap / rpc override; web: VITE flag), and the ungating procedure — (1) full
  security-invariants checklist, recorded with date + commit SHA; (2) re-verify the Circle USDC
  mainnet issuer on BOTH sides (api whitelist + web config, must match); (3) set API flag on VPS,
  restart PM2; (4) curl validation: mainnet quote OK, over-cap swap → 400, non-whitelisted asset →
  400, flag off → 403; (5) set Vercel flag, redeploy; (6) small real swap from the dashboard, keep
  the tx hash as T3-D2 evidence. Rollback = unset the API flag + restart.

## Definition of done

- `pnpm -C apps/web test` green (21 tests incl. the fee-cap case) · `pnpm -C apps/web build` ·
  `pnpm -C apps/api build`.
- Flags unset: testnet E2E swap unchanged; `curl` swap with `"network":"mainnet"` → **403**.
- Flags set (local): mainnet quote returns real prices; over-cap → 400; non-whitelisted asset →
  400; testnet path still works.
- No real mainnet swap in this lot — first real capped swap happens via the runbook ungating
  procedure (that tx hash is the T3-D2 evidence starter).

## Out of scope

Blend deposit on mainnet (Lot A2) · fee sponsorship · multi-hop paths · configurable slippage ·
KPI instrumentation (Lot D).
