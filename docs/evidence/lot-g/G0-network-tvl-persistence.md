# G0 — Network TVL snapshot persistence (T3-D3, Lot G)

Ships alone, first. Value is calendar time: every refresh cycle from now on leaves
one TVL point behind, since history cannot be reconstructed later (no historized prices).

## What landed

- **New table** `network_tvl_snapshots` — `apps/api/src/db/stellar_v1_network_tvl.sql`
  (`as_of timestamptz` PK, `tvl_usd numeric not null`, `protocol_count int not null`).
  Additive raw-SQL migration, v1-pipeline style. Prisma untouched.
- **Write** at the tail of refresh step 7, inside `70-protocol-persist-metrics.ts`
  (`persistNetworkTvlSnapshot`), after all five `persistProtocol` calls have
  rewritten `protocol_metrics_latest`. One statement:
  `sum(protocol_metrics_latest.tvl_usd)` + `count(*)`, `as_of = date_trunc('minute', now())`,
  upsert on `as_of`. Idempotent per run.
- Docs: apply command added to `docs/deployment.md` and `docs/runbooks.md`.

## Figure matches the hero

The dashboard hero's total TVL is `sum(protocol_metrics_latest.tvl_usd)` across venues
(`StellarService.getProtocols`, `stellar.service.ts:180`). The snapshot sums the same
column → identical figure.

## Validation (local, 2026-08-12)

Migration applied cleanly (`CREATE TABLE` / `CREATE INDEX`), then ran step 7:

```
{ networkTvlSnapshot: true,
  asOf: 2026-08-12T14:42:00.000Z,
  tvlUsd: 231617787.09096548,
  protocolCount: 5 }
```

`tvlUsd` equals the live `sum(tvl_usd)` over `protocol_metrics_latest` (231617787.0909654771)
and `protocolCount` = 5 (the five venues folded in).

Two consecutive runs landed in different minutes → two distinct points (one per cycle):

```
         as_of          |       tvl_usd        | protocol_count
------------------------+----------------------+----------------
 2026-08-12 14:43:00+00 | 231617787.0909654771 |              5
 2026-08-12 14:42:00+00 | 231617787.0909654771 |              5
```

Same-minute idempotency (two writes truncating to the same minute → one row, latest values):

```
insert ... values (date_trunc('minute', '09:00:30'), 100, 4) on conflict ...;  -- INSERT 0 1
insert ... values (date_trunc('minute', '09:00:55'), 200, 5) on conflict ...;  -- INSERT 0 1
select ... where as_of = '2026-08-12 09:00:00+00';
--  as_of  | tvl_usd | protocol_count
--  09:00  |   200   |       5          (one row, overwritten — no duplicate)
```

## Gates

- `70-protocol-persist-metrics.ts` runs clean under `tsx` (the real runner); no tsc
  error references it (pre-existing `@stellar/stellar-sdk`/`urijs` ambient errors only).
- `pnpm -C apps/api build` (nest build) green.
- Web untouched — no `apps/web` files changed by G0.

## Deploy (calendar clock starts here)

On the VPS, after `git pull`, before the next cron tick:
```
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql
```
Then confirm two consecutive cron ticks each write a point
(`select as_of, tvl_usd, protocol_count from network_tvl_snapshots order by as_of desc limit 5;`).
