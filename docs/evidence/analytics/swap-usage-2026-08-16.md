# Action / Swap Usage Analytics — build-side intent (as of 2026-08-17)

Read-only analytics run against the production DB (`dig_stellar` on the VPS), queried
**2026-08-17 ~07:48 UTC**. Source table: `action_events`. No code or data was changed.

---

## HONESTY CAVEAT — read first

**`action_events` records BUILDS, not executions.** Every row is a server-side action:
a quote served or a signable XDR successfully built and handed to the client. On-chain
submission happens client-side (non-custodial) and is **not confirmed back** — there is no
on-chain execution tracking yet (E3b / R1 backlog). All figures below are **build-side
intent, not settled volume**. Executed-tx evidence remains the manually kept
transaction-hash list (see `docs/evidence/t3-d2-mainnet-actions.md`).

Two further data limitations discovered during this run:

1. **No event metadata is persisted.** `action_events` columns are only
   `(id, kind, network, address, created_at)`. Asset pairs, amounts, and venue are **not
   recorded**, so the requested amount distribution (median / p90 / max, native + USD) and
   pair/venue splits **cannot be produced from the DB**. This is a telemetry gap to log
   against the E3b/R1 backlog, not a zero.
2. **`sdex-quote` events carry no address** (all 31 rows have `address = NULL`) — quotes
   are anonymous. Wallet-level figures therefore cover build events only.
3. There is **no `blend-position` kind** in the data. Live kinds are exactly:
   `sdex-quote`, `sdex-swap-build`, `blend-deposit-build`, `blend-withdraw-build`
   (all `network = mainnet`).

Counters start at instrumentation deploy (first event **2026-08-13 17:23 UTC**) — no
historical backfill. Actions performed before that date (e.g. the Aug 2 ungating swaps)
are not in this table.

---

## 1. Builds per day, by kind

Total events since go-live: **56** (31 quotes + **25 builds**).

| Day (UTC) | sdex-quote | sdex-swap-build | blend-deposit-build | blend-withdraw-build | Builds/day |
|---|---|---|---|---|---|
| 2026-08-13 | — | — | 2 | — | 2 |
| 2026-08-14 | 10 | 5 | 11 | 3 | 19 |
| 2026-08-15 | 10 | 2 | — | — | 2 |
| 2026-08-16 | 8 | 2 | — | — | 2 |
| 2026-08-17 (partial) | 3 | — | — | — | 0 |
| **Total** | **31** | **9** | **13** | **3** | **25** |

Aug 14 is the standout day (the Lot A5/A5b mainnet evidence session). Since then activity
is a trickle: ~2 builds/day, quotes continuing without conversion on Aug 17 so far.

## 2. Wallets and users

- **Distinct wallets (build events): 6** — all six are registered in `user_wallets`
  (tracked by **9 distinct users**; some addresses are tracked by more than one user).
- Platform-wide (for context, from `user_wallets`): 38 wallet rows, 22 distinct users.
- Quotes contribute no wallet data (anonymous, see caveat #2).

### New vs returning wallets per day (build events)

| Day (UTC) | Active wallets | New | Returning |
|---|---|---|---|
| 2026-08-13 | 1 | 1 | 0 |
| 2026-08-14 | 4 | 3 | 1 |
| 2026-08-15 | 2 | 1 | 1 |
| 2026-08-16 | 1 | 1 | 0 |

### Top wallets by build count (all 6 — fewer than 10 exist)

| Wallet | Builds | Swaps | Blend deposits | Blend withdraws | First seen | Last seen |
|---|---|---|---|---|---|---|
| GCLS…CF2O | 10 | 0 | 8 | 2 | 08-13 | 08-14 |
| GAIB…I7GP | 7 | 3 | 3 | 1 | 08-14 | 08-15 |
| GCPS…URI2 | 4 | 2 | 2 | 0 | 08-14 | 08-14 |
| GD2J…TACL | 2 | 2 | 0 | 0 | 08-16 | 08-16 |
| GCSW…RA55 | 1 | 1 | 0 | 0 | 08-15 | 08-15 |
| GBXO…OUSI | 1 | 1 | 0 | 0 | 08-14 | 08-14 |

## 3. Swap specifics

**Not derivable from the DB.** As stated in the caveat, `action_events` persists no
metadata — no asset pair, no amount, no venue. Consequently:

- Asset-pair split: **not recorded**
- Amount distribution (median / p90 / max, native or USD): **not recorded**
- Venue split: **not recorded** (all swap builds are `sdex-*` kinds, so the only venue
  signal is that 100% of recorded swap builds target the native SDEX path; Soroban AMM
  swap builds do not exist as a kind)

Recommendation (backlog, not done here): add a `metadata jsonb` column at build time
(pair, amounts, venue) — cheap, non-PII beyond what `address` already stores, and it would
make this report's section 3 answerable next run.

## 4. KPI cross-reference — T3-D2 targets

Targets (`docs/grant-roadmap.md`): **50+ unique mainnet wallets, 200+ mainnet transactions.**

| Metric | Target | Build-side (this run) | Progress |
|---|---|---|---|
| Unique mainnet wallets | 50+ | **6** | 12% |
| Mainnet transactions | 200+ | **25 builds** (56 incl. quotes) | ~12% (builds) |

`/v1/ops/adoption` (queried live on the VPS, same moment) agrees exactly:
`actions.total = 56`, `distinctAddresses.total = 6` (24h: 1, 7d: 6), by-kind totals
13 / 3 / 31 / 9 matching the table in §1, plus `wallets: 38 total / 17 signers /
21 watch-only / 22 distinct users`. Its own stated boundary matches this doc's caveat:
builds only, counters start at deploy, executed-tx evidence is the manual hash list.

**Honest read:** even generously counting builds as transactions, we are at ~12% of both
KPI targets, and the wallet mix is still overwhelmingly founder/test-adjacent (all 6
addresses are wallets already registered on the platform). The distribution push remains
the gap — consistent with the status board's risk call ("KPIs cannot be built, only
accumulated").

---

*Method: read-only `psql` over SSH on the VPS (`DATABASE_URL` from `apps/api/.env`,
`?schema=` stripped), plus one live `GET /v1/ops/adoption` on localhost. Queries: per-day
per-kind counts, first-seen cohorts, per-address rollups, `user_wallets` joins.*
