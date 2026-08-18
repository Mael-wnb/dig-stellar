# Dig Stellar Reference Deployment (Quickstart)

E4 (Lot E, T3-D3): the SDF reference-implementation quickstart. From a fresh clone to a
rendering dashboard backed by real mainnet data, with **no secrets required** (one optional
key noted below). Proven end-to-end from a fresh clone on 2026-08-13; deviations found
during that proof are folded in; the proof notes live in `docs/evidence/lot-e/`.

Two supported paths, same repo, same compose file:

- **Docker compose path (Lot Z, the packaged Reference Implementation):** postgres,
  redis, the API and the indexer all run as containers, one command from a fresh clone.
  This is the path for an SDF reviewer. See the next section.
- **Host-pnpm path (dev workflow):** `docker compose up -d` runs only the infrastructure
  (Postgres 16 + Redis 7); the applications run as documented pnpm services on the host.
  Unchanged; starts at "1. Clone + install".

In **both** paths `apps/web` stays outside the compose stack: a deliberate choice, not an
omission: the web app is a static Vite build with no server runtime, deployed on Vercel in
production. Any static host (or `pnpm -C apps/web dev` locally) serves it against the API.

## Docker compose path (containerized reference)

From a fresh clone to real mainnet data, no secrets required:

```bash
git clone <repo-url> dig-stellar && cd dig-stellar
GIT_SHA=$(git rev-parse --short HEAD) docker compose --profile app up -d --build
```

That is the whole procedure. Optional knobs (all have safe public defaults) substitute
from the shell or a root `.env`; `cp .env.example .env` and uncomment what you need:
`GIT_SHA` (the `version` reported by `/health`; 'unknown' when unset), `STELLAR_RPC_URL`
(operator Soroban RPC; unset = public SDF endpoint, rate-limited but fine for a first
run), `DEFINDEX_API_KEY` (without it the defindex step fails non-fatally each run).
The faucet stays **dark**: no faucet variable is plumbed into the compose stack, and the
reference deployment never requires a server-side key (`docs/security-invariants.md` §9).

What happens on first `up`:

1. **postgres** initializes and applies the raw SQL schema automatically: the
   `stellar_v*.sql` files are mounted into `/docker-entrypoint-initdb.d/` with explicit
   numeric prefixes in **dependency order** (v1 base → v1 satellites → v2 multiwallet →
   v3 alerting → v4 faucet). The numbering in `docker-compose.yml` is the ordering
   contract; init runs only on an empty data volume, so `down && up` is idempotent and
   the manual `psql -f` path below stays valid for existing volumes.
2. **indexer** waits for postgres to be healthy, seeds the vetted perimeter
   (`bootstrap:core`, idempotent) + logos (`bootstrap:logos`, non-fatal), runs one
   `job:refresh` immediately, then refreshes every 15 min. The container loop replaces
   the VPS cron+flock: one sequential `while … sleep 900` loop is self-excluding by
   construction (a run can never overlap itself).
3. **api** waits for postgres, serves `:3000`, and reports healthy once `GET /health`
   answers. The API image also carries the indexer package (source + deps): the wallet
   on-demand refresh spawns `pnpm tsx` in `apps/indexer` (`INDEXER_DIR`); packaging
   follows the code, zero product-logic changes.

Expected outcome (first refresh takes ~3-6 min after `up`):

```bash
docker compose --profile app ps               # postgres + api healthy, indexer running
docker compose logs -f indexer                # bootstrap, then the per-step refresh summary
curl -s localhost:3000/health                 # status ok, version = GIT_SHA, freshness
curl -s localhost:3000/v1/protocols           # 5 protocols with real mainnet data
```

Without `DEFINDEX_API_KEY` the summary shows 9/10 steps SUCCESS and `defindex` FAILED:
the documented expected degradation (non-fatal, recorded in `refresh_step_runs`; the
defindex card simply has no data until a key is provided).

Proof from a clean clone: `docs/evidence/lot-z/z1-compose-fresh-clone.md`.

---

The remaining sections document the **host-pnpm path** (the dev workflow).

## 0. Prerequisites

- **Node 20+** (`.nvmrc` at the repo root pins 20; `nvm use`). Vite 8 fails on Node 18.
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
- `STELLAR_RPC_URL` (indexer): unset, the public SDF Soroban RPC is used (rate-limited;
  fine for a first refresh, get an operator endpoint before installing the 15-min cron).
- `DEFINDEX_API_KEY` (indexer): optional; without it the `defindex` refresh step fails
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

## 5. Database schema (manual apply; no migration runner)

Apply the raw SQL files **in this order** (idempotent, safe to re-run; same list as
`docs/runbooks.md`). `docker compose exec` avoids needing psql on the host:

```bash
for f in stellar_v1 stellar_v1_metrics stellar_v1_logos stellar_v1_network_tvl \
         stellar_v1_ops_metrics stellar_v1_bridge stellar_v1_action_witness \
         stellar_v2_multiwallet stellar_v3_alerting stellar_v4_faucet; do
  docker compose exec -T postgres psql -U dig -d dig_stellar < apps/api/src/db/$f.sql
done
```

(Same files, same order as the compose init mounts; the full set includes the Lot R
witness/faucet tables so `POST /v1/actions/witness` works; the faucet stays dark unless
`FAUCET_ENABLED` is set. On a **fresh** compose volume this step is automatic.)

## 6. Bootstrap seeds

Seeds the whole vetted indexing perimeter (venues, entities, assets, links) from the
COMMITTED `registries/core-registry.json`; the refresh reads its perimeter from the
`entities` table. Idempotent:

```bash
pnpm -C apps/indexer bootstrap:core
pnpm -C apps/indexer bootstrap:logos
```

(stellar-native pool entities are not seeded; the refresh discovers and upserts them
itself. To refresh the committed registry after onboarding a new pool/vault, run
`pnpm -C apps/indexer bootstrap:export` on the source deployment and commit the JSON.)

## 7. First refresh (real mainnet data)

```bash
pnpm -C apps/indexer job:refresh
```

~3-6 min: prices → per-protocol pool refreshes → protocol metrics → network stats, ending
with a per-step summary + the E2 ops persist. Per-step failures are non-fatal and recorded
(`refresh_step_runs`); the run exits non-zero if any step failed. In production this runs
from cron every 15 min (see `docs/runbooks.md`).

Expected degradation (found during the E4 fresh-clone proof): `defindex` reports FAILED
unless `DEFINDEX_API_KEY` is set; the other protocols are unaffected. Everything else
should be SUCCESS from the first run, PROVIDED `bootstrap:core` ran first (it also seeds
the Soroswap pair reserve snapshots that `prices:soroswap-derived` and the pair TVL read;
nothing on the live refresh path writes those; see the known-issue note in
`docs/evidence/lot-e/`).

## 8. API + web

```bash
pnpm -C apps/api start:dev    # NestJS on http://localhost:3000
pnpm -C apps/web dev          # Vite on  http://localhost:5173
```

Open **http://localhost:5173**; the dashboard renders the refreshed protocols/pools.

## 9. Verify

```bash
curl -s localhost:3000/health          # status: ok, per-venue freshness, lastRefreshAt
curl -s localhost:3000/v1/protocols    # aggregated protocol metrics
curl -s localhost:3000/v1/ops/metrics  # E2: per-run RPC percentiles + error rates
curl -s localhost:3000/v1/ops/adoption # E3: wallet + action-build counters
```

## Running a second stack side-by-side

The compose file parameterizes host ports + container names, so a verification stack can
run next to a live one. **A distinct `COMPOSE_PROJECT_NAME` is mandatory**: compose
identifies a stack by project name (default = the directory name), and a second checkout
with the same name silently *replaces* the running containers and mounts the existing data
volumes instead of creating fresh ones (found the hard way during the E4 proof):

```bash
# Fully containerized verification stack (the Lot Z path) next to a dev one:
COMPOSE_PROJECT_NAME=dig_ref DIG_CONTAINER_PREFIX=dig_ref \
POSTGRES_PORT=15432 REDIS_PORT=16379 API_PORT=13000 \
docker compose --profile app up -d --build

# Infra-only variant (host-pnpm path):
COMPOSE_PROJECT_NAME=dig_ref DIG_CONTAINER_PREFIX=dig_ref \
POSTGRES_PORT=15432 REDIS_PORT=16379 docker compose up -d
# then point DATABASE_URL at localhost:15432 in apps/api/.env + apps/indexer/.env,
# and run the api/web on alternate ports:
#   PORT=13000 pnpm -C apps/api start:dev
#   pnpm -C apps/web exec vite --port 15173
# (NOT `pnpm dev -- --port`: pnpm passes the args in a form vite ignores and it
#  silently falls back to auto-picking a port; found during the E4 proof.)
```

## Production notes (VPS)

Deploy shape, PM2, cron schedule, `GIT_SHA` export and the alerting sweep are documented in
`docs/deployment.md` + `docs/runbooks.md`. CI/CD is deliberately out of scope for the beta
(manual VPS deploy, documented); a minimal GitHub Actions build+test workflow exists as a
bonus at `.github/workflows/ci.yml`.
