# Lot R2 — evidence: campaign 2 (per-family) testnet end-to-end

Run 2026-08-18, local API (`dist/main.js`, the real deployed code) against
**live Stellar testnet**, throwaway friendbot-funded keypairs (generated
locally, deleted after the run — the mainnet treasury key remains founder-side
per §9). Campaign-2 env: `FAUCET_MAX_CLAIMS=60`, `FAUCET_STARTS_AT=
2026-08-18T00:00:00Z`, `FAUCET_ENDS_AT=2026-08-20T23:59:59Z`, reward 5 XLM.
On-chain artifacts are permanent testnet evidence.

Unit/build baseline: `pnpm -C apps/api test` → **125/125 green** (incl. new
`campaign-not-started` + campaign-2 eligibility specs); `pnpm -C apps/api
build` and `pnpm -C apps/web build` (vue-tsc) green. `stellar_v5_faucet_campaign2.sql`
applied twice — second run all no-op notices (idempotence proven).

## Green path — per-family double claim on ONE wallet (the campaign-2 change)

Wallet A: `GAIZTTURCEA4S7GQVPYLPQW3HQ3QGE26TM45SQMNJWHEZKOQLKDEC3X7`

| Step | Result |
|---|---|
| Swap build `POST /v1/actions/sdex/swap` (2 XLM → USDC) | tx `82857a2e930459252cb7b96e4a49cb9d91aadc16470cd977163b7e5333cac2b1` — successful |
| Witness | `witnessed:true, kind:sdex-swap, notionalXlm:2, meetsMinNotional:true` |
| Eligibility after swap | `swap: eligible:true` · `blend-supply: no-qualifying-witness` (per-family statuses live) |
| **Claim `family:swap`** | `paid`, payout `fccda34d95f30477ce1143318659a342f58ea52e67b3cb1d0fccd3f99b58d0b8` |
| Blend deposit build `POST /v1/actions/blend/deposit` (2 XLM) | tx `eb94ab81ddc8f377c58bff276159828261c239612f259ec1d2a175a46bbd6160` — successful |
| Witness | `witnessed:true, kind:blend-deposit, notionalXlm:2, meetsMinNotional:true` |
| **Claim `family:blend-supply`** | `paid`, payout `41b6a2daf04e64021356aa6e42b6cdfd8d566e17dc918df379722d6920f4cd5d` |
| Both payouts verified on Horizon | successful, memo `dig-reward`, ONE native payment of exactly `5.0000000` each, destination = wallet A |

## Campaign-1 wallet rule (both directions)

Wallet B `GA32SCXMHMGWFCE4XWW2PYSCSPOMMBTVQQ67TMWH6SPFB7IXVNX75PWM` was set up
by direct SQL as a campaign-1-rewarded wallet: an OLD witness
(`ledger_closed_at 2026-08-17T12:00Z`, before campaign start) + its `paid`
campaign-1 claim row.

- **Without a new execution**: eligibility → both families
  `no-qualifying-witness`; claim → refused `no-qualifying-witness`. The
  campaign-1 action cannot be replayed (witness window filters on
  `ledger_closed_at >= FAUCET_STARTS_AT`).
- **With a NEW campaign-2 execution**: real swap tx
  `476372d07299ed4fd01b3c16c16d766401857cb70f0f53b9e5183e45b6da1dde` →
  witnessed → claim `family:swap` → **`paid`**, payout
  `20814ce96f22b6b03a291df045e6f7925c5eccf10041e5adfebdf1372959cf5a`.
  Campaign-1 history does not block campaign 2 — exactly the founder ruling.

## Red tests (live on testnet)

- **Second claim, same family**: `already-claimed` for BOTH families after
  their payouts (swap and blend-supply each re-claimed → refused).
- **DB backstop**: direct SQL duplicate insert for (wallet A, swap, campaign 2)
  → `23505 duplicate key … uq_faucet_claims_wallet_family_campaign`.
- **Velocity brake**: restart with `FAUCET_HOURLY_CLAIM_CAP=1` (one claim
  already inside the hour) → claim refused `temporarily-paused`.
- **Auto-halt on drained treasury**: restart with `FAUCET_REWARD_XLM=20000`
  (> ~10k spendable) → eligibility AND claim → `treasury-drained`.
- **Fail-closed activation (new, R2)**: `FAUCET_ENABLED=true` but
  `FAUCET_STARTS_AT` unset → `campaign.active:false`, all families + claim →
  `campaign-not-started`. A misconfigured activation promises and pays nothing.
- **Family validation**: `family:"blend-withdraw"` → 400
  `family must be one of: swap, blend-supply` (withdraws never qualify).

## Ops visibility

`/v1/ops/metrics` faucet block after the run: `campaign:2`, campaign-scoped
`claims { paid:3, remainingClaims:57 }` on the 60 budget, plus `allTime
{ paid:4 }` keeping the campaign-1 fixture visible; `treasurySpendableXlm`
decremented by the payouts.

## Hygiene

- Local DB rows from the run (wallets, witnesses, events, claims) deleted.
- Throwaway key file deleted. No secret was ever committed, logged by the API,
  or included in any payload.
- Go-live reminder (runbook): clear testnet `faucet_claims` rows on the VPS DB
  before the mainnet flip — uniqueness is per (wallet, family, campaign), not
  per network, unchanged from campaign 1.

## KPI integrity note (grant narrative)

Same framing as Lot R: witnessed actions gathered during campaign 2 are real
on-chain executions, but the adoption figures must state the incentive
(5 XLM per FIRST action per family, max 2 per wallet), controls (1 XLM min
notional, 60-claim budget, 10/h velocity cap, witness-gated, campaign window),
and that a wallet may appear in both campaigns only via distinct executions.
