# Lot W — Wallet Management & Portfolio Assets — Implementation Brief

Execution brief for Claude Code. Founder review of 2026-08-14 (wallet/portfolio pass):
three defects — the portfolio shows no ASSET holdings, the pool-detail position card
hides which wallet holds what, and the connect-signer flow FORKS A NEW ACCOUNT instead
of attaching to the session's account (plus labels became impossible to set/edit).
Touches the T2-D1 account model → recon first, strict review gate on W1.
Evidence: `docs/evidence/lot-w/`.

## Non-negotiables

- T2-D1 invariants hold: ONE active signer per user (DB singleton), watch-only never
  signs, the signing guardrail untouched.
- NO action-path changes (swap/deposit/withdraw builders, gates, flags: untouched).
- Honest display: USD values only for priced assets ("—" otherwise, never $0);
  liquid assets stay DISTINCT from DeFi supplied/borrowed (standing rule).
- Each step green + captured; nothing committed by you.

## W0 — Account-model recon (REPORT before any code)

Map how identity actually works today — the bug's mechanism, with file:line evidence:

1. Where does `userId` come from (creation, storage, `useAppUser`)? What exactly does
   the Kit connect flow call when a signer wallet connects — and WHY does it create a
   fresh user instead of attaching to the session's (`useConnectFlow`, the wallets
   connect endpoint)? Is identity derived from the wallet address somewhere?
2. What happens today when the connected address is ALREADY in the session account as
   watch-only? Already in ANOTHER account?
3. Label support: which add-flows accept a label today, does a label-update endpoint
   exist (`PATCH /v1/wallets/:id`?), where are labels rendered?
4. Anything else coupled to userId creation that W1 could break (alerts rules,
   notifications, positions are all keyed by user/wallet — list the joins).

STOP after the report.

## W1 — Identity fix: connect-signer ATTACHES to the session account

The rule, in order:

- Session account exists → connecting a signer wallet **adds it to THAT account**
  (`is_active_signer` promotion per the existing T2-D1 semantics — the singleton
  moves to the newly connected signer, as Kit-connect already does elsewhere).
- The address is already in the account as watch-only → **promote in place** (same
  row, no duplicate).
- The address is already in the account as a signer → no-op (just re-select it as
  active signer).
- NO session account exists → today's create-account path, unchanged.
- NEVER silently switch the session to a different account, even if the address
  exists in one — the user stays on the account they were on. (An address may
  legitimately appear in several accounts; watch-only-anyone already allows that.)

Guard the invariant: the one-active-signer singleton must hold through every branch
(the DB unique index is the backstop — exercise it in tests). Add red tests for the
old behavior: connecting a signer with a session account present must NOT create a
user row.

## W2 — Labels: set at connect, rename after

- Optional label field on BOTH add flows (Kit connect + watch-only add) — watch-only
  already has it; restore/add it for the signer path in the same modal.
- Rename from the Portfolio wallet card's ⋯ menu (alongside the existing T2-D1 ops):
  small inline edit → `PATCH /v1/wallets/:id { label }` (add the endpoint if W0 found
  none; label-only, same auth pattern as the other wallet ops).
- Empty label → the existing short-address fallback everywhere; the label renders
  consistently (portfolio cards, positions rows, dashboard panel, pool-detail
  breakdown from W4).

## W3 — Portfolio "Assets" section (what the wallets HOLD)

- Data: the existing per-wallet balance snapshots/endpoint (T2-D1) — no new
  ingestion. If the overview payload lacks balances, extend it additively (same
  pattern as H6's legs).
- UI: an Assets card on the Portfolio between the summary and positions —
  aggregated across wallets by asset: BrandLogo + symbol + total amount
  (`formatTokenAmountCompact`, exact on hover) + USD value (priced assets only,
  "—" otherwise) + share bar; expandable per-wallet detail per asset (which wallet
  holds how much). Dust threshold visual only (group tiny balances under "Other",
  never dropped from totals).
- The section total must equal the existing "liquid" hero figure (same source —
  assert, don't recompute differently).

## W4 — Pool-detail "Your position": per-wallet breakdown

- When >1 tracked wallet holds a position in the pool: the card lists one row per
  wallet (dot + label + supplied + borrowed + HF gauge, reusing `hfDisplay` +
  `HealthFactorGauge`), with the aggregate on top. Single-wallet: unchanged today's
  card.
- Data: the overview `defi.poolHealth[]` (+ H6 legs) already keyed by (wallet, pool)
  — filter by the page's pool. No new endpoint.

## Sequencing

W0 (report) → STOP → W1 (review gate: the account model diff gets read line by line)
→ W2 → W3 → W4. Each step: builds + tests green (web 111 + api 42 baselines),
captures to `docs/evidence/lot-w/`, founder commits manually.

## Definition of done

- Connecting a signer while on an account adds to it — proven by a test AND a manual
  flow capture; the watch-only-first workaround is obsolete.
- Labels settable at connect and editable from the portfolio; rendered everywhere.
- Portfolio shows what each wallet holds (amounts + honest USD), totals consistent
  with the hero figure.
- Pool detail shows who holds the position when several wallets do.
- Docs flagged: `current-state.md` (§ wallets/frontend), `status-board.md` (T2-D1
  remains Done — this is UX debt repair, not a criterion change).

## Out of scope

Auth/accounts beyond the attach fix (no login system, no account merge tooling) ·
asset detail pages · price sources for unpriced exotics · any action-path change.
