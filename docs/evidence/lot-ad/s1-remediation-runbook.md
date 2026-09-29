# S1 remediation runbook — loopback-only Postgres + `dig` password rotation (founder executes)

Context: `ad0-security-findings.md`. Target: VPS, root shell, repo at `/root/dig-stellar`,
container `dig_stellar_postgres` (the only container in prod — Redis is a native systemd
service on loopback, untouched here), API under pm2, indexer via cron.

Two windows:
- **Window S1 (today): phases 0–6.** The temporary DOCKER-USER rules stay in place, no reboot.
- **Separate slot: phase 7** (persistent DOCKER-USER rule) — its own section at the end.

Rules: every phase ends with a check; a failed check is a STOP, not a "probably fine".
Paste outputs into `s1-remediation-execution.md` with password lines masked. **Public/private
split**: the execution note records the procedure outcomes (bindings, volume, health, row
counts, cron tick). The result of the old-password test (phase 5), any authentication-failure
counts from the container log (phase 0d / phase 2 archive) and source addresses go to the
founder's private journal outside the repo, never into `docs/`. The new password
is generated on the VPS, held in a shell variable that is **never exported**, and unset before
anything touches pm2. Pre-requisite: the fix branch is merged to `main` and pushed to both
remotes (§1 flow), so phase 1 can fast-forward to it.

---

## Phase 0 — Read-only preflight (STOP conditions inside)

```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH
cd /root/dig-stellar
docker compose version                      # v2 plugin expected ("docker compose", not "docker-compose")

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
#     (pm2 env keys did NOT include DATABASE_URL in the 2026-09-28 preflight — the API reads
#     apps/api/.env via dotenv; re-check anyway.)
ls -la apps/api/.env apps/indexer/.env .env 2>&1
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
ss -ltnp | grep -E ':(5432|6379) '                          # 5432 on 0.0.0.0 today; 6379 = native redis on 127.0.0.1/::1
iptables -L DOCKER-USER -n -v --line-numbers               # the temporary rules (kept through S1)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "show log_connections; show password_encryption;"

# 0d. Container log: driver, rotation, current size (the recreation replaces the log file)
docker inspect dig_stellar_postgres --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'
ls -la "$(docker inspect dig_stellar_postgres --format '{{.LogPath}}')"          # size only in the execution note; log CONTENT stays private
cat /etc/docker/daemon.json 2>&1
```
`password_encryption` must be `scram-sha-256` (PG16 default); `md5` → STOP and paste.
`LogConfig` is expected to be `json-file map[]` (no rotation): the fix adds `max-size 20m /
max-file 5` in compose and the phase-4 recreation applies it — no extra recreation.

```bash
# 0e. BEFORE any rotation — was the current password still the public compose default?
#     The old compose hard-coded POSTGRES_PASSWORD: dig; whether an ALTER USER ever happened since
#     the volume was initialised is unknown, and after phase 3 the question can no longer be
#     answered. `-h 127.0.0.1` is MANDATORY: the container's local socket is `trust`, a socket
#     connection would answer YES whatever the password.
PGPASSWORD=dig docker exec -i -e PGPASSWORD dig_stellar_postgres psql -h 127.0.0.1 -U dig -d dig_stellar -tAc 'select 1'; echo "default-password test exit=$?"
```
Result (YES = `1` printed / exit 0, NO = authentication error) → **private journal only**, the
field exists there. Nothing about it in `docs/` or the execution note. The phase-5 check ("old
password refused after rotation") is a different test and stays.

---

## Phase 1 — Fast-forward the VPS clone to the fix

```bash
cd /root/dig-stellar
git status --short                                          # must print NOTHING (else STOP, paste)
git fetch origin && git merge --ff-only origin/main && git log -1 --format='%h %ci %s'
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
docker logs dig_stellar_postgres 2>&1 | gzip > /root/s1-postgres-log-pre-recreate.log.gz
ls -la /root/s1-postgres-log-pre-recreate.log.gz
```

---

## Phase 3 — Rotate the `dig` password (value never leaves this shell, never exported)

```bash
umask 077
set +o history
NEWPW="$(openssl rand -hex 24)"; [ ${#NEWPW} -eq 48 ] && echo "generated"     # plain shell variable, NOT export

# 3a. ALTER USER via stdin (not argv), then prove it over TCP (socket auth is trust, TCP is not).
#     `-e PGPASSWORD` without a value forwards the variable from the docker CLI's environment;
#     the leading assignment scopes it to that single command — nothing is exported.
printf "ALTER USER dig WITH PASSWORD '%s';\n" "$NEWPW" | docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -v ON_ERROR_STOP=1
PGPASSWORD="$NEWPW" docker exec -i -e PGPASSWORD dig_stellar_postgres psql -h 127.0.0.1 -U dig -d dig_stellar -Atc 'select 1'    # → 1

# 3b. Connection logging on (persists in postgresql.auto.conf inside the volume)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -v ON_ERROR_STOP=1 -c "alter system set log_connections = on;" -c "select pg_reload_conf();"

# 3c. The two .env files the apps read (dotenv, cwd = apps/api and apps/indexer)
for f in apps/api/.env apps/indexer/.env; do
  cp -p "$f" "$f.pre-s1"
  sed -i -E "s#(DATABASE_URL=\"?postgresql://dig:)[^@]*(@)#\1${NEWPW}\2#" "$f"
  [ "$(sed -n 's/^DATABASE_URL="\{0,1\}postgresql:\/\/dig:\([^@]*\)@.*/\1/p' "$f")" = "$NEWPW" ] && echo "$f updated" || echo "STOP: $f NOT updated"
done

# 3d. Root compose .env — REQUIRED by the fixed compose file (no default), and the value a
#     future volume re-init would use
touch .env && chmod 600 .env
if grep -q '^POSTGRES_PASSWORD=' .env; then sed -i -E "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${NEWPW}#" .env; else printf 'POSTGRES_PASSWORD=%s\n' "$NEWPW" >> .env; fi
grep -c '^POSTGRES_PASSWORD=' .env                                  # → 1
docker compose config | grep -E 'host_ip|published|max-size'        # host_ip 127.0.0.1 for 5432 and 6379, max-size 20m

# 3e. ONLY IF phase 0b listed a profile file: same sed on each, AND drop the stale export from
#     this shell so `pm2 restart --update-env` (phase 5) cannot push the old value:
#     sed -i -E "s#(DATABASE_URL=\"?postgresql://dig:)[^@]*(@)#\1${NEWPW}\2#" <that file>
#     unset DATABASE_URL
```

---

## Phase 4 — Recreate the Postgres container with the loopback binding (postgres ONLY)

```bash
docker compose up -d postgres                                       # NOT redis: prod redis is native on :6379 already
docker ps --format '{{.Names}}  {{.Ports}}  {{.Status}}'
docker inspect dig_stellar_postgres --format '{{range .Mounts}}{{.Type}}  {{.Name}}{{"\n"}}{{end}}'   # SAME volume name as phase 0a
docker inspect dig_stellar_postgres --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'  # json-file map[max-file:5 max-size:20m]
docker port dig_stellar_postgres                                    # 127.0.0.1:5432 only
ss -ltnp | grep -E ':(5432|6379) '                                  # 5432 → 127.0.0.1 only; 6379 unchanged (native)
PGPASSWORD="$NEWPW" docker exec -i -e PGPASSWORD dig_stellar_postgres psql -h 127.0.0.1 -U dig -d dig_stellar -Atc "show log_connections"   # on
```
Volume name different from phase 0a → **STOP**: do not `down` anything; paste and we look at
it together (the data is in the old volume in every scenario).

---

## Phase 5 — Install + build + API restart, then verify against the baseline

The ff-merge moved HEAD to the S1 commit while `apps/api/dist` is still the previous build.
Restarting without building is the 2026-09-28 incident; install + build come first so
`/health.version == HEAD` is true for the right reason (this is the manual form of what the
AD1 script automates).

```bash
cd /root/dig-stellar
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
pnpm -C apps/api build

unset NEWPW PGPASSWORD                                              # BEFORE pm2 sees this shell's env
cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
sleep 3; curl -s http://127.0.0.1:3000/health | head -c 200; echo   # db.ok true, version = phase-1 sha

# Leak check — key NAMES only, never values: none of these may appear
pm2 env "$(pm2 id dig-stellar-api | tr -d '[] ')" | cut -d= -f1 | grep -cE '^(NEWPW|PGPASSWORD|DATABASE_URL)$'   # → 0

cd /root/dig-stellar
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc \
  "select (select count(*) from reserve_snapshots), (select max(as_of) from network_tvl_snapshots), (select count(*) from faucet_claims), (select count(*) from user_wallets)"
#   → every value >= phase 0c (nothing lost)
# Old password must now be refused (exit non-zero). Record the RESULT in the private journal, not here.
PGPASSWORD=dig docker exec -i -e PGPASSWORD dig_stellar_postgres psql -h 127.0.0.1 -U dig -d dig_stellar -Atc 'select 1'; echo "old-password exit=$?"

# Indexer path with the new apps/indexer/.env — read-only, same env resolution as the cron
# (cwd apps/indexer, dotenv); no job is run inside the window:
cd /root/dig-stellar/apps/indexer && node --env-file=.env -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL.replace('?schema=public','')});c.connect().then(()=>c.query('select 1 as ok')).then(r=>{console.log('indexer env ok',r.rows[0].ok);return c.end()}).catch(e=>{console.error('indexer env FAIL',e.message);process.exit(1)})"; cd /root/dig-stellar
```

---

## Phase 6 — Close the window, clean up, external check

```bash
set -o history
exec 8>&- 9>&-                                                      # release both locks
shred -u apps/api/.env.pre-s1 apps/indexer/.env.pre-s1              # ONLY after phase 5 is fully green
tail -f /var/log/dig-stellar-refresh.log                            # next :00/:15/:30/:45 tick ends with "completed successfully"
```
From your Mac (not the VPS): `nc -G 5 -vz <vps-ip> 5432` → timeout. `iptables -L DOCKER-USER
-n -v` still shows the temporary rules — they stay until phase 7; **no reboot** in between.

**End of window S1.**

---

## Phase 7 — SEPARATE SLOT: persistent, generalised DOCKER-USER rule (ufw-docker pattern)

Not part of the S1 window. Replaces the temporary 5432-only rules with one structural rule:
drop every *new* inbound connection from the public interfaces to any container, so a future
`ports:` mistake or an ad-hoc `docker run -p` can never be public, whatever compose says.
Persisted through ufw (`/etc/ufw/after.rules`, the known ufw-docker pattern with the
`:DOCKER-USER - [0:0]` chain declaration) so it survives reboots and Docker restarts.
Container outbound traffic is unaffected (`ESTABLISHED,RELATED` returns pass); host services
(nginx 80/443, ssh 22) never traverse `DOCKER-USER`.

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
From your Mac: `nc -G 5 -vz <vps-ip> 5432` → timeout; `curl -sI https://stellar-api.getdig.ai/health | head -1` → 200
(nginx path unaffected). If `ufw reload` reports an error: `cp /root/after.rules.pre-s1
/etc/ufw/after.rules && ufw reload`, then paste. Record the outcome in the execution note.
