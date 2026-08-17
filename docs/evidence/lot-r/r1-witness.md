# Lot R — R1 evidence: execution witness + action_events metadata

Built 2026-08-17. Scope per `docs/lot-r-swap-reward-faucet.md` (R1 only — no
faucet, no claims, no keys, nothing money-touching).

## What landed

- **`POST /v1/actions/witness { txHash, network?, userId? }`** — server-side
  verification, all against Horizon, never trusting the client:
  1. tx exists on the network's Horizon and is `successful`;
  2. tx source is a wallet known to us (`user_wallets`, chain=stellar; a
     client-supplied `userId` pins the owning row, otherwise active signer wins);
  3. tx contains a qualifying op whose **source is that wallet**: path payment
     (strict send/receive) or manage_buy_offer → `sdex-swap`; an
     invoke_host_function whose `asset_balance_changes` show a SAC transfer
     **wallet → vetted registry Blend pool** → `blend-deposit` (a withdraw
     transfers pool → wallet and never matches);
  4. build link: a recorded matching `action_events` build (`sdex-swap-build` /
     `blend-deposit-build`) for that wallet+network within **[-60 min, +5 min]**
     of the tx close time — builds alone prove nothing, and an executed tx with
     no recorded build did not come through Dig;
  5. min-notional: XLM-equivalent of the swapped/deposited amount at
     verification-time prices (≤ 24h-fresh `asset_prices`; native legs price
     directly, others cross through USD; unpriceable → `NULL`, honestly failing
     the rule). Threshold `FAUCET_MIN_NOTIONAL_XLM` (default 1), **stored on the
     row** with the outcome so the rule stays auditable.
- **`action_witnesses`** (`stellar_v1_action_witness.sql`): tx_hash PK →
  re-witnessing is a no-op; failed verifications are never stored. Row carries
  wallet, user_id, kind, op_summary (op + legs + prices used), notional,
  threshold, linked `action_event_id`, ledger close time, verified_at.
- **`action_events.metadata jsonb`** (additive column in
  `stellar_v1_ops_metrics.sql`), populated at build time for all five kinds
  (asset pair / asset, amounts, venue/pool slug). Historical rows stay NULL —
  no backfill invention.
- **Web**: after a successful swap or Blend-deposit submit (and the Blend
  pending-timeout state), the widget fire-and-forgets the hash with retries
  (~4s + 3×6s — the hash is reported at acceptance, Horizon sees success a few
  ledgers later). Never blocks or fails the action flow. Withdraws are not
  reported (not qualifying).
- Pure qualification rules isolated in `witness-verify.ts` with 10 unit specs
  (`witness-verify.spec.ts`) — api suite now 95 tests.

## Validation run (2026-08-17, local API on :3111, real mainnet data)

- `txHash` malformed → 400; unknown network → 400.
- Unknown hash on testnet → `{witnessed:false, reason:"tx-not-found"}`.
- Real mainnet path-payment tx (`9a989cd9…`, not our wallet) →
  `reason:"unknown-wallet"` — a real executed swap by a stranger is rejected.
- Same tx after staging its source as a known wallet + a matching
  `sdex-swap-build` event → `witnessed:true, kind:"sdex-swap"`, build linked
  (`action_event_id` set), source leg AUDD unpriceable → honest fallback to the
  dest USDC leg (`pricing.pricedLeg:"dest"`), notional 0.0099 XLM →
  `meetsMinNotional:false` (dust swap correctly below the 1 XLM rule).
- Re-witness of the same hash → `alreadyWitnessed:true`, no second row.
- Smoke rows deleted after the run.
- Schema files re-applied twice — idempotent, no errors.

## Boundaries / notes for R2 review

- Generic "Soroban swap invokes" are NOT recognized (no honest recognizer
  without a router registry; no Dig build path produces one, and the mandatory
  build-link would reject it anyway). `manage_buy_offer` is accepted per the
  brief but proves placement, not a fill — also unreachable today for the same
  build-link reason.
- The witness endpoint is deliberately NOT behind the mainnet action
  kill-switches: it builds nothing and moves nothing; gating it would make
  already-executed actions unwitnessable.
- **Deploy order matters**: apply `stellar_v1_ops_metrics.sql` (metadata
  column) + `stellar_v1_action_witness.sql` on the VPS BEFORE deploying this
  api build, or the fire-and-forget `action_events` inserts fail silently.
- **Ops follow-up (founder)**: add `/v1/actions/witness` to Lot S's strict
  nginx rate-limit zone alongside the future `/v1/faucet/*` endpoints.
- Standalone analytics win: once real witnesses accumulate, the analytics doc's
  funnel section can be regenerated as tracked → building → **executed**
  (settled volume), per the brief.
