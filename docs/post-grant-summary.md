# Dig Stellar: from data foundations to an execution layer

*Post-grant summary and direction. State at the SCF #46 submission, 2026-11-08.*
*App: stellar.getdig.ai · API: stellar-api.getdig.ai/v1/docs · Code: github.com/Mael-wnb/dig-stellar*

## 1. Where SCF #43 left us

Dig Stellar is the Stellar module of Dig (getdig.ai), a Web3 analytics platform built for several
chains. SCF #43 funded its foundation, and that foundation is complete: all four tranches
were validated and paid, the last one in August 2026 with the acceptance of the final report.

What exists today, on Stellar Mainnet, with real data and real transactions:

- **A unified data layer** over Blend, Aquarius, Soroswap, the native SDEX, DeFindex and, since
  October, XOXNO Lending: protocol and pool analytics, refreshed every 15 minutes, with the
  freshness of every figure exposed to the user and to the API.
- **A multi-wallet portfolio** with one designated signer, watch-only addresses that can never
  sign, per-asset balances and lending positions with health factor.
- **In-app alerting** on health factor, asset price, pool TVL and APY, plus an automatic
  pool-status protection.
- **Non-custodial actions on Mainnet**: SDEX swaps and Blend supply / withdraw, built
  server-side, validated client-side before the wallet is invoked, signed in the user's wallet,
  behind a kill-switch, a per-transaction cap and an issuer-verified whitelist.
- **Operational transparency**: a public status page, health and ops endpoints, and a reference
  deployment that runs from a fresh clone with no secrets.

Two audiences use this foundation: people, through the app, and since this autumn Stellar
developers, through a public API.

## 2. What we built since, on our own initiative

Everything below shipped between late August and early November 2026, outside the scope of
SCF #43, and runs in production.

### 2.1 A sixth protocol: XOXNO Lending

XOXNO Lending is indexed as a first-class protocol: 3 hubs, 25 markets, every figure read from
the on-chain views of the pool contract, no third-party API. TVL is defined as pool cash priced
over priced markets, so the number is 100 % on-chain, with a bounded fallback to the protocol's
own price aggregator for the few markets our price sources do not cover. Integration to
production took one week, which is the point: the adapter model built under the grant makes the
next protocol a matter of days, not months.

### 2.2 A public API, an SDK and an MCP server for Stellar builders

The read-only data tier of the API now has a published contract. An OpenAPI 3.1 document is the
single source of truth, served at `/v1/openapi.json` and rendered at `/v1/docs`: fifteen
operations, each with an explicit stability tier (nine stable, six beta), covering protocols,
pools, pool flows and series, network figures and the pipeline's own status. A contract test
boots the real application and validates every operation and every documented error path
(40 checks). Versioning is a rule, not a hope: additive changes only inside `/v1`, a breaking
change ships as `/v2`, every change takes a line in the changelog.

On top of the contract, two surfaces for builders:

- **`@getdig/stellar-api`**, a TypeScript SDK published on npm, generated from the contract.
  One typed method per operation, typed errors (including rate limits with their Retry-After
  delay), freshness helpers, ESM and CJS builds. A CI job regenerates the types from the
  document and fails on any drift, so the SDK cannot silently diverge from the API.
- **`@getdig/stellar-mcp`**, an MCP server runnable with `npx`, exposing the same read surface to
  AI agents as six tools: protocols, pools, pool detail, pool series, network stats, pipeline
  status. Read-only by construction: no wallet, no transaction, no key.

Together they let an agent or a script consume Stellar DeFi data in three lines, with a
documented contract behind it.

### 2.3 Operational maturity

- **Status page and ops metrics.** `#status` renders per-run outcomes, missed cycles and
  upstream health over 24 hours, from the same metrics the pipeline persists on every run; RPC
  calls are recorded per job and per method, so cost and latency are queryable.
- **RPC efficiency.** The alert sweep went from one pool load and one oracle simulation per
  wallet per pool to batched ledger reads: 3,312 calls per run to 36 in production, a 97 %
  reduction, with identical results.
- **API latency.** `GET /v1/pools`, the endpoint behind the dashboard and the protocols view,
  went from 3.2 s to about 0.1 s through a partial index and an in-process cache that keeps
  freshness computed per request.
- **Price sources v2.** Reflector is the primary oracle, every priced asset has an on-chain
  source, every reader enforces a maximum price age, and the alert evaluator never evaluates a
  rule against a stale price.
- **Runtime.** CI, the VPS and Vercel all run Node 24.

### 2.4 Security hardening

A hardening program ran across the stack during the autumn: typed and validated inputs on every
request, Stellar addresses checked in StrKey form, admission control on the most expensive
request the API serves (one refresh per wallet at a time, with honest 429s), redaction of
upstream URLs and child-process output before anything reaches a client or a log, loopback-only
bindings for every container with a persistent firewall rule on Docker's forwarding chain,
rotated credentials, and per-IP edge zones on wallet creation and refresh. Wallet ownership is
proven by signing a plain-text challenge, never a transaction; the backend verifies with the
public key only and holds no key, no JWT and no session token. Internal metrics routes are
token-gated. The security contract for the action path is a public document
(`docs/security-invariants.md`) and every change to that path is reviewed against it.

### 2.5 Product

- **Earn & Points**, live on Mainnet (see §3).
- **Responsive overhaul**: every view and modal usable at 390 px, with watch-only first on mobile.
- **Watch-only as the first wallet**: anyone can track an address without connecting a signer,
  and a tracked address can never become one.
- **Consent-first analytics**: nothing loads before the visitor accepts, and no address, user id
  or handle ever leaves the browser.
- **Reviewer-facing documentation**: a rewritten README, a one-page status board, a
  design-vs-as-built table on the original architecture document, and a link checker in CI. The
  working documents and the proof corpus live under `docs/internal/`, kept so that every public
  claim stays inspectable.

## 3. Earn & Points: the feedback loop for the next build

The Earn & Points program is live on Mainnet. A wallet proves ownership by signed message and
enrols; points are awarded only for actions verified on-chain by the execution witness, through a
single idempotent award job; a daily check-in builds a streak; referrals are credited only after
the referee's first verified on-chain action; a public leaderboard shows shortened addresses;
perks are non-monetary and points have no monetary value, are not convertible and are never
folded into a yield figure (a published founder ruling).

Its public phase opens with the SCF #46 build period, by design. The goal is not a number on a
slide: it is a steady stream of real users exercising the product while the second layer is being
built, so that every deliverable of the application is tested against actual usage before the
major release that closes it. Adoption figures from the program are always reported with their
incentive context, as they were for SCF #43.

## 4. What SCF #46 adds

The foundation lets a user see what happens across Stellar DeFi. The application funds the layer
that lets them act on it: manage and compare, not just watch.

- **Manage every position from one place.** Blend backstop deposits and BLND claims, health-factor
  warnings with the resolution action ready to execute, intra-pool rebalances in one batched
  transaction; Aquarius liquidity, AQUA rewards, real impermanent loss per position and bribe
  yield folded into APR; Soroswap liquidity via the Router; DeFindex vault deposits with a strategy
  comparison; SDEX limit orders. Every action calls the protocol's own contracts; Dig deploys none.
- **Compare DeFi yield and real-world yield side by side.** Etherfuse stablebonds indexed next to
  lending, AMM and vault opportunities, with a scoring engine that computes yield estimates and
  category-specific risk signals, so sources with different risk profiles become comparable in
  one ranked feed.
- **Bring capital from other chains.** Native USDC into Stellar through Circle's CCTP, routed
  directly into any surfaced opportunity.
- **Get alerted when it matters.** Telegram and Discord delivery for health-factor and yield
  alerts, with the recommended action ready to execute when the user returns.

The build converges on one major release: a single interface where people compare, decide and
act across Stellar DeFi.

**In parallel, on our own initiative: the builder layer.** Outside the application's budget, the
data and signals track continues as it started this autumn: access keys with per-key quotas,
pagination and an events feed, homogeneous history series across every venue type, market-level
signal subscriptions with webhook delivery, and the SDK and MCP server maturing with the contract.
Once keys and per-key limits are in place, the action builders and their client-side validation
library follow, so that a builder or an agent can prepare a non-custodial transaction and hand it
to the user's wallet for signature: the agent prepares, the person signs.

## 5. Verify it yourself

- Application: https://stellar.getdig.ai
- Status page: https://stellar.getdig.ai/#status
- API reference: https://stellar-api.getdig.ai/v1/docs · OpenAPI: https://stellar-api.getdig.ai/v1/openapi.json
- SDK: `packages/sdk` (npm `@getdig/stellar-api`) · MCP server: `packages/mcp` (npm `@getdig/stellar-mcp`)
- Repository: https://github.com/Mael-wnb/dig-stellar. Reading order: `README.md`,
  `docs/post-grant-summary.md`, `docs/status-board.md`; the proof corpus is indexed in
  `docs/internal/evidence/README.md`.
- Reference deployment, from a fresh clone with no secrets: `docs/reference-deployment.md`.

Every figure in this document traces to a command output, a capture or a transaction hash in the
repository.

## 6. Scope notes

- The public API is read-only today, by design; execution stays in the app, where every
  transaction is validated client-side and signed in the user's wallet. Exposing it to builders
  comes after access keys and per-key limits, with the same validation and signing rules.
- SDK v0 covers the read surface of the contract; access keys, pagination and retries arrive with
  the builder layer.
- The Allbridge bridge-flow integration delivered under SCF #43 remains in the API as a
  historical record; the venue wound down upstream in July 2026 and is no longer shown on the
  dashboard.
