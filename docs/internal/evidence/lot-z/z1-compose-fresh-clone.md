# Lot Z — Z1: Reference compose proven from a clean clone

**Date:** 2026-08-18 · **Branch:** `feat/t3-reference-compose` (final: `4804e9f`) ·
**Criterion (T3-D3, verbatim):** "The application is packaged as a Reference Implementation
for the SDF (functional Docker compose) with internal documentation."

Proof machine: macOS (Darwin 25.6.0), Docker 27.3.1, compose v2. The clone ran **side-by-side
with the live dev stack**, so the documented second-stack overrides were used (distinct
project name + ports — see `docker-compose.yml` header). A reviewer on a clean machine uses
none of these and just runs `docker compose --profile app up -d --build`.

```bash
git clone --branch feat/t3-reference-compose <repo> refclone && cd refclone
export COMPOSE_PROJECT_NAME=dig_ref DIG_CONTAINER_PREFIX=dig_ref \
       POSTGRES_PORT=15432 REDIS_PORT=16379 API_PORT=13000 \
       GIT_SHA=$(git rev-parse --short HEAD)
docker compose --profile app up -d --build
```

## 1. `up` — all services created, schema applied, healthy

First boot applied all ten schema files **in the mounted dependency order** (postgres logs):

```
running /docker-entrypoint-initdb.d/10-stellar_v1.sql
running /docker-entrypoint-initdb.d/11-stellar_v1_metrics.sql
running /docker-entrypoint-initdb.d/12-stellar_v1_logos.sql
running /docker-entrypoint-initdb.d/13-stellar_v1_network_tvl.sql
running /docker-entrypoint-initdb.d/14-stellar_v1_ops_metrics.sql
running /docker-entrypoint-initdb.d/15-stellar_v1_bridge.sql
running /docker-entrypoint-initdb.d/16-stellar_v1_action_witness.sql
running /docker-entrypoint-initdb.d/20-stellar_v2_multiwallet.sql
running /docker-entrypoint-initdb.d/30-stellar_v3_alerting.sql
running /docker-entrypoint-initdb.d/40-stellar_v4_faucet.sql
```

→ 28 tables in `public`. `docker compose --profile app ps` after the first refresh:

```
NAME               IMAGE             SERVICE    STATUS                   PORTS
dig_ref_api        dig_ref-api       api        Up 8 minutes (healthy)   0.0.0.0:13000->3000/tcp
dig_ref_indexer    dig_ref-indexer   indexer    Up 6 minutes
dig_ref_postgres   postgres:16       postgres   Up 8 minutes (healthy)   0.0.0.0:15432->5432/tcp
dig_ref_redis      redis:7           redis      Up 8 minutes             0.0.0.0:16379->6379/tcp
```

Indexer startup (container logs): `bootstrap:core` seeded the committed perimeter
(6 venues, 32 entities, 17 assets, 78 links), `bootstrap:logos` ok, then the first
`job:refresh` started immediately.

Image sizes: api 771MB, indexer 741MB (the api image intentionally carries the indexer
package — the wallet on-demand refresh spawns `pnpm tsx` there; see the Dockerfile header).

## 2. `GET /health` — ok, version = GIT_SHA

```
$ curl -s localhost:13000/health
{"status":"ok","version":"4804e9f","uptimeSeconds":523,"db":{"ok":true,"latencyMs":1},
 "staleAfterSeconds":2700,"freshness":[
   {"venue":"aquarius","asOf":"2026-08-18T17:58:22.171Z","ageSeconds":86,"isStale":false},
   {"venue":"blend","asOf":"2026-08-18T17:58:22.168Z","ageSeconds":86,"isStale":false},
   ... all five data venues fresh; allbridge asOf null (bridge flows, no pool metrics) ...
 ],"lastRefreshAt":"2026-08-18T17:58:00.000Z"}
```

`version` comes from the `GIT_SHA` build arg (`'unknown'` when not passed — documented).

## 3. First refresh — green in the container loop

With `DEFINDEX_API_KEY` provided (our own key, from the VPS env — never committed):

```
step 1  prices:reference:        SUCCESS in 0.9s
step 2  prices:soroswap-derived: SUCCESS in 1.7s
step 3  blend:                   SUCCESS in 12.3s
step 4  soroswap:                SUCCESS in 13.4s
step 5  aquarius:                SUCCESS in 201.6s
step 6  stellar-native:          SUCCESS in 59.7s
step 7  defindex:                SUCCESS in 5.5s
step 8  protocol-metrics:        SUCCESS in 0.4s
step 9  allbridge:               SUCCESS in 1.4s
step 10 network-stats:           SUCCESS in 1.1s
=== Global refresh job completed successfully ===
[indexer] job:refresh OK — next run in 900s
```

Run time ~5 min on the **public** Soroban RPC fallback (no `STELLAR_RPC_URL` set) — inside
the 900s loop cadence. Without `DEFINDEX_API_KEY` the same run shows 9/10 SUCCESS with
`defindex` FAILED — the documented expected degradation (non-fatal, recorded in
`refresh_step_runs`).

## 4. `GET /v1/protocols` — real mainnet data

```
$ curl -s localhost:13000/v1/protocols   # 6 venues = 5 protocols + the bridge
  Aquarius            tvlUsd 42,241,372
  Blend               tvlUsd 180,516,259
  DeFindex            tvlUsd 19,393,654
  Soroswap            tvlUsd 1,177,112
  Stellar Native DEX  tvlUsd 5,350,576
  Allbridge           tvlUsd null   (bridge-flow venue — no pool TVL by design)
```

## 5. `down && up` — idempotent on the existing volume

```
$ docker compose --profile app down && docker compose --profile app up -d
health reachable after restart: yes (within 60s)
postgres logs: 0 initdb reruns, 0 ERROR lines   # init SQL only runs on an empty volume
$ curl -s localhost:13000/health → status: ok | lastRefreshAt: 2026-08-18T17:58:00.000Z
```

Data survived the restart; the indexer re-ran its (idempotent) bootstrap and resumed the loop.

## Deviation found by this proof (fixed before merge)

The first containerized run failed 3 steps (soroswap, allbridge + dropped ops-metrics
samples) with `EACCES` on `/app/apps/indexer/tmp/…` — the image runs as the non-root
`node` user but `/app` was root-owned, and the refresh writes ops-metrics flushes +
discovery `saveJson` snapshots under `apps/indexer/tmp/`. Fixed in `4804e9f`
(`mkdir -p apps/indexer/tmp && chown node:node` in the indexer Dockerfile); the green run
above is from a full re-run (fresh volume, rebuilt images) after the fix.

## Choices on record

- **`apps/web` is not in the stack** — static Vite build, deployed on Vercel; any static
  host serves it against the API. Documented in `docs/reference-deployment.md`.
- **Loop instead of cron** — the indexer container replaces the VPS 15-min cron+flock with
  one sequential `while … sleep 900` loop: self-excluding by construction.
- **Faucet stays dark** — no faucet variable is plumbed into compose; the reference
  deployment never requires a server-side key (`docs/security-invariants.md` §9).
