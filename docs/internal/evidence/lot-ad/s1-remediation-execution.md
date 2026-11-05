# S1 remediation — execution note (2026-09-29)

Runbook: `s1-remediation-runbook.md` (v2 in this commit carries the corrections learned here).
Executed by the founder on the VPS, phases 0–6 in one window, **13:09:27Z → 13:15:55Z**.
Captures below are the terminal outputs in the real execution order, trimmed to the relevant
lines; the VPS IP is masked as `<vps-ip>`, container ids as `<id>`. Anything about the old
password or the container log content is deliberately not here (`[omitted — private journal]`).
In-container password tests are shown only as what they are: invalid (see the `pg_hba` note).

## Result

| Check | Before | After |
|---|---|---|
| Postgres binding (`docker port`, `ss -ltnp`) | `0.0.0.0:5432` + `[::]:5432` | `127.0.0.1:5432` only |
| External TCP test from outside the VPS | `succeeded` (before the temporary rules) | `Operation timed out` |
| Data volume | `dig-stellar_dig_stellar_pgdata` | same volume, same name |
| Container log driver | `json-file map[]` (no rotation) | `json-file map[max-file:5 max-size:20m]` |
| `log_connections` | `off` | `on` |
| `/health` | `db.ok true`, `version 18072ca` | `db.ok true`, `version 521d436` = HEAD after install + build |
| pm2 env keys `NEWPW` / `PGPASSWORD` / `DATABASE_URL` | — | 0 (names checked, values never printed) |
| Baseline (`reserve_snapshots`, `max(as_of)` network TVL, `faucet_claims`, `user_wallets`) | `411360 / 12:52Z / 100 / 115` | `411430 / 13:07Z / 100 / 115` (≥ baseline) |
| `git status` on the VPS | clean | clean |
| `.env` file modes (api, indexer, root) | `644` | `600` (also the archived container log) |
| Indexer via cron after the window (`bash -lc`, dotenv) | — | 13:30Z refresh 10/10 steps, alert sweep OK |

The `dig` role password was rotated in place; the value was generated on the VPS and never
displayed. The 13:15Z refresh tick was skipped by the cron's `flock -n` while the window held
the locks (expected); the next tick ran normally. **Conclusion: the indexer, launched by cron
(`bash -lc`, dotenv from `apps/indexer/.env`), works with the rotated password.**

## Captures

### Temporary mitigation (morning, before S1) — from outside the VPS

```
$ nc -zv -w 5 <vps-ip> 5432
Connection to <vps-ip> port 5432 [tcp/postgresql] succeeded!
(after the DROP rules in DOCKER-USER on eth0/eth1)
$ nc -zv -G 5 <vps-ip> 5432
nc: connectx to <vps-ip> port 5432 (tcp) failed: Operation timed out
```

### Phase 0 — preflight (read-only)

```
docker: unknown command: docker compose        # v2 plugin absent at this point
=== 0a
dig_stellar_postgres  postgres:16  0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp  Up 6 weeks
project=dig-stellar  wd=/root/dig-stellar  cfg=docker-compose.yml  svc=postgres
volume  dig-stellar_dig_stellar_pgdata  ->  /var/lib/postgresql/data
DRIVER    VOLUME NAME
local     dig-stellar_dig_stellar_pgdata
local     dig-stellar_dig_stellar_redisdata
=== 0b
-rw-r--r-- 1 root root    1 Aug 18 19:31 .env
-rw-r--r-- 1 root root  484 Aug 20 16:10 apps/api/.env
-rw-r--r-- 1 root root 1279 Jun 11 13:54 apps/indexer/.env
apps/api/.env:1
apps/indexer/.env:1
(profile scan end — ideally empty)
0
DATABASE_URL="postgresql://dig:***@localhost:5432/dig_stellar?schema=public"
=== 0c
411360|2026-09-29 12:52:00+00|100|115
{"status":"ok","version":"18072ca","uptimeSeconds":79203,"db":{"ok":true,"latencyMs":26},...}
LISTEN 0 511   127.0.0.1:6379  0.0.0.0:*  users:(("redis-server",pid=813,fd=6))
LISTEN 0 4096    0.0.0.0:5432  0.0.0.0:*  users:(("docker-proxy",pid=1569,fd=7))
LISTEN 0 4096       [::]:5432     [::]:*  users:(("docker-proxy",pid=1576,fd=7))
LISTEN 0 511       [::1]:6379     [::]:*  users:(("redis-server",pid=813,fd=7))
Chain DOCKER-USER (1 references)
num pkts bytes target prot opt in   out source    destination
1      0     0 DROP   tcp  --  eth1 *   0.0.0.0/0 0.0.0.0/0  ctorigdstport 5432
2     27  1592 DROP   tcp  --  eth0 *   0.0.0.0/0 0.0.0.0/0  ctorigdstport 5432
off
scram-sha-256
=== 0d
json-file map[]
-rw-r----- 1 root root 243247649 Sep 29 12:53 /var/lib/docker/containers/<id>/<id>-json.log
cat: /etc/docker/daemon.json: No such file or directory
=== 0e
[omitted — private journal; in-container test, invalid anyway (pg_hba trust on loopback)]
=== extra: gitignore
.gitignore:69:.env      .env
.gitignore:69:.env      apps/api/.env
.gitignore:69:.env      apps/indexer/.env
check-ignore exit=0
```

### Compose diagnosis + v2 plugin install (outside the locks)

```
/usr/bin/docker-compose
docker-compose version 1.29.2, build unknown
docker-py version: 5.0.3
server=29.1.3
containerd 2.2.1-0ubuntu1~22.04.2
docker-compose 1.29.2-1
docker.io 29.1.3-0ubuntu3~22.04.2
python3-docker 5.0.3-1
/usr/libexec/docker/cli-plugins:
docker-trust
docker-compose-v2:
  Installed: (none)
  Candidate: 2.40.3+ds1-0ubuntu1~22.04.1
$ docker-compose ps
dig_stellar_postgres   docker-entrypoint.sh postgres   Up   0.0.0.0:5432->5432/tcp,:::5432->5432/tcp
$ apt-get install -y docker-compose-v2
Setting up docker-compose-v2 (2.40.3+ds1-0ubuntu1~22.04.1) ...
Restarting services...
 systemctl restart containerd.service cron.service irqbalance.service multipathd.service nginx.service
 packagekit.service polkit.service rabbitmq-server.service redis-server.service serial-getty@ttyS0.service
 ssh.service systemd-journald.service systemd-networkd.service systemd-resolved.service
 systemd-timesyncd.service systemd-udevd.service
Service restarts being deferred:
 systemctl restart docker.service  (+ getty@tty1, networkd-dispatcher, systemd-logind, unattended-upgrades, user@0)
No containers need to be restarted.
Docker Compose version 2.40.3+ds1-0ubuntu1~22.04.1
config OK
NAME                   IMAGE         SERVICE    CREATED        STATUS       PORTS
dig_stellar_postgres   postgres:16   postgres   5 months ago   Up 6 weeks   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp
NAME          STATUS       CONFIG FILES
dig-stellar   running(1)   docker-compose.yml
```

### Check after the needrestart restarts

```
{"status":"ok","version":"18072ca","uptimeSeconds":79661,"db":{"ok":true,"latencyMs":8},...}
Chain DOCKER-USER (1 references)
1    DROP  tcp  --  0.0.0.0/0  0.0.0.0/0  ctorigdstport 5432
2    DROP  tcp  --  0.0.0.0/0  0.0.0.0/0  ctorigdstport 5432
active (nginx) / active (cron) / active (ssh) / active (docker)
HTTP/1.1 200 OK   (https://stellar-api.getdig.ai/health)
```

### S2 partial — VPS remote to HTTPS (no credential)

```
$ git remote set-url origin https://github.com/Mael-wnb/dig-stellar.git
$ git fetch origin && git remote -v && git log --oneline -1 origin/main
   0d0a868..521d436  main -> origin/main
origin  https://github.com/Mael-wnb/dig-stellar.git (fetch)
origin  https://github.com/Mael-wnb/dig-stellar.git (push)
521d436 (origin/main) fix(s1): loopback-only Docker ports, required Postgres password, container log rotation
```

### Phase 1 — fast-forward

```
(git status --short: empty)
Updating 18072ca..521d436
Fast-forward
 9 files changed, 454 insertions(+), 23 deletions(-)
521d436 2026-09-29 14:42:05 +0200 fix(s1): loopback-only Docker ports, required Postgres password, container log rotation
```

### Phase 2 — window open

```
locks held at 13:09:27Z
-rw-r--r-- 1 root root 7849663 Sep 29 13:09 /root/s1-postgres-log-pre-recreate.log.gz
$ chmod 600 /root/s1-postgres-log-pre-recreate.log.gz
```

### Phase 3 — rotation (value never displayed)

```
generated
ALTER ROLE
[3a in-container "select 1" → 1 : invalid test, see pg_hba note]
ALTER SYSTEM
 pg_reload_conf
----------------
 t
apps/api/.env updated
apps/indexer/.env updated
1
        max-size: 20m
        host_ip: 127.0.0.1
        published: "5432"
        max-size: 20m
        host_ip: 127.0.0.1
        published: "6379"
    max-size: 20m
-rw------- 1 root root   68 Sep 29 13:10 .env
-rw------- 1 root root  529 Sep 29 13:10 apps/api/.env
-rw------- 1 root root 1324 Sep 29 13:10 apps/indexer/.env
```

### Install + generate + build (moved BEFORE the recreation; runbook v2 phase 1)

```
Scope: all 5 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 2.6s using pnpm v10.32.1
✔ Generated Prisma Client (v5.22.0) ... in 187ms
> api@0.0.1 build /root/dig-stellar/apps/api
> nest build
BUILD OK
```

### Phase 4 — recreation + API restart chained (guarded by the volume name)

```
 ✔ Container dig_stellar_postgres  Started   1.2s
postgres ready
dig_stellar_postgres  127.0.0.1:5432->5432/tcp  Up 1 second (health: starting)
volume=dig-stellar_dig_stellar_pgdata
json-file map[max-file:5 max-size:20m]
5432/tcp -> 127.0.0.1:5432
LISTEN 0 511   127.0.0.1:6379  0.0.0.0:*  users:(("redis-server",pid=804867,fd=6))
LISTEN 0 4096  127.0.0.1:5432  0.0.0.0:*  users:(("docker-proxy",pid=806876,fd=7))
LISTEN 0 511       [::1]:6379     [::]:*  users:(("redis-server",pid=804867,fd=7))
on
[PM2] [dig-stellar-api](1) ✓   status online, restarts 6
[PM2] Successfully saved in /root/.pm2/dump.pm2
{"status":"ok","version":"521d436","uptimeSeconds":4,"db":{"ok":true,"latencyMs":8},...}
```

### Phase 5 — verification

```
0                                           # NEWPW|PGPASSWORD|DATABASE_URL in pm2 env keys
411430|2026-09-29 13:07:00+00|100|115       # phase-0 baseline: 411360|12:52|100|115
[in-container old-password test → exit=0 : invalid test, see pg_hba note]
indexer env ok 1
(git status end)                            # git status empty
```

### Phase 5 — valid host-side tests + the container's pg_hba

```
[grep of the .env.pre-s1 files: omitted — private journal]
old password refused: password authentication failed for user "dig"
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
local   replication     all                                     trust
host    replication     all             127.0.0.1/32            trust
host    replication     all             ::1/128                 trust
host all all all scram-sha-256
```
The `pg_hba.conf` lines are the reason the in-container tests above prove nothing: inside the
container, loopback is `trust`. Host-side connections through `127.0.0.1:5432` enter via
docker-proxy from the bridge and hit the `scram-sha-256` line — those are the valid tests
(new password accepted via `apps/indexer/.env`, old password refused).

### Phase 6 — close

```
locks released at 13:15:55Z
backups shredded
apps/api/.env  apps/api/.env.example  apps/indexer/.env  apps/indexer/.env.example
From outside the VPS:
nc: connectx to <vps-ip> port 5432 (tcp) failed: Operation timed out
```

### First cron tick after the window (13:30Z refresh, 13:37Z alert sweep; read at 13:38Z)

```
-rw-r--r-- 1 root root  40181673 13:38 /var/log/dig-stellar-alert.log
-rw-r--r-- 1 root root 801537921 13:37 /var/log/dig-stellar-refresh.log
=== Wallet alert sweep completed successfully ===
All steps succeeded (10 total)
Total job duration: 432.2s
=== Refresh completed successfully ===
=== Global refresh job completed successfully ===
```

## Deviations from the runbook, and what they change

1. **`docker compose` v2 was absent** on the VPS (only `docker-compose` v1.29.2 with docker-py
   5.0.3, Docker 29.1.3 from Ubuntu packages). `docker-compose-v2` 2.40.3 was installed from
   `jammy-updates` **outside the locks**; `docker compose ps` recognised the existing
   `dig-stellar` project container before anything was recreated. Side effect: `needrestart`
   auto-restarted containerd, nginx, cron, ssh, redis-server, systemd-networkd,
   rabbitmq-server and others (`docker.service` deferred); the container was not affected,
   the temporary `DOCKER-USER` rules survived, `/health` and the nginx path were verified
   afterwards. **Rule added** to the runbook, `docs/deployment.md` and the Lot AD deploy
   rules: any `apt` on the VPS runs with `NEEDRESTART_MODE=l` (list only).
2. **Order changed**: `pnpm install --frozen-lockfile` + `prisma:generate` + api build were done
   **before** the container recreation, and the pm2 restart followed the recreation
   immediately, guarded by the volume-name check. The API held the old password in its
   connection pool, so this keeps the outage to seconds instead of the build time. Runbook v2
   prescribes this order.
3. **Invalid tests in runbook v1** (false positives): the postgres image's `pg_hba.conf` trusts
   `local`, `127.0.0.1/32` and `::1/128` inside the container; only `host all all all` is
   `scram-sha-256`. The 0e / 3a / phase-5 in-container tests as written proved nothing. Valid
   tests were run from the host through `127.0.0.1:5432` with node/pg: new password accepted,
   old password refused. Runbook v2 uses host-side tests only; no in-container connection is
   presented as proof.
4. **File modes**: the three `.env` files were world-readable (`644`); set to `600`, as was the
   archived container log.

## S2 partial (outside the S1 window, same day)

The VPS git remote now points at the HTTPS URL of the public repository (fetch without any
credential; capture above). Removal of the SSH key still present on the VPS is a separate slot.

## Follow-ups recorded, not treated here

- Phase 7 (persistent, generalised `DOCKER-USER` rule) **before any reboot** — the temporary
  rules are not persistent; a kernel reboot is pending.
- Cron logs have no logrotate: at 13:38Z `dig-stellar-refresh.log` ≈ 800 MB and
  `dig-stellar-alert.log` ≈ 40 MB (disk has margin; not urgent, to set up).
- `rabbitmq-server` present natively, probably unused → inventory then removal.
- CoinGecko returns a CloudFront 403 ("Request blocked") from the VPS and from a residential
  connection alike → separate price hotfix with a fallback to the XLM price derived from
  Soroswap.
- SSH key cleanup on the VPS (S2).

---

## Phase 7 — persistent, generalised DOCKER-USER rule (separate slot, 2026-09-29 ~17:29Z–17:33Z)

Option A of the runbook, executed by the founder with a second SSH session kept open. IP masked.

### 7.0 — state before (read-only)

```
$ ufw status verbose
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
22/tcp (OpenSSH) ALLOW IN Anywhere ; 80/tcp ALLOW IN Anywhere ; 443/tcp ALLOW IN Anywhere (+ v6 for 22 and 80)
$ iptables -S DOCKER-USER
-N DOCKER-USER
-A DOCKER-USER -i eth1 -p tcp -m conntrack --ctorigdstport 5432 -j DROP
-A DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport 5432 -j DROP
$ tail -5 /etc/ufw/after.rules            # ends with "COMMIT"
$ grep -c 'DOCKER-USER' /etc/ufw/after.rules
0
Interfaces: eth0 (public, <vps-ip>/19 + a private /16), eth1 (DigitalOcean VPC, private /20)
```

### 7.1 — persistent rule

```
$ cp -p /etc/ufw/after.rules /root/after.rules.pre-s1
# appended to /etc/ufw/after.rules:
# S1 (2026-09-29): Docker publishes ports around ufw. Drop every NEW inbound connection
# from the public interfaces to any container. docs/security-invariants.md §10.
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -i eth0 -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -i eth1 -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -j RETURN
COMMIT
$ iptables -F DOCKER-USER ; ufw reload
Firewall reloaded
Chain DOCKER-USER (1 references)
num pkts bytes target prot opt in   out source    destination
1      0     0 DROP   all  --  eth0 *   0.0.0.0/0 0.0.0.0/0  ctstate NEW
2      0     0 DROP   all  --  eth1 *   0.0.0.0/0 0.0.0.0/0  ctstate NEW
3      0     0 RETURN all  --  *    *   0.0.0.0/0 0.0.0.0/0
(the two temporary 5432 rules are gone)
$ curl -s http://127.0.0.1:3000/health | head -c 120
{"status":"ok","version":"fdd370b","uptimeSeconds":1184,"db":{"ok":true,...}
$ ss -ltnp | grep ':5432 '
LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:* users:(("docker-proxy",pid=806876,fd=7))
```

### 7.2 — external tests (from outside the VPS)

```
$ nc -zv -G 5 <vps-ip> 5432
nc: connectx to <vps-ip> port 5432 (tcp) failed: Operation timed out
$ curl -sI https://stellar-api.getdig.ai/health | head -1
HTTP/1.1 200 OK
$ ssh -o ConnectTimeout=5 root@<vps-ip> 'echo ssh ok'
ssh ok                                     # a NEW session is accepted (host services never traverse DOCKER-USER)
```

### 7.3 — structural proof: a container deliberately published on 0.0.0.0

```
$ docker run -d --rm --name s1-wall-probe -p 0.0.0.0:18080:8080 busybox httpd -f -p 8080
$ ss -ltnp | grep ':18080 '
LISTEN 0 4096 0.0.0.0:18080 0.0.0.0:* users:(("docker-proxy",pid=909273,fd=7))
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/
404                                        # the container answers locally
# from outside the VPS:
$ nc -zv -G 5 <vps-ip> 18080
nc: connectx to <vps-ip> port 18080 (tcp) failed: Operation timed out
$ docker stop s1-wall-probe ; docker rmi busybox        # only dig_stellar_postgres remains
```

### Conclusion

A port published by mistake on `0.0.0.0` is no longer reachable from the internet: the S1
incident class is blocked structurally, independently of each service's binding. The rule is
persistent (`/etc/ufw/after.rules`), so it survives a reboot: the pending kernel reboot is
unblocked (to be scheduled in a dedicated slot; not done tonight). Rollback:
`cp /root/after.rules.pre-s1 /etc/ufw/after.rules && ufw reload` (the backup stays on the VPS
for a few days).
