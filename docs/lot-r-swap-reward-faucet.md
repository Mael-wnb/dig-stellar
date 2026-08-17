# Lot R — Action Reward Faucet (claim 5 XLM after a verified swap OR Blend deposit)

Execution brief for Claude Code. Founder-scoped 2026-08-16, amended 2026-08-17: a
user who has executed a qualifying action through Dig — a **swap OR a Blend
deposit** (both count toward the T3-D2 "50+ wallets / 200+ txs" KPI, which covers
swaps AND vault/lending interactions) — can claim **5 XLM** (mainnet) once.
Purpose: adoption push for the KPI window, with the offer VISIBLE UPFRONT (the
incentive must be seen before the action, not discovered after). **THIS IS A
MONEY PATH — A2/A3 review bar** — and it is the FIRST time a funded secret key
lives server-side. Depends on **Lot S** (deployed 2026-08-17). Evidence:
`docs/evidence/lot-r/`.

## Security model (read before scoping)

- **The treasury is DIG's own money, never the user's.** A dedicated hot wallet
  (fresh keypair, funded manually with **200 XLM** — the hard exposure cap),
  its secret in VPS env only (`FAUCET_SECRET_KEY`), used by an isolated module
  that imports NOTHING from the user action paths and vice versa. The
  non-custodial invariant for USER funds is untouched — state this in
  `security-invariants.md` with a new section.
- Worst case if everything fails: the hot wallet drains. 200 XLM ≈ $31 —
  bounded, acceptable, and the ONLY reason this lot is beta-shippable. Never
  fund it beyond the cap; refills are manual and deliberate.
- Kill-switch: `FAUCET_ENABLED` (default OFF — deploy dark, founder flips it).

## R1 — Execution witness (E3b, standalone value) + build metadata

The eligibility primitive: proof a wallet EXECUTED a qualifying action through
Dig (builds alone prove nothing — `action_events` is build-side).

- `POST /v1/actions/witness { txHash }`: the web submits the hash after a
  successful submit (it already has it for the explorer link) — for BOTH swap
  and Blend deposit flows.
- Server verification, all on Horizon (never trust the client): tx exists and
  `successful`; source account = a wallet known to us; the tx contains a
  qualifying op whose source matches — swap-shaped (pathPayment /
  manageBuyOffer / Soroban swap invoke) OR a Blend submit invoke against a
  registry pool; tx created within a sane window of a recorded matching build
  for that wallet (link to `action_events`). Store in `action_witnesses`
  (tx_hash PK — idempotent, re-witnessing is a no-op; wallet, user_id, kind,
  op summary, ledger close time, verified_at).
- Min notional for faucet eligibility: the swapped/deposited amount ≥ **1 XLM
  equivalent** at verification-time prices (raises farming cost; stored on the
  witness row so the rule is auditable).
- **Also in R1 (closes the analytics gap found 2026-08-17):** add a
  `metadata jsonb` to `action_events`, populated at build time — asset pair /
  asset, amounts, venue/pool slug, network. Additive migration; historical
  rows stay NULL (honest — no backfill invention).
- Standalone win: witnesses turn the build-side analytics into settled-volume
  analytics — note it in the evidence, and regenerate the analytics doc's
  funnel section (tracked → building → executed) once data exists.

## R2 — Claims backend

- `faucet_claims` table: wallet_id, user_id, witness_tx_hash, status
  (pending|paid|failed), payout_tx_hash, amounts, timestamps. UNIQUE(wallet_id)
  AND UNIQUE(user_id) — one claim per wallet AND per user, ever, DB-enforced.
- `GET /v1/faucet/eligibility?wallet=`: eligible iff FAUCET_ENABLED && a
  verified qualifying witness (swap OR Blend deposit, ≥ min notional) exists
  && no prior claim (either key) && treasury balance ≥ 5 XLM. Response says
  WHICH condition fails (honest UX). Also exposes campaign state for the promo
  surface: `{ active, remainingClaims }` (paid count vs the 40-claim budget).
- `POST /v1/faucet/claim`: re-checks everything server-side inside a
  transaction, inserts `pending`, then pays: a single 5 XLM payment from the
  hot wallet to the claiming wallet (memo `dig-reward`), submits, records
  `paid` + payout hash (or `failed` + reason; a failed claim row blocks retries
  until founder review — never auto-retry payments).
- Concurrency: payouts run strictly serially (one in-process queue; the hot
  wallet's sequence number makes parallel submits fail anyway — design for it,
  don't discover it).
- Velocity brake: max **10 claims paid per rolling hour** — beyond it,
  eligibility returns "temporarily paused" (honest copy). A full drain
  therefore takes ≥ 4 hours of sustained abuse, which the founder can see.
- Rate limits: both endpoints in Lot S's strict nginx zone.

## R3 — Web (visible incentive + post-action claim)

Founder amendment 2026-08-17: the offer must be SEEN BEFORE the action — a
reward nobody knows about incentivizes nothing.

- **Promo surface (upfront)**: a compact campaign card/banner on the dashboard
  AND a one-line note inside the swap widget + Blend deposit card: "Your first
  swap or Blend supply (≥ 1 XLM) earns 5 XLM — first 40 claims." Rendered ONLY
  when the campaign is live (`active && remainingClaims > 0` from the
  eligibility endpoint) — it disappears by itself when the budget is spent or
  the flag is off, never a stale promise. Show `remainingClaims` (honest
  scarcity beats fake urgency).
- **Post-action claim**: after a successful swap or deposit submit + witness
  POST, if eligible — banner on the success state: "Your action qualifies —
  claim 5 XLM". One click → claim → paid state shows the payout tx + explorer
  link.
- Ineligible states render the honest reason (already claimed / faucet paused /
  amount below 1 XLM / campaign exhausted) — never a dead button.
- The promo and the claim never block or delay the action flows themselves.

## R4 — Ops & funding (founder + runbook)

- Founder: generate the keypair LOCALLY (never in chat, never committed), fund
  with exactly 200 XLM from treasury, set `FAUCET_SECRET_KEY` + thresholds in
  the VPS env. Runbook section: funding, checking balance, pausing
  (`FAUCET_ENABLED=false` + restart), draining back to treasury (account merge
  or payment), what a `failed` claim means and how to resolve it.
- Observability: treasury balance + claims count (24h) into `/health` ops
  block (or `/v1/ops/metrics`) so the existing monitoring sees a drain — and
  auto-disable payouts if balance < 5 XLM (obvious but explicit).
- Evidence: full flow on TESTNET first (testnet hot wallet, real testnet swap
  → witness → claim → payout hash), then ONE real mainnet claim by the founder
  as the go-live proof. Red tests: double claim (both unique keys), unwitnessed
  wallet, below-notional swap, disabled flag, drained balance, velocity brake.

## KPI integrity note (for the grant narrative)

Faucet-driven wallets ARE real users (they must execute a real mainnet swap
first — that's the eligibility), but say so explicitly in the KPI evidence:
adoption figures gathered during an incentive campaign, incentive = 5 XLM
post-swap, controls as above. Honest framing beats a surprised reviewer.

## Sequencing

R1 (witness — standalone, lowest risk) → STOP → R2 (claims + payout, the real
review gate) → STOP, review line by line → R3 (banner) → R4 (testnet E2E, then
founder funds mainnet + one real claim). Founder commits at every step.

## Out of scope

Other reward conditions (deposits, referrals) · recurring/repeat claims ·
non-XLM rewards · auth changes · anything touching user-key flows or the
action builders · automated treasury refill.
