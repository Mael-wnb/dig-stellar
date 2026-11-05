# Lot R — R4 evidence: testnet end-to-end (real chain, real payout)

Run 2026-08-17, local API against **live Stellar testnet**, throwaway
friendbot-funded keypairs (generated locally, deleted after the run — the
mainnet treasury key remains founder-side per §9). Server paths exercised are
the REAL deployed code: build endpoint → witness → eligibility → claim →
payout. On-chain artifacts are permanent testnet evidence.

## Green path (full loop)

| Step | Result |
|---|---|
| Treasury (testnet) | `GCVRVFUIZQVB4X3T2KWT5PVFCMES65A6BXR2OZWW6RYYZQKLAIDTGXKB` |
| User wallet | `GDF4EWLE4FSLHO2PVK6PGY27ZBHJA4KAQ3CQXMBF4URBWO2ABIIPEYFM` |
| Swap build via `POST /v1/actions/sdex/swap` | `change_trust:USDC, path_payment_strict_send:XLM→USDC` (2 XLM) |
| Swap tx (signed client-side, submitted) | `aed978afd83b38ad7c63678c41cd71210a9a3e57db08afcd136decc2584df472` — successful |
| `POST /v1/actions/witness` | `witnessed:true, kind:sdex-swap, notionalXlm:2, meetsMinNotional:true` |
| `GET /v1/faucet/eligibility?wallet=` | `eligible:true` (campaign active, 40 remaining) |
| `POST /v1/faucet/claim` | `claimed:true, status:paid` |
| **Payout tx** | `8cb9a86b075cdae50e87ce168cae4cfbef96b33eda1ad62fa8fd47d7a2354359` |
| Payout verified on Horizon | successful, memo `dig-reward`, ONE native payment of exactly `5.0000000`, source = treasury, destination = user |
| `/v1/ops/metrics` faucet block after | `paid:1, paid24h:1, remainingClaims:39`, treasury spendable decremented |
| Eligibility after payout | `already-claimed` + `claim:{status:paid, payoutTxHash}` (feeds the R3 paid state) |

## Red tests (live on testnet)

- **Double claim**: second `POST /v1/faucet/claim` for the paid wallet →
  `already-claimed`. (DB unique-index backstops additionally proven by direct
  SQL at R2.)
- **Unwitnessed wallet**: claim for a wallet with no witness →
  `no-qualifying-witness`.
- **Below-notional**: second wallet
  (`GB7BDKVVZ2BLMQ4YL5PDWZAB47QOOTRYVPRLIVFZEUWZYZAFJDAXCI6K`) executed a REAL
  0.5 XLM swap (tx `38d509b95d081f8a32936f672b99e9bc0f071fd6274415d7d66f26fb52899a5c`)
  → witnessed honestly (`notionalXlm:0.5, meetsMinNotional:false` — still
  counts in the KPI ledger) → claim refused `below-min-notional`.
- **Disabled flag**: proven at R2 (dark deploy smoke — campaign inactive,
  claim refused, treasury never queried).
- **Velocity brake / drained treasury**: unit-locked in
  `faucet-eligibility.spec.ts` only — a live run needs 10 claims / a
  near-empty treasury; noted honestly rather than simulated. The founder's
  mainnet go-live claim (R4 founder-side) is the remaining live proof point.

## Hygiene

- Local DB rows from the run (wallets, witnesses, events, claims) deleted.
- Throwaway key file deleted. No secret was ever committed, logged by the
  API, or included in any payload.
- Reminder for go-live (runbook): testnet `faucet_claims` rows on the VPS DB
  must be cleared before the mainnet flip (global uniqueness).

## KPI integrity note (grant narrative)

Witnessed actions gathered while the faucet campaign runs are real on-chain
executions by real wallets (the eligibility REQUIRES a settled qualifying tx),
but the adoption figures must state: gathered during an incentive campaign,
incentive = 5 XLM post-action, controls = one claim per wallet/user, 1 XLM min
notional, 40-claim budget, 10/h velocity cap. Honest framing beats a surprised
reviewer.
