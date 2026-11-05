# Lot N — N2 Evidence: automatic POOL-STATUS protection (2026-08-15)

The Orbit story, as planned in N0/N1 review. Builds + tests green: **api 71/71**
(64 + 7 new pool-status specs), **web 111/111**, both builds clean. Live smoke on
the local stack against REAL mainnet RPC.

## Design (as confirmed)

- **Not a user rule** — an automatic protection with no `alert_rules` row.
- **`pool_status_state`** (additive SQL in `stellar_v3_alerting.sql`, applied
  locally): one row per monitored pool — `status_code` (raw on-chain), `status`
  (A5b label), `changed_at`, `seen_at`. **VPS: re-apply the v3 file.**
- **No duplicated mapping**: script 83 imports `derivePoolStatus` from
  `actions.service.ts` (A5b) and the verified `MAINNET_BLEND_POOLS` registry +
  `getNetworkConfig('mainnet')` from `network-registry.ts`. Status is read live
  via `PoolV2.load` × 4 per sweep — the same read path as A5b.
- **Pure edge logic** in `families.ts`: `diffPoolStatus(prev, current)` →
  `seed | unchanged | changed | suppressed` ('Unknown' transitions are recorded
  but never notified — RPC noise is not a pool event), and
  `buildPoolStatusCopy()` with the A5b action consequences baked into the copy
  (withdrawals are never status-blocked; On-Ice blocks borrowing only; Frozen
  blocks supplies + borrowing). Return to Active = `alert_resolved`.
- **Affected users** = distinct owners of wallets whose LATEST
  `wallet_pool_health` row for that pool is < 24h old (script 81 only writes a
  row when the wallet HAS a position, so exited wallets age out of the window;
  no health-factor filter — supply-only positions are affected too).
- **Red tests** (`families.spec.ts`): seed run silent (incl. a first-seen
  Frozen pool — no retroactive firing), unchanged silent, known-label
  transitions notify, Unknown suppressed, copy content + kind mapping.
- **Payload**: `metric:'pool_status'`, from/to, statusCode, supply/withdraw
  flags, asOf, and route hint `link:{view:'pool', poolId:<slug>}` — the feed and
  bell deep-link to the pool page (wiring landed in N1).
- **UI**: "Pool status · AUTOMATIC" system card at the top of the Alerts page
  rules panel — visible, honest, not toggleable. Feed severity: degradation =
  warning under the Critical filter; return to Active = activity/info.

## Live smoke (local DB + real mainnet RPC)

1. **Seed run**: `PoolV2.load` × 4 succeeded; `pool_status_state` seeded:
   Fixed/YieldBlox/Etherfuse **Active**, **Orbit genuinely Frozen on mainnet
   (status_code 4)** — seeded SILENTLY, `poolStatusChanges: 0, notified: 0`.
   The brief's exact scenario validated against reality: had this shipped before
   Orbit froze, every Orbit position holder would have been notified.
2. **Transition**: faked prior state On-Ice for Fixed + inserted a fresh
   position snapshot → sweep: `changes: 1, notified: 1` — "Pool status: Blend
   Fixed is Active again / … On-Ice → Active. All actions are available again."
   with `link.poolId = blend-fixed-pool`.
3. **Freshness window works**: with only stale (June) position snapshots the
   same transition notified **0** users — exited/stale positions don't notify.
4. **Steady state**: next run `changes: 0, notified: 0` (no re-fire).
5. Synthetic smoke rows cleaned; the one demo notification kept in the feed.

## Notes

- RPC cost: 4 × `PoolV2.load` per 15-min sweep, non-fatal per pool (a failed
  load skips that pool, state kept for the next sweep).
- Deploy: VPS psql re-apply + API build/restart + web deploy (same as N1); no
  cron change.
