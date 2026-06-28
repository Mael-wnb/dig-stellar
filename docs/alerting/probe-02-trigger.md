# Probe 02 — Evaluation Trigger for the Alerting Engine (D2)

**Type:** read-only recon. Nothing was modified. Every claim is quoted from source; gaps are
flagged as gaps, not inferred.

**Question:** the evaluator runs *against the snapshot DB* (not a sub-minute event stream).
Choose between **(A)** riding an existing "snapshot refreshed" event, or **(B)** a periodic sweep.

**Sources inspected:** `apps/api/**`, `apps/indexer/**`, `apps/web/**`, root `package.json`s,
`docker-compose.yml`, `docs/deployment.md`, `docs/runbooks.md`. Search commands and their output
are quoted inline.

---

## TL;DR

- **(A) is not viable.** There is **no message bus of any kind** — no RabbitMQ, no AMQP, no Nest
  microservices, no Redis pub/sub, no event emitter. Nothing publishes a "snapshot refreshed"
  event, and there is no consumer pattern to mirror. The API↔indexer seam is `child_process.spawn`
  of `tsx` scripts.
- **(B) periodic sweep is the only viable path** — and it fits the "against the snapshot DB"
  requirement exactly.
- **Critical gap:** `wallet_pool_health` is **not refreshed by `job:refresh` at all.** Today it is
  written **only on-demand**, per-wallet, by `POST /v1/wallets/:walletId/refresh`. There is **no
  periodic background refresh of wallet health**, so currently the alert-latency floor is "whenever
  a user manually refreshes that wallet" — effectively unbounded. D2 must add a wallet-health
  sweep; the good news is script `81` already supports an all-active-wallets sweep with no code
  change (see §4).

---

## 1. Is a RabbitMQ event emitted on snapshot refresh? — **NO. No producer exists.**

```
grep -rniE "rabbitmq|amqp|amqplib|@nestjs/microservices|ClientProxy|EventPattern|MessagePattern" apps packages
  → (zero matches)

grep -niE "amqp|rabbit|bull|@nestjs/schedule|node-cron|cron|agenda|redis"
  apps/api/package.json apps/indexer/package.json apps/web/package.json package.json
  → (zero matches)
```

- **No RabbitMQ / AMQP** dependency or import anywhere. No exchange, queue, routing key, or payload
  exists to document — there is no producer.
- `docker-compose.yml` provisions only `postgres:16` and `redis:7`. **No RabbitMQ container.**
- **CRITICAL PIVOT (answered by absence):** there is no event payload at all — neither rich
  (carrying `(wallet, pool)` + new `health_factor`) nor thin ("something changed"). The signal
  does not exist.

**How the snapshot actually gets written instead (the real "producer"):** `child_process.spawn`.
The API shells out to the indexer's tsx scripts. From `apps/api/src/modules/wallets/wallets.service.ts`:

```ts
// :396
private runWalletBalanceRefreshScript(walletId: string): Promise<void> {
  return this.runIndexerWalletScript(
    'src/scripts/wallets/80-stellar-wallet-balance-snapshots.ts', walletId, 'Wallet balance refresh');
}
// :404
private runWalletBlendPositionsScript(walletId: string): Promise<void> {
  return this.runIndexerWalletScript(
    'src/scripts/wallets/81-stellar-wallet-blend-positions.ts', walletId, 'Wallet Blend positions refresh');
}
```

`script 81` is the **only** writer of `wallet_pool_health` (confirmed in probe-01). So "snapshot
refreshed" = "script 81 finished" — and that completion is reported via process exit code over a
spawned child, not over any bus.

---

## 2. RabbitMQ consumer pattern in apps/api / indexer — **NONE. No house style to follow.**

```
grep -rniE "@nestjs/microservices|EventPattern|MessagePattern|ClientProxy|@RabbitSubscribe|@MessageHandler" apps
  → (zero matches)
```

- `apps/api` is a **plain HTTP NestJS app** (`@nestjs/platform-express` only; deps are
  `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@prisma/client`, `rxjs`,
  `reflect-metadata`). No `@nestjs/microservices`, no decorators, no ack/retry/DLQ conventions
  exist — there is nothing to copy.
- The closest thing to an existing "house style for triggered background work" is the
  **spawn-a-tsx-script** orchestration:
  - **API → indexer (on demand):** `runIndexerWalletScript` (`wallets.service.ts:~340-394`) spawns
    `pnpm tsx <script>` with `WALLET_ID`, captures stdout/stderr, resolves on exit code 0, rejects
    with the captured output otherwise. Errors from the *Blend* step are explicitly swallowed as
    **non-fatal** (`refreshWallet`, `wallets.service.ts:990-1000`):
    ```ts
    try { await this.runWalletBlendPositionsScript(walletId); }
    catch (error) { console.error('[wallets] Blend positions refresh failed (non-fatal):', ...); }
    ```
  - **Indexer orchestration (the batch house style):** `72-run-refresh-job.ts` spawns
    `71-refresh-all-metrics.ts`, which in turn spawns each per-protocol `run-*-refresh.ts` in
    sequence (`spawn('pnpm', ['tsx', scriptPath], { stdio: 'inherit' })`), with
    catch-and-log for non-fatal steps (Aquarius, Allbridge, network-stats).

**Implication:** a new alerting consumer should **not** introduce a broker. The idiomatic move is a
new **tsx evaluator script** chained after the health-refresh step, exactly like the existing
sequential spawn pipeline. (Per CLAUDE.md layer ownership, batch/evaluator logic belongs in
`apps/indexer`, not in API runtime.)

---

## 3. Scheduler / cron infra — **No in-process scheduler. OS-level cron only.**

```
grep -rniE "@Cron|ScheduleModule|CronJob|@Interval|@Timeout|repeatable" apps
  → (zero matches that are schedulers)
```

- **No `@nestjs/schedule`**, no `ScheduleModule`, no `@Cron`/`@Interval`/`@Timeout`.
- **No Bull/BullMQ**, no repeatable jobs, no custom in-process scheduler.
- The `setTimeout` hits are **not** scheduling: `actions.service.ts` uses Stellar
  `TransactionBuilder.setTimeout(300)` (tx time bounds); `71-refresh-all-metrics.ts:42` and
  `00-common.ts:200` are `sleep()` helpers; `73-network-stats-refresh.ts` uses `setTimeout` to
  `AbortController.abort()` (HTTP timeouts). None drive a recurring job.
- **Redis exists but is unused by code.** `redis:7` is in `docker-compose.yml`, but
  `grep -rniE "redis|ioredis|createClient" apps` → **zero matches** and neither app depends on a
  redis client. So Redis is **not** currently a viable BullMQ backend without adding the dep — it's
  provisioned-but-dormant.
- **Actual scheduling = external OS cron**, per `docs/deployment.md`:
  > `:18` use cron or equivalent scheduler for refresh jobs
  > `:22` On the VPS, after `git pull` and **before** the cron runs a new step …
  > `:37` cron and script execution are easier to reason about outside frontend hosting
  > `:71` cron schedule details *(listed as a TODO/placeholder — no concrete crontab is committed)*

**Fallback (sweep) registration options, simplest first:**
1. **OS cron** runs a new wallet-health + evaluator job (matches today's deployment model exactly; zero new deps). ✅ recommended for beta.
2. Add `@nestjs/schedule` `@Cron` in the API (in-process; keeps it one process, but pulls batch
   work into API runtime — discouraged by CLAUDE.md layer rules).
3. BullMQ on the dormant Redis (real queue/retry/repeatable, but new deps + infra — over-engineered
   for current roadmap).

---

## 4. Refresh cadence of `wallet_pool_health` — **on-demand only; NO periodic cadence today.**

This is the decisive finding. `wallet_pool_health` is **not** on the `job:refresh` path:

- `72-run-refresh-job.ts` spawns **only** `71-refresh-all-metrics.ts`.
- `71-refresh-all-metrics.ts` runs steps 1–9 (prices, Soroswap, Blend **pool** metrics, Aquarius,
  Stellar-native, protocol metrics, Allbridge, network-stats). It **never** invokes
  `80-` or `81-` wallet scripts. (`grep "80-stellar|81-stellar|wallet-blend" 71/72` → no hits.)
- So `job:refresh` refreshes **pool-level v1 metrics**, not per-wallet health.

The **only** writer of `wallet_pool_health` is `81-stellar-wallet-blend-positions.ts`, invoked
**per-wallet, on demand** by the API endpoint `POST /v1/wallets/:walletId/refresh`
(`wallets.controller.ts:92`) → `refreshWallet()` → spawn `80` then `81`
(`wallets.service.ts:976-1014`). The web app calls this only on explicit user action
(`useWallets.ts:188 refreshOneWallet`, and once right after connecting a wallet, `:177`).

**Therefore the current cadence is: "whenever a user clicks refresh for that specific wallet."**
There is no loop interval, no per-block trigger, and no polling cron for wallet health. Quoted
cadence source: **none exists** — this is a genuine gap, not an unread config.

**One enabling fact for the sweep (from probe-01 / script 81):** script 81 already selects **all
active wallets** when no target is given:
```ts
// 81-...:64  (no WALLET_ID / USER_WALLET_ID env)
select id, address from user_wallets
where chain = 'stellar' and is_active = true
order by created_at asc
```
So `pnpm tsx src/scripts/wallets/81-stellar-wallet-blend-positions.ts` **with no `WALLET_ID`**
already performs a full-fleet health sweep — no code change needed to produce the data the
evaluator reads. The missing piece is purely *scheduling* it and running the evaluator after it.

---

## DECISIONS UNBLOCKED

### Recommendation: **(B) periodic sweep — there is no (A) to ride.**
Event-driven-targeted is off the table: no broker, no producer, no consumer pattern, no scheduler.
Building RabbitMQ/eventing for D2 would be exactly the "abstraction layer just in case" CLAUDE.md
forbids, and the requirement explicitly says *snapshot DB, not a sub-minute event stream*. A sweep
is both the only viable and the architecturally correct choice.

### Exact integration point
Mirror the existing spawn-chain house style (§2), in `apps/indexer` (layer ownership), driven by
**OS cron** (§3):

1. **New orchestrator script** — e.g. `apps/indexer/src/scripts/wallets/82-run-wallet-alert-job.ts`
   (sibling to `72-run-refresh-job.ts`), added as `pnpm -C apps/indexer job:wallets` (or
   `job:alerts`). It spawns, in sequence:
   - `81-stellar-wallet-blend-positions.ts` **with no `WALLET_ID`** → refreshes `wallet_pool_health`
     for all active wallets (and optionally `80-` first for balance-based rules later).
   - **New evaluator** `apps/indexer/src/scripts/wallets/83-evaluate-alerts.ts` → reads
     latest-per-(wallet,pool) from `wallet_pool_health` (per probe-01's `distinct on
     (user_wallet_id, entity_id) … snapshot_at desc, created_at desc`, filtering `health_factor is
     not null`), compares against rules, fires + dedups via threshold-crossing (no `last_fired`
     table exists yet — probe-01 §4).
2. **Schedule** via the same OS-cron mechanism `job:refresh` already uses; document the crontab line
   in `docs/deployment.md`/`docs/runbooks.md` (the `:71 cron schedule details` placeholder).
3. Keep the evaluator **out of API runtime**; the API only *reads* alert results via `/v1/*` and
   *manages* rules (writes) — consistent with the façade role.
   - *Optional opportunistic trigger (not a substitute):* `refreshWallet()` already runs `81` for a
     single wallet on demand; the evaluator could also be invoked there for instant feedback on a
     manual refresh. Treat as a nice-to-have on top of the sweep, not the primary path.

### Resulting alert latency
- **Latency floor = the sweep interval** (cron period), since there is no finer signal. There is no
  sub-minute stream and none should be built.
- **Recommended beta cadence: every 5–15 minutes.** This is gated by Soroban RPC cost of running
  `PositionsEstimate` per (wallet × Blend pool) for all active wallets — start at ~15 min, tighten
  to ~5 min if RPC budget allows. Same operational model as the existing refresh cron.
- **Today, without this job, effective latency is unbounded** (health only updates on a manual
  per-wallet refresh) — shipping the sweep is what makes alerting meaningful, and is the single
  concrete prerequisite D2 must add.
