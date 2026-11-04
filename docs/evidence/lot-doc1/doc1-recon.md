# Lot DOC1 — recon (reviewer-facing docs before the SCF 46 window)

Read-only recon, 2026-11-04, on `main` at `98e0267` (branch `docs/lot-doc1`). Every claim
below traces to a grep over the code, a file line, or a `curl` against the production API on
2026-11-04. Nothing was moved or deleted. Drafts produced from this recon: `README.md`,
`docs/TECHNICAL_ARCHITECTURE.md` (banner + table only), `docs/README.md` (new), the D4 one-line
fixes listed in §5, the `docs/status-board.md` line, and (D6, 2026-11-05) `docs/post-grant-summary.md`.

Production facts used (2026-11-04, ~18:10 UTC):

```bash
curl -s https://stellar-api.getdig.ai/health            # status ok, version 8e6dd18, 7 venues:
                                                        # allbridge asOf null; aquarius, blend, defindex,
                                                        # soroswap, stellar-native, xoxno fresh (age 203 s)
curl -s https://stellar-api.getdig.ai/v1/protocols      # 7 rows: 6 with TVL + Allbridge (tvlUsd null)
curl -s https://stellar-api.getdig.ai/v1/pools          # 44 pools
curl -s https://stellar-api.getdig.ai/v1/openapi.json   # version 1.0.0, 15 paths, 15 operations, 9 stable
curl -s "https://stellar-api.getdig.ai/v1/ops/status?window=24h"   # overall.state operational, 0 missed, 0 failed
```

Two consequences for the docs: the production API reports version `8e6dd18` (the Lot PRE docs
commit, which sits after the Lot PRE code commits), so **Lot PRE is deployed**; and `xoxno` is
refreshing in prod, so **Lot XO is deployed**. Both were still marked "VPS deploy pending" in
`status-board.md` and `current-state.md` (fixed in D4/D5). PRE2 (`98e0267`) is not deployed.

---

## R1 — Root `README.md` today

206 lines, grant-era (written around the T1/T2 MVP, mid-2026). What is stale:

| README says | Reality | Where proven |
|---|---|---|
| "the foundation for future alerts and non-custodial action flows"; "advanced alerting workflows … direct in-app execution of non-custodial actions … not fully in scope yet" | Both shipped: 5 alert families on a 15-min sweep (T2-D2 + Lot N); mainnet SDEX swaps and Blend supply/withdraw executed and Horizon-verified | `docs/status-board.md` T2-D2 / T3-D2 rows, `docs/evidence/t3-d2-mainnet-actions.md` |
| Integrated protocols: Blend, Aquarius, Soroswap (3) | 6 live: Blend, Soroswap, Aquarius, Stellar native DEX, DeFindex, XOXNO Lending (+ dormant Allbridge venue row) | `curl /v1/protocols` above; `apps/indexer/src/scripts/ingest/71-refresh-all-metrics.ts:291-415` |
| No mention of SCF #43 completion, post-grant phase, status page, API docs, OpenAPI | SCF #43 complete (all four tranches paid, Aug 2026); `#status`, `/v1/docs`, `/v1/openapi.json` live | `docs/status-board.md` "Tranche numbering"; `docs/decisions/2026-11-03-public-api-v1-surface.md` |
| "fully production-grade ownership verification / signed wallet auth" out of scope | Beta session model unchanged (userId key, §7) but a signed-message ownership proof exists for campaign writes (§11) | `docs/security-invariants.md` §7, §11 |
| No run instructions at all; "packages/db: Prisma schema and database-related package remnants" | Proven quickstart exists (`docker compose --profile app up`) | `docs/reference-deployment.md` |
| Repository structure lists only `docs/TECHNICAL_ARCHITECTURE.md` | 30+ docs, decisions, evidence corpus | `find docs -name '*.md'` |
| Data-model section names `wallet_protocol_positions` as "future foundation" | Written since T2-D1; per-asset legs served since Lot H6 | `docs/status-board.md` T2-D1 row |
| No contact links, no license mention | `LICENSE` (MIT) exists; footer links in the app: `https://x.com/Dig_Agentic`, `https://discord.gg/sDpqGfmDgF` | `apps/web/src` grep |

Nothing in the README is wrong about the direction; it is simply two tranches behind, and it
never tells a reviewer where to look.

---

## R2 — `docs/TECHNICAL_ARCHITECTURE.md`: design claims that are NOT as-built

Each row verified against the code on 2026-11-04 (pattern: `grep -rI --include='*.ts'
--include='*.vue' -E '<pattern>' apps/api/src apps/indexer/src apps/web/src`; the pattern is
quoted in the "Code evidence" column). Rows the brief
expected that turned out partly built are marked; one expected row was dropped (see end).

| # | Design claim (section) | As-built reality | Code evidence | Doc that proves it |
|---|---|---|---|---|
| 1 | Alerts delivered by **WebSocket push** + in-app queue (§1 diagram, §5 "Serving", §9.2) | No WebSocket/SSE anywhere. The web polls the unread count over HTTP every 45 s; rules are evaluated by an OS-cron sweep every 15 min (`7,22,37,52 * * * *`, `job:wallet-alert` → scripts 82→81→83) writing `notifications` rows | grep `socket.io\|@nestjs/websockets\|EventSource\|new WebSocket` → 0 hits; `apps/web/src/composables/useNotifications.ts:23` (`POLL_INTERVAL_MS = 45_000`) | `docs/runbooks.md:191-197` (crontab), `docs/current-state.md` T2-D2, `docs/alerting/probe-02-trigger.md` |
| 2 | **SEP-10** web auth / session token (§3 SEPs table historically, §11.1 "stolen session token") | No SEP-10, no JWT, no session token. Beta access model = the `userId` grouping key, rate-limited at nginx (§7). Wallet ownership for campaign writes = SEP-53 signed plain-text message verified with the public key only (§11) | grep `sep-?10\|jsonwebtoken\|jwt` → 0 hits; `apps/api/src/modules/campaign/verify-wallet-signature.ts` | `docs/security-invariants.md` §7, §11 |
| 3 | Historical backfill from **Stellar Data Lake / Hubble / BigQuery / Galexie**, 30-day seed on adapter init (§4, §5.3, §12) | None. History is what our own snapshot tables have accumulated since they were created (e.g. `network_tvl_snapshots` since 2026-08-12, methodology change marked 2026-08-17). Event reads use the Soroban RPC retention window (~7 days) only | grep `hubble\|bigquery\|galexie\|data ?lake` → 0 hits | `docs/decisions/2026-08-17-network-tvl-definition.md`, `docs/evidence/lot-g/G4-network-tvl-chart.md` |
| 4 | **Layer 1 sub-minute event stream**: long-running `getEvents` subscriber, position updater and alert evaluator within one ledger close (§5.1, §9.1 latency table) | No long-running subscriber. `getEvents` is pulled in batch inside the 15-min refresh (Aquarius/Soroswap pool events; the Allbridge one is retired). Positions refresh on demand or in the alert sweep; alert latency = cron cadence (≤ 15 min), not < 30 s | `getEvents` outside `discovery/`: `lib/protocols/aquarius/fetch-pool-events.ts`, `lib/protocols/soroswap/fetch-pair-events.ts`, `lib/protocols/allbridge/fetch-bridge-events.ts` (batch) | `docs/repo-structure.md` pipeline section, `docs/runbooks.md` crontab |
| 5 | `Snapshot` table **partitioned by month**, migration path to **TimescaleDB** (§5.2, §6) | Plain Postgres tables, no partitioning, no Timescale; one partial index added for `/v1/pools` latency (2026-10-30) | grep `PARTITION BY\|timescale\|hypertable` in `apps/api/src/db/*.sql` + `packages/db/prisma` → 0 hits; `apps/api/src/db/stellar_v1_perf_indexes.sql` | `docs/data-model.md`, `docs/evidence/perf-pools/README.md` |
| 6 | **Prisma data store** / Prisma-style schema is the data model (§1 diagram "Postgres – Prisma data store", §6) | Raw SQL table families v1…v8 (`apps/api/src/db/stellar_v*.sql`). The Prisma client is used only as a connection for raw SQL (339 `$queryRawUnsafe`/`$executeRawUnsafe` call sites in `apps/api/src`); Prisma models are touched only by the legacy prefix-less routes (`app.controller.ts`) and legacy `run-*.ts` scripts. Indexer writes through raw `pg` (19 files) | grep `prisma\.(protocol\|venue\|snapshot)\.` → `app.controller.ts`, `run-blend.ts`, `run-defindex.ts`, `run-horizon.ts`, `run-once.ts` only | `docs/data-model.md`, `docs/repo-structure.md`, `CLAUDE.md` "Data architecture (as-built)" |
| 7 | **OpenTelemetry** logs/traces, **Prometheus** metrics, `/ready` readiness (§10.3) | None of those libraries. Observability = `rpc_metrics_runs` + `refresh_step_runs` tables written per run, `GET /health` (status, `version` = git SHA, DB latency, per-venue freshness), `GET /v1/ops/metrics`, `/v1/ops/status`, `/v1/ops/adoption`, and the public `#status` page. No `/ready` route | grep `opentelemetry\|prom-client\|pino\|winston` → 0 hits; `apps/api/src/modules/ops/ops.controller.ts:17-43`; `apps/api/src/app.controller.ts:27` (`/health`) | `docs/evidence/lot-e/README.md`, `docs/evidence/status-page/`, `docs/runbooks.md` |
| 8 | **Fly.io / Railway / Cloud Run** API, worker deployments with leader election, **managed Postgres with read replicas**, managed Redis cache + rate-limit counters (§1 diagram, §10.1) | One DigitalOcean VPS: nginx (public entry, measured `limit_req` zones, Lot S) → API under pm2 on `127.0.0.1:3000`; indexer jobs from the OS crontab with `flock`; Postgres 16 and Redis 7 as Docker containers on the same host. Web on Vercel. **Redis is provisioned by `docker-compose.yml` but no application code reads it** (rate limits live in nginx) | grep `ioredis\|from 'redis'` in `apps/api/src`, `apps/indexer/src`, both `package.json` → 0 hits; `docker-compose.yml:98` | `docs/deployment.md` ("VPS edge", "Recommended beta architecture"), `docs/current-state.md:795`, `docs/evidence/lot-s/` |
| 9 | **CI/CD**: lint → typecheck → unit → Testnet integration → preview → staging → manual promote; migrations as a discrete step (§10.5) | `.github/workflows/ci.yml` runs build + unit tests on push/PR (api Jest, web Vitest, Node 24). No deploy step, no staging, no preview. VPS deploy is manual (`git pull`, build, pm2 restart, SQL files applied by hand); Vercel auto-builds the web. Lot AD (deploy discipline) in progress | `.github/workflows/ci.yml` (one job `build-test`) | `docs/deployment.md`, `docs/evidence/lot-ad/ad0-recon.md`, `docs/lot-ad-cicd-deploy.md` |
| 10 | **Allbridge** bridge-flow monitoring as an active adapter (§1, §5 diagram, §7.7, §14) | Built and live for T2-D3, then the venue wound down upstream after 2026-07-20 (last flow 2026-07-19). The refresh step was retired on 2026-11-03 (Lot PRE); `bridge_flows`, `/v1/bridge/*` and the adapter stay as a historical record; the dashboard section is gone | `apps/indexer/src/scripts/ingest/71-refresh-all-metrics.ts:407-409` (retirement comment) | `docs/status-board.md` T2-D3 row, `docs/api/CHANGELOG.md` 1.0.0 |
| 11 | **Testing**: Vitest unit, Testnet integration on CI, e2e with a test wallet, chaos tests (§10.4) | api: Jest, 38 `*.spec.ts` files + an ajv **contract test** that boots the real app (`pnpm -C apps/api test:contract`, deploy-checklist step, not in CI); web: Vitest, 12 spec files; indexer: `node --test`, 11 `*.test.ts` files. No Testnet integration suite on CI, no e2e wallet tests, no chaos tests | `apps/*/package.json` `test` scripts; `apps/api/test/contract/run-contract-test.ts` | `docs/api/README.md`, `.github/workflows/ci.yml` |
| 12 | **Execution model**: SEP-7 URI/QR handoff, SEP-11 txrep summary, multisig detection and partial signatures, fee-bump sponsorship, `restore_footprint` bundling (§3, §8.2–8.6) | Two action families: SDEX swap (classic `ChangeTrust` + `PathPaymentStrictSend`) and Blend supply/withdraw (Soroban, `simulateTransaction` preflight). XDR built server-side (`actions.service.ts`), decoded and validated **client-side** before signing (`validateSwapXdr.ts`, `validateDepositXdr.ts`), signed in-wallet via Stellar Wallets Kit. **None** of SEP-7, txrep/SEP-11, multisig detection, fee bump or restore-footprint exist in the code | grep `web\+stellar\|sep-?7\|txrep\|SEP-11\|feeBump\|restoreFootprint\|multisig` over `apps/*/src` → 0 hits; `apps/api/src/modules/actions/`, `apps/web/src/lib/validate*Xdr.ts` | `docs/security-invariants.md` §2–§4, `docs/evidence/t3-d2-mainnet-actions.md` |
| 13 | **Freshness tri-state** Fresh/Stale/Broken, 10-min alert buffer, ops-channel alert, exponential backoff per adapter (§5.4) | Binary `isStale` + `staleAfterSeconds` (45 min = 3× cron) on every `/v1/*` payload and per venue on `/health`; the alert sweep skips stale snapshots with a warning; `#status` shows missed cycles / failed steps; refresh steps retry with exponential backoff (Lot B). No ops-channel notifier, no 10-min buffer | `apps/api/src/common/freshness.ts`; `apps/api/src/modules/ops/status.ts` | `docs/evidence/lot-b/README.md`, `docs/evidence/lot-n/`, `docs/evidence/status-page/` |
| 14 | **Alert rule catalogue**: health factor and netflow < 30 s, APY shift, utilization spike, protocol staleness; `Notifier` abstraction for email/webhook (§9.1–9.2) | Five families on the 15-min sweep: wallet health factor, asset price, pool TVL drop (`tvl_drop_pct`), pool supply/borrow APY, plus an automatic pool-status protection. No netflow or utilization rules, no staleness rule, in-app only, no `Notifier` interface | `apps/api/src/modules/alerts/families.ts:12-16` | `docs/evidence/lot-n/`, `docs/current-state.md` Lot N |
| 15 | **Reference implementation** §13: `prisma:migrate`, `run:once`, `GET /protocols`, `/venues/:key/snapshots` | Legacy path. The proven quickstart is `docker compose --profile app up -d --build` (raw SQL applied by init mounts, `bootstrap:core`, `job:refresh`, then `/health` + `/v1/protocols`) | `docker-compose.yml`, `apps/indexer/src/scripts/bootstrap/` | `docs/reference-deployment.md`, `docs/evidence/lot-z/z1-compose-fresh-clone.md` |
| 16 | **Protocol adapters** list (§1, §7): Blend, Soroswap, Aquarius, DeFindex, SDEX, Allbridge, XOXNO | As-built live set: Blend, Soroswap, Aquarius, Stellar native DEX, DeFindex, XOXNO Lending (6); Allbridge dormant (row 10). Per-pool cadence (5 vs 15 min, §5.2) does not exist: one 15-min run for everything | `71-refresh-all-metrics.ts:291-415` (step list) | `docs/status-board.md`, `curl /v1/protocols` |
| 17 | **Reflector** read directly for all USD conversions (§6, §7.6) | Partially as-built: Reflector is one price source among several (CoinGecko reference prices, Soroswap-derived prices, Blend pool oracles via the same SEP-40 surface, XOXNO aggregator fallback), selected per asset by `price-select.ts` | `apps/indexer/src/scripts/shared/reflector.ts`, `price-select.ts`, `pricing-config.ts` | `docs/evidence/price-sources-v2/` |

Expected by the brief and **confirmed as listed**: WebSocket (1), SEP-10 (2), Hubble (3),
Fly.io/managed Postgres (8), TimescaleDB (5), OpenTelemetry/Prometheus (7), CI/CD staging (9),
Allbridge (10), Prisma ORM (6), event-stream layer (4). Added from the code: 11–17. Dropped:
nothing; the one claim that is closer to built than expected is Reflector (17), kept as
"partial".

Still true in the design doc and worth keeping as-is: RPC primary / Horizon complement (§2, §4),
non-custodial invariants (§11.2), client-side XDR validation (§8.1), Protocol-20 constraint on
mixing Soroban and classic ops (handled in `status-board.md` T1-D3 note).

---

## R3 — docs inventory

Format: `path — purpose — current? — audience`. "Historical" = a brief or report kept as the
record of a lot; accurate for its date, not maintained.

### Top-level `docs/*.md`

| Path | Purpose | Current? | Audience |
|---|---|---|---|
| `TECHNICAL_ARCHITECTURE.md` | June 2026 design document (SCF #43 application) | **Stale as a system description** (R2); carries two as-built notes (§6, §9) and gets the DOC1 banner + table | reviewer (with banner), historical |
| `ai-guidelines.md` | How AI is used on the project | yes (process doc) | contributor |
| `current-state.md` | Detailed as-built reality, lot by lot (881 lines) | yes, maintained; two one-line drifts fixed in D4 (five→six protocols; XO deploy) | reviewer, contributor |
| `data-model.md` | Raw SQL schema families as built (v1/v2/v3 + later) | mostly yes; title says "three families", the schema has eight numbered files (v4–v8 covered in later sections of the doc). `CLAUDE.md` still describes this doc as "legacy Prisma", which is wrong — DOC2 | contributor |
| `delivery-playbook.md` | Standard task workflow + branch discipline (§1) | yes | contributor |
| `deployment.md` | VPS shape, nginx hardening, SQL apply order, per-lot deploy sequences | yes, maintained | operator |
| `final-report.md` | Tranche 4 final report to SDF (August 2026) | historical, do not edit. Line 31 says "Redis handles caching" — not true in code (R2 row 8) — DOC2 note only | historical |
| `grant-roadmap.md` | SCF #43 criteria verbatim + interpretation | yes for its purpose (contract is closed); `protocolCount = 4/5` lines are dated statements inside tranche narratives, left as-is | reviewer (grant history) |
| `hotfix-frozen-amm-reserves.md`, `lot-a1-…`, `lot-a1b-…`, `lot-a2-…`, `lot-a3-…`, `lot-a5-…`, `lot-aa-…`, `lot-ac-…`, `lot-ad-…`, `lot-b-…`, `lot-c-…`, `lot-e-…`, `lot-f-…`, `lot-g-…`, `lot-h-…`, `lot-n-…`, `lot-p-…`, `lot-q-…`, `lot-r-…`, `lot-s-…`, `lot-w-…` (21 files) | Execution briefs per lot | historical (each dated in its first paragraph); some reference `docs/tasks/` paths that do not exist (e.g. `security-invariants.md:183`) — DOC2 | contributor, historical |
| `reference-deployment.md` | Proven quickstart (compose path + host-pnpm path) | yes; one count drift fixed in D4 (`5 protocols` comment) | reviewer, operator |
| `repo-structure.md` | As-built navigation map of the monorepo | partly stale: still lists Step 8 Allbridge as live (fixed in D4); documents `stellar`, `wallets`, `network`, `openapi` modules but **not** `alerts`, `ops`, `actions`, `bridge`, `campaign`, `faucet`, `auth` — DOC2 | contributor |
| `runbooks.md` | Operating procedures (Node, cron, SQL, campaign, API contract) | yes, maintained; one `protocolCount = 5` fixed in D4 | operator |
| `security-invariants.md` | Security contract for the action path + beta access model + money path | yes, maintained | reviewer, contributor |
| `status-board.md` | Operational progress board | yes; "Last updated" + XO/PRE deploy lines corrected in D4/D5 | reviewer (first read) |

### Subfolders

| Path | Purpose | Current? | Audience |
|---|---|---|---|
| `alerting/probe-01…03.md` | T2-D2 read-only recon probes (read model, trigger, feed) | historical (accurate for mid-2026; sweep design unchanged since) | contributor |
| `api/README.md` | Where the public HTTP contract lives, Scalar pin, contract test | yes (2026-11-03) | reviewer, contributor |
| `api/CHANGELOG.md` | Public API changes | yes (1.0.0) | API consumers |
| `decisions/2026-08-17-network-tvl-definition.md` | Network TVL ruling (our data, gross, DeFindex excluded) | yes | reviewer |
| `decisions/2026-10-21-points-have-no-monetary-value.md` | Earn & Points ruling | yes | reviewer |
| `decisions/2026-10-27-xoxno-tvl-and-pricing.md` | XOXNO TVL/pricing/licence ruling | yes | reviewer |
| `decisions/2026-11-03-public-api-v1-surface.md` | Public API surface ruling | yes | reviewer |
| `evidence/README.md` | Index of the evidence corpus (lot → entry doc → era) | yes (2026-11-03); no `lot-doc1` row yet (added in this lot) | reviewer |
| `evidence/**` (36 folders/files, ~559 files) | Per-lot proofs: captures, command outputs, incident notes | per lot | reviewer |
| `integrationtrack/{README,ARCHITECTURE,milestones}.md` | SCF Round **45** integration-track application text | headers still say "SCF Round 45"; the application moved to SCF 46 (`current-state.md:36`) — founder material, DOC2 | founder |

### Contradictions between docs (facts)

| Fact | Doc A | Doc B / reality | Class |
|---|---|---|---|
| Protocols indexed | `current-state.md:28` "five protocols"; `reference-deployment.md:66` "5 protocols"; `runbooks.md:99` `protocolCount = 5` | `current-state.md:481` "Sixth protocol"; prod `/v1/protocols` 6 live + Allbridge row | one-line drift → **fixed (D4)** |
| Lot XO deploy state | `status-board.md:54-55`, `current-state.md:481` "VPS deploy pending" | prod `/health` 2026-11-04: `xoxno` fresh; `/v1/protocols` XOXNO ≈ $146.8k | one-line drift → **fixed (D4/D5)** |
| Lot PRE deploy state | `status-board.md:401` "Lot PRE + PRE2 built, not deployed" | prod `/health` version `8e6dd18` (Lot PRE docs commit, after the PRE code commits); PRE2 `98e0267` not deployed | one-line drift → **fixed (D5)** |
| Allbridge refresh step | `repo-structure.md:190-195, 221` "Step 8 run-allbridge-bridge-refresh.ts" live | `71-refresh-all-metrics.ts:407` step retired (Lot PRE, 2026-11-03); `status-board.md` T2-D3 | one-line drift → **fixed (D4)** |
| Redis role | `final-report.md:31` "Redis handles caching"; `TECHNICAL_ARCHITECTURE.md` "Redis Cache – hot data + rate limits" | no Redis client in any app (R2 row 8); rate limits in nginx | final report is a submitted historical document: **not edited**, DOC2 note; architecture doc covered by the D2 table |
| "Single source of truth" | `TECHNICAL_ARCHITECTURE.md:3` claims it for architecture | `CLAUDE.md` + `repo-structure.md` header + `status-board.md` are the as-built truth | resolved by the D2 banner and `docs/README.md` rank table |
| Test coverage statement | `CLAUDE.md:112,114` "No tests yet" for indexer and web; "Tests / CI largely deferred" | indexer 11 `*.test.ts` (node:test), web 12 `*.spec.ts` (Vitest), api 38 `*.spec.ts` + contract test; CI build+test | `CLAUDE.md` is the Claude Code working contract, out of DOC1's file list → DOC2 |
| `GET /v1/network/stats` source | `CLAUDE.md` "hits external APIs live (CoinGecko, DefiLlama, stellar.expert, Horizon) with no DB persistence" | `apps/api/src/modules/network/network.service.ts:84-100` reads `network_stats_latest` (DB-backed since step 73) | DOC2 (`CLAUDE.md`) |
| Public repository URL | `final-report.md:86` `github.com/Mael-wnb/dig-stellar` (×4 across docs) | `git remote`: `origin` = `Digbot-ai/dig-stellar`, `public-origin` = `Mael-wnb/dig-stellar` (the VPS and Vercel pull from `public-origin`, `deployment.md:179`) | consistent: the public repo is `Mael-wnb/dig-stellar`; the single `Digbot-ai` URL in docs is the private origin. No change; README links to neither (the reader is already in the repo) |
| SCF round of the integration-track docs | `integrationtrack/*.md` "SCF Round 45" | `current-state.md:36`, `status-board.md:45`: application redirected to SCF 46 (8 Nov 2026) | founder application text → DOC2 (not a DOC1 edit) |

---

## R4 — LICENSE and GitHub metadata

- `LICENSE` exists at the repo root: MIT, "Copyright (c) 2026 Mael69". The README never
  mentioned it; the new README does (one line).
- GitHub repository description/topics: `gh` is not installed on this machine and the recon is
  offline-only for GitHub, so the description and topics were **not read**. Note for the founder:
  set the description to the README's first sentence and topics such as `stellar`, `soroban`,
  `defi`, `analytics`, `portfolio`, `non-custodial` once the README lands. No change made.

---

## 5. What D4 changed in place (one-line factual drift only)

| File | Line(s) | Before → after |
|---|---|---|
| `docs/current-state.md` | 28 | "five protocols" → "six protocols" (XOXNO live in prod, `/health` 2026-11-04) |
| `docs/current-state.md` | 481 | "VPS deploy pending" → "deployed, refreshing in prod on 2026-11-04 (`/health` xoxno fresh)" |
| `docs/status-board.md` | 54-55 | same XO correction |
| `docs/status-board.md` | 401 | "Last updated" line: PRE deployed (`/health` version `8e6dd18`), PRE2 not; + Lot DOC1 line (D5) |
| `docs/reference-deployment.md` | 66 | comment "5 protocols" → "6 live protocols (+ the dormant allbridge row)" with the 2026-08-13 proof context kept |
| `docs/runbooks.md` | 99 | "`protocolCount = 5`" → "live count, 6 since Lot XO" |
| `docs/repo-structure.md` | 190-195, 221 | Step 8 Allbridge marked retired (Lot PRE, 2026-11-03), adapter kept as record |
| `docs/evidence/README.md` | table | one `lot-doc1/` row (post-grant) |

## 6. DOC2 follow-up (bigger than a one-line fix; not done here)

1. `CLAUDE.md`: "No tests yet" (indexer, web), "Tests / CI largely deferred", and the
   `/v1/network/stats` live-fetch note are stale; `docs/data-model.md` is described as legacy
   Prisma when it is the raw-SQL as-built doc. Needs a careful pass, since it is the working
   contract for Claude Code.
2. `docs/repo-structure.md`: add the `alerts`, `ops`, `actions` (+ witness), `bridge`
   (historical), `campaign`, `faucet`, `auth` modules and the v3–v8 SQL files; it currently maps
   the T1 surface plus `openapi`.
3. `docs/data-model.md`: title/overview says three families; confirm v4–v8 are described and
   update the overview table.
4. `docs/final-report.md:31` "Redis handles caching": the submitted report is historical; decide
   whether to add a dated footnote or leave it (recommendation: one footnote, no rewrite).
5. `docs/integrationtrack/*.md`: "SCF Round 45" headers vs the SCF 46 application; founder
   decides whether these are rewritten for SCF 46 or archived.
6. Broken internal references in briefs (`docs/tasks/…` paths that do not exist, e.g. from
   `security-invariants.md:183`); a link check over `docs/` would list them all.
7. `docs/TECHNICAL_ARCHITECTURE.md` beyond the banner: §13 quickstart and §10 could be
   replaced by pointers; deliberately untouched in DOC1 (banner + table only, per brief).
8. Redis: either wire a use (the API list cache from `perf/pools` is in-process today) or drop
   the container from the compose stack and the architecture summary; the README now states the
   honest situation.

## 7. D6 — post-grant summary and the PDF

`docs/post-grant-summary.md` (256 lines) was built only from `status-board.md`, `current-state.md`,
`decisions/`, `evidence/README.md` and the evidence files it cites per item; no adoption numbers.
Deploy status per item follows the rule stated in its §1: "in production" only when the item's own
evidence records a production verification, otherwise "on `main`" (every cited commit precedes the
production version `8e6dd18` observed on 2026-11-04). Linked from the README docs map and
`docs/README.md` (first in the reviewer reading order).

PDF: **not produced.** No markdown-to-PDF tool is available on this machine: `pandoc`,
`wkhtmltopdf`, `weasyprint`, `md-to-pdf` and `grip` are absent, Python has no `markdown` module,
and no `marked` / `markdown-it` package resolves from the repo's `node_modules`. Headless Chrome
exists (`/Applications/Google Chrome.app`) but needs an HTML input. The founder exports it; one
working chain once `pandoc` is installed (`brew install pandoc`):

```bash
pandoc docs/post-grant-summary.md -f gfm -s --metadata title="Dig Stellar — post-grant summary" \
  -o /tmp/post-grant-summary.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --print-to-pdf=docs/post-grant-summary.pdf --no-pdf-header-footer /tmp/post-grant-summary.html
```

