# AC2 — VPS Node 24 migration runbook (founder executes)

Target: VPS `root@209.38.195.61` — public API (`dig-stellar-api` under pm2) + indexer
(cron jobs). Repo at `/root/dig-stellar`. Current runtime: Node `v20.19.4` via nvm at
`/root/.nvm/versions/node/v20.19.4/bin`.

**Invariant: Node 20 stays installed as instant rollback until AC4 sign-off. Do NOT
`nvm uninstall 20` at any point in this procedure.**

Timing note: run this between cron ticks (refresh + wallet-alert run every 15 min;
`crontab -l` shows the minute offsets). Steps 3–6 take ~10 minutes; a skipped or
failed cron tick during the window is expected and self-heals on the next tick.

## Where the v20.19.4 path is hardcoded (enumeration)

| Place | What | Fixed by |
|---|---|---|
| `docs/deployment.md:87` | `export PATH=/root/.nvm/versions/node/v20.19.4/bin:$PATH` in the deploy/restart procedure | AC4 docs pass |
| `docs/runbooks.md` (§ prereqs, ~11–15, 512) | "Node 20" / `nvm alias default 20` / troubleshooting lines | AC4 docs pass |
| `docs/reference-deployment.md:77` | "Node 20+ (`.nvmrc` pins 20)" | AC4 docs pass |
| VPS crontab (root) | absolute node/pnpm paths or PATH export for `job:refresh` + `job:wallet-alert` — exact lines discovered in step 0 | step 6 |
| pm2 daemon | pm2 was `npm i -g` under the v20.19.4 tree → daemon runs on Node 20 | step 5 |
| `pm2-root` systemd unit | `/etc/systemd/system/pm2-root.service` has PATH + PM2_HOME baked in from the Node 20 install | step 5 |
| `/root/.pm2/dump.pm2` | saved process list records the old interpreter | step 5 (delete + fresh start + `pm2 save`) |
| repo `.nvmrc` / `engines` | was `20` / `20.x` — already `24` / `>=24` on `feat/node-24` (AC0) | lands with the Lot AC merge |

## Step 0 — Preflight: record current state (paste output into evidence)

```bash
node -v && which node && pnpm -v && which pnpm
pm2 -v && pm2 ls
systemctl is-enabled pm2-root && grep -E 'PATH|PM2_HOME|ExecStart' /etc/systemd/system/pm2-root.service
crontab -l                                   # ← note EVERY line containing v20.19.4 / node / pnpm
crontab -l > /root/crontab-node20.bak        # rollback copy
curl -s http://127.0.0.1:3000/health | head -c 600   # baseline: version SHA, db.ok, lastRefreshAt
```

## Step 1 — Install Node 24 (Node 20 stays)

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
N24BIN="$(dirname "$(nvm which 24)")" && echo "$N24BIN"   # e.g. /root/.nvm/versions/node/v24.19.0/bin
export PATH="$N24BIN:$PATH"
node -v    # must print v24.x
```

`$N24BIN` is used in every later step — if you open a new shell, re-derive it.

## Step 2 — pnpm under Node 24

pnpm was installed globally under the Node 20 tree, so the Node 24 tree needs its own:

```bash
npm i -g pnpm@10.32.1     # matches the repo packageManager pin + CI
which pnpm && pnpm -v      # must resolve inside $N24BIN, print 10.32.1
```

## Step 3 — Rebuild node_modules under Node 24 (REQUIRED, not optional)

Native modules (`bufferutil`, `secp256k1`, …) are compiled against the Node 20 ABI and
will not load on Node 24 — a plain restart without reinstall can crash or silently
fall back. Fresh install:

```bash
cd /root/dig-stellar && git pull            # only if Lot AC is already merged; otherwise skip — the runtime migration does not depend on the repo change
rm -rf node_modules apps/api/node_modules apps/web/node_modules apps/indexer/node_modules packages/db/node_modules
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
```

## Step 4 — Rebuild + smoke the API build

```bash
pnpm --dir /root/dig-stellar/apps/api build
```

## Step 5 — The pm2 trap: reinstall pm2 under Node 24, regenerate the boot unit

The pm2 daemon AND the `pm2-root` systemd unit currently live in the Node 20 tree.
Order matters — old unit out, old daemon dead, new pm2 in, new unit generated:

```bash
# 5a. install pm2 under the Node 24 tree
npm i -g pm2
which pm2                                    # must resolve inside $N24BIN

# 5b. remove the old boot unit, stop the old daemon
pm2 unstartup systemd                        # removes the Node-20 pm2-root unit
pm2 kill                                     # old daemon down (API goes down NOW — window starts)

# 5c. generate the new boot unit from the Node 24 pm2
pm2 startup systemd                          # prints nothing to copy when run as root; creates the unit
systemctl daemon-reload
systemctl is-enabled pm2-root                # must print: enabled
grep -E 'PATH|ExecStart' /etc/systemd/system/pm2-root.service   # paths must show the v24 tree

# 5d. recreate the API process under the new runtime (fresh definition, not resurrect —
#     the old dump records the Node 20 interpreter)
cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 start dist/main.js --name dig-stellar-api --time
pm2 save                                     # writes a NEW dump with the Node 24 runtime
pm2 ls                                       # dig-stellar-api online; pm2-logrotate module still listed

# 5e. verification, exactly like the Lot S validation: reboot simulation
pm2 kill && pm2 resurrect
sleep 3
pm2 ls
curl -s http://127.0.0.1:3000/health | head -c 600
# PASS = status ok|degraded-with-explained-venue, version == the SHA from 5d, db.ok true
node -e "console.log(process.version)"       # sanity: still v24
pm2 info dig-stellar-api | grep -i 'node.js version'   # must show 24.x
```

If `/health` is wrong here → Rollback (below) before debugging anything else.

## Step 6 — Crontab: point the indexer jobs at Node 24

Use the exact lines captured in step 0. Any occurrence of
`/root/.nvm/versions/node/v20.19.4/bin` becomes `$N24BIN`; any `nvm use 20` /
`nvm exec 20` becomes 24. If the crontab relies on `nvm alias default` rather than an
absolute path, step 1's `nvm alias default 24` already covered it — verify, don't assume:

```bash
crontab -l | sed "s|/root/.nvm/versions/node/v20.19.4/bin|$N24BIN|g" | crontab -
crontab -l                                   # eyeball: no v20.19.4 left
```

Then verify the NEXT cron cycle completes on the new runtime (refresh runs every
15 min):

```bash
# after the next tick — freshness must advance:
curl -s http://127.0.0.1:3000/health | python3 -m json.tool | grep -A2 -i 'lastRefreshAt\|freshness'
tail -20 /var/log/dig/wallet-alert.log       # wallet-alert tick: 82 → 81 → 83 clean exit
# lastRefreshAt must be AFTER the migration timestamp; allbridge asOf:null stays expected-dormant
```

**Done-check for AC2:** step 5e PASS + one full cron cycle with advancing freshness
timestamps. Paste the outputs of steps 0, 5e and 6 into
`docs/evidence/lot-ac/` (AC4 collects them).

## Rollback — back to v20.19.4 (kept installed)

At any point, this restores the exact pre-migration state:

```bash
export PATH=/root/.nvm/versions/node/v20.19.4/bin:$PATH
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm alias default 20
which node && node -v                        # /root/.nvm/versions/node/v20.19.4/bin/node

# pm2 back on Node 20 (the Node 20 tree still has its pm2 install)
pm2 unstartup systemd 2>/dev/null; pm2 kill
which pm2                                    # must resolve inside the v20.19.4 tree
pm2 startup systemd && systemctl daemon-reload

# node_modules back to Node 20 ABI
cd /root/dig-stellar
rm -rf node_modules apps/api/node_modules apps/web/node_modules apps/indexer/node_modules packages/db/node_modules
pnpm install --frozen-lockfile && pnpm -C packages/db prisma:generate
pnpm --dir apps/api build
cd apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 start dist/main.js --name dig-stellar-api --time
pm2 save

# crontab back
crontab /root/crontab-node20.bak && crontab -l

curl -s http://127.0.0.1:3000/health | head -c 600   # version SHA + db.ok
```

Report the rollback + the failing symptom instead of retrying the migration.
