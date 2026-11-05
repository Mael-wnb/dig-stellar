# Dig Stellar

Dig Stellar is DeFi analytics, multi-wallet portfolio monitoring and non-custodial actions on the
Stellar network: one place to read protocol and pool metrics, follow several wallets, receive
in-app alerts, and swap or lend from the same screen while every transaction is signed in the
user's own wallet. It is built by the Dig team (getdig.ai). The work was funded by Stellar
Community Fund award #43, completed and fully paid in August 2026; everything since is
post-grant product hardening ahead of the SCF #46 application.

## Live

- App: https://stellar.getdig.ai
- Status page: https://stellar.getdig.ai/#status
- API docs: https://stellar-api.getdig.ai/v1/docs
- OpenAPI document: https://stellar-api.getdig.ai/v1/openapi.json

## What it does today

Facts as of 2026-11-04, each traceable to `docs/status-board.md`, `docs/current-state.md` or a
call against the production API.

- **Protocol analytics** for six Stellar DeFi protocols on real mainnet data: Blend (lending),
  Soroswap (AMM), Aquarius (AMM), the Stellar native DEX, DeFindex (yield vaults) and XOXNO
  Lending. Pool-level pages with TVL, reserves, volume, APY and 7-day series. The Allbridge
  bridge-flow venue is kept as a historical record only (the venue wound down upstream in
  July 2026).
- **Multi-wallet portfolio**: several wallets grouped under one account, one designated active
  signer, watch-only addresses that can never sign, per-asset balances and Blend positions with
  health factor.
- **In-app alerting**: rules on wallet health factor, asset price, pool TVL drop and pool
  supply/borrow APY, plus an automatic pool-status protection. Rules are evaluated on a periodic
  sweep against the indexed snapshots; notifications are in-app only.
- **Mainnet actions**: SDEX swaps and Blend supply/withdraw, executed and Horizon-verified on
  mainnet. Security regime: kill-switch flags, a per-transaction cap, an issuer-verified asset
  whitelist, client-side XDR validation before the wallet is invoked, in-wallet signing only
  (`docs/security-invariants.md`).
- **Public read API**: a versioned HTTP contract, 15 operations (OpenAPI 3.1, `v1`), validated
  by a contract test that boots the real application (`docs/api/README.md`). TypeScript SDK in
  `packages/sdk` (v0, generated from the contract).

## Architecture in ten lines

- `apps/web`: Vue 3 + Vite, wallet UX via Stellar Wallets Kit; no business logic, no direct
  provider calls for product data.
- `apps/api`: NestJS, the single UI-facing façade; raw SQL over Postgres, freshness metadata on
  every `/v1/*` payload.
- `apps/indexer`: ingestion jobs; Soroban RPC is the primary data plane, Horizon the complement,
  DeFindex and XOXNO through their SDK or on-chain views.
- Storage: Postgres 16. A Redis container ships in the compose stack but no application path
  uses it today.
- Cadence: one refresh run every 15 minutes writes snapshots and latest metrics; the alert sweep
  runs on its own 15-minute line; staleness is computed at read time and shown in the UI.
- Operations: one VPS (nginx, pm2, cron), web on Vercel; health and run metrics at `/health`,
  `/v1/ops/*` and the status page.
- Design document: `docs/TECHNICAL_ARCHITECTURE.md` (June 2026). Not all of it was built as
  described; read its banner and "Design vs as-built" table first.

## Run it

The proven reference stack, from a fresh clone to real mainnet data, with no secrets
(`docs/reference-deployment.md` has the details and the host-pnpm developer path):

```bash
git clone <repo-url> dig-stellar && cd dig-stellar
cp .env.example .env
GIT_SHA=$(git rev-parse --short HEAD) docker compose --profile app up -d --build
curl -s localhost:3000/health          # status, version = GIT_SHA, per-venue freshness
curl -s localhost:3000/v1/protocols    # protocols with live TVL after the first refresh (~3-6 min)
```

Requirements: Docker with compose v2. For the developer path: Node 24 (`.nvmrc`) and pnpm 10.
Without `DEFINDEX_API_KEY` the DeFindex step fails non-fatally; everything else runs on public
endpoints.

## Docs map

Full map with source-of-truth ranks and a reviewer reading order: `docs/README.md`.

| Doc | What it is |
|---|---|
| `docs/post-grant-summary.md` | What shipped after the grant closed (Aug → Nov 2026), with evidence per item |
| `docs/status-board.md` | One page: grant tranches, post-grant lots, what is next |
| `docs/current-state.md` | Detailed as-built reality |
| `docs/decisions/` | Founder rulings with their rationale |
| `docs/runbooks.md` | Operating procedures (cron, schema, campaign, API contract) |
| `docs/deployment.md` | VPS shape, hardening, deploy sequences |
| `docs/internal/` | Working documents and the proof corpus (briefs, evidence, archived long-form board); not written for reviewers, kept so every claim is inspectable |
| `docs/api/README.md` | Public API contract, docs page, contract test |
| `docs/security-invariants.md` | Security contract for the action path and the money path |
| `docs/TECHNICAL_ARCHITECTURE.md` | Design document, with a design-vs-as-built banner |

## Status and honesty

The product is a production beta. Rules this repository follows when describing itself:
every number traces to a command, a capture or a transaction hash; design intentions are never
stated as built; adoption figures earned under an incentive campaign are always stated with
that context. `docs/status-board.md` carries the current state and its "Last updated" line;
`docs/internal/evidence/` holds the proofs. Known limits are listed there rather than here: among them,
deployment to the VPS is still manual (CI builds and tests, it does not deploy), the beta API
access model is a rate-limited grouping key rather than authentication, and the public API has
no auth yet; SDK v0 not yet published.

Tests: unit suites in each app (Jest for the API, Vitest for the web, `node --test` for the
indexer) and an API contract test; CI runs build and unit tests on every push.

## Contact

- X: https://x.com/Dig_Agentic
- Discord: https://discord.gg/sDpqGfmDgF

License: MIT (`LICENSE`).
