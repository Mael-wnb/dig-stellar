# Lot R — Swap Reward Faucet (claim 5 XLM after a verified swap)

Execution brief for Claude Code. Founder-scoped 2026-08-16: a user who has executed
a swap through Dig can claim **5 XLM** (mainnet) once. Purpose: adoption push for
the T3-D2 KPI window. **THIS IS A MONEY PATH — A2/A3 review bar** — and it is the
FIRST time a funded secret key lives server-side. Depends on **Lot S** (rate
limiting) being deployed first. Evidence: `docs/evidence/lot-r/`.

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

## R1 — Execution witness (E3b, standalone value)

The eligibility primitive: proof a wallet EXECUTED a swap through Dig (builds
alone prove nothing — `action_events` is build-side).

- `POST /v1/actions/witness { txHash }`: the web submits the hash after a
  successful swap submit (it already has it for the explorer link).
- Server verification, all on Horizon (never trust the client): tx exists and
  `successful`; source account = a wallet known to us; the tx contains a
  swap-shaped op (pathPayment / manageBuyOffer / Soroban swap invoke) whose
  source matches; tx created within a sane window of a recorded swap build for
  that wallet (link to `action_events`). Store in `action_witnesses`
  (tx_hash PK — idempotent, re-witnessing is a no-op; wallet, user_id, kind,
  op summary, ledger close time, verified_at).
- Min notional for faucet eligibility: the swapped amount ≥ **1 XLM
  equivalent** at verification-time prices (raises farming cost; stored on the
  witness row so the rule is auditable).
- Standalone win: witnesses turn the build-side analytics into settled-volume
  analytics — note it in the evidence.

## R2 — Claims backend

- `faucet_claims` table: wallet_id, user_id, witness_tx_hash, status
  (pending|paid|failed), payout_tx_hash, amounts, timestamps. UNIQUE(wallet_id)
  AND UNIQUE(user_id) — one claim per wallet AND per user, ever, DB-enforced.
- `GET /v1/faucet/eligibility?wallet=`: eligible iff FAUCET_ENABLED && a
  verified swap witness ≥ min notional exists && no prior claim (either key)
  && treasury balance ≥ 5 XLM. Response says WHICH condition fails (honest UX).
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

## R3 — Web (banner post-swap)

- After a successful swap submit + witness POST: if eligibility returns true,
  a banner on the swap success state — "Your swap qualifies — claim 5 XLM".
  One click → claim → paid state shows the payout tx + explorer link.
- Ineligible states render the honest reason (already claimed / faucet paused /
  swap below 1 XLM) — never a dead button.
- No permanent UI surface elsewhere (founder decision: post-swap banner only).
- The banner never blocks or delays the swap flow itself — it appends to the
  success state.

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
