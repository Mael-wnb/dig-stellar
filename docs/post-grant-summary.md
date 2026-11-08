# Dig Stellar — post-grant development summary (2026-08-20 → 2026-11-05)

## 1. Context

Stellar Community Fund award #43 funded Dig Stellar's indexing foundation, analytics dashboard,
transaction builder, multi-wallet portfolio, in-app alerting, bridge-flow monitoring, mainnet
deployment with freshness tracking, non-custodial mainnet actions and the observability /
reference-implementation hand-off. All four tranches were validated and paid: the MVP tranche in
late July 2026, the testnet tranche in early August, the mainnet tranche around 20 August 2026
with acceptance of the final report (`docs/status-board.md`, "Tranche numbering"). This document
covers everything shipped after that final validation, from about 2026-08-20 to 2026-11-05. All
of it was undertaken on Dig's own initiative; none of it was required by SCF #43. Every figure
below is taken from `docs/status-board.md`, `docs/current-state.md`, `docs/decisions/` or the
evidence files cited on each "Evidence:" line. Adoption numbers are deliberately absent here.

Deployment status is stated per item. "In production" means the item's own evidence records a
production verification. Items marked "on `main`" are merged and present in the production
checkout (the production API reported version `8e6dd18` on 2026-11-04, which is after every
commit cited below) but have no separate production capture in the corpus.

## 2. Live surfaces

- Application: https://stellar.getdig.ai
- Status page (pipeline runs, gaps, failed steps, freshness per venue): https://stellar.getdig.ai/#status
- API reference page: https://stellar-api.getdig.ai/v1/docs
- OpenAPI 3.1 document: https://stellar-api.getdig.ai/v1/openapi.json
- Reference deployment from a fresh clone, no secrets: `docs/reference-deployment.md`
  (`docker compose --profile app up -d --build`, proven from a clean clone on 2026-08-18)

## 3. What shipped, by theme

Newest first within each theme.

### 3.1 Protocol integrations

**XOXNO Lending (Lot XO, 2026-10-26 → 10-30; in production, `xoxno` refreshing on the production
`/health` on 2026-11-04).** Sixth protocol, read-only market analytics. One Soroban pool contract
with a controller and a price aggregator; a market is a (hub, asset) pair; the 25 markets are
grouped in three hubs (Core, RWA, AMM), modelled as one entity per hub and one reserve row per
market. Every figure comes from on-chain read-only views (`get_reserves`, supplied, borrowed,
utilisation, rates); no XOXNO HTTP API is called and nothing is vendored (the upstream licence is
PolyForm Noncommercial). TVL is defined as pool cash priced over priced markets, i.e. 100 %
on-chain. Markets that our own price sources cannot cover use the protocol's aggregator price as
a bounded fallback: 14 markets are eligible, and an aggregator price loses to any own source.
Static parameters are cached 24 h; the refresh costs 162 RPC calls per run on the normal 15-minute
cadence. Wallet positions on XOXNO (XO-2) are not built.
Evidence: `docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md`, `docs/internal/evidence/lot-xo/00-recon-verification.md`,
`docs/internal/evidence/lot-xo/xo1-build-and-calls.md`.

**Price sources v2 (2026-09-29 → 2026-10-15; in production, verified at the first refresh tick
after deploy).** Triggered by keyless CoinGecko being blocked from datacenter IPs on 2026-09-29.
Phase A1 gave every priced asset an on-chain source (SDEX and Aquarius pool quotes) with CoinGecko
used only when a key is configured; phase A2 added a maximum price age on every reader, so a stale
row is never served as current; phase B made Reflector the primary source with an on-chain
cross-check per asset (SEP-40 reads, freshness ≤ 900 s). At the first tick after deploy the BTC
price moved from a 15-day-old 69,846 to 81,216.10 from Reflector, cross-checked within +0.59 %
against a two-hop on-chain quote; no asset showed an empty price at any point.
Evidence: `docs/internal/evidence/hotfix-xlm-price-fallback/00-recon.md`, `docs/internal/evidence/price-sources-v2/00-recon.md`,
`docs/internal/evidence/price-sources-v2/05-phase-b-design.md`, `docs/internal/evidence/price-sources-v2/06-phase-b-prod-verification.md`.

**Lending supplied-side correction (hotfix, 2026-09-28; in production, verified at `18072ca`).**
The pool TVL series and the protocol card's top assets summed the borrowed column instead of the
supplied one for Blend pools. API-only fix with a regression spec; series values changed
retroactively because the number became true (the Blend Fixed pool series moved from about $35M
to about $190M).
Evidence: `docs/internal/evidence/hotfix-lending-supplied-side/README.md`.

### 3.2 Public API

**Public API v1 contract (Lot API, 2026-11-02 → 11-03; in production, verified 2026-11-03.)** The
read-only data-and-signals tier of the API now has a published HTTP contract ("contract" always
means the HTTP API contract here, never a smart contract). A hand-written OpenAPI 3.1 document is
the single source of truth, served at `GET /v1/openapi.json`; a Scalar reference page at
`GET /v1/docs` is pinned to one CDN version so a Scalar release cannot change the page. Fifteen
operations, each with an explicit stability tier (nine `stable`, six `beta`): protocols, pools,
pool detail / flows / series, network stats and TVL series, bridge summary / flows / series
(historical), ops status / metrics / adoption, health, and one read-only quote. Wallet-scoped
data, the action builders, the witness ledger, the faucet, auth and campaign routes are
deliberately outside the public contract. A contract test boots the real application against a
local Postgres and validates every operation and every documented error path with a JSON Schema
validator (40 checks). Versioning rule: additive changes only inside `/v1`; a breaking change
ships as `/v2`; every change takes a line in the changelog. A TypeScript SDK and an MCP server
are built from it (both published on npm, November 2026).
Evidence: `docs/decisions/2026-11-03-public-api-v1-surface.md`, `docs/internal/evidence/lot-api/api0-recon.md`,
`docs/internal/evidence/lot-api/api2-contract-test.md`, `docs/internal/evidence/lot-api/api5-prod-verification.md`, `docs/api/README.md`.

### 3.3 Operational maturity

**Pre-dossier fixes (Lot PRE, 2026-11-03; in production at version `8e6dd18`, and PRE2 on
2026-11-04, on `main`).** The status page exposed an amber Horizon bar on the refresh pipeline;
the cause was found and corrected within 24 hours. The indexer fetched the Horizon source-account
sequence once per pool in parallel bursts; it is now fetched once per step process, which took the
`GET /accounts` count from 290 to 29 per refresh in production (274 to 39 Horizon calls per
refresh in the local run). The follow-up recon showed the remaining Horizon latency came from the
24-hour trades walk of the native DEX pools (30 to 60 pages on the public endpoint), not from a
pool scan; the trades pages were moved to the provider endpoint, provider keys are masked in every
log line, and a failed page now leaves a pool's 24 h volume empty instead of a partial sum. The
same lot retired the dashboard bridge section and the Allbridge refresh step, replaced a misleading
"building history since" caption with a plain "TVL history not available" state on non-lending
pools, and put the campaign metrics route behind an operator token.
Evidence: `docs/internal/evidence/lot-pre/pre0-recon.md`, `docs/internal/evidence/lot-pre/pre1-fixes.md`, `docs/internal/evidence/lot-pre/pre2-recon.md`.

**RPC cost reduction on the alert sweep (Lot RP, 2026-10-27; on `main`).** A reconciliation of the
RPC provider's usage against our own run metrics found the wallet sweep issuing one pool load and
one oracle simulation per wallet per pool. The sweep now loads each Blend pool once and reads
wallet positions in batches of 100 ledger keys. Measured locally on 9 wallets and 4 pools: 324
calls per run before, 36 after, with identical health-factor rows; scaled to the production wallet
count of the day, 3,312 calls per run before and 36 after. Every job now persists its RPC calls per
method, so cost is queryable per job.
Evidence: `docs/internal/evidence/lot-rp/00-rpc-cost-recon.md`, `docs/internal/evidence/lot-rp/rp1-sweep-fix.md`.

**Status page (Lot ST, 2026-09-03 → 09-05; in production).** `GET /v1/ops/status` aggregates the
per-run step outcomes and RPC metrics already persisted by the pipeline into a current state
(operational / degraded), missed cycles and failed steps over a window, per-component availability
bars and the list of gaps; the `#status` view in the app renders it, and the freshness chip on
every data surface links to it. A follow-up fix counts leading and trailing gaps, so a stalled
pipeline can no longer read 100 %. This is the visible face of the observability delivered under
the grant, not uptime monitoring.
Evidence: `docs/internal/evidence/status-page/00-recon-2026-09-03.md`, `docs/internal/evidence/status-page/01-lot-st-2026-09-04.md`.

**Node 24 runtime (Lot AC, 2026-08-20 → 08-21; in production).** Node 20 reached upstream
end-of-life in April 2026. CI, the VPS (API under pm2, indexer under cron) and Vercel all moved to
Node 24 with a founder-executed migration runbook, a reboot simulation and a clean refresh cycle
after the switch; zero application-code change.
Evidence: `docs/internal/evidence/lot-ac/ac0-compat.md`, `docs/internal/evidence/lot-ac/ac2-execution.md`, `docs/internal/evidence/lot-ac/ac4-close-out.md`.

### 3.4 Security hardening

**Request validation, refresh admission and ops redaction (Lot SEC, Gate 1, 2026-10-27; on
`main`; the nginx zones are applied by the founder per the deploy sequence).** Three invariants,
each unit-tested. Every request field is type-checked before use and a tracked address must be a
Stellar public key in StrKey form, so malformed input answers 400 rather than a 500 and can no
longer be persisted. A wallet refresh, the most expensive request the API serves, is
admission-controlled: one refresh per wallet at a time, one per wallet per 60 seconds, at most two
running per process, each refusal a 429 with a retry delay that the web shows as "wait a moment".
Child-process output and upstream URLs never reach a client: step messages are redacted before
they are written and again when the public ops endpoints read them, so an operator endpoint that
embeds a key in its URL cannot surface on the status page. Per-IP edge zones were added on wallet
creation and refresh.
Evidence: `docs/internal/evidence/lot-sec/g1.md`, `docs/security-invariants.md` §12.

**Host network posture (S1, 2026-09-29; in production, founder-executed).** A routine check found
the Postgres container port published on all interfaces, reachable from outside the VPS because
Docker's own forwarding rules bypass the host firewall. Every compose binding is now loopback-only,
the compose file refuses to start without a database password, the database role password was
rotated in place, container logs rotate, environment files are owner-readable only, and a
persistent firewall rule on the Docker forwarding chain is documented and proven. The indexer ran
its next scheduled cycle normally after the window.
Evidence: `docs/internal/evidence/lot-ad/ad0-security-findings.md`, `docs/internal/evidence/lot-ad/s1-remediation-runbook.md`,
`docs/internal/evidence/lot-ad/s1-remediation-execution.md`, `docs/security-invariants.md` §10.

**Ownership proofs (Lot EP, 2026-10-16 → 10-21; in production, dark).** Wallet ownership is proven
by signing a plain-text nonce challenge, never a transaction; the API verifies the signature with
the public key only and holds no key, no JWT and no session token. The same proof is now required
for no-session account recovery, closing a path where a stranger could attach to an existing
account by address alone.
Evidence: `docs/internal/evidence/lot-ep/ep1-implementation.md`, `docs/internal/evidence/lot-ep/ep1-wallet-matrix.md`, `docs/security-invariants.md` §11.

### 3.5 Performance

**`GET /v1/pools` latency (2026-10-30; on `main`).** Measured from a laptop against production:
3.2 s at rest and 6.2 s during a refresh for the endpoint that both the dashboard and the protocols
view depend on. Root cause: a per-request aggregation of the whole events table (2.87 million
rows) for the "24h swaps" column, 3.32 s in the plan. Fix: a partial index on swap and trade events
and a rewrite of the statement around it, proven at 2.5 ms on a local copy with both subplans on
the new index; plus a 90-second in-process cache of the list rows with freshness still computed
per request. The first rewrite attempted was 60 s because of a planner cost-model trap on
entities with no events; it is documented as a lesson for this database.
Evidence: `docs/internal/evidence/perf-pools/README.md`, `docs/internal/evidence/perf-pools/explain-before-2026-10-30.md`,
`docs/internal/evidence/perf-pools/explain-local-after-2026-10-30.md`.

### 3.6 Product

**Earn & Points campaign (Lot EP, EP1 → EP4, 2026-10-15 → 10-21; deployed dark, activation is a
founder decision).** Mechanism only, by design: a wallet proves ownership by signed message and
enrols; points are awarded for actions already verified on Horizon by the execution witness,
through a single idempotent award job that is the only writer of action points; a daily check-in
builds a streak whose multiplier ramps gradually; social tasks are self-declared with one handle
per wallet and a daily cap; a referral is credited only after the referee's first verified
on-chain action; a public leaderboard shows shortened addresses; perk tiers are non-monetary.
Points have no monetary value, are not convertible and are never folded into a yield figure
(`docs/decisions/2026-10-21-points-have-no-monetary-value.md`). Third-party APYs stay exactly as
the protocols report them. Action validators, flags and whitelists were not touched.
Evidence: `docs/internal/evidence/lot-ep/00-recon.md`, `docs/internal/evidence/lot-ep/ep1-implementation.md`,
`docs/internal/evidence/lot-ep/ep2-implementation.md`, `docs/internal/evidence/lot-ep/ep3-implementation.md`, `docs/internal/evidence/lot-ep/ep4-implementation.md`.

**Analytics, consent-first (AN0, 2026-10-21; in production).** Google Analytics 4 with Consent
Mode v2: nothing loads until the visitor accepts in a banner, decline sends nothing, and a
parameter guard drops any address, user id or handle before an event is sent. Six product events
only.
Evidence: `docs/internal/evidence/lot-an0/an0-implementation.md`.

**Alerting.** The five rule families (wallet health factor, asset price, pool TVL drop, pool
supply and borrow APY, automatic pool-status protection) date from the grant period (Lot N,
2026-08-16). Post-grant, the evaluator gained the fresh-price rule from price sources v2, so a
price or TVL-drop rule is never evaluated against a stale price (2026-10-14).
Evidence: `docs/internal/evidence/lot-n/n0-recon.md`, `docs/internal/evidence/price-sources-v2/04-phase-a2.md`.

**Watch-only as the first wallet (Lot AB, 2026-08-20; in production).** A visitor can track an
address without connecting a signer; the backend mints a real account for it, and the tracked row
is never promoted to signer, so tracking an address cannot create signing power.
Evidence: `docs/internal/evidence/lot-ab/ab-watch-only-first.md`.

**Responsive overhaul (Lot AA, 2026-08-20; in production).** All five views and three modals
usable at 390 px: drawer shell, per-view mobile pass, modals as bottom sheets, an honest mobile
connect state that presents watch-only first because mobile signing was found unreliable on real
devices. Final sweep: 81 capture records at three viewports, zero horizontal overflow, zero
console errors, desktop pixel-identical outside live-data drift, zero lines changed in the
widgets and XDR validators.
Evidence: `docs/internal/evidence/lot-aa/aa0-breakage-catalog.md`, `docs/internal/evidence/lot-aa/aa0-mobile-signing.md`,
`docs/internal/evidence/lot-aa/aa4-close-out.md`.

### 3.7 Deployment discipline

**CI (since Lot E, Node 24 since Lot AC).** A GitHub Actions workflow builds and runs the unit
suites of the API and the web on every push to `main`, `alpha`, `feat/**` and `fix/**` and on every
pull request; the merge gate is CI green on the pushed branch. It does not deploy.
Evidence: `.github/workflows/ci.yml`, `docs/internal/evidence/lot-ac/ac4-close-out.md`.

**Per-lot deploy sequences.** Every lot that touches the VPS ships with an ordered sequence in
`docs/deployment.md` (schema file before build, build before restart, one manual refresh, a
`/health` version check): status page, RP1, SEC Gate 1, XO, API, PRE. The three deploy incidents of
the grant and post-grant periods (a skipped SQL file, a pull without rebuild, a checkout stuck on a
local edit) are catalogued with the step that must make each one impossible or loud.
Evidence: `docs/deployment.md`, `docs/internal/evidence/lot-ad/ad0-recon.md`.

**Reference compose.** The fully containerised stack (Postgres with the SQL files applied in
dependency order, Redis, API, indexer loop) remains the reviewer path and was last proven from a
clean clone on 2026-08-18; the public API routes are served by the same image.
Evidence: `docs/reference-deployment.md`, `docs/internal/evidence/lot-z/z1-compose-fresh-clone.md`.

## 4. Honest boundaries

- The product is a beta. The API access model for wallet-scoped data is a rate-limited grouping
  key, not authentication (`docs/security-invariants.md` §7).
- Not built: API keys or any auth on the public API, a CI deploy gate
  (deployment to the VPS is manual and founder-executed, with the sequences above), daily TVL
  history for AMM and vault pools (available for lending pools only), XOXNO wallet positions,
  the alert latency of the design document (alerts run on a 15-minute sweep, not an event stream).
- A Redis container ships in the compose stack but no application code uses it today; the list
  cache is in-process.
- Lot SEC's edge zones and Lot RP's schema line depend on founder-side VPS steps whose captures
  are not in the evidence corpus; the code is on `main` and in the production checkout.
- The Allbridge bridge-flow integration delivered under the grant was retired from the refresh
  pipeline and the dashboard on 2026-11-03 after the venue wound down upstream in July 2026; its
  data, API routes and adapter remain as a historical record.
- `docs/TECHNICAL_ARCHITECTURE.md` is the June 2026 design document; its banner and
  "Design vs as-built" table list every point where the build diverged.

## 5. What's next

The SCF 46 application extends this base into an execution and intelligence layer: rank yield
opportunities across lending, AMM liquidity, vaults and tokenised real-world assets with risk
signals and net-of-cost returns, and manage positions on each protocol from one place with the
same non-custodial, in-wallet signing. In parallel, the data-and-signals API track continues: the
SDK, access keys and the contract's stability tiers moving from beta to stable as consumers appear.
No dates are stated here; the application carries the schedule.
