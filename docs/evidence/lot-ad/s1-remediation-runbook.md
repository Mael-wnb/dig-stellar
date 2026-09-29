# S1 remediation runbook — loopback-only Postgres + `dig` password rotation (founder executes)

Version 2 — corrected after the 2026-09-29 execution (`s1-remediation-execution.md`): host-side
password tests only (the container's `pg_hba.conf` trusts loopback), install + build before the
recreation, `docker compose` v2 prerequisite, `NEEDRESTART_MODE=l`, `.env` modes. Kept as the
reference procedure for any future rotation or container recreation.

Context: `ad0-security-findings.md`. Target: VPS, root shell, repo at `/root/dig-stellar`,
container `dig_stellar_postgres` (the only container in prod — Redis is a native systemd
service on loopback, untouched here), API under pm2, indexer via cron.

Two windows:
- **Window S1: phases 0–6.** The temporary DOCKER-USER rules stay in place, no reboot.
- **Separate slot: phase 7** (persistent DOCKER-USER rule) — its own section at the end.

Rules: every phase ends with a check; a failed check is a STOP, not a "probably fine".
Paste outputs into the execution note with password lines masked. **Public/private split**: the
execution note records the procedure outcomes (bindings, volume, health, row counts, cron
tick). The results of the password tests (0e, 5), any authentication-failure counts from the
container log and source addresses go to the founder's private journal outside the repo, never
into `docs/`. The new password is generated on the VPS, held in a shell variable that is
**never exported**, and unset before anything touches pm2.

**How passwords are tested here.** The official postgres image ships a `pg_hba.conf` with
`local`, `127.0.0.1/32` and `::1/128` in `trust`; only `host all all all` is `scram-sha-256`.
So `docker exec … psql -h 127.0.0.1` runs *inside* the container and accepts any password —
it proves nothing. Every password test below runs **from the host** through `127.0.0.1:5432`,
which enters through docker-proxy and hits the `scram-sha-256` line. The tool is node + `pg`
from `apps/indexer` (the same resolution the cron uses):
```bash
# helper: connect with an explicit URL, print ok/FAIL, never print the URL
pgtest() { (cd /root/dig-stellar/apps/indexer && node -e "const {Client}=require('pg');const c=new Client({connectionString:process.argv[1]});c.connect().then(()=>c.query('select 1 as ok')).then(r=>{console.log('ok',r.rows[0].ok);return c.end()}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})" "$1"); }
```

Prerequisites: the fix is merged to `main` and pushed to both remotes (§1 flow); `docker compose
version` prints a v2 plugin. If only `docker-compose` v1 exists, install `docker-compose-v2`
**before the window and outside the locks** with `NEEDRESTART_MODE=l apt-get install -y
docker-compose-v2` (needrestart otherwise auto-restarts nginx, cron, ssh, redis and more), then
check `docker compose ps` recognises the existing project before touching anything.

---

## Phase 0 — Read-only preflight (STOP conditions inside)

```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH
cd /root/dig-stellar
docker compose version                      # v2 plugin required (see prerequisites)

# 0a. Which compose project owns the container, and where the data lives
docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}  {{.Status}}'            # dig_stellar_postgres only
docker inspect dig_stellar_postgres --format 'project={{index .Config.Labels "com.docker.compose.project"}}  wd={{index .Config.Labels "com.docker.compose.project.working_dir"}}  cfg={{index .Config.Labels "com.docker.compose.project.config_files"}}  svc={{index .Config.Labels "com.docker.compose.service"}}'
docker inspect dig_stellar_postgres --format '{{range .Mounts}}{{.Type}}  {{.Name}}  ->  {{.Destination}}{{"\n"}}{{end}}'
docker compose ls
docker volume ls
```
**GO only if**: the mount is `volume  <project>_dig_stellar_pgdata  ->  /var/lib/postgresql/data`
(type `volume`, not `bind`, not anonymous), `project` equals what `docker compose ls` shows for
`/root/dig-stellar`, and `cfg` is `/root/dig-stellar/docker-compose.yml`. Anything else (no
labels = created with `docker run`; another working dir; a bind mount) → **STOP and paste**:
`docker compose up` from the repo would create a *second* stack with an *empty* volume.

```bash
# 0b. Every place DATABASE_URL is defined — NAMES ONLY, never cat these files.
#     Needed for the crons: `bash -lc` is a login shell, so root's profile is sourced and an
#     exported DATABASE_URL there would win over apps/indexer/.env (dotenv never overrides).
ls -la apps/api/.env apps/indexer/.env .env 2>&1                    # modes must be 600 (fix: chmod 600)
grep -c '^DATABASE_URL=' apps/api/.env apps/indexer/.env          # must print 1 for BOTH
grep -l 'DATABASE_URL' /root/.bashrc /root/.profile /root/.bash_profile /etc/environment /etc/profile.d/* /root/.pm2/dump.pm2 2>/dev/null; echo "(profile scan end — ideally empty)"
pm2 env "$(pm2 id dig-stellar-api | tr -d '[] ')" | cut -d= -f1 | grep -c '^DATABASE_URL$'   # expected 0
sed -E 's#(://[^:]+:)[^@]*@#\1***@#' apps/api/.env | grep '^DATABASE_URL='   # shape only, password masked
```
`apps/indexer/.env` MUST define `DATABASE_URL`: the indexer's `getDatabaseUrl()`
(`src/scripts/shared/db.ts`) falls back to `dig:dig@localhost` when it is unset, which would
silently break after the rotation. Any profile file listed → phase 3e handles it.

```bash
# 0c. Baseline (compared again in phase 5)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc \
  "select (select count(*) from reserve_snapshots), (select max(as_of) from network_tvl_snapshots), (select count(*) from faucet_claims), (select count(*) from user_wallets)"
curl -s http://127.0.0.1:3000/health | head -c 200; echo
ss -ltnp | grep -E ':(5432|6379) '                          # 5432 on 0.0.0.0 before the fix; 6379 = native redis on loopback
iptables -L DOCKER-USER -n -v --line-numbers               # the temporary rules (kept through S1)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "show log_connections; show password_encryption;"

# 0d. Container log: driver, rotation, current size (the recreation replaces the log file)
docker inspect dig_stellar_postgres --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'
ls -la "$(docker inspect dig_stellar_postgres --format '{{.LogPath}}')"          # size only in the execution note; log CONTENT stays private
cat /etc/docker/daemon.json 2>&1
```
`password_encryption` must be `scram-sha-256` (PG16 default); `md5` → STOP and paste.
`LogConfig` `json-file map[]` = no rotation: the fix adds `max-size 20m / max-file 5` in compose
and the phase-4 recreation applies it — no extra recreation.

```bash
# 0e. BEFORE any rotation — is the current password still the public compose default?
#     After phase 3 the question can no longer be answered. HOST-SIDE test (see header).
pgtest 'postgresql://dig:dig@127.0.0.1:5432/dig_stellar'
```
Result (`ok 1` = yes, `FAIL password authentication failed` = no) → **private journal only**.

---

## Phase 1 — Fast-forward the VPS clone to the fix, install, build

The ff-merge moves HEAD while `apps/api/dist` is still the previous build; restarting without
building is the 2026-09-28 incident. Install + build happen **here**, before the window, so the
restart in phase 4 can follow the container recreation within seconds (the API keeps the old
password in its pool until it restarts — the shorter that gap, the shorter the outage).

```bash
cd /root/dig-stellar
git status --short                                          # must print NOTHING (else STOP, paste)
git fetch origin && git merge --ff-only origin/main && git log -1 --format='%h %ci %s'
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
pnpm -C apps/api build
ls -la apps/api/dist/main.js                                # fresh timestamp
```
`docker compose config` is checked in phase 3d, after the root `.env` carries the required
`POSTGRES_PASSWORD` (the fix makes it mandatory; config fails loudly before that).

---

## Phase 2 — Open the maintenance window (hold both cron locks)

```bash
exec 8>/tmp/dig-stellar-refresh.lock 9>/tmp/dig-stellar-alert.lock
flock -w 900 8 && flock -w 900 9 && echo "locks held at $(date -u +%H:%M:%SZ)"
```
Waits for a running refresh to finish (≤ 15 min); the cron's `flock -n` then skips its ticks
until this shell exits. Everything below runs in **this** shell.

```bash
# Preserve the evidence before the container (and its log file) is replaced. Stays on the VPS.
umask 077
docker logs dig_stellar_postgres 2>&1 | gzip > /root/s1-postgres-log-pre-recreate.log.gz
ls -la /root/s1-postgres-log-pre-recreate.log.gz            # mode 600
```

---

## Phase 3 — Rotate the `dig` password (value never leaves this shell, never exported)

```bash
umask 077
set +o history
NEWPW="$(openssl rand -hex 24)"; [ ${#NEWPW} -eq 48 ] && echo "generated"     # plain shell variable, NOT export

# 3a. ALTER USER via stdin (not argv). The container socket is `trust`, so this needs no
#     password — and, for the same reason, it cannot be used to PROVE the new one (3c does).
printf "ALTER USER dig WITH PASSWORD '%s';\n" "$NEWPW" | docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -v ON_ERROR_STOP=1

# 3b. Connection logging on (persists in postgresql.auto.conf inside the volume)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -v ON_ERROR_STOP=1 -c "alter system set log_connections = on;" -c "select pg_reload_conf();"

# 3c. The two .env files the apps read (dotenv, cwd = apps/api and apps/indexer), then the
#     HOST-SIDE proof with the indexer's own env resolution
for f in apps/api/.env apps/indexer/.env; do
  cp -p "$f" "$f.pre-s1"
  sed -i -E "s#(DATABASE_URL=\"?postgresql://dig:)[^@]*(@)#\1${NEWPW}\2#" "$f"
  chmod 600 "$f" "$f.pre-s1"
  [ "$(sed -n 's/^DATABASE_URL="\{0,1\}postgresql:\/\/dig:\([^@]*\)@.*/\1/p' "$f")" = "$NEWPW" ] && echo "$f updated" || echo "STOP: $f NOT updated"
done
(cd apps/indexer && node --env-file=.env -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL.replace('?schema=public','')});c.connect().then(()=>c.query('select 1 as ok')).then(r=>{console.log('new password ok',r.rows[0].ok);return c.end()}).catch(e=>{console.error('new password FAIL',e.message);process.exit(1)})")

# 3d. Root compose .env — REQUIRED by the fixed compose file (no default), and the value a
#     future volume re-init would use
touch .env && chmod 600 .env
if grep -q '^POSTGRES_PASSWORD=' .env; then sed -i -E "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${NEWPW}#" .env; else printf 'POSTGRES_PASSWORD=%s\n' "$NEWPW" >> .env; fi
grep -c '^POSTGRES_PASSWORD=' .env                                  # → 1
docker compose config | grep -E 'host_ip|published|max-size'        # host_ip 127.0.0.1 for 5432 and 6379, max-size 20m

# 3e. ONLY IF phase 0b listed a profile file: same sed on each, AND drop the stale export from
#     this shell so `pm2 restart --update-env` (phase 4) cannot push the old value:
#     sed -i -E "s#(DATABASE_URL=\"?postgresql://dig:)[^@]*(@)#\1${NEWPW}\2#" <that file>
#     unset DATABASE_URL

unset NEWPW                                                          # nothing below needs the value
```

---

## Phase 4 — Recreate the Postgres container (postgres ONLY), restart the API right after

```bash
docker compose up -d postgres                                       # NOT redis: prod redis is native on :6379 already
docker inspect dig_stellar_postgres --format '{{range .Mounts}}{{.Type}}  {{.Name}}{{"\n"}}{{end}}'   # SAME volume name as phase 0a — STOP if not
docker inspect dig_stellar_postgres --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'  # json-file map[max-file:5 max-size:20m]
docker port dig_stellar_postgres                                    # 127.0.0.1:5432 only

cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
cd /root/dig-stellar
sleep 3; curl -s http://127.0.0.1:3000/health | head -c 200; echo   # db.ok true, version = phase-1 sha
```
Volume name different from phase 0a → **STOP before the restart**: do not `down` anything;
paste and we look at it together (the data is in the old volume in every scenario).

---

## Phase 5 — Verify against the baseline

```bash
cd /root/dig-stellar
docker ps --format '{{.Names}}  {{.Ports}}  {{.Status}}'
ss -ltnp | grep -E ':(5432|6379) '                                  # 5432 → 127.0.0.1 only; 6379 unchanged (native)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "show log_connections"   # on

# Leak check — key NAMES only, never values: none of these may appear
pm2 env "$(pm2 id dig-stellar-api | tr -d '[] ')" | cut -d= -f1 | grep -cE '^(NEWPW|PGPASSWORD|DATABASE_URL)$'   # → 0

docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc \
  "select (select count(*) from reserve_snapshots), (select max(as_of) from network_tvl_snapshots), (select count(*) from faucet_claims), (select count(*) from user_wallets)"
#   → every value >= phase 0c (nothing lost)

# HOST-SIDE: the old password must now be refused. Result → private journal, not here.
pgtest 'postgresql://dig:dig@127.0.0.1:5432/dig_stellar'            # expected: FAIL password authentication failed
git status --short                                                  # still clean
```

---

## Phase 6 — Close the window, clean up, external check

```bash
set -o history
exec 8>&- 9>&-                                                      # release both locks
shred -u apps/api/.env.pre-s1 apps/indexer/.env.pre-s1              # ONLY after phase 5 is fully green
tail -f /var/log/dig-stellar-refresh.log                            # next :00/:15/:30/:45 tick ends with "completed successfully"
```
From outside the VPS: `nc -G 5 -vz <vps-ip> 5432` → timeout. `iptables -L DOCKER-USER -n -v`
still shows the temporary rules — they stay until phase 7; **no reboot** in between.

**End of window S1.**

---

## Phase 7 — SEPARATE SLOT: persistent, generalised DOCKER-USER rule (ufw-docker pattern)

Not part of the S1 window. Replaces the temporary 5432-only rules with one structural rule:
drop every *new* inbound connection from the public interfaces to any container, so a future
`ports:` mistake or an ad-hoc `docker run -p` can never be public, whatever compose says.
Persisted through ufw (`/etc/ufw/after.rules`, the known ufw-docker pattern with the
`:DOCKER-USER - [0:0]` chain declaration) so it survives reboots and Docker restarts.
Container outbound traffic is unaffected (`ESTABLISHED,RELATED` returns pass); host services
(nginx 80/443, ssh 22) never traverse `DOCKER-USER`. **Must happen before any reboot.**

Safety: **open a second SSH session first and keep it open** for the whole slot.

```bash
cp -p /etc/ufw/after.rules /root/after.rules.pre-s1
cat >> /etc/ufw/after.rules <<'RULES'

# S1 (2026-09-29): Docker publishes ports around ufw. Drop every NEW inbound connection
# from the public interfaces to any container. docs/security-invariants.md §10.
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -i eth0 -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -i eth1 -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -j RETURN
COMMIT
RULES
iptables -F DOCKER-USER                                             # temporary rules out
ufw reload && iptables -L DOCKER-USER -n -v --line-numbers          # two DROP + RETURN, nothing else
curl -s http://127.0.0.1:3000/health | head -c 80; echo             # loopback path untouched
ss -ltnp | grep -E ':(5432) '                                       # still 127.0.0.1
```
From outside the VPS: `nc -G 5 -vz <vps-ip> 5432` → timeout; `curl -sI https://stellar-api.getdig.ai/health | head -1` → 200
(nginx path unaffected). If `ufw reload` reports an error: `cp /root/after.rules.pre-s1
/etc/ufw/after.rules && ufw reload`, then paste. Record the outcome in the execution note.
