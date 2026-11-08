# EP5 — daily XLM rewards on points, immediate award, witness outbox, campaign minimum (2026-10-21)

Built on `feat/lot-ep5` (WIP commit rebased on main 2026-11-08). Not merged, not deployed, no key
generated, no treasury funded. **Money path**: second server-side payout key, `modules/rewards/`,
`docs/security-invariants.md` §13. Every local run used a `Keypair.random()` secret generated
in-process, so the payout path stopped at the treasury guard (`treasury-unavailable`).
Node 24.22.0, local Postgres 16 with v6 + v7 + v8 + v9 applied.

## Delivered

| Area | Fact |
|---|---|
| Schema v9 | `stellar_v9_rewards.sql`: `reward_claims` (status paying/paid/failed, `tx_hash` unique) and `reward_allocations` (PK `(campaign, day, address)`, `share_xlm > 0 and <= cap_xlm`, `(status = 'claimable') = (claim_id is null)`); 4 indexes; idempotent on second apply; compose mount 53 |
| Config | `REWARDS_ENABLED` (off), `REWARDS_NETWORK` (testnet), `REWARDS_SECRET_KEY`, `REWARDS_DAILY_POOL_XLM` 100, `REWARDS_DAILY_CAP_XLM` 5, `REWARDS_MIN_CLAIM_XLM` 1, `REWARDS_EXCLUDED_ADDRESSES`; `CAMPAIGN_MIN_NOTIONAL_XLM` 1; names only in `.env.example` |
| Rules | `rewards-rules.ts`: BigInt stroops, `allocateDay` (floor share, cap, excluded out of Σ, remainder stays), 30 min grace, `claimEligibility` (10 ordered reasons) |
| Repository | `allocateClosedDays` (closed UTC days with points and no row, `on conflict do nothing`), `beginClaim` (one tx, `SELECT … FOR UPDATE` on the enrollment), `markClaimPaid` / `markClaimFailed` forward-only |
| Payout | `rewards-payout.service.ts`: only reader of `REWARDS_SECRET_KEY` (lazy, never cached or logged); one native payment, memo `dig-points`, fee 10000 stroops, 60 s timebound; `pay()` requires a claim id; ambiguous submits carry `maybePaid`; copied from the faucet payout, never imported |
| Routes | `GET /v1/campaign/rewards/me` (no-store), `POST /v1/campaign/rewards/claim` (serialized, never retried); `GET /v1/campaign` `rules.rewards`; `/v1/ops/metrics` `.rewards` block |
| Award job | `84-campaign-award.ts` step 5 allocates only, no payout; summary gains `rewards_days` / `rewards_allocations` / `rewards_distributed_xlm`; cron line unchanged |
| Sync (item 8) | `POST /v1/campaign/sync {address, userId}`: same planner (`campaign/award-planner.ts`) for one wallet under the enrollment lock; `{awarded, pending}`; `rateLimited: true` within 10 s |
| Outbox (item 9) | `lib/witnessOutbox.ts`: localStorage `dig.witnessOutbox.v1`, 24 h TTL, public fields only; `witnessAndSync` re-POSTs unacknowledged hashes then syncs; also on Earn view load |
| Minimum (item 10) | `actionAward` requires `notional_xlm >= CAMPAIGN_MIN_NOTIONAL_XLM` (null = below); the faucet's `meets_min_notional` is no longer consulted; served as `rules.actions[kind].minNotionalXlm` |
| Web | hero "Daily pool · 100 XLM shared by points", "Claimable: X XLM", Claim disabled below minimum, hidden unless `rules.rewards.enabled`; `RewardsBonusLine.vue` under the Blend tiles; paid claims in `ActivityFeed`; the web computes no XLM amount |

Out of scope: batch or job-driven send, auto-retry of a failed payment, skip switch for days closed
during a pause, treasury auto-refill, admin UI, Galxe import.

## Review greps (working tree)

| Check | Result |
|---|---|
| `REWARDS_SECRET_KEY` outside `rewards-payout.service.ts` | none in `apps/*/src` (`.env.example` and docs only) |
| `Keypair` in non-spec API code | `rewards-payout.service.ts`, `faucet-payout.service.ts`, `verify-wallet-signature.ts`; none in the web |
| `.pay(` calls | one, `rewards.service.ts`, with `claimId`; `pay()` throws `claim-id-required` without one |
| `modules/campaign/` importing `modules/rewards` | none |
| Web copy in the rewards block | no "airdrop", "token", "APY", no `%` |

## Local runs (API on :3077, throwaway key, two temporary allocation rows deleted afterwards)

`GET /v1/campaign/rewards/me` → `claimableXlm: 2.4234567`, `pendingDays` 2026-10-19 (2.1234567, 300 pts)
and 2026-10-20 (0.3, 55 pts), `paid: []`. `POST …/claim` → `{claimed: false, reason: "treasury-unavailable"}`,
allocations unchanged, `reward_claims` empty. `POST /v1/campaign/sync` → `awarded: 0, pending: 0`; again
within 10 s → `rateLimited: true`. `GET /v1/ops/metrics` `.rewards` → counts, `treasuryBalanceXlm null`,
`reserveXlm 2`, no address. Malformed `/rewards/me` and claim bodies → 400.

```
[campaign-award] rewards dark (REWARDS_ENABLED unset), no allocation
[campaign-award] rewards days_pending=0 waiting_grace=0 days_allocated=0 allocations=0 excluded_wallets=0 distributed_xlm=0.0000000 remainder_xlm=0.0000000 pool_xlm=100 cap_xlm=5
```

Capture `shots-ep5/01-hero-pool-claimable.jpg`: hero with the daily pool block, "Claimable: 2.4234567 XLM",
enabled Claim button, Earn-more rows ending "· min 1 XLM". Browser-verified, not captured: refusal copy
for `claim-rate-limited` and `treasury-unavailable` (nothing written), "XLM paid · tx e5de0000 · +7 XLM" in
the activity feed. Spec-pinned only: bonus line, paid path (fake Horizon), "Verifying N recent actions…".

## Tests and builds (2026-10-21)

| Command | Output |
|---|---|
| `pnpm -C apps/api test` | `Suites: 5 skipped, 30 passed, 35 total` · `Tests: 55 skipped, 355 passed, 410 total` (EP4: 309) |
| `CAMPAIGN_IT=1 npx jest --runInBand` | `35 suites, 410 tests passed`, twice; parallel run green 3/5 (pre-existing award/campaign race) |
| `nest build` | clean |
| `pnpm -C apps/web test` | `13 files, 171 tests passed` (EP4: 157) |
| `pnpm -C apps/web build` | `✓ built`; main chunk 1,856.07 kB, gzip 527.67 kB (EP4: 1,847.75 / 525.26) |

## Deploy order (not executed)

1. `stellar_v9_rewards.sql` on the VPS BEFORE the API build; `pnpm install --frozen-lockfile` (no new dependency), `nest build`, `pm2 restart dig-stellar-api --update-env`.
2. Dark checks: `GET /v1/campaign` `rules.rewards.enabled: false`; `/rewards/me` zeros; claim → `rewards-disabled`; `/v1/ops/metrics` `.rewards.treasuryBalanceXlm: null`; `job:campaign` logs the dark line. nginx: claim in the strict zone, `/rewards/me` and `/sync` general.
3. Live without the flag: sync award, witness outbox, campaign minimum (they do not read `REWARDS_ENABLED`).
4. Activation (founder, runbook "Rewards treasury"): offline keypair, fund 3 days of pool + 2 XLM, set `REWARDS_SECRET_KEY` / `REWARDS_NETWORK=mainnet` / `REWARDS_EXCLUDED_ADDRESSES`, restart, then `REWARDS_ENABLED=true`, restart; go-live proof is ONE real claim with memo `dig-points` on stellar.expert.
