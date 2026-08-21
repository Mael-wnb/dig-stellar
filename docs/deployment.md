# Dig Stellar: Deployment

## Purpose
Describe the target deployment shape for Dig Stellar beta and how to operate it.
For the fresh-machine quickstart (clone → rendering dashboard, proven end-to-end), see
`docs/reference-deployment.md` (E4, Lot E).

---

## Recommended beta architecture

### Frontend
- deploy `apps/web` on Vercel

### Backend
- deploy `apps/api` on a VPS or equivalent server runtime

### Indexer / jobs
- run `apps/indexer` on the same VPS or another controlled environment
- use cron or equivalent scheduler for refresh jobs

### Database schema (manual apply, no migration runner)
The raw SQL schemas are applied by hand on each environment (local **and** VPS); the DDL is
idempotent. On the VPS, after `git pull` and **before** the cron runs a new step:
```bash
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1.sql
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_metrics.sql
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_bridge.sql   # Allbridge bridge flows (T2-D3)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v2_multiwallet.sql   # incl. T2-D1 is_active_signer column + singleton index, + Gap B wallet_pool_health table
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v3_alerting.sql   # D2 alerting (apply AFTER v1 + v2): alert_rules, alert_rule_state, notifications
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql   # G0 (T3-D3): network_tvl_snapshots, one TVL point per refresh cycle
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_ops_metrics.sql   # E2 (Lot E, T3-D3): rpc_metrics_runs + refresh_step_runs
# Allbridge needs its venue + USDC asset seeded once before the first refresh:
pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts
```

---

## VPS edge: nginx rate limiting & hardening (Lot S, 2026-08-17)

The public entry is nginx (`/etc/nginx/sites-available/stellar-api.getdig.ai`,
symlinked into `sites-enabled`). **This config is ops state that must survive a VPS
rebuild; recreate it from this section.** Evidence: `docs/evidence/lot-s/`.

### Network posture
- The API binds **`127.0.0.1:3000`** (`main.ts`; override with `HOST=0.0.0.0` only
  for environments that need it, e.g. Docker). nginx is the only public path.
- ufw: default deny incoming; allow `22/tcp`, `80/tcp`, `443/tcp`.
- The `default` vhost (`sites-available/default`) does `return 444;`: IP-direct
  scanner probes get a closed connection, not a file listing.

### Rate-limit zones (values from the observed baseline, S0 2026-08-17)
Keyed by `$binary_remote_addr`, all `nodelay`; `limit_req_status 429` with a JSON
body + `Retry-After: 1` via an `@rate_limited` named location (ACAO echoed so the
web app can read the 429 cross-origin).

| Zone | Applies to | Rate | Burst | Sizing rationale |
|---|---|---|---|---|
| `api_general` | all locations | 10 r/s | 60 | worst observed legit minute 62 req/min; burst ≈ a full page load (~20 req) ×3 |
| `api_actions` | `location /v1/actions/` | 30 r/min | 10 | builds cost RPC simulation; observed 29 POSTs/2 days |
| `api_mutations` | POST/PATCH/DELETE under `/v1/` (via `$request_method` map → empty key exempts reads) | 2 r/s | 20 | mutations are click-driven |

Faucet locations (added at Lot R go-live, adjusted in the 2026-08-17 incident):
`POST /v1/faucet/claim` sits in the strict `api_actions` zone; `GET /v1/faucet/eligibility`
sits in the general zone; it is polled by the promo/claim surfaces and the strict zone
starved it. `/v1/actions/witness` is covered by the existing `location /v1/actions/`.

If the web app ever grows a legitimately chattier page, re-measure before raising
values; limits come from observed traffic, not guesses.

### Other edge settings
`server_tokens off`, `client_max_body_size 100k` (largest legit body is a small
JSON action payload; XDR travels in responses), and headers on every response:
HSTS (`max-age=31536000`), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.

### API process: pm2 supervised (Lot S follow-up, 2026-08-17)
The API runs under **pm2** (name `dig-stellar-api`, direct `dist/main.js` definition,
cwd `apps/api` so dotenv finds `.env`). The pm2 daemon is boot-persistent via the
`pm2-root` systemd unit (`systemctl is-enabled pm2-root` → enabled), and the process
list is saved (`pm2 save` → `/root/.pm2/dump.pm2`), so a VPS reboot restores the API
without manual action. Verified 2026-08-17: `pm2 kill && pm2 resurrect` (reboot
simulation) brings the API back healthy on `127.0.0.1:3000`.

Deploy / restart procedure:
```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH   # non-interactive PATH has an old node
cd /root/dig-stellar && git pull
pnpm --dir apps/api build
cd apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env
pm2 save                                  # ALWAYS after a definition/env change
curl -s http://127.0.0.1:3000/health      # verify (version must equal the new SHA)
```
If the process definition itself must be recreated:
```bash
cd /root/dig-stellar/apps/api
pm2 delete dig-stellar-api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 start dist/main.js --name dig-stellar-api --time
pm2 save
```
Logs: `~/.pm2/logs/dig-stellar-api-{out,error}.log` (pm2-logrotate active).
Do NOT start the API with nohup/setsid; a second instance loses the `:3000` port
race against pm2's respawn and dies; only pm2 owns this process.
Pre-Lot-S nginx config backed up at `/root/nginx-backup-lot-s/` on the VPS.

---

## Why this architecture
- Vercel is convenient for the frontend
- API and indexer benefit from a more controllable runtime
- cron and script execution are easier to reason about outside frontend hosting

---

## Deployment principles
- keep environments explicit
- front should only call the deployed API
- indexer should be runnable independently of user traffic
- API should expose a health endpoint

---

## Environment variables
Document separately for:
- web
- api
- indexer

Include only what is actually required.

---

## Operational goals for beta
- frontend is reachable and stable
- API is reachable and stable
- data refresh jobs run without manual babysitting
- stale or failing sources can be diagnosed quickly

---

## Future additions
Later, this doc should include:
- exact hosting layout
- process manager strategy
- cron schedule details
- deployment commands
- rollback notes
