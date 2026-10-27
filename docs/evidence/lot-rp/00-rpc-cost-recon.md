# Lot RP — step 0: RPC cost reconciliation (read-only, 2026-10-26 → 2026-10-27)

Why: the Validation Cloud bill (endpoint "dig", Scale plan) went from ~5M CU/day (late Aug → mid
Oct) to a flat ~35M CU/day from 2026-10-17/18 (~$190 for October). Request logs (enabled 2026-10-26)
show 100 % of requests from the VPS IP — no key leak, no third party; web bundle and git history are
clean. This note reconciles the bill against what our jobs actually call. Every number below is
either a provider-documented figure (cited) or a local measurement against the PUBLIC endpoint
(`mainnet.sorobanrpc.com`, ≤ 5 req/s, never the operator key).

## 1. Provider weights (documented)

| Call | CU | Source |
|---|---|---|
| Every Stellar RPC method (`getLedgerEntries`, `simulateTransaction`, `getEvents`, `getLatestLedger`, `getTransaction`, `sendTransaction`, `getHealth`…) | **10** | https://docs.validationcloud.io/v1/stellar/stellar-rpc-formerly-soroban-api ("Every method uses 10 Compute Units") and each method page |
| Horizon endpoints (accounts, liquidity-pool trades, …) | **20** | https://docs.validationcloud.io/v1/stellar/horizon-api/… ("This endpoint will use 20 Compute Units") |
| Free tier / Scale plan | 50M CU/month free; $0.50 → $0.35 per 1M CU | https://www.validationcloud.io/stellar, https://docs.validationcloud.io/nodeapi/about/billing |

One Node API key serves RPC **and** Horizon. The indexer's `HORIZON_TRADES_URL` points at the
key, so the stellar-native trades pages are billed too (20 CU each). No pricing change is
announced anywhere public; the docs still say 10 CU for `simulateTransaction`. See §4 for why the
bill nevertheless behaves as if a simulation cost ~100 CU since 2026-10-17/18.

## 2. Measured calls per run, by method (local, public endpoint, 2026-10-27)

Captured with a preload that counts every outbound call of every child process (global fetch +
the SDKs' axios copy), throttled to 5 req/s.

### job:refresh (71, 10 steps; EVENTS_LIMIT=50 MAX_EVENT_PAGES=10 LEDGER_LOOKBACK=5000 as on the VPS)

| Step | getLedgerEntries | simulateTransaction | getEvents | getLatestLedger | Horizon (public) | Horizon trades (on the VC key in prod) |
|---|---|---|---|---|---|---|
| prices:reference (62) | 1 | 37 | | | | |
| blend (4 pools) | 12 | 48 | | | 48 accounts | |
| soroswap (4 pairs) | | 38 | 7 | 4 | 38 accounts | |
| aquarius (21 pools) | | 168 | 69 | 21 | 168 accounts | |
| stellar-native | | | | | 18 liquidity_pools | **46** trades pages |
| allbridge | | | 2 | 2 | | |
| network-stats | | | | | 2 fee_stats (+ llama, stellar.expert) | |
| defindex (3 vaults) | failed locally (no `DEFINDEX_API_KEY`) — prod adds its calls | | | | | |
| **Total Soroban RPC** | **13** | **291** | **78** | **27** | | |

409 Soroban calls + 46 trades pages locally; prod `rpc_metrics_runs` reports ~700 per run (the
46 trades pages are classified `soroban-rpc` there because they hit the RPC host, plus DeFindex
and a higher event-page count on busy ledgers). The mix is what matters: **~70 % of the refresh's
RPC calls are `simulateTransaction`** (`simulateContractRead` per reserve / pair / pool + 36
Reflector `lastprice` reads).

### 81 wallet sweep (via job:wallet-alert) — per wallet, 4 pools, as deployed before RP1

| Per wallet | getLedgerEntries | simulateTransaction | total |
|---|---|---|---|
| PoolV2.load × 4 | 8 | | |
| loadOracle × 4 (decimals + `lastprice` per reserve; reserves 5+3+4+8) | | 24 | |
| loadUser × 4 | 4 | | |
| **per wallet** | **12** | **24** | **36** |
| **92 wallets (prod)** | 1,104 | 2,208 | **3,312** |

Measured on 9 local wallets: 108 getLedgerEntries + 216 simulateTransaction = 324 calls, 67 s.
The pool + oracle are reloaded for EVERY wallet: 92 × 4 identical loads per run.

### 83 evaluator

`PoolV2.load` × 4 pools = 8 getLedgerEntries per run, on `ACTIONS_MAINNET_RPC_URL` (public RPC by
default — only on the key if the VPS sets that variable). DB-only otherwise.

### job:campaign (84)

DB only, no RPC (confirmed in code and by the 67–111 ms runs).

## 3. Reconciliation at the DOCUMENTED weights (10 CU RPC, 20 CU Horizon)

| | calls/run | CU/run | runs/day | CU/day |
|---|---|---|---|---|
| job:refresh (prod ~700 incl. 46 trades @20) | ~700 | ~7.5k | 96 | **0.7M** |
| 81 sweep, 92 wallets, 4×/hour | 3,312 | 33k | 96 | **3.2M** |
| 81 sweep, hourly (stopgap) | 3,312 | 33k | 24 | 0.8M |
| 83 | 8 | 80 | 96 → 24 | ~0 |
| **Total, old cadence** | | | | **~3.9M CU/day** |

That matches the **pre-Oct-17 bill (~5M CU/day)** to within the DeFindex/event-page slack. It
does **not** match the plateau (35M) nor the post-stopgap level (17M). Note also that the sweep
was already ~80 % of the bill before the jump — `job:refresh` was never the main consumer.

## 4. What the hourly chart says the sweep REALLY costs

Stopgap 2026-10-26 ~21:00 Paris: wallet-alert from 4×/hour to 1×/hour. Hourly CU fell from
~1.45M to ~0.70M, flat on both sides → 3 sweeps = 0.75M CU → **~250k CU per sweep run**.
At 3,312 calls/run that is **~75 CU per call** on average. Solve for the method weights with the
measured mix (1,104 getLedgerEntries, 2,208 simulateTransaction):

- 10 CU everything → 33k CU/run (observed 250k: **7.5× short**)
- getLedgerEntries 10, **simulateTransaction 100** → 11k + 221k = **232k CU/run** (observed ~250k ✔)

Apply the same weights to the refresh (291 sim × 100 + ~160 other × 10 + 46 × 20 ≈ 31k CU/run,
3.0M CU/day) and the daily picture becomes:

| Regime | sweep | refresh | sum | observed | residual |
|---|---|---|---|---|---|
| Before 2026-10-17 (all @10) | 3.2M | 0.7M | 3.9M | ~5M | ~1M |
| Plateau, 4×/hour sweep (sim @100) | 22.3M | 3.0M | 25.3M | ~35M | **~10M/day ≈ 0.4M CU/h** |
| After stopgap, hourly sweep (sim @100) | 5.6M | 3.0M | 8.6M | ~17M | **~8M/day ≈ 0.35M CU/h** |

Conclusion: the 7× step on 2026-10-17/18 is consistent with request volume staying constant and
**the effective price of `simulateTransaction` moving from 10 to ~100 CU** — the two jobs that
spike simulations (the sweep's 2,208 oracle reads per run, the refresh's 291) are exactly what
blew up, and nothing in our deploys (none between Oct 15 and Oct 21) changed call counts. The
docs still say 10; this must be confirmed with Validation Cloud support (ask for the CU per method
on the invoice period and whether weights changed mid-October) and against the dashboard's
per-method CU breakdown if it has one.

**Unexplained residual: ~0.35–0.4M CU/hour and ~70k requests/hour.** The request counter rose by
1.08M in ~14 h after the stopgap (≈ 77k/h) while our jobs account for ~5k/h (hourly sweep 3.3k +
refresh 1.8k). Those ~70k requests/hour at ~6 CU each are cheap calls (getLedgerEntries /
getLatestLedger / getHealth-class), continuous, from the VPS IP, and from a source our
`rpc_metrics_runs` capture does not see. Candidates, in order: a compose `indexer` container left
running (its `docker-entrypoint.sh` loops `job:refresh` every `REFRESH_INTERVAL_SECONDS`), a
stuck or orphan `tsx` process, API-spawned per-wallet refreshes (`POST /v1/wallets/:id/refresh`
spawns 80 + 81 for one wallet = 36 calls on the key) driven by a client, or a `getTransaction`
poller. Read-only checks (VPS):

```bash
docker ps -a --format '{{.Names}} {{.Status}} {{.Image}}'          # any dig_stellar_indexer / _api container?
pgrep -af 'tsx|node' | grep -v pm2 | grep -v pgrep                  # anything long-running besides pm2's API
VC=$(getent hosts mainnet.stellar.validationcloud.io | awk '{print $1}' | head -1); echo $VC
for i in 1 2 3; do ss -tnp state established "( dst $VC )" | awk 'NR>1{print $NF}' | sort | uniq -c; sleep 20; done   # which PID holds connections to VC between sweeps
sudo zgrep -hE 'POST /v1/wallets/[^ ]+/refresh|POST /v1/actions/blend/position' /var/log/nginx/access.log* | awk '{print substr($4,2,14)}' | sort | uniq -c | tail -30   # per-hour API-triggered RPC
grep -c 'Starting wallet alert sweep' /var/log/dig-stellar-alert.log; grep -oE "completedAt: '[^']+" /var/log/dig-stellar-alert.log | tail -3
```

and, on the provider side, the request log filtered to a window with no sweep running (e.g.
:20–:50 of any hour now that the sweep runs at :07): the method histogram of that window IS the
residual.

## 5. Blend reserve counts over time (task 4)

Local `reserve_snapshots` (June → Oct 26): orbit = 4 reserves on every day, yieldblox = 8 on every
day; fixed = 3 and etherfuse = 5 on 2026-10-27 (from the pool loads). No reserve was added around
2026-10-17/18 in our snapshots, so the per-load simulation count (reserves + 1 per pool, 24 per
wallet) did not change. Prod cross-check:

```sql
select e.slug, snapshot_at::date d, count(distinct asset_id) reserves
from reserve_snapshots rs join entities e on e.id = rs.entity_id join venues v on v.id = e.venue_id
where v.slug = 'blend' and snapshot_at > '2026-10-10' group by 1,2 order by 1,2;
```

## 6. The 2,016 user_wallets rows of 2026-10-15 12:21–14:37 UTC (task 5)

- The only writer of `user_wallets` is `WalletsService.createWalletForUser` (apps/api), reached by
  `POST /v1/wallets` (watch-only track: with no `userId` the backend **mints a new user** and an
  `is_active = true` wallet) and `POST /v1/wallets/connect` (same minting when there is no session).
  No indexer script, seed, import or campaign path inserts wallets. `normalizeChain` accepts only
  `stellar`, so every API-created row has `chain = 'stellar'`.
- 2,016 rows by 2,007 distinct users in 136 minutes (one every ~4 s) is the signature of a
  **scripted client** against the public API (one minted user per call, no auth on those routes)
  — not real users, not a seed. The Oct 15 deploys (`3607ea7`, `99b9c35`, `6ee8721`) touched web
  copy, prices and ops; none creates wallets. Who: the nginx access log for that window
  (`zgrep ' /v1/wallets' /var/log/nginx/access.log.*` → client IP, user-agent, cadence).
- **Contradiction to resolve:** 81 selects `chain = 'stellar' and is_active = true` with no limit,
  so if those 2,016 rows are `stellar` + active it sweeps **all 2,139**, not ~92. Either the
  `processedWallets ≈ 92` lines predate Oct 15, or the rows differ from what the API writes
  (direct SQL?). Check: `select chain, is_active, count(*) from user_wallets group by 1,2;` and the
  last `completedAt` / `processedWallets` pairs in `/var/log/dig-stellar-alert.log`. If the sweep
  does cover 2,139 wallets, the pre-RP1 cost was 77k calls per run (and the run outlived its cron
  slot, which `flock -n` turns into a near-continuous loop). RP1 makes the question moot for cost
  (120 calls for 2,100 wallets); wallet hygiene (deactivating minted-and-abandoned rows) is RP2.
- 80 (balances, Horizon public) is only spawned per wallet by the API refresh route; 83 and 84
  do not iterate wallets.
