# Dig Stellar

Dig Stellar is DeFi analytics, multi-wallet portfolio monitoring and non-custodial actions on the
Stellar network, live on Stellar Mainnet: one place to read protocol and pool metrics on real data
refreshed every 15 minutes, follow several wallets, receive in-app alerts, and swap or lend from the
same screen while every transaction is signed in the user's own wallet. It is built by the Dig team
(getdig.ai) and is the Stellar module of Dig, a multi-chain Web3 analytics platform. Its foundation
was funded by Stellar Community Fund award #43, delivered in full and paid in August 2026;
everything since is Dig's own work ahead of the SCF #46 application.

## Live

- App: https://stellar.getdig.ai
- Status page: https://stellar.getdig.ai/#status
- API docs: https://stellar-api.getdig.ai/v1/docs
- OpenAPI document: https://stellar-api.getdig.ai/v1/openapi.json

## What it does

Facts as of 2026-11-08, each in production and traceable through `docs/status-board.md`,
`docs/post-grant-summary.md` or a call against the production API.

- **Six protocols on one pipeline**, on real Mainnet data: Blend (lending), Aquarius (AMM),
  Soroswap (AMM), the Stellar native DEX, DeFindex (yield vaults) and XOXNO Lending. Pool-level
  pages with TVL, reserves, volume, APY and 7-day series, refreshed every 15 minutes.
- **Freshness on every figure**: each `/v1/*` payload carries `asOf`, `isStale` and
  `staleAfterSeconds`; the UI shows the same freshness next to the number it qualifies.
- **Multi-wallet portfolio**: several wallets under one account, one designated active signer,
  watch-only addresses that can never sign, per-asset balances and Blend positions with health factor.
- **In-app alerts** on wallet health factor, asset price, pool TVL and pool supply/borrow APY, plus
  an automatic pool-status protection, evaluated on a periodic sweep against the indexed snapshots.
- **Non-custodial Mainnet actions**: SDEX swaps and Blend supply/withdraw, built server-side,
  validated client-side against the user's intent before the wallet is invoked, signed in-wallet,
  behind a kill-switch, a per-transaction cap and an issuer-verified asset whitelist
  (`docs/security-invariants.md`).
- **Public read API** with a published OpenAPI 3.1 contract: 15 operations, each with an explicit
  stability tier (nine stable, six beta), validated by a contract test that boots the real
  application and checks every operation and every documented error path (40 checks).
- **SDK and MCP server**, both on npm and generated from the same contract: the TypeScript SDK
  `@getdig/stellar-api` (`packages/sdk`) and the MCP server `@getdig/stellar-mcp` (`packages/mcp`,
  six read-only tools for AI agents).

  ```bash
  npm i @getdig/stellar-api        # typed client, one method per operation
  npx -y @getdig/stellar-mcp       # MCP server over stdio, read-only
  ```

- **Operational transparency**: a public status page with per-run outcomes, missed cycles and
  upstream health over 24 hours; health and ops endpoints; a reference deployment that runs from
  a fresh clone with no secrets.
- **Efficiency work in production**: the alert sweep went from 3,312 RPC calls per run to 36, a
  97 % reduction with identical results; `GET /v1/pools` went from 3.2 s to about 0.1 s.

## Architecture in ten lines

- `apps/web`: Vue 3 + Vite, wallet UX via Stellar Wallets Kit; UI and state only, every product
  figure comes from the internal API.
- `apps/api`: NestJS, the single UI-facing façade; raw SQL over Postgres, freshness metadata on
  every `/v1/*` payload, public contract served at `/v1/openapi.json` and `/v1/docs`.
- `apps/indexer`: ingestion jobs; Soroban RPC is the primary data plane, Horizon the complement,
  DeFindex and XOXNO through their SDK or on-chain views.
- `packages/sdk` and `packages/mcp`: the TypeScript SDK and the MCP server, generated from and
  drift-checked against the contract in CI.
- Storage: Postgres 16, raw SQL schema families (`apps/api/src/db/stellar_v*.sql`).
- Cadence: one refresh run every 15 minutes writes snapshots and latest metrics; the alert sweep
  runs on its own 15-minute line; staleness is computed at read time and shown in the UI.
- Operations: one VPS (nginx, pm2, cron), web on Vercel; health and run metrics at `/health`,
  `/v1/ops/*` and the status page; CI builds, runs the unit suites and checks SDK drift and doc
  links on every push.
- Design document: `docs/TECHNICAL_ARCHITECTURE.md` (June 2026), with a design-vs-as-built table
  recording every engineering decision taken since, each with its reason.

## Run it

The reference stack, from a fresh clone to real Mainnet data, with no secrets
(`docs/reference-deployment.md` has the details and the host-pnpm developer path):

```bash
git clone <repo-url> dig-stellar && cd dig-stellar
cp .env.example .env
GIT_SHA=$(git rev-parse --short HEAD) docker compose --profile app up -d --build
curl -s localhost:3000/health          # status, version = GIT_SHA, per-venue freshness
curl -s localhost:3000/v1/protocols    # protocols with live TVL after the first refresh (~3-6 min)
```

Requirements: Docker with compose v2. For the developer path: Node 24 (`.nvmrc`) and pnpm 10.
Every step runs on public endpoints; the DeFindex step additionally takes a `DEFINDEX_API_KEY`.

Tests: unit suites in each app (Jest for the API, Vitest for the web, `node --test` for the
indexer) and the API contract test; CI runs them on every push.

## Documentation

Reading order: this README, then `docs/post-grant-summary.md` (what shipped after the grant and
where it is going), then `docs/status-board.md` (one page: tranches, post-grant lots, what is next).
Full map with source-of-truth ranks: `docs/README.md`.

- `docs/integrationtrack/`: the SCF #46 integration track: architecture of the next layer
  (`ARCHITECTURE.md`, including the Circle CCTP flow) and the deliverables with their completion
  criteria (`milestones.md`).
- `docs/TECHNICAL_ARCHITECTURE.md`: the architecture document, with a design-vs-as-built table
  recording every engineering decision since the June 2026 design.
- `docs/security-invariants.md`: the security contract for the action path and the money path.
- API reference: https://stellar-api.getdig.ai/v1/docs (contract, tiers and tests in `docs/api/README.md`).
- `docs/internal/evidence/README.md`: index of the proof corpus; every figure above traces to a
  command output, a capture or a transaction hash there.

## Contact

- X: https://x.com/Dig_Agentic
- Discord: https://discord.gg/sDpqGfmDgF

License: MIT (`LICENSE`).
