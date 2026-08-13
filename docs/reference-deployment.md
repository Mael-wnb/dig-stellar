# Dig Stellar — Reference Deployment (Quickstart)

E4 (Lot E — T3-D3): the SDF reference-implementation quickstart. From a fresh clone to a
rendering dashboard backed by real mainnet data, with **no secrets required** (one optional
key noted below). Proven end-to-end from a fresh clone on 2026-08-13 — deviations found
during that proof are folded in; the proof notes live in `docs/evidence/lot-e/`.

Architecture choice (deliberate, beta-first): `docker compose` runs the **infrastructure**
(Postgres 16 + Redis 7); the three applications run as **documented pnpm services on the
host** — the indexer is one-shot cron-style commands, not a daemon, so containerizing the
apps would add Dockerfiles and build time without making the reference clearer.

## 0. Prerequisites

- **Node 20+** (`.nvmrc` at the repo root pins 20 — `nvm use`). Vite 8 fails on Node 18.
- **pnpm 10** (`corepack enable` or `npm i -g pnpm`)
- **Docker** (compose v2)

## 1. Clone + install

```bash
git clone <repo-url> dig-stellar && cd dig-stellar
pnpm install          # workspace install (apps/* + packages/*)
```

## 2. Environment files

Each app ships a commented `.env.example` with working defaults; copy them as-is:

```bash
cp apps/api/.env.example     apps/api/.env
cp apps/indexer/.env.example apps/indexer/.env
cp apps/web/.env.example     apps/web/.env
```

No secrets are required for the quickstart. Two knobs worth knowing:
- `STELLAR_RPC_URL` (indexer) — unset, the public SDF Soroban RPC is used (rate-limited;
  fine for a first refresh, get an operator endpoint before installing the 15-min cron).
- `DEFINDEX_API_KEY` (indexer) — optional; without it the `defindex` refresh step fails
  **non-fatally** (recorded in `refresh_step_runs`, the other protocols are unaffected).

## 3. Infrastructure

```bash
docker compose up -d     # postgres:16 on :5432 + redis:7 on :6379
```

DB URL (already in the `.env` files): `postgresql://dig:dig@localhost:5432/dig_stellar`.

## 4. Prisma client (build dependency)

The API imports `@prisma/client`; generate it once (no DB connection needed):

```bash
pnpm -C packages/db prisma:generate
```

## 5. Database schema (manual apply — no migration runner)

Apply the raw SQL files **in this order** (idempotent, safe to re-run; same list as
`docs/runbooks.md`). `docker compose exec` avoids needing psql on the host:

```bash
for f in stellar_v1 stellar_v1_metrics stellar_v1_bridge stellar_v2_multiwallet \
         stellar_v3_alerting stellar_v1_network_tvl stellar_v1_ops_metrics; do
  docker compose exec -T postgres psql -U dig -d dig_stellar < apps/api/src/db/$f.sql
done
```

## 6. Bootstrap seeds

Seeds the whole vetted indexing perimeter (venues, entities, assets, links) from the
COMMITTED `registries/core-registry.json` — the refresh reads its perimeter from the
`entities` table. Idempotent:

```bash
pnpm -C apps/indexer bootstrap:core
pnpm -C apps/indexer bootstrap:logos
```

(stellar-native pool entities are not seeded — the refresh discovers and upserts them
itself. To refresh the committed registry after onboarding a new pool/vault, run
`pnpm -C apps/indexer bootstrap:export` on the source deployment and commit the JSON.)

## 7. First refresh (real mainnet data)

```bash
pnpm -C apps/indexer job:refresh
```

~3–6 min: prices → per-protocol pool refreshes → protocol metrics → network stats, ending
with a per-step summary + the E2 ops persist. Per-step failures are non-fatal and recorded
(`refresh_step_runs`); the run exits non-zero if any step failed. In production this runs
from cron every 15 min (see `docs/runbooks.md`).

Expected degradation (found during the E4 fresh-clone proof): `defindex` reports FAILED
unless `DEFINDEX_API_KEY` is set — the other protocols are unaffected. Everything else
should be SUCCESS from the first run, PROVIDED `bootstrap:core` ran first (it also seeds
the Soroswap pair reserve snapshots that `prices:soroswap-derived` and the pair TVL read
— nothing on the live refresh path writes those; see the known-issue note in
`docs/evidence/lot-e/`).

## 8. API + web

```bash
pnpm -C apps/api start:dev    # NestJS on http://localhost:3000
pnpm -C apps/web dev          # Vite on  http://localhost:5173
```

Open **http://localhost:5173** — the dashboard renders the refreshed protocols/pools.

## 9. Verify

```bash
curl -s localhost:3000/health          # status: ok, per-venue freshness, lastRefreshAt
curl -s localhost:3000/v1/protocols    # aggregated protocol metrics
curl -s localhost:3000/v1/ops/metrics  # E2: per-run RPC percentiles + error rates
curl -s localhost:3000/v1/ops/adoption # E3: wallet + action-build counters
```

## Running a second stack side-by-side

The compose file parameterizes host ports + container names, so a verification stack can
run next to a live one. **A distinct `COMPOSE_PROJECT_NAME` is mandatory** — compose
identifies a stack by project name (default = the directory name), and a second checkout
with the same name silently *replaces* the running containers and mounts the existing data
volumes instead of creating fresh ones (found the hard way during the E4 proof):

```bash
COMPOSE_PROJECT_NAME=dig_ref DIG_CONTAINER_PREFIX=dig_ref \
POSTGRES_PORT=15432 REDIS_PORT=16379 docker compose up -d
# then point DATABASE_URL at localhost:15432 in apps/api/.env + apps/indexer/.env,
# and run the api/web on alternate ports:
#   PORT=13000 pnpm -C apps/api start:dev
#   pnpm -C apps/web exec vite --port 15173
# (NOT `pnpm dev -- --port` — pnpm passes the args in a form vite ignores and it
#  silently falls back to auto-picking a port; found during the E4 proof.)
```

## Production notes (VPS)

Deploy shape, PM2, cron schedule, `GIT_SHA` export and the alerting sweep are documented in
`docs/deployment.md` + `docs/runbooks.md`. CI/CD is deliberately out of scope for the beta
(manual VPS deploy, documented); a minimal GitHub Actions build+test workflow exists as a
bonus at `.github/workflows/ci.yml`.
