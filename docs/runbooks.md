# Dig Stellar Runbooks

## Purpose
This document captures practical procedures used regularly during development and operations.

---

## Node version (read first)

The repo runs on **Node 24** (active LTS; Lot AC migration, 2026-08-21 — Node 20 hit upstream
EOL on 2026-04-30). A `.nvmrc` pinned to `24` lives at the repo root; `engines` floors every
workspace at `>=24` (web pins `24.x` for Vercel). Default is set via `nvm alias default 24`.
Before any build/dev command, ensure Node 24 is active:

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
```

After switching Node majors, always re-run a fresh `pnpm install`: native bindings
(`bufferutil`, `secp256k1`, `@rolldown/binding-*`, …) are compiled per Node ABI and must be
rebuilt for the active major.

---

## Local development

### Start frontend (`apps/web`)
```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use
pnpm -C apps/web dev      # Vite dev server, http://localhost:5173
pnpm -C apps/web build    # vue-tsc typecheck + vite build (must be on Node 24)
```

Frontend env (`apps/web/.env`):
```
VITE_API_BASE="http://localhost:3000"     # local API; prod = https://stellar-api.getdig.ai
VITE_STELLAR_NETWORK="PUBLIC"             # initial default only; the Mainnet/Testnet toggle is the
                                          # runtime source of truth (useNetwork → kit.setNetwork)
```

### Start API (`apps/api`)
```bash
pnpm -C apps/api start:dev    # NestJS, http://localhost:3000
pnpm -C apps/api build        # nest build
```
Restart `start:dev` after changing a service/module so the new code is loaded.

**Version stamp (E1, Lot E).** `GET /health` reports `version` from the `GIT_SHA` env var.
On the VPS, export it when (re)starting the API after a deploy so the running version is visible:
```bash
export GIT_SHA=$(git rev-parse --short HEAD)   # then: pm2 restart api --update-env
```
Unset, `/health` reports `"version": "unknown"`; that means the deploy procedure was skipped.

### Run indexer scripts (`apps/indexer`)
Runner is `tsx` (no build step).
```bash
# Full production refresh (canonical entry point): 72 → 71 → all per-protocol steps
pnpm -C apps/indexer job:refresh

# A single ingest step directly (example: network stats)
pnpm -C apps/indexer exec tsx src/scripts/ingest/73-network-stats-refresh.ts

# Bootstrap on a fresh database (E4, Lot E): seeds the WHOLE vetted perimeter
# (6 venues, all non-stellar-native entities, assets, links) from the committed
# registries/core-registry.json. Idempotent. Replaces the legacy per-protocol
# upserts below for first-time setup.
pnpm -C apps/indexer bootstrap:core
pnpm -C apps/indexer bootstrap:logos

# Regenerate the committed registry from a live DB (run on the source
# deployment after onboarding a new pool/vault, commit the JSON):
pnpm -C apps/indexer bootstrap:export

# Widening the AMM pool perimeter (Lot P procedure, Aug 2026): after a git pull
# that changes core-registry.json, ONE seed run picks up the new perimeter;
# the cron's next job:refresh does the rest (first cycle: reserve snapshots +
# metrics; derived soroswap prices follow on the SECOND cycle by design).
pnpm -C apps/indexer bootstrap:core && pnpm -C apps/indexer bootstrap:logos

# Legacy per-protocol upserts (kept for reference; their tmp/discovery registry
# inputs are ephemeral and no longer exist, so prefer bootstrap:core):
pnpm -C apps/indexer tsx src/scripts/bootstrap/defindex-upsert-core.ts   # T3-D1: venue 'defindex' + 3 mainnet vault entities
pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts  # T2-D3: venue 'allbridge' + USDC asset
```

### Onboarding DeFindex vaults (T3-D1)

`defindex-upsert-core.ts` seeds the `defindex` venue + the selected mainnet vault entities
(`entity_type = 'yield_vault'`, `venue_type = 'vault'`) with their underlying asset (USDC/EURC SAC,
`role = 'underlying'`). The vault set is enumerated from DeFindex's own API:
`GET https://api.defindex.io/vault/discover?network=mainnet` (Bearer `DEFINDEX_API_KEY`), picking
non-trivial-TVL vaults with a real APY; addresses + seed-time evidence are in the bootstrap's header
comment. After seeding, `71-refresh-all-metrics` discovers them by DB query
(`entities join venues where v.slug='defindex' and is_active`) and refreshes each per cycle via
`run-defindex-refresh.ts` (SDK `getVaultInfo` → TVL from `totalManagedFunds`, priced through the
`asset_prices` pipeline; `getVaultAPY` → stored as a **fraction** in `weighted_supply_apy`). The step
is **non-fatal** and runs before step 7 so `70-protocol-persist-metrics` folds DeFindex into
`protocol_metrics_latest` (→ `/v1/protocols`, `protocolCount = 5`). Env: `DEFINDEX_API_KEY`,
`DEFINDEX_API_URL` (default `https://api.defindex.io`). `DEFINDEX_VAULTS` in `.env` is only for the
legacy Prisma `run:defindex` script; the live v1 path is DB-driven, not that var.

```bash
# Re-enumerate mainnet vaults (evidence / picking a new vault to seed)
curl -s "https://api.defindex.io/vault/discover?network=mainnet" -H "Authorization: Bearer $DEFINDEX_API_KEY" | jq .

# Refresh one vault directly (idempotent)
ENTITY_SLUG=defindex-meru-usdc \
DEFINDEX_VAULT_ADDRESS=CCA2ZJP5BVRXYTQH4FAGHCAUMRYCXVC4CRYC2NXHWMR7TIVX36U7F5HR \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-defindex-refresh.ts
```

### Onboarding an additional Blend pool (the actual seed path)

`blend-upsert-core.ts` only seeds the **fixed** pool (from a generated discovery registry).
The other Blend entities (orbit, etherfuse, **yieldblox**) are seeded by running the pool refresh
**once** with the pool's contract id: `persistBlendPoolState` upserts the entity (`is_active = true`)
plus its reserves/assets read on-chain. After that, `71-refresh-all-metrics` discovers it by DB query
(`entities join venues where v.slug='blend' and is_active`) and keeps it fresh with no further action.

```bash
# Seed YieldBlox (idempotent; re-running just refreshes it)
ENTITY_SLUG=blend-yieldblox-pool \
BLEND_POOL_ID=CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-blend-pool-refresh.ts
```

The known active Blend pools are catalogued in `apps/indexer/src/config/stellar-targets.json`
(documentation only; no code reads it). **Forex** is listed there as `status: excluded` (frozen
oracle) and must never be seeded as active. After seeding, confirm any new reserve assets are priced
(`PRICING_RULES_BY_SYMBOL` in `scripts/shared/pricing-config.ts`); unpriced reserves show null/0 USD
but the health factor stays correct (it comes from Blend's on-chain Reflector oracle, not the price
pipeline). `BLEND_POOL_ID` in `.env` is only a default for the discovery/probe scripts (75/76).

### XOXNO Lending (Lot XO): seeding, new markets, app-version check, params cache

The `xoxno` venue (`venue_type = 'lending'`) has one entity per hub (`xoxno-core-hub`,
`xoxno-rwa-hub`, `xoxno-amm-hub`; `entity_type = 'lending_pool'`, `contract_address` = the single
pool contract) and one `reserve_snapshots` row per market. The hub id and market list live in the
entity metadata (`hubId`, `markets[]`), seeded by `xoxno-upsert-core.ts` (idempotent, no RPC) and
replayed by `bootstrap:core` from `registries/core-registry.json`. `71-refresh-all-metrics` discovers
the hubs by DB query (`v.slug = 'xoxno' and is_active`) and refreshes each per cycle (step 6c, before
the protocol rollup). Decision note: `docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md`.

```bash
# Seed / re-seed the venue + 3 hubs + 25 markets (idempotent; merges entity metadata)
pnpm -C apps/indexer exec tsx src/scripts/bootstrap/xoxno-upsert-core.ts
# Refresh one hub directly (reads on-chain; STELLAR_SOURCE_ACCOUNT needed for simulations)
ENTITY_SLUG=xoxno-core-hub XOXNO_POOL_ID=CBXRNDQMAJFG4VUKMKFEMFS75UUXE2SPSNV4LEEFCSNBCN66PYRWBKXO \
  pnpm -C apps/indexer exec tsx src/scripts/ingest/run-xoxno-hub-refresh.ts
```

- **Detecting a new market.** There is no on-chain list view; XOXNO adds markets through
  `market|batch_params_update` pool events / new `("Params", HubAssetKey)` ledger entries. Check the
  pool's contract data on stellar.expert (count of `Params` keys vs 25) or the venue UI. To add one:
  append it to the right hub in `XOXNO_HUBS` (`xoxno-upsert-core.ts`: asset contract id, SEP-41
  symbol / name / decimals — never rename an existing assets row), run the script, add a pricing
  rule or an `external` marker in `scripts/shared/pricing-config.ts` (a symbol with neither warns in
  step 62), then `pnpm -C apps/indexer bootstrap:export` and commit the registry. The next refresh
  reads the new market's params from chain automatically (it is not in the params cache).
- **App-version check.** Every hub refresh starts with `controller.get_app_version()` and FAILS the
  xoxno step loudly when it differs from `XOXNO_EXPECTED_APP_VERSION` (1; env override of the same
  name). An upgraded controller may have changed the view semantics the adapter relies on:
  re-verify the spec (`docs/evidence/lot-xo/00-recon-verification.md`), then bump the constant.
  Step isolation keeps the rest of `job:refresh` alive meanwhile; `/v1/ops/status` shows the step
  FAILED and `/health` turns the venue stale.
- **Params cache.** Static market params (`get_sync_data`: decimals, interest-rate model, reserve
  factor) are cached in the entity metadata (`paramsCache.fetchedAt`) and re-read at most every
  24 h, or when the app version changed or a seeded market is missing from the cache.
  `XOXNO_PARAMS_REFRESH=1` on a hub run forces a full re-read. `pool_snapshots.metadata.callPlan`
  shows what a run read (`paramsFromCache / paramsFromChain / priceFallbackKeys / priceChunks`);
  steady state is 162 RPC calls per refresh for the three hubs.
- **Pricing.** Own-priced markets (XLM, USDC, EURC, USDT0, PYUSD, SolvBTC, xSolvBTC, CETES,
  USTRY, USDY, AQUA) never use the XOXNO aggregator and are unpriced when their own price is
  stale (pool flagged stale, like Blend). Fallback-covered markets (`external` markers) take the
  aggregator price when it is `valid`, not `stale`, error-free and ≤ 24 h old. Step order
  (reference prices before the Aquarius refresh) leaves USDY unpriced on a run that follows an
  idle longer than the 45-minute price window (RWA hub 6/7 priced); the next run prices it. Never
  on the `*/15` cadence; pre-existing, not XOXNO-specific.

### Wallet alert sweep (D2): periodic evaluator

The alerting engine runs as a periodic sweep (no broker, no in-process scheduler): one OS-cron
entry calls the orchestrator, which refreshes every active wallet's `wallet_pool_health` (script 81,
no `WALLET_ID` → all wallets) and then runs the pure evaluator (script 83, in `apps/api`), which
writes `notifications` on each fire/resolve edge.
```bash
# Canonical entry point (82 → 81 → 83):
pnpm -C apps/indexer job:wallet-alert
```
Example crontab (VPS): every 15 min, offset from `job:refresh` so they don't collide.
End-to-end alert latency ≈ this interval + the web's notification poll (~30-60s):
```cron
# m         h  dom mon dow  command
7,22,37,52 * * * * cd /root/dig-stellar && /usr/bin/flock -n /tmp/dig-stellar-alert.lock bash -lc 'export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm --dir apps/indexer job:wallet-alert' >> /var/log/dig-stellar-alert.log 2>&1
```
(The real VPS crontab line, verified in the Lot AC migration — see
`docs/evidence/lot-ac/ac2-execution.md` step 0: repo at `/root/dig-stellar`, `flock` guard
against overlapping runs, Node 24 tree exported because the non-interactive cron PATH has an
old node, log at `/var/log/dig-stellar-alert.log`. The `job:refresh` cron line follows the
same pattern (`*/15`, its own lock and log). An earlier version of this example showed
`/srv/dig-stellar`, which never matched the VPS.)
Prereq: `stellar_v3_alerting.sql` applied. A non-zero exit from the health refresh (81) aborts the
evaluator (83) for that run and logs; stale/half-written health rows are never evaluated.

**RPC budget (Lot RP, RP1 — 2026-10-27).** Script 81 loads each Blend pool + its oracle ONCE per
run and reads the wallets' `Positions` ledger entries in batches of 100 keys per `getLedgerEntries`
(`BLEND_POSITIONS_BATCH_SIZE`, max 200 = the RPC cap). Cost per run = 4 pools × (2 getLedgerEntries
+ reserves+1 `lastprice` simulations) + ceil(wallets / 100) × 4 getLedgerEntries: **36 calls for
92 wallets, 120 for 2,100** (was 36 calls PER WALLET — 3,312 for 92). A pool whose load fails is
skipped for that run (its wallets keep their previous rows; the other pools are persisted) and
**81 exits 1, so 82 aborts the evaluator** — no alert evaluation on partial data; alerts resume on
the next sweep. Both children append their RPC samples to `OPS_METRICS_FILE`
(81 via `lib/ops-capture`, 83 via `apps/api/src/scripts/ops-capture-lite.ts`); 82 persists them as
`rpc_metrics_runs` rows with `job = 'wallet-alert'` and a `methods` JSON (calls per RPC method).
Prereq: `stellar_v1_ops_metrics_job.sql` applied (adds `job` + `methods`). Query the sweep's cost:
```sql
select run_at, calls, errors, p50_ms, methods from rpc_metrics_runs
where job = 'wallet-alert' order by run_at desc limit 8;
```
Evidence and before/after numbers: `docs/evidence/lot-rp/rp1-sweep-fix.md`. The cadence was
moved to hourly (`7 * * * *`) as a stopgap on 2026-10-26; restore `7,22,37,52` once the RP1
drop is visible on the provider dashboard (`docs/deployment.md`, "RP1 deploy").

### Campaign award job (Lot EP, Earn & Points): periodic points award

Points only: the job pays nothing, signs nothing and holds no key. It is the ONLY writer of
`action:*` and `referral:*` rows in `points_ledger`; every insert is `on conflict do nothing` on
the ledger's unique indexes, so re-runs, crashes mid-way and overlapping manual runs can never
double-award. It reads `action_witnesses` (the Horizon-verified executions written by
`POST /v1/actions/witness`) and awards enrolled wallets inside the campaign window.
```bash
# Canonical entry point (85 → 84):
pnpm -C apps/indexer job:campaign          # wrapper: spawns `pnpm run job:campaign-award` in apps/api
pnpm -C apps/api job:campaign-award        # the award script itself (ts-node), same thing without the wrapper
```
Env (apps/api/.env, names only): `CAMPAIGN_ENABLED` (default off → "campaign dark, nothing to
award", exit 0), `CAMPAIGN_STARTS_AT` (REQUIRED, fail-closed when unset; only witnesses that
closed at or after it earn points), `CAMPAIGN_ENDS_AT` (optional). Prereq: `stellar_v6_campaign.sql`, `stellar_v7_social_claim_delete.sql`
and `stellar_v8_campaign_perks.sql` applied, in that order.

**Retroactive awards:** witnesses that closed at or after `CAMPAIGN_STARTS_AT` earn points once
the wallet enrols, even if the enrolment comes later — the job selects by window and enrolment at
run time, not by enrolment date (`campaign.repository.ts` `findActionCandidates`: join on
`campaign_enrollments` by address, window on `ledger_closed_at` only).

**Supported wallets for proofs:** Freighter ≥ 5.x and xBull (both sign SEP-53,
`signature_variant = 'sep53'`); Lobstr is unsupported — the Kit 1.9.5 Lobstr module does not
implement `signMessage`, so Lobstr users cannot enrol or recover an account without a session
(`docs/evidence/lot-ep/ep1-wallet-matrix.md`).

**Social tasks (EP2):** self-declared — the API takes the person's word and records the handle,
there is no X / Discord API check. Rules enforced in `modules/campaign/social-claims.ts` and the
v6/v7 indexes: one claim per task per wallet, ONE handle per wallet across all tasks (a different
handle on a second task is `handle-mismatch`, a handle already declared by another wallet is
`handle-already-used`), and a GROSS daily cap (`SOCIAL_DAILY_CAP`, 50): points of a claim deleted
the same UTC day still count toward that day's cap, so a same-day re-claim is refused until the next
UTC day. Delete (`DELETE /v1/campaign/social/:id`, proof required, works while the campaign is dark)
is SOFT: one transaction under the enrollment row lock sets `deleted_at = now()` and scrubs
`handle_normalized` to `'deleted'` on the claim, then inserts the negative `adjust:social-delete`
ledger row whose `adjusts_id` points at the credited row — the ledger stays append-only, balance =
`sum(points)` nets the claim out, and the handle leaves the database. The task can be claimed again
afterwards (partial unique indexes, `stellar_v7_social_claim_delete.sql`). The repost task opens only
when `CAMPAIGN_X_REPOST_URL` (https URL of the post, apps/api/.env, name only here) is set: unset, it
is served as `available: false` ("coming soon" in the UI) and refused with `task-unavailable`. Handles
are never logged and never in a public payload (`docs/security-invariants.md` §11).

**Perks (EP3):** non-monetary tiers granted by the job's step 4 from the live balance
(`PERK_TIERS` in `campaign-rules.ts`: early-access at 100 points, beta-features at 500,
priority-rwa at 1500) into `wallet_perks`, `on conflict do nothing`. A perk once granted STAYS
granted even if a later negative adjust drops the balance under the threshold; the job only
inserts. `GET /v1/campaign/me` lists them (`perks`, `nextPerk`, `flags.beta`); nothing in the
product is gated on a perk yet, and since EP4 the Earn view does not surface them (founder
decision 2026-10-21; the `PerksBlock` component is kept, not rendered). Revocation is a
founder-only manual SQL ("Revoke a perk" below).

**Streak ramp (EP4, founder decision 2026-10-21):** the streak multiplier on ACTION points is a
daily ramp, `multiplier = min(1 + 0.05 × streak days before the action's UTC day, 1.35)`
(`STREAK_RAMP` in `campaign-rules.ts`): 0 days → ×1.00, 1 → ×1.05, 4 → ×1.20, 6 → ×1.30, 7 or
more → ×1.35. It is still computed from the check-ins up to D-1 (a check-in on the action's own
day never changes that day's award), and `round(base × multiplier)` is done in integer
hundredths with half rounding up (50 × 1.15 = 58, 50 × 1.35 = 68). Daily check-in stays +5.
Ledger history is untouched (every row stores its own `multiplier`); only awards written after the
deploy use the ramp. `GET /v1/campaign` serves it as `rules.streak` (`stepPerDay`, `cap`,
`dailyPoints`, `daysToCap`, `ladder`) so the web renders the figures and computes none.

#### Install the campaign cron line (EP3, VPS, founder)

Same shape as the two live lines (refresh, alert): minutes offset so the three jobs never
collide, its own `flock` and its own log. Install it BEFORE activating the campaign: while the
campaign is dark the job exits 0 with "campaign dark, nothing to award" every tick, which is
the cheapest possible proof that the line, the PATH and the lock work.

1. Check the two existing lines and the Node tree they export (the campaign line must use the
   same one):
   ```bash
   crontab -l | grep dig-stellar
   ls /root/.nvm/versions/node/
   ```
2. Open the crontab (`crontab -e`) and add this line, verbatim (adjust ONLY the Node version
   if step 1 shows a different tree):
   ```cron
   # m         h  dom mon dow  command
   3,18,33,48 * * * * cd /root/dig-stellar && /usr/bin/flock -n /tmp/dig-stellar-campaign.lock bash -lc 'export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm --dir apps/indexer job:campaign' >> /var/log/dig-stellar-campaign.log 2>&1
   ```
   - lock: `/tmp/dig-stellar-campaign.lock` (`flock -n`: an overlapping tick exits immediately;
     the award script is idempotent regardless, so a lost tick costs nothing);
   - log: `/var/log/dig-stellar-campaign.log`, one line per step, counts only;
   - log rotation: the two existing logs are NOT rotated either (known gap, Lot AD backlog). The
     dark line writes ~2 lines per tick (~200 KB/month); once active ~5 lines per tick. Add a
     `/etc/logrotate.d/dig-stellar` stanza for the three logs (`weekly`, `rotate 8`,
     `compress`, `missingok`, `notifempty`) when the AD1 deploy script lands — not before, so the
     deploy script and the rotation are tested together.
3. Confirm it is installed and wait for the next tick (at most 15 min):
   ```bash
   crontab -l | grep -c dig-stellar          # expect 3
   tail -n 5 /var/log/dig-stellar-campaign.log
   ```
   Expected while dark: `=== Starting campaign award job ===`, `[campaign-award] campaign dark,
   nothing to award (campaign=1)`, `=== Campaign award job completed successfully ===`.
4. The AD1 deploy script must take this third lock blocking (`flock -w`) next to the refresh and
   alert locks (see `docs/deployment.md`, cron locks) before it stops the API.

#### Activate the campaign (founder, one-time)

Pre-activation checklist — every box BEFORE the flag flip:

- [ ] `CAMPAIGN_STARTS_AT` chosen as a UTC instant (ISO, `Z` suffix, e.g. `2026-11-03T09:00:00Z`).
      Only witnesses that closed at or after it earn points, and every metric counter starts
      there; it cannot be moved backwards later without re-stating the metrics.
- [ ] Paul's X post is published and its URL is at hand for `CAMPAIGN_X_REPOST_URL` (https);
      without it the repost task shows "coming soon" on day one.
- [ ] `stellar_v8_campaign_perks.sql` applied (`\d wallet_perks` lists the table).
- [ ] The cron line is installed (above) and ONE manual run shows the dark path end to end:
      ```bash
      cd /root/dig-stellar && pnpm --dir apps/indexer job:campaign
      # expect: [campaign-award] campaign dark, nothing to award (campaign=1)
      ```
- [ ] `GET /v1/campaign` answers `active: false, reason: campaign-disabled` (the baseline to
      compare against after the flip).

Then, in this order:

1. In `apps/api/.env` set the three names (values never pasted anywhere else):
   `CAMPAIGN_STARTS_AT=<the UTC instant>`, `CAMPAIGN_ENABLED=true`,
   `CAMPAIGN_X_REPOST_URL=<the post URL>`. Leave `CAMPAIGN_ENDS_AT` unset unless a deadline is
   decided (unset = no deadline shown, no fake urgency).
2. `pm2 restart dig-stellar-api --update-env && pm2 save` (env is read lazily, but pm2 only
   hands a new env to the process on `--update-env`).
3. Verify the flip:
   ```bash
   curl -s https://stellar-api.getdig.ai/v1/campaign | jq '{active, reason, startsAt, repost: .rules.socialTasks["x-repost"]}'
   # expect active:true, startsAt = the instant, repost.available = true with the URL
   curl -s https://stellar-api.getdig.ai/v1/campaign/metrics | jq '{active, dark, window, walletsEnrolled}'
   # expect active:true, dark:false, the window, every count 0 on day one
   ```
4. Run the job by hand once more and read the summary line (now the live path):
   ```bash
   cd /root/dig-stellar && pnpm --dir apps/indexer job:campaign
   # expect: window … / actions candidates=0 awarded=0 … / referrals … / perks wallets=0 granted=0 / summary …
   ```
5. No web redeploy is needed: the web polls `GET /v1/campaign` (60 s), so the Earn nav entry,
   the `#earn` view, the "+N pts" chips and the `#status` "Campaign metrics" section appear on
   every open tab at its next refresh. Open https://stellar.getdig.ai in a fresh tab and check
   the sidebar shows "Earn".

To pause: set `CAMPAIGN_ENABLED=false`, restart with `--update-env`; every surface hides within
a minute, the proof routes stay on, the ledger and the perks are untouched.

**How to read the summary line** (`/var/log/dig-stellar-campaign.log`, one line per step, counts
only — never an address or a hash):
```
[campaign-award] window campaign=1 starts=2026-11-01T00:00:00.000Z ends=none
[campaign-award] actions candidates=7 awarded=6 skipped={"outside-window":0,"kind-not-awarded":0,"below-min-notional":1,"daily-cap-reached":0}
[campaign-award] referrals uncredited=1 credited=1 pending=0
[campaign-award] perks wallets=12 granted=2
[campaign-award] summary awarded_actions=6 skipped_by_reason={…} referrals_credited=1 perks_granted=2 duration_ms=41
```
`candidates` = awardable witnesses (swap / Blend deposit) of enrolled wallets inside the window
with no ledger row yet; `awarded` = rows inserted this run; `skipped` = candidates refused by the
pure rules (`below-min-notional`: the witness's stored `meets_min_notional` is false;
`daily-cap-reached`: 5 swaps / 3 deposits per wallet per UTC day; the other two reasons are
structurally 0 here because the selection is already window- and kind-bounded). `pending` =
referral links whose referee has no qualifying witness yet. `perks wallets` = enrolled wallets
scanned, `granted` = `wallet_perks` rows inserted this run (0 on every re-run). A non-zero exit
means a thrown error: the wrapper relays it and the next tick retries from the same state.

**Stuck "pending verification"** (`GET /v1/campaign/me` shows `pendingVerification > 0` for a
witness that never earns): the witness exists, the ledger row does not. Check, in order:
1. window — `ledger_closed_at` is at or after `CAMPAIGN_STARTS_AT` (and before `CAMPAIGN_ENDS_AT`);
2. min notional — `action_witnesses.meets_min_notional` is true (the faucet threshold,
   `FAUCET_MIN_NOTIONAL_XLM`, stored per row at witness time);
3. enrolment — the wallet has a `campaign_enrollments` row for this campaign (proof + enrol);
4. daily cap — the wallet already has 5 swaps / 3 deposits counted for that UTC day (known EP1
   limit: a capped witness stays in the pending count);
then run the job by hand (`pnpm -C apps/indexer job:campaign`) and read the summary line.
```bash
psql "$DATABASE_URL" -c "select kind, meets_min_notional, ledger_closed_at from action_witnesses where tx_hash = '<hash>'"
psql "$DATABASE_URL" -c "select reason, points, counted_day from points_ledger where witness_tx_hash = '<hash>'"
```

**Revoke points** (founder review): the ledger is append-only — never `update` or `delete` a
row. Insert a negative `adjust:<note>` row pointing at the row being corrected; the balance is
always `sum(points)`, so the correction is visible and auditable:
```sql
insert into points_ledger (campaign, address, user_id, reason, base_points, multiplier, points, adjusts_id)
select campaign, address, user_id, 'adjust:founder-review-2026-11-05', 0, 1, -points, id
  from points_ledger where id = <ledger id>;
```
(`points_ledger_points_check` only allows negative points on `adjust:*` rows; the `reason`
regex requires a non-empty note.) Revoking points never revokes a perk (next paragraph).

**Revoke a perk** (founder-only, manual): no code path deletes from `wallet_perks`, so a
revocation is a deliberate SQL after a founder review, with the reason kept in the evidence
folder. The job will NOT re-grant it while the balance stays under the threshold; if the
balance is at or above it, the next tick re-grants (so revoke the points first, see above):
```sql
delete from wallet_perks
 where campaign = 1 and address = '<G…>' and perk_key = 'early-access';   -- or 'beta-features' / 'priority-rwa'
```

**Galxe import (later, not built):** campaign points earned on Galxe are NOT imported by any
job or route in this lot. When the founder decides to import them, the ONLY mechanism is a
founder-written `adjust:galxe-import-<date>` ledger row per wallet (positive points, `base_points`
= the points, `multiplier` 1, no reference columns), inserted by hand from the Galxe export; the
next job tick then grants any perk tier the new balance reaches. Nothing in `apps/api` reads
Galxe. Procedure, numbers and the export file belong in `docs/evidence/lot-ep/` when it happens.

---

## Database

### Connect with psql
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar"
```

### Apply raw SQL schemas (manual; no migration runner for v1/v2)
The v1/v2 schemas are applied by hand. The DDL is idempotent (`create table if not exists`), so
re-running is safe. **This list is THE canonical order** (dependency order, identical to the
`docker-compose.yml` initdb mounts, `docs/reference-deployment.md` and `docs/deployment.md`;
Lot EP aligned all four on 2026-10-15 — keep them identical when adding a file).
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1.sql   # v1 base (pgcrypto, venues/entities/assets/snapshots/prices)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_metrics.sql   # v1 latest rollups read by /v1/*
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_logos.sql   # F3: venue/asset logo_url columns (bootstrap:logos fills them)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_network_tvl.sql   # G0 (T3-D3): network_tvl_snapshots, one TVL point per refresh cycle
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_ops_metrics.sql   # E2 (Lot E, T3-D3): rpc_metrics_runs + refresh_step_runs + action_events; R1 adds action_events.metadata (re-run once)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_ops_metrics_job.sql   # Lot RP (RP1): rpc_metrics_runs.job ('refresh' | 'wallet-alert') + methods jsonb (apply BEFORE the RP1 indexer + api deploy)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_bridge.sql   # T2-D3: Allbridge bridge_flows (then run the allbridge bootstrap once, below)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v1_action_witness.sql   # R1 (Lot R, T3-D2): action_witnesses, verified execution witnesses (apply BEFORE deploying the R1 api)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v2_multiwallet.sql   # v2 wallets: user_wallets (+ T2-D1 is_active_signer + singleton index), snapshots, wallet_pool_health
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v3_alerting.sql   # D2 alerting (apply AFTER v1 + v2): alert_rules, alert_rule_state, notifications
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v4_faucet.sql   # R2 (Lot R, T3-D2): faucet_claims (money path, depends on action_witnesses); deploys dark (FAUCET_ENABLED unset)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v5_faucet_campaign2.sql   # Lot R2: campaign 2, campaign/action_family columns + per-family uniqueness (apply BEFORE the campaign-2 api build)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v6_campaign.sql   # Lot EP (EP1): Earn & Points — proofs, enrollments, points_ledger, check-ins, referrals (points only, no key; depends on v2 + action_witnesses); deploys dark (CAMPAIGN_ENABLED unset)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v7_social_claim_delete.sql   # Lot EP (EP2): soft delete of social task claims (deleted_at + partial unique indexes); depends on v6, apply after it
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -f apps/api/src/db/stellar_v8_campaign_perks.sql   # Lot EP (EP3): wallet_perks, non-monetary perks granted by the award job (depends on v6; apply BEFORE the EP3 api build)
```
Manually-applied schemas (local AND VPS): `stellar_v1.sql`, `stellar_v1_metrics.sql`,
`stellar_v1_bridge.sql` (Allbridge bridge flows, T2-D3), `stellar_v2_multiwallet.sql`,
`stellar_v3_alerting.sql` (D2 alerting; must be applied AFTER v1 + v2),
`stellar_v1_network_tvl.sql` (G0 network-TVL history, T3-D3),
`stellar_v1_ops_metrics.sql` (E2 ops observability, T3-D3; R1 added the
`action_events.metadata` column: re-run once BEFORE deploying the R1 api, or the
fire-and-forget adoption inserts start failing silently),
`stellar_v1_action_witness.sql` (R1 execution witnesses, T3-D2, Lot R),
`stellar_v4_faucet.sql` + `stellar_v5_faucet_campaign2.sql` (Lot R/R2 faucet claims),
`stellar_v6_campaign.sql` (Lot EP Earn & Points: points only, no key, deploys dark),
`stellar_v7_social_claim_delete.sql` (Lot EP EP2: soft delete of social task claims, after v6),
`stellar_v8_campaign_perks.sql` (Lot EP EP3: `wallet_perks`, non-monetary perks, after v6).
Note: when a new table **or column** is added to one of these files (e.g. `network_stats_latest`
in `stellar_v1_metrics.sql`, `bridge_flows` in `stellar_v1_bridge.sql`, or the T2-D1
`is_active_signer` column + `user_wallets_one_signer_per_user` index, or the T2-D1 Gap B
`wallet_pool_health` table in `stellar_v2_multiwallet.sql`),
re-run that file once; the statements are idempotent (`add column if not exists`,
`create … if not exists`), so re-applying on local AND VPS is safe.

After applying `stellar_v1_bridge.sql`, run the Allbridge bootstrap once (creates the
`allbridge` venue + USDC asset) before the first refresh:
```bash
pnpm -C apps/indexer tsx src/scripts/bootstrap/allbridge-upsert-core.ts
```

### Useful checks
```bash
# Latest protocol metrics + freshness
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select venue_id, tvl_usd, as_of from protocol_metrics_latest order by as_of desc;"

# Network stats (single 'global' row)
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select scope, as_of, xlm_price_usd, stellar_tvl_usd, usdc_supply_usd from network_stats_latest;"

# Wallets + latest balance snapshots
psql "postgresql://dig:dig@localhost:5432/dig_stellar" -c "select * from user_wallets;"
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select user_wallet_id, asset_symbol, balance_usd, snapshot_at from wallet_balance_snapshots order by snapshot_at desc limit 20;"
```

---

## Ops endpoints (Lot E, T3-D3)

Public read-only observability: no auth, and they must never leak secrets, env values or
internal URLs (targets/steps are fixed internal labels; `version` is the short GIT_SHA only).

- `GET /health`: enriched liveness with `status` (`ok` | `degraded`), `version` (GIT_SHA),
  `uptimeSeconds`, `db.ok`/`db.latencyMs`, per-venue `freshness` (same 45-min read-time rule as
  the product reads), `lastRefreshAt` (max `as_of` in `network_tvl_snapshots`). Always HTTP 200
  with a readable `status`: `degraded` when the DB errors or any venue is stale; HTTP 503 only
  when the DB itself is unreachable.
  **Known expected-dormant venue: `allbridge` (`asOf: null` / stale is NOT an indexer bug).**
  Allbridge Core has been paused since the 2026-07-20 Solana flash-loan exploit (~$1.65M, their
  second since 2023; LPs urged to withdraw; no relaunch announced as of 2026-08-20) — there are
  simply no bridge events to ingest. The dashboard bridge card frames this honestly as an
  upstream pause (self-clearing banner). If Allbridge relaunches, this note is the trigger to
  re-enable freshness expectations for the venue.
- `GET /v1/ops/metrics`: refresh-pipeline RPC latency + error rates over a 24h window, from
  `rpc_metrics_runs` / `refresh_step_runs` (written by 71 at end of each `job:refresh`).
  Error rate is aggregated (`sum(errors)/sum(calls)`, sound to aggregate); latency percentiles
  are strictly per-run (never averaged). Known boundary: captures the INDEXER's outbound calls;
  the API process's own Horizon calls (actions preflight) are not captured.
- `GET /v1/ops/adoption` (E3): adoption counters. Wallets tracked (total / signers / watch-only,
  distinct users, from `user_wallets`) + actions built by kind/network (24h/7d/total, from
  `action_events`, one row per successful server-side build) + distinct acting addresses.
  Honest boundary (stated in the payload): counts server-side BUILDS; on-chain submission is
  client-side (non-custodial), so executed-tx evidence stays the manual hash list. No backfill:
  counters start at deploy.
- `GET /v1/ops/status?window=24h` (Lot ST, post-grant Sept 2026 — feeds the `#status` page):
  the Statuspage-style aggregation of the same two tables. Public read-only, `Cache-Control:
  no-store`, only `window=24h` accepted (anything else → 400 listing supported values).
  Rules — all in ONE exported object, `OPS_STATUS_RULES` in `apps/api/src/modules/ops/status.ts`:
  - step segment: `SUCCESS` → ok (green) · `FAILED` → failed (red). Retries are invisible in
    the DB, so no amber is derived for steps.
  - rpc segment: 0 errors → ok · error rate < 0.25 → degraded (amber) · ≥ 0.25 → failed.
  - gaps: the window is a TIME axis — spans between consecutive events in
    `[windowStart, run₁…runₙ, now]` over 1.75 × the 15-min cadence are missed cycles,
    including the open-ended TRAILING span (`before: null`, refresh overdue) and the leading
    span when history predates the window (else `noDataBefore`, not a gap).
  - `availability24h` = 1 − (failed + missed) / (observed + missed); degraded does NOT reduce it.
  - `overall.state` is the CURRENT state (latest run + trailing age only), never a 24h
    aggregate; `staleAfterSeconds` comes from `common/freshness.ts` (same 45-min rule).
  Boundary: this reflects the indexer's refresh pipeline and its outbound calls — it is not an
  external uptime probe of the API or the dashboard.

```bash
# Incident history, one query instead of grepping cron logs (E2):
psql "postgresql://dig:dig@localhost:5432/dig_stellar" \
  -c "select run_at, step, status, duration_ms, left(message, 80) from refresh_step_runs where status = 'FAILED' order by run_at desc limit 20;"
```

### Status-page fixture drill (local — Lot ST)

To exercise the `#status` view against a full 24h of shapes (failure, degradation, gap) on a
local DB that only holds a couple of real runs: seed 96 synthetic runs whose `run_at` seconds
are exactly `:33` (the fixture marker — real writer rows carry sub-second precision, e.g.
`…:33.854`, so the cleanup predicate can never touch them). Never run against prod; never
commit the rows.

```sql
-- Seed (96 runs over the last 24h into BOTH tables; one FAILED aquarius step at ≈−5h,
-- a 3-cycle gap at ≈−11h, price-sources at 10% errors for ≈2h):
with runs as (
  select
    date_trunc('minute', now()) - interval '2 minutes'
      + interval '33 seconds'
      - (n * interval '15 minutes') as run_at,
    n
  from generate_series(0, 95) n
  where n not in (44, 45, 46)
)
insert into refresh_step_runs (run_at, step, status, duration_ms, message)
select
  r.run_at,
  s.step,
  case when s.step = 'aquarius' and r.n = 20 then 'FAILED' else 'SUCCESS' end,
  1500 + (r.n % 7) * 210,
  case when s.step = 'aquarius' and r.n = 20
       then 'fixture: simulated pool refresh failure' else null end
from runs r
cross join (values
  ('prices:reference'), ('prices:soroswap-derived'), ('blend'), ('soroswap'),
  ('aquarius'), ('stellar-native'), ('defindex'), ('protocol-metrics'),
  ('allbridge'), ('network-stats')
) s(step)
on conflict (run_at, step) do nothing;

with runs as (
  select
    date_trunc('minute', now()) - interval '2 minutes'
      + interval '33 seconds'
      - (n * interval '15 minutes') as run_at,
    n
  from generate_series(0, 95) n
  where n not in (44, 45, 46)
)
insert into rpc_metrics_runs (run_at, target, calls, errors, p50_ms, p95_ms, p99_ms)
select
  r.run_at,
  t.target,
  100,
  case when t.target = 'price-sources' and r.n between 4 and 11 then 10 else 0 end,
  90 + (r.n % 5) * 12,
  260 + (r.n % 5) * 30,
  420 + (r.n % 5) * 45
from runs r
cross join (values
  ('soroban-rpc'), ('horizon'), ('defindex-api'), ('price-sources')
) t(target)
on conflict (run_at, target) do nothing;

-- Cleanup (the :33.000 marker is exact; real rows have fractional seconds):
delete from refresh_step_runs where extract(second from run_at) = 33;
delete from rpc_metrics_runs  where extract(second from run_at) = 33;
```

Observed counts in the 2026-09-04 drill: steps 120 → 1050 → 120, rpc 48 → 420 → 48; the real
rows' `max(run_at)` unchanged after cleanup.

---

## Data freshness & retries (T3-D1)

**Freshness is computed at read time in the API**: no new indexer state. Every `/v1/*` payload that
carries an `as_of` (protocols, pools, pool detail, `/v1/network/stats`) also returns:
- `isStale: boolean | null`: `true` when `now − as_of` exceeds the threshold; `null` when `as_of`
  is unknown (no metrics row yet). `stale` is kept as a backward-compatible alias of `isStale`.
- `staleAfterSeconds: number`: the configured threshold, so the UI can label it ("older than 45m").

**Threshold:** `FRESHNESS_STALE_AFTER_MINUTES` (API env, default **45** = 3× the 15-min cron; one
missed cycle is tolerated, two is stale). Legacy `STALE_THRESHOLD_MINUTES` is honoured as a fallback.
Helper: `apps/api/src/common/freshness.ts` (env read per-call, so a drill needs no code change).

**UI:** a freshness chip on the Protocol View header ("Updated Xm ago" → amber "Stale: data older
than 45m" when the selected protocol has any stale pool), an amber "Stale" badge on stale protocol
tabs, and the chip on `PoolDetail` when a pool is stale (`FreshnessChip.vue`).

**Retries (indexer):** every step of `71-refresh-all-metrics` runs through
`runTsxWithRetry` (`scripts/shared/retry.ts`): 3 attempts, exponential backoff **5s → 20s** + jitter,
each retry logged with the step label (`[retry] <label> attempt N/3 failed; backing off Nms`).
Per-protocol-entity steps retry per entity. Steps that must stay non-fatal (Aquarius / DeFindex /
Allbridge / network-stats) keep their `try/catch`: retries happen INSIDE first, catch-and-log is
the last resort.

### Forced-stale drill (evidence)

Prove the read-time stale flip without pausing the cron:
```bash
# Set the threshold tiny and restart the API (PM2 re-reads env); the UI chip turns amber.
FRESHNESS_STALE_AFTER_MINUTES=1 pnpm -C apps/api start:dev   # or: pm2 restart api --update-env
curl -s http://localhost:3000/v1/protocols | jq '.[] | {id, isStale, staleAfterSeconds}'
# ...screenshot the amber "Stale" chip/badges, then restore (unset the env / pm2 restart) and re-screenshot recovery.
```
Unit-level equivalent (no restart), evaluating real `as_of` rows at two thresholds: see
`docs/evidence/lot-b/`.

---

## Network stats (`/v1/network/stats`)

DB-backed since this session. Flow: indexer step `73-network-stats-refresh` fetches the external
providers (CoinGecko / DefiLlama / stellar.expert / Horizon) and upserts a single row into
`network_stats_latest` (scope `'global'`); the API does a single SELECT. The step is wired
non-fatally into `job:refresh` (step 8), so a provider outage never breaks the whole refresh.

To refresh manually then verify:
```bash
pnpm -C apps/indexer exec tsx src/scripts/ingest/73-network-stats-refresh.ts
curl -s localhost:3000/v1/network/stats | jq
```
Known issue: `activeWallets` and `dexVolume24hUsd` come back `null`; the stellar.expert summary
endpoint returns 404 (pre-existing; needs a corrected endpoint). `updatedAt` is the row's `as_of`,
not request time.

### Price sources (price-sources v2, 2026-09-29; born as the XLM hotfix)

Keyless CoinGecko access is blocked from datacenter IPs (CloudFront 403). Since v2 **CoinGecko
is called only when a key is configured** (`COINGECKO_PRO_API_KEY` → pro-api + `x-cg-pro-api-key`;
`COINGECKO_API_KEY` → the former Demo shape); without a key there is no call. Every asset is
priced by one shared rule (`apps/indexer/src/scripts/shared/xlm-price.ts`, unit-tested with
`pnpm -C apps/indexer test`) in step 1 `prices:reference`, XLM first:

1. `MANUAL_<ASSET>_USD` — explicit override, traced as `manual_env`;
2. **Reflector (phase B, 2026-10-14) — the primary source for every asset it lists**: the
   "External CEXs & DEXs" feed for XLM / BTC / ETH / EURC (`reflector_cex_<asset>`), the
   "Stellar Mainnet DEX" feed for the Stellar tokens (`reflector_sdex_<asset>`: AQUA, USDGLO,
   CETES, USTRY, TESOURO, SolvBTC, PYUSD, yUSDC); accepted only when the oracle timestamp is
   ≤ 900 s old, read by `simulateTransaction` through the configured RPC
   (`STELLAR_SOURCE_ACCOUNT` required; unset → oracle disabled, logged). The rules below are
   then the **cross-check**: tolerance 1 % (dollar / NAV coins) or 3 % (XLM, BTC, ETH, SolvBTC,
   xSolvBTC, EURC, AQUA); on disagreement the primary is kept, `metadata.crossCheck.agrees =
   false` is written and the log line says `DISAGREES … primary kept` — never averaged;
3. CoinGecko, when called and answered — `coingecko_direct`;
4. the deepest on-chain **constant-product** pool already captured by the refresh (Soroswap and
   SDEX by design; Aquarius only when the registry type is explicitly `constant_product` —
   `stable`, `concentrated` and unknown types are excluded) quoting the asset **vs USDC** (direct) or **vs XLM** (two
   hops through this run's XLM/USD, or **vs ETH** for BTC through `aquarius-btc-eth-pool`)
   that passes the guards: reserves ≤ 60 min old, quote side ≥ 50 000 USD, ≤ 10 % deviation vs
   a CoinGecko reference younger than 6 h when one exists — sources
   `onchain_<venue>_<asset>_<usdc|xlm|eth>` (e.g. `onchain_aquarius_ustry_usdc`,
   `onchain_sdex_aqua_xlm`, `onchain_aquarius_btc_eth`); XLM proxies (yXLM) follow XLM as
   `xlm_proxy:<source>`;
5. **StableSwap mid quotes** (`estimate_swap` both ways, geometric mean so the fee cancels,
   pool ≥ 50 000 USD on the quote side): **xSolvBTC** = SolvBTC (this run) × the
   xSolvBTC/SolvBTC mid — `derived_quote_aquarius_xsolvbtc_solvbtc`; and for **USDGLO, PYUSD,
   yUSDC**, whose only pool is StableSwap, the mid vs USDC — `quote_aquarius_<asset>_usdc` — is
   the fallback when Reflector is absent and the cross-check (1 %) when it is primary, so a
   Reflector outage never turns three stablecoins into "no price";
6. nothing → **no row** and a `no qualifying source for <ASSET>` log line. No constant exists
   any more. **Single-source assets, by design:** USDY (its cp pool only; sanity band
   [1.00, 1.25] and |Δ 24 h| ≤ 2 % vs our previous row, else no row) and oUSD (`manual_stable`
   = 1, Blend's Orbit oracle hard-codes the same peg — parity). USDC stays 1 by convention;
   the Reflector USDC/USD read is traced on its row (`metadata.reflectorUsdcUsd`) and flagged
   beyond ±1 %. Not on the production path: the Blend pool oracles (Reflector proxies with
   hard-coded pegs) and the BTC/USDC concentrated pool (thin) — both stay in the read-only
   `discovery/qa-price-sources.ts` comparison script.

RPC budget of step 1 with Reflector: 36 sequential simulations per run (1 `assets()`, 2
`decimals()`, 5 CEX + 10 Stellar DEX `lastprice`, 4 stable-pool quotes × 5), 120 ms apart,
≈ 5 s; a 429 / timeout is retried once then the source is absent for the run (never a failed
step). They are recorded on `#status` under the **Reflector oracle** target (`price-oracle`;
they also transit the RPC host, so the Soroban RPC row counts them once more). Step 2 (`prices:soroswap-derived`)
now derives when a pair leg has no **fresh** row (`PRICE_MAX_AGE_MINUTES`, default 45, same
threshold as `FRESHNESS_STALE_AFTER_MINUTES`), never for an asset that has a pricing rule (step 1
owns it), and under the same guards (USDC or XLM quote only, reserves ≤ 60 min, quote side
≥ 50 000 USD). Step 9
(`network-stats`) reads the native row step 1 wrote in the same run.

**Max age (phase A2):** every reader of `asset_prices` — indexer metric writers, wallet snapshots,
step 2, the alert evaluator (price family, TVL-drop window, rule-modal asset list) and the
`/v1/*` pool/top-asset/flow/series queries — accepts only rows younger than
`PRICE_MAX_AGE_MINUTES` (default = `FRESHNESS_STALE_AFTER_MINUTES`, 45): an older row counts as
absent, and a pool with no priced reserve gets `tvl_usd = null` (shown as `—`, never `$0`). The
faucet witness keeps its own 24 h rule. Evidence: `docs/evidence/price-sources-v2/04-phase-a2.md`.

The prices serve display and USD valuation only (plus the faucet witness's notional threshold,
which reads `asset_prices` with its own 24 h max age); they never feed a transaction build.
Each run logs one `price source: <ASSET> <kind> (<source>) => <price|null>` line per asset.
The `#status` "Price sources" tile measures the external providers still called (DefiLlama,
stellar.expert) and turns red when one of them fails; the "Reflector oracle" row measures the
step-1 oracle simulations; the "Price sources ·" line under the groups reads
`/v1/ops/status.priceSources` (assets priced / unpriced / single-source / cross-check
disagreements, from the latest fresh row per asset). Evidence:
`docs/evidence/price-sources-v2/05-phase-b-design.md`.

Verify after a refresh:
```bash
grep -n "price source:\|no qualifying source" /var/log/dig-stellar-refresh.log | tail -20
psql "$DATABASE_URL" -Atc "select a.symbol, ap.source, round(ap.price_usd::numeric, 6), ap.observed_at, round(extract(epoch from (now() - ap.observed_at))/60) as age_min from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by age_min desc, a.symbol"
```

---

## Smart Transaction Builder (T1-D3, Testnet)

End-to-end swap from the UI: connect Freighter (set the extension to **Test Net**), flip the
network toggle to **Testnet** → the "Testnet Actions" section shows the SDEX swap widget. The widget
calls `POST /v1/actions/sdex/swap` (multi-op XDR: `ChangeTrust` + `PathPaymentStrictSend`), signs
in-wallet via Stellar Wallets Kit, and submits to the Testnet RPC.

Test the backend endpoint directly:
```bash
curl -s -X POST http://localhost:3000/v1/actions/sdex/swap \
  -H "Content-Type: application/json" \
  -d '{"address":"G...","fromAsset":"XLM","toAsset":"USDC","amount":"10","minReceive":"0.1","network":"testnet"}' | jq
```
Notes:
- Swap is gated Testnet-only by default (disabled + notice on Mainnet). Mainnet is ungated via the
  controlled regime below (T3-D2, Lot A1); with the flags unset, behavior is exactly the above.
- On Testnet the swap op may fail with `pathPaymentStrictSendTooFewOffers`: no SDEX liquidity for
  the pair on Testnet, not a code bug (`ChangeTrust` op 1 still succeeds).
- Fund a Testnet account via Friendbot; sign with Freighter set to Test Net.

---

## Mainnet actions (T3-D2): gating regime

Ungating Mainnet actions is **not** removing the Testnet-only guard; it is replacing it with a
controlled regime. See `docs/security-invariants.md` §4 (the review checklist) and the implementation
briefs `docs/lot-a1-mainnet-swap.md` (swap) + `docs/lot-a2-blend-mainnet.md` (Blend deposit). The
**swap and the Blend deposit each have their OWN kill-switch**, so they ungate independently.

**Environment flags** (all default to today's Testnet-only behavior when unset):

| Var | App | Default | Effect |
|-----|-----|---------|--------|
| `ACTIONS_MAINNET_ENABLED` | api | unset → OFF | Swap kill-switch (INV-4.1). `"true"` lets `sdex/*` `network:"mainnet"` through; otherwise → **403**. |
| `ACTIONS_MAINNET_BLEND_ENABLED` | api | unset → OFF | Blend kill-switch (Lot A2), independent of the swap. `"true"` lets `blend/deposit`, `blend/withdraw` **and** `blend/position` `network:"mainnet"` through; otherwise → **403**. The withdraw (Lot A3) rides this same switch; there is no separate withdraw flag. |
| `ACTIONS_MAINNET_MAX_SEND_XLM` | api | `100` | Per-transaction cap (INV-4.2). Over-cap `sdex/swap` **and** `blend/deposit` → **400**. Deliberately **not** applied to `blend/withdraw` (INV-2.15). |
| `ACTIONS_MAINNET_RPC_URL` | api | `https://mainnet.sorobanrpc.com` | Soroban RPC override for the mainnet swap **and** Blend paths. |
| `ACTIONS_INCLUSION_FEE_STROOPS` | api | `10000` | Per-operation inclusion-fee **bid** on every built envelope (Blend deposit/withdraw, trustline, SDEX swap). A bid, not a price: the network charges the market-clearing rate (100 stroops off-surge), so a high bid costs nothing in practice. `BASE_FEE` (100) here caused a real mainnet `txInsufficientFee` rejection under surge pricing (2026-08-14). Keep ≤ 50,000: above that the client gates (swap ≤ 100,000 total over up to 2 ops) fail closed and refuse to sign. Values below 100 are ignored. |
| `VITE_ACTIONS_MAINNET_ENABLED` | web | unset → OFF | UX only: reveals the mainnet swap surface. NOT enforcement. |
| `VITE_ACTIONS_MAINNET_BLEND_ENABLED` | web | unset → OFF | UX only: reveals the mainnet Blend card (supply AND withdraw tabs). NOT enforcement. |

Mainnet enforcement lives in `apps/api` (`actions.controller.ts` + `network-registry.ts`): the two
kill-switches, the shared per-transaction cap, the swap asset whitelist (native XLM + Circle USDC
only, INV-4.3), and the Blend deposit asset whitelist (XLM | USDC only). The web VITE flags only
toggle UI; the API rejects mainnet regardless when its flag is off.

**Ungating procedure** (record the result, date + commit SHA + checker, as T3-D2 evidence):

1. Run the full `docs/security-invariants.md` checklist top to bottom.
2. Re-verify the Circle USDC **mainnet** issuer on BOTH sides: `MAINNET_USDC_ISSUER` in
   `apps/api/src/modules/actions/network-registry.ts` AND `apps/web/src/config/mainnetSwapPairs.ts`.
   They MUST match (currently `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
3. Set `ACTIONS_MAINNET_ENABLED=true` on the VPS, restart PM2.
4. `curl` validation (mainnet):
   ```bash
   # quote OK
   curl -s -X POST $API/v1/actions/sdex/quote -H "Content-Type: application/json" \
     -d '{"fromAsset":"XLM","toAsset":"USDC","amount":"10","network":"mainnet"}' | jq
   # over-cap swap → 400
   curl -s -X POST $API/v1/actions/sdex/swap -H "Content-Type: application/json" \
     -d '{"address":"G...","fromAsset":"XLM","toAsset":"USDC","amount":"1000000","minReceive":"0.1","network":"mainnet"}' | jq
   # non-whitelisted asset → 400
   curl -s -X POST $API/v1/actions/sdex/quote -H "Content-Type: application/json" \
     -d '{"fromAsset":"XLM","toAsset":{"code":"AQUA","issuer":"G..."},"amount":"10","network":"mainnet"}' | jq
   # flag OFF (before step 3, or after rollback) → 403
   ```
5. Set `VITE_ACTIONS_MAINNET_ENABLED=true` on Vercel, redeploy.
6. Do ONE small real capped swap from the dashboard; keep the tx hash as the T3-D2 evidence starter.

**Rollback**: unset `ACTIONS_MAINNET_ENABLED` on the VPS and restart PM2; the API returns to 403 on
mainnet immediately, independent of the web deploy.

### Blend deposit ungating (Lot A2)

The deposit ungates on its OWN switch (`ACTIONS_MAINNET_BLEND_ENABLED`), independently of the swap.
Its 2-step trustline-gated path is already proven E2E on testnet; this is the mainnet extension.

1. Run the full `docs/security-invariants.md` checklist top to bottom (record date + commit SHA + checker).
2. Re-verify the Blend **Fixed pool** id + reserve **SACs** on BOTH sides (`MAINNET_BLEND_POOL` /
   `MAINNET_USDC_SAC` / `MAINNET_XLM_SAC` in `apps/api/src/modules/actions/network-registry.ts` AND
   `apps/web/src/config/blendPools.ts`) against the prod DB (`entities` where venue=Blend →
   `blend-fixed-pool`; `reserve_snapshots` for its USDC/native reserves) **and** blend.capital. The
   SACs are the deterministic contract ids of `USDC:GA5ZSE…` and native XLM on Pubnet (cross-check
   with `Asset(...).contractId(Networks.PUBLIC)`). Confirm it is a **V2** pool.
3. Set `ACTIONS_MAINNET_BLEND_ENABLED=true` on the VPS, restart PM2.
4. `curl` validation (mainnet), using a real funded address:
   ```bash
   # flag OFF (before step 3, or after rollback) → 403
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"XLM","amount":"5","network":"mainnet"}' | jq
   # flag ON, XLM deposit → returns xdr + simulation.success:true
   # USDC without the classic trustline → trustlineRequired:true + changetrustXdr (deposit xdr empty)
   # over-cap → 400
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"XLM","amount":"1000000","network":"mainnet"}' | jq
   # EURC (or any non XLM/USDC asset) → 400
   curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
     -d '{"address":"G...","asset":"EURC","amount":"5","network":"mainnet"}' | jq
   ```
5. Set `VITE_ACTIONS_MAINNET_BLEND_ENABLED=true` on Vercel, redeploy.
6. Do ONE small real deposit (a few XLM) from the dashboard. The client gate
   (`apps/web/src/lib/validateDepositXdr.ts`) validates the XDR against `config/blendPools.ts`
   before EVERY signing prompt. Verify the new position appears in the portfolio above (T2-D1
   resolver picks up the Blend position + health factor) AND on blend.capital. Record the tx hash
   in `docs/evidence/`; it is the "vault/lending" evidence for T3-D2 criterion 1.

**Rollback**: unset `ACTIONS_MAINNET_BLEND_ENABLED` on the VPS and restart PM2; `blend/deposit`,
`blend/withdraw` and `blend/position` all return to 403 on mainnet immediately, independent of the
swap flag and the web deploy.

### Blend withdraw ungating (Lot A3)

The withdraw ships behind the **same** switch as the deposit: flipping
`ACTIONS_MAINNET_BLEND_ENABLED` ungates both, so there is nothing extra to enable. Its testnet
money path is proven E2E (supply `b199a1d7…` + withdraw `322d760e…`, both confirmed on-chain; see
`docs/evidence/lot-a3-blend-withdraw.md`).

Deliberate difference from the deposit: **there is no amount cap on a withdraw** (INV-2.15): it
returns the user's own funds to their own wallet, and a cap could strand a position larger than it.
Do not "fix" this by adding one.

`curl` validation (mainnet), after the deposit ungating above:
```bash
# flag OFF → 403 (withdraw AND the position read ride the same switch)
curl -s -X POST $API/v1/actions/blend/withdraw -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"XLM","amount":"5","network":"mainnet"}' | jq
curl -s -X POST $API/v1/actions/blend/position -H "Content-Type: application/json" \
  -d '{"address":"G...","network":"mainnet"}' | jq
# flag ON, position read → collateral / supply / liabilities per asset, live from chain
# flag ON, withdraw within the position → xdr + simulation.success:true
# withdraw with NO position → simulation.success:false, xdr:"" (nothing signable)
# EURC (or any non XLM/USDC asset) → 400
```

Then do ONE small real pair from the dashboard: supply a few XLM, then Withdraw → Max. The client
gate (`validateWithdrawXdr`) validates the XDR against `config/blendPools.ts` before the signing
prompt, pinning `WithdrawCollateral`. Verify the position drops in the portfolio and on
blend.capital, and record BOTH hashes in `docs/evidence/lot-a3-blend-withdraw.md`; they are the
T3-D2 bonus evidence pair.

Expect a **dust remainder** after a Max withdraw (a few stroops): collateral accrues interest
between the position read and apply. That is correct behavior, not a bug.

---

### Blend multi-pool: adding or ungating a pool (Lot A5)

Since A5, supply + withdraw work on **every pool in the registry**, not just Fixed. Both registries
must agree, entry for entry:

- API: `apps/api/src/modules/actions/network-registry.ts` → `MAINNET_BLEND_POOLS`
- Web: `apps/web/src/config/blendPools.ts` → `MAINNET_BLEND_POOLS`

The client one is what the signing gate pins; a divergence between them is a **security bug**, not
config drift.

**Before adding a pool** (never from memory; the A2 rule: an id that cannot be verified is
EXCLUDED, not guessed):

1. Confirm it is in the indexed perimeter (`entities` × `venues.slug='blend'`,
   `entity_type='lending_pool'`, `is_active`). A pool the product does not list is out of scope.
2. Verify the contract id against Blend itself. `mainnet.blend.capital` is a client-rendered SPA
   (a fetch returns an empty shell), so verify on-chain instead (stronger, and reproducible):
   - the official **V2 pool factory** (`CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU`,
     from docs.blend.capital) must answer `is_pool(<id>) = true`;
   - the pool should appear in the **backstop reward zone**
     (`CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7`), Blend governance recognition;
   - stellar.expert should report the **same wasm hash** as the vetted Fixed pool;
   - `PoolV2.load` must succeed (this IS the V2 confirmation; the builder uses `PoolContractV2`),
     and its `metadata.name` is the label to use.
3. Read the pool's reserves **live via the SDK** to decide its asset list. Do **NOT** read
   `reserve_snapshots`: it retains rows for reserves a pool no longer has (Orbit still has a
   2026-04-01 USDC row but no USDC reserve on-chain), so a DB-derived list would offer a deposit
   that fails at simulation.
4. Add the entry to BOTH registries, then run `pnpm -C apps/web test`; the cross-pool red tests
   iterate the real registry, so a new pool is automatically covered by the pairwise pinning tests.

`curl` validation per pool (mainnet):
```bash
# unknown slug → 400 (never a silent fallback to another pool)
curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"XLM","amount":"1","network":"mainnet","pool":"blend-nope"}' | jq
# asset the pool has no reserve for → 400 naming the pool (e.g. Orbit + USDC)
curl -s -X POST $API/v1/actions/blend/deposit -H "Content-Type: application/json" \
  -d '{"address":"G...","asset":"USDC","amount":"1","network":"mainnet","pool":"blend-orbit-pool"}' | jq
# position read echoes the pool it actually read + that pool's assets
curl -s -X POST $API/v1/actions/blend/position -H "Content-Type: application/json" \
  -d '{"address":"G...","network":"mainnet","pool":"blend-yieldblox-pool"}' | jq '.poolSlug, .assets'
# no "pool" key at all → the default (Fixed), i.e. pre-A5 behavior
# flag OFF → 403 for EVERY pool (the kill-switch is checked before pool resolution)
```

---

## Wallet troubleshooting
- Test wallet connect: connect via the header button (Stellar Wallets Kit); pick Freighter.
- After a page reload, the kit re-selects the connected provider (`restoreWalletSession` +
  defensive `setWallet` before signing); this fixes the "xBull opens instead of Freighter" bug.
- Refresh a wallet's balances: `POST /v1/wallets/:walletId/refresh` (spawns the indexer balance
  snapshot script, then the Blend positions script).
- **A `429` on refresh is admission control, not a failure (Lot SEC G1,
  `security-invariants.md` §12).** The body says why: `reason: "cooldown"` = this wallet was
  refreshed less than 60 s ago (`retryAfterSeconds` tells when); `reason: "in-flight"` = a
  refresh of this wallet is still running; `reason: "capacity"` = two refreshes are already
  running in the API process, retry in a few seconds. A `429` with the nginx JSON body (no
  `reason` field) is the per-IP edge limit instead. Nothing to fix server-side in either case;
  if `capacity` shows up for ordinary users, look at what is keeping refreshes slow (Horizon /
  RPC latency in the API log) before raising the cap.
- **A `400` on `POST /v1/wallets`** names the field: the address must be a Stellar public key
  (`G…`, 56 characters; contract addresses are not accepted yet), labels are limited to 64
  characters, `userId` must be a UUID. A `500` on these routes is now always a defect to report.
- **A `500` on refresh** answers a fixed message; the detail (child exit code, its stdout and
  stderr) is in the API log under `[wallets]`. Look there, never ask a user for the body.
- Inspect: `user_wallets`, `wallet_balance_snapshots` (see Database checks above).

---

## Common debug situations

- **Frontend build fails with `CustomEvent is not defined`** → you're on an old Node (18); `nvm use` (Node 24).
- **`/v1/...` returns 404 from the widget** → the frontend is hitting the wrong API base; check
  `apps/web/.env` `VITE_API_BASE` points at the running API (local = `http://localhost:3000`).
- **API returns all-`null` numeric fields from a raw-SQL read** → Postgres `numeric` columns come back
  as `Prisma.Decimal` objects via `$queryRawUnsafe`; the mapper must unwrap them (`toNumber()` /
  `toString()` → `Number`), as in `network.service.ts` / `stellar.service.ts`.
- **Freighter refuses to sign ("transaction is on Main Net")** → the toggle/kit network and the
  Freighter extension network must match; set both to Testnet for T1-D3.
- **Stale protocol data in UI** → check `as_of` freshness in `*_metrics_latest`; re-run
  `pnpm -C apps/indexer job:refresh`.

## Reward faucet (Lot R, T3-D2)

The faucet pays 5 XLM from a DIG-owned hot wallet after a verified qualifying action
(security model: `docs/security-invariants.md` §9). Everything defaults DARK
(`FAUCET_ENABLED` unset).

### Setup (founder, one-time per network)

1. Generate the keypair **locally** (never in chat, never committed):
   `node -e "const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();console.log(k.publicKey());console.log(k.secret())"`
2. Fund the public address with **exactly 200 XLM** from treasury (the hard exposure cap:
   never more; refills are manual and deliberate).
3. VPS env (`apps/api/.env`): `FAUCET_SECRET_KEY=<secret>`, `FAUCET_NETWORK=testnet|mainnet`,
   optional `FAUCET_REWARD_XLM` / `FAUCET_MAX_CLAIMS` / `FAUCET_HOURLY_CLAIM_CAP` /
   `FAUCET_MIN_NOTIONAL_XLM`. Leave `FAUCET_ENABLED` unset until go-live.
4. Apply `stellar_v1_action_witness.sql` + `stellar_v4_faucet.sql` (see "Apply raw SQL schemas").
5. nginx: `/v1/actions/witness` is already covered by the strict `location /v1/actions/` zone;
   put `POST /v1/faucet/claim` in the strict zone but keep `GET /v1/faucet/eligibility` in the
   general zone; it is polled by the promo surfaces and the strict zone starves it (learned in
   the 2026-08-17 incident; see `docs/deployment.md` zones).

### Campaign 2 (Lot R2): per-family rewards

Campaign 2 pays per action FAMILY: first verified swap AND first verified Blend supply each
earn 5 XLM (max 2 claims per wallet), budget 60 claims. Evidence:
`docs/evidence/lot-r2/testnet-e2e.md`.

1. Apply `stellar_v5_faucet_campaign2.sql` BEFORE deploying/restarting the campaign-2 api
   build (it relabels campaign-1 rows and swaps the unique indexes to per-(wallet, family,
   campaign); idempotent).
2. Fund the treasury with the campaign budget (302 XLM for 60 × 5 + fees), founder-side.
3. Activation env, all three together: `FAUCET_MAX_CLAIMS=60`, `FAUCET_STARTS_AT=<ISO now>`,
   `FAUCET_ENDS_AT=<ISO now+48h>`, then `FAUCET_ENABLED=true` + pm2 restart.
   `FAUCET_STARTS_AT` is REQUIRED and fail-closed: without it the campaign stays inactive
   (`campaign-not-started`); only witnesses whose tx executed at/after it qualify, so
   campaign-1 actions can never be replayed for a campaign-2 reward.

### Go-live sequence (mainnet)

1. **Clear testnet E2E claim rows first**: the unique indexes (per wallet/user + family +
   campaign since v5) are GLOBAL across networks:
   `delete from faucet_claims where network = 'testnet';`
2. Set `FAUCET_NETWORK=mainnet`, `FAUCET_ENABLED=true`, restart the api (pm2).
3. Founder executes ONE real qualifying action + claim as the go-live proof; verify the payout
   hash and the `/v1/ops/metrics` faucet block.

### Operate

- **Watch a drain**: `/v1/ops/metrics` → `faucet` block (`claims.paid24h`, `remainingClaims`,
  `treasurySpendableXlm`). Payouts auto-halt when spendable < reward.
- **Pause**: set `FAUCET_ENABLED=false` + restart. The promo surfaces disappear by themselves.
- **Drain back to treasury**: pause first, then send the balance back with a normal payment
  from the hot wallet (or account-merge if retiring the wallet for good).
- **`failed` claim row**: the payout errored; `failure_reason` says whether it MAY have paid
  (ambiguous submit). Verify the treasury's outgoing payments on stellar.expert. If it paid:
  set the row `paid` with the real `payout_tx_hash`. If it did not: either delete the row
  (frees the wallet/user to claim again) or leave it (permanently blocks them). NEVER resubmit
  blindly: that is the double-pay path.
- **Row stuck in `pending` > 5 min**: the post-payout UPDATE failed; same explorer-verify
  procedure as `failed`, then resolve the row manually.
