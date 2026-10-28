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
idempotent. On the VPS, after `git pull` and **before** the cron runs a new step. Same
canonical list and order as `docs/runbooks.md` (Lot EP aligned the lists on 2026-10-15):
```bash
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1.sql   # v1 base (pgcrypto, venues/entities/assets/snapshots/prices)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_metrics.sql   # v1 latest rollups read by /v1/*
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_logos.sql   # F3: venue/asset logo_url columns (bootstrap:logos fills them)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql   # G0 (T3-D3): network_tvl_snapshots, one TVL point per refresh cycle
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_ops_metrics.sql   # E2 (Lot E, T3-D3): rpc_metrics_runs + refresh_step_runs + action_events; R1 adds action_events.metadata (re-run once)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_ops_metrics_job.sql   # Lot RP (RP1): rpc_metrics_runs.job + methods — per-job, per-method RPC cost (apply BEFORE the RP1 indexer + api deploy)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_bridge.sql   # T2-D3: Allbridge bridge_flows (then run the allbridge bootstrap once, below)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_action_witness.sql   # R1 (Lot R, T3-D2): action_witnesses, verified execution witnesses (apply BEFORE deploying the R1 api)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v2_multiwallet.sql   # v2 wallets: user_wallets (+ T2-D1 is_active_signer + singleton index), snapshots, wallet_pool_health
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v3_alerting.sql   # D2 alerting (apply AFTER v1 + v2): alert_rules, alert_rule_state, notifications
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v4_faucet.sql   # R2 (Lot R, T3-D2): faucet_claims (money path, depends on action_witnesses); deploys dark (FAUCET_ENABLED unset)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v5_faucet_campaign2.sql   # Lot R2: campaign 2, campaign/action_family columns + per-family uniqueness (apply BEFORE the campaign-2 api build)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v6_campaign.sql   # Lot EP (EP1): Earn & Points — proofs, enrollments, points_ledger, check-ins, referrals (points only, no key; depends on v2 + action_witnesses); deploys dark (CAMPAIGN_ENABLED unset)
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v7_social_claim_delete.sql   # Lot EP (EP2): soft delete of social task claims (deleted_at + partial unique indexes); depends on v6, apply after it
psql "$DATABASE_URL" -f apps/api/src/db/stellar_v8_campaign_perks.sql   # Lot EP (EP3): wallet_perks, non-monetary perks granted by the award job (depends on v6; apply BEFORE the EP3 api build)
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
- **Docker-published ports bypass ufw** (S1, 2026-09-29): Docker's own iptables chains sit in
  FORWARD, ufw filters INPUT, so a compose `ports: "5432:5432"` is public even under ufw
  default-deny. Every binding in `docker-compose.yml` is now `127.0.0.1:` (Postgres, Redis, the
  Lot Z api service). Check after any container recreation: `ss -ltnp | grep -E ':(5432|6379) '`
  → `127.0.0.1` only. Invariant: `docs/security-invariants.md` §10.
- **Persistent `DOCKER-USER` wall** (S1 phase 7, 2026-09-29): `/etc/ufw/after.rules` declares the
  `DOCKER-USER` chain and drops every NEW inbound connection from `eth0` and `eth1` to any
  container (`-m conntrack --ctstate NEW -j DROP`, then `RETURN`). A port published on
  `0.0.0.0` by mistake is therefore unreachable from the internet whatever the compose file
  says; container outbound traffic and host services (nginx, ssh) are unaffected. **This block is
  ops state that must survive a VPS rebuild; recreate it from
  `docs/evidence/lot-ad/s1-remediation-execution.md` §Phase 7.** Verify: `iptables -L DOCKER-USER -n -v
  --line-numbers` → two `DROP … ctstate NEW` (eth0, eth1) + `RETURN`; from outside, `nc -zv -G 5
  <vps-ip> 5432` times out while `curl -sI https://stellar-api.getdig.ai/health` is 200. Rollback:
  `cp /root/after.rules.pre-s1 /etc/ufw/after.rules && ufw reload` (backup kept on the VPS).
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

---

## Lot ST deploy sequence (status page, Sept 2026) — ORDER MATTERS

The VPS pulls from `public-origin`, and the same push triggers Vercel — so the push comes
first, and the VPS deploy follows IMMEDIATELY: the web goes live ~2 min before the API, during
which `#status` shows its error state (acceptable — the page is new and unlinked from any user
flow). **No SQL to apply — Lot ST has no schema change** (it only reads `rpc_metrics_runs` +
`refresh_step_runs` as they are).

**(a) Push (one push; Vercel starts building the web immediately):**

```bash
git push origin main && git push public-origin main
```

**(b) VPS — API, immediately after:**

Remote naming: the VPS clone's only remote is **`origin`**
(`git@github.com:Mael-wnb/dig-stellar.git`); **`public-origin`** is the local dev clone's
name for that same repository — it does not exist on the VPS.

```bash
cd /root/dig-stellar
git pull origin main
pnpm install
pnpm -C apps/api build
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env
pm2 save
```

**(c) Verify (all three):**

```bash
# 1. New endpoint up, 200 + no-store:
curl -sI https://stellar-api.getdig.ai/v1/ops/status | egrep '^(HTTP|Cache-Control)'
#    -> HTTP/… 200 · Cache-Control: no-store

# 2. Payload sane (~96 runs at the 15-min cadence, operational, no gaps):
curl -s 'https://stellar-api.getdig.ai/v1/ops/status?window=24h' \
  | jq '{overall, n: (.runs|length), gaps, historySince}'

# 3. The /v1/ops/metrics steps fix (window filter): one recent timestamp, not Aug history:
curl -s https://stellar-api.getdig.ai/v1/ops/metrics | jq '[.steps[].lastRunAt] | unique'
```

**(d) Web checks:** `https://stellar.getdig.ai/#status` renders the live bars, a
`FreshnessChip` click (dashboard or pool detail) lands on `#status`, and a 390 px check on a
phone: the bar scrolls inside its own container, the body never pans horizontally.

Strict variant (only worth it when a web change would break on the old API): push
`<api-commit>:main` first, deploy the VPS from it, then push the rest and pull again.

---

## RP1 deploy — wallet-sweep RPC fix (Lot RP, 2026-10-27)

Indexer + API scripts + one SQL column; no web change, no new cron line, no env change. Order:

```bash
cd /root/dig-stellar
# 0. between two refresh ticks, locks free:
ls /tmp/dig-stellar-refresh.lock /tmp/dig-stellar-alert.lock; pgrep -af '81-stellar|71-refresh' | grep -v pgrep
git pull origin main && git log -1 --oneline
# 1. SQL first (idempotent): rpc_metrics_runs.job + methods
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar < apps/api/src/db/stellar_v1_ops_metrics_job.sql
# 2. deps + API build (ops.service now reads job = 'refresh'; 83 gets ops-capture-lite)
pnpm install --frozen-lockfile && pnpm -C apps/api build
GIT_SHA=$(git rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
# 3. one manual sweep, then read its cost row
pnpm -C apps/indexer job:wallet-alert 2>&1 | grep -E 'processedWallets|rpcBatches|\[ops\]'
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select run_at, calls, methods from rpc_metrics_runs where job='wallet-alert' order by run_at desc limit 1"
```

Expected: `calls` ≈ 44 for ~92 wallets (36 from 81 + 8 from 83), `methods` ≈
`{"getLedgerEntries": 20, "simulateTransaction": 24}`. The crontab stays on the hourly stopgap
(`7 * * * *`) until the provider's hourly chart shows the drop (next full hour after the deploy:
the sweep's share should fall from ~0.25M CU to a few thousand CU per run); only then restore
`7,22,37,52 * * * *` — four sweeps an hour now cost less than one did.

## Lot SEC Gate 1 deploy — request validation, refresh admission, ops redaction (2026-10-27)

API + indexer + web; no SQL, no env change, no new cron line. **Order matters: edge first, then
the API on the VPS, then the web on Vercel** — every change is backward compatible for the client,
so the web is last and never needs to go first.

### 1. nginx: two new per-IP zones (POST only)

Wallet creation and wallet refresh are the two cheapest-to-abuse writes; they get their own zones
on top of `api_general` / `api_mutations`. Rates come from the legitimate flow (add a wallet =
one create + one immediate refresh; a user refreshes by hand a few times an hour), not from
guesses. The map yields an empty key for anything but POST, so reads are exempt.

The full patched site file and the unified diff against the live file (dumped from the VPS on
2026-10-27) are in `docs/evidence/lot-sec/nginx-site-config-g1.conf` / `.diff`. The hunks:

```nginx
# http {} level (this site file holds every zone), right after the api_mutations zone
# Lot SEC G1 (2026-10-27): per-IP zones for the two cheapest-to-abuse writes, POST only.
map $request_method $wallet_write_key {
    default "";
    POST    $binary_remote_addr;
}
limit_req_zone $wallet_write_key zone=api_wallet_create:10m rate=6r/m;
limit_req_zone $wallet_write_key zone=api_wallet_refresh:10m rate=12r/m;

# server {} level, right BEFORE "location /v1/". The exact-match and regex locations win over
# the prefix location, so every directive of that block is repeated, plus the wallet zone.
# The regex MUST be quoted: an unquoted "{36}" is parsed by nginx as a block opener and
# nginx -t fails with 'unknown directive "36}/refresh$"'.
location = /v1/wallets {
    limit_req zone=api_general burst=60 nodelay;
    limit_req zone=api_mutations burst=20 nodelay;
    limit_req zone=api_wallet_create burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ~ "^/v1/wallets/[0-9a-fA-F-]{36}/refresh$" {
    limit_req zone=api_general burst=60 nodelay;
    limit_req zone=api_mutations burst=20 nodelay;
    limit_req zone=api_wallet_refresh burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Nothing else changes in this gate (headers, CSP, timeouts and the `@rate_limited` CORS echo are
Gate 3). Arithmetic: `rate=6r/m` + `burst=5` lets 6 POSTs through in the same instant and refuses
the 7th; the bucket drains one slot every 10 s (5 s for the refresh zone). The 429 is the nginx
JSON body without a `reason` field, which is how it is told apart from the API's own admission
429 (`docs/runbooks.md`). Proven locally on 2026-10-27 in a throwaway `nginx:stable` container
with no upstream (`502` = reached the proxy): `POST /v1/wallets` x7 → `502 x6, 429`;
`POST …/refresh` x7 → `502 x6, 429`; `GET /v1/wallets`, `POST /v1/wallets/<id>` and
`GET /v1/protocols` never 429 (`docs/evidence/lot-sec/g1.md` §5).

Apply against the LIVE files, not against the evidence copy in `docs/evidence/lot-s/` (it has
drifted). `sites-enabled/stellar-api.getdig.ai` is normally a symlink to `sites-available/`;
the first line resolves which file is real and patches that one. Procedure (as root):

```bash
# 0. which file is real
SITE=/etc/nginx/sites-enabled/stellar-api.getdig.ai
[ -L "$SITE" ] && SITE=$(readlink -f "$SITE"); echo "patching $SITE"
# 1. dated backup
cp -p "$SITE" /root/nginx-site.pre-sec-g1.$(date +%F) && ls -l /root/nginx-site.pre-sec-g1.*
# 2. write the new file next to it (paste docs/evidence/lot-sec/nginx-site-config-g1.conf
#    into the heredoc), then check that the diff is exactly the two hunks above
cat > /root/stellar-api.getdig.ai.sec-g1 <<'EOF'
…full content of docs/evidence/lot-sec/nginx-site-config-g1.conf…
EOF
diff -u "$SITE" /root/stellar-api.getdig.ai.sec-g1
# 3. install, test, reload (nginx -t fails -> nothing is reloaded, the old config keeps serving)
cp /root/stellar-api.getdig.ai.sec-g1 "$SITE" && nginx -t && systemctl reload nginx
# if sites-enabled was a plain file (not a symlink), keep sites-available identical:
[ -L /etc/nginx/sites-enabled/stellar-api.getdig.ai ] || cp "$SITE" /etc/nginx/sites-available/stellar-api.getdig.ai
# 4. verify (from any one IP; the API is already deployed, so it answers 400 for the bad address)
for i in $(seq 1 7); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://stellar-api.getdig.ai/v1/wallets -H 'content-type: application/json' -d '{"address":"not-an-address"}'; done; echo
#   expected: 400 400 400 400 400 400 429
curl -s -o /dev/null -w '%{http_code}\n' https://stellar-api.getdig.ai/v1/wallets             # 400 (userId required), never 429
for i in $(seq 1 7); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://stellar-api.getdig.ai/v1/wallets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/refresh; done; echo
#   expected: six 400/404 (unknown wallet, no DB write) then 429
curl -s -X POST https://stellar-api.getdig.ai/v1/wallets -d '{}' | head -c 120; echo       # nginx JSON body, no "reason"
curl -s -o /dev/null -w '%{http_code}\n' https://stellar-api.getdig.ai/v1/protocols         # 200
#   then load https://stellar.getdig.ai in a browser: dashboard + portfolio render, no 429 in the network tab
# rollback (one line)
cp /root/nginx-site.pre-sec-g1.$(date +%F) "$SITE" && nginx -t && systemctl reload nginx
```

The 429 from the verification burst clears by itself (one slot per 10 s). Keep this section, the
evidence copy and the live file in sync.

### 2. API on the VPS

```bash
cd /root/dig-stellar
git pull origin main && git log -1 --oneline
pnpm install --frozen-lockfile && pnpm -C apps/api build
GIT_SHA=$(git rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
# smoke (all from the VPS, no DB write):
curl -s -X POST https://stellar-api.getdig.ai/v1/wallets -H 'content-type: application/json' -d '{"address":"not-an-address"}'   # 400, names the field
curl -s https://stellar-api.getdig.ai/v1/ops/status?window=24h | grep -c 'https://[^"]*/\[redacted\]'                        # ≥ 0; no URL path anywhere
pm2 logs dig-stellar-api --lines 20 --nostream
```

The indexer side (`71-refresh-all-metrics.ts` redaction) rides the same pull; the next cron tick
picks it up, no restart needed.

### 3. Web on Vercel

Merge to the deploy branch as usual. The change is a client-side address check in the
add-wallet modal and friendlier copy on `429`; both work against the old API too.

## Campaign cron line (Lot EP, EP3)

A third OS-cron line (`job:campaign`, every 15 min at minutes 3/18/33/48, lock
`/tmp/dig-stellar-campaign.lock`, log `/var/log/dig-stellar-campaign.log`) runs the points award
job. The exact line, the install steps and the founder's activation sequence are in
`docs/runbooks.md` ("Install the campaign cron line", "Activate the campaign"). It is installed
while the campaign is dark (the job exits 0 with "campaign dark") and stays as is after
activation; activation itself is an env change (`CAMPAIGN_STARTS_AT`, `CAMPAIGN_ENABLED`,
`CAMPAIGN_X_REPOST_URL` in `apps/api/.env`) + `pm2 restart --update-env`, no build, no web
redeploy. Deploy checklist for the EP3 code itself: `docs/evidence/lot-ep/ep3-deploy.md`
(`stellar_v8_campaign_perks.sql` BEFORE the API build).

## Package changes on the VPS (S1 lesson, 2026-09-29)

`needrestart` on this Ubuntu auto-restarts services after an `apt` install (it restarted nginx,
cron, ssh, redis-server and more when `docker-compose-v2` was installed). Any `apt` on the VPS
runs with `NEEDRESTART_MODE=l` (list only) and never inside a maintenance window that holds the
cron locks (three since Lot EP: `/tmp/dig-stellar-refresh.lock`, `/tmp/dig-stellar-alert.lock`
and `/tmp/dig-stellar-campaign.lock` — the AD1 deploy script must take all three blocking with
`flock -w`; `docs/evidence/lot-ad/s1-remediation-runbook.md` shows the first two, add the third
when the campaign cron line is installed, see `docs/runbooks.md` "Campaign award job"):
```bash
NEEDRESTART_MODE=l apt-get install -y <package>
```
The Postgres image's `pg_hba.conf` trusts `local`, `127.0.0.1` and `::1` **inside the
container**; a `docker exec … psql -h 127.0.0.1` never tests a password. Password checks are
made from the host through `127.0.0.1:5432` (docker-proxy → `scram-sha-256`).
