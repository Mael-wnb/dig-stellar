# Dig: Stellar DeFi Intelligence & Position Management Layer — Milestones and budget

## Tranche 1 — MVP: lending position management, Etherfuse and notifications ($24,100)

### 1.1 Lending position management: Blend and XOXNO Lending

**Description.** We build the lending position management layer on the two lending protocols we already index. On Blend: claiming the BLND emissions accrued on the user's positions; when the health factor drops below a configured threshold, the platform surfaces a warning with recommended actions (add collateral, partial repay), ready to execute; intra-pool rebalances, for example withdrawing one collateral and depositing another, through Blend's batched `submit` with mixed Request types. On XOXNO Lending: position account creation, supply, withdraw and repay through the controller, health factor and account positions read, same warnings and same resolution actions as on Blend. All actions are non-custodial: transactions are built server-side and signed in the user's wallet.

**How to measure completion.**
- A user claims their BLND emissions from the platform; a user supplies to, withdraws from and repays on an XOXNO Lending market from the platform; transaction hashes published.
- The platform surfaces health-factor warnings on Blend and on XOXNO Lending with the resolution action ready to execute, and executes it, hashes published.
- A user executes an intra-pool position adjustment on Blend in a single transaction (collateral swap, or partial repay followed by a withdrawal), hash published.
- Unit tests of the Blend and XOXNO Lending action builders pass in public CI.

**Budget.** $10,700

**Delivery date.** December 19, 2026

### 1.2 Etherfuse integration: stablebond indexing, buy and sell

**Description.** We integrate Etherfuse stablebonds, tokenized sovereign bonds such as CETES, USTRY and EUROB, as a new asset category. A read adapter indexes balances, prices and accrued yield. Buy and sell go through the Stellar DEX or the Etherfuse API, with automatic trustline setup where missing. Stablebond positions appear in the consolidated portfolio alongside the other positions.

**How to measure completion.**
- Etherfuse stablebonds are indexed with balances, prices and accrued yield, visible in the public API.
- A user buys and sells a stablebond from the platform, with the trustline created automatically if missing, hashes published.
- Stablebond holdings appear in the portfolio with accrued yield displayed.

**Budget.** $7,300

**Delivery date.** December 30, 2026

### 1.3 Telegram and Discord notification bots

**Description.** We build external notification delivery through Telegram and Discord bots. Health-factor alerts tell the user which position is at risk and what action is recommended. Yield-change notifications fire when a pool or vault APY moves beyond a configured delta. The user configures alert preferences, thresholds and channels, in their profile. When they open the platform, any active warning is surfaced with the recommended action ready to execute, the transaction being built at that moment on current on-chain state.

**How to measure completion.**
- A user configures alert preferences, thresholds and channels, in their profile.
- Alerts are delivered through the Telegram and Discord bots with the position at risk and the recommended action, captures and message identifiers published.
- When the platform is opened, active warnings are surfaced with the resolution action ready to execute.
- Yield-change alerts are delivered on the configured channels.

**Budget.** $6,100

**Delivery date.** January 7, 2027

---

## Tranche 2 — Testnet: AMM liquidity, vaults, SDEX orders and USDC import ($27,600)

### 2.1 Aquarius LP management: deposit, withdraw, claim AQUA, impermanent loss, bribes

**Description.** We build LP management on Aquarius. The user adds and removes liquidity across the pool types exposed by the Aquarius contract, volatile, stableswap and concentrated, and claims accrued AQUA rewards. Each LP position shows impermanent loss tracking, current position value against the hold-equivalent value, and net P&L including fees and emissions. Active bribes per pool returned by the Aquarius Bribes API are surfaced and bribe yield is folded into the APR calculation.

**How to measure completion.**
- A user adds and removes liquidity in Aquarius pools from the platform, hashes published.
- A user claims their accrued AQUA rewards, hash published.
- LP positions display impermanent loss and net P&L (fees + rewards − impermanent loss), calculation verifiable in the public API.
- Bribe yield returned by the Aquarius Bribes API is integrated into each pool's APR.

**Budget.** $10,300

**Delivery date.** January 22, 2027

### 2.2 Soroswap LP, DeFindex vaults and SDEX limit orders

**Description.** We build LP management on Soroswap, adding and removing liquidity through the Router; vault deposit and withdrawal on DeFindex, with a strategy comparison view showing which vault uses which strategy and its historical performance; and limit order management on the native SDEX, placing, modifying and cancelling orders.

**How to measure completion.**
- A user adds and removes liquidity in Soroswap pairs, hashes published.
- A user deposits into and withdraws from a DeFindex vault, with a comparison view of the available vaults and their strategies, hashes published.
- A user places, modifies and cancels a limit order on the SDEX, hashes published.
- All actions are non-custodial: the XDR is validated client-side and signed in the wallet, public test in CI.

**Budget.** $9,200

**Delivery date.** February 4, 2027

### 2.3 Cross-chain capital import through Circle CCTP

**Description.** We integrate Circle's CCTP for native USDC transfers across chains, burn-and-mint with no wrapped asset, so that the user brings USDC from other chains into Stellar. The user connects a source-chain wallet and signs the burn transaction. The platform polls Circle's attestation then builds the mint transaction on Stellar. Arriving USDC can be routed directly into an opportunity surfaced by Dig. The architecture's threat model and monitoring plan are kept current and published in the repository with this tranche.

**How to measure completion.**
- USDC is moved from a supported source chain into Stellar via CCTP, hashes on both sides published.
- The orchestration flow, burn, attestation, mint, works end to end, transfer state visible in the interface.
- Arriving USDC is directed into an opportunity from the interface, hash published.
- The threat model and the monitoring plan are published in the repository, current with the delivered components.

**Budget.** $8,100

**Delivery date.** February 16, 2027

---

## Tranche 3 — Mainnet: ranking engine, enriched portfolio and production launch ($22,900)

### 3.1 Intelligence engine: cross-category ranking

**Description.** We build the intelligence engine that consumes protocol metrics from all the integrations of Tranches 1 and 2 and automatically detects, scores and ranks yield opportunities across categories: lending on Blend and XOXNO Lending, AMM liquidity on Aquarius and Soroswap, auto-compound yield on DeFindex vaults, real-world asset yield on Etherfuse stablebonds. Each opportunity carries a yield estimate, category-specific risk signals, two cross-cutting signals, thin-market collateral and pool status, and a composite ranking score. The key output is cross-category comparison: the user sees yield sources from different categories side by side, understands their risk profiles and acts from the same interface.

**How to measure completion.**
- A backend service computes ranked opportunities from Stellar data across the integrated protocols and asset categories, served by `/v1/opportunities` in the public API.
- Each opportunity carries a yield estimate, risk signals and a ranking score.
- The "thin-market collateral" and "pool status" signals are computed for every opportunity and a frozen or paused pool has its actions disabled, public tests in CI.
- The dashboard renders a ranked feed filterable by protocol, asset, yield, risk and category, each opportunity linked to its execution action when one exists.

**Budget.** $9,500

**Delivery date.** March 1, 2027

### 3.2 Enriched portfolio

**Description.** We surface all the new position types in the portfolio view: Blend and XOXNO Lending positions with health factor and claimable BLND, LP positions with impermanent loss and net P&L, stablebonds with accrued yield, and a cross-protocol summary showing total exposure and blended yield.

**How to measure completion.**
- The portfolio displays lending, LP and stablebond positions alongside existing positions, each with its metrics, data verifiable against on-chain state.
- A cross-protocol summary shows total exposure and blended yield.
- Tests of the portfolio view and of the summary pass in public CI.

**Budget.** $6,100

**Delivery date.** March 10, 2027

### 3.3 Production launch on Mainnet

**Description.** We bring all the new layers live on Stellar Mainnet with production configuration: execution on Blend, XOXNO Lending, Aquarius, Soroswap, DeFindex, Etherfuse and the SDEX, USDC import through CCTP, notification bots, ranking engine and enriched portfolio. The complete flow, from ranking an opportunity to the on-chain action, works end to end on Mainnet, and its adoption is measured on the platform's public execution ledger.

**How to measure completion.**
- All new layers run on Stellar Mainnet, every protocol action executed at least once with its hash published.
- CCTP operates with Mainnet USDC and the notification bots deliver alerts from Mainnet data.
- At least 60 unique Mainnet wallets have executed at least one action delivered under this scope (BLND claim, health-factor resolution or rebalance on Blend, supply, withdraw or repay on XOXNO Lending, Aquarius or Soroswap liquidity, DeFindex vault, SDEX limit order, Etherfuse buy or sell, CCTP import), from award acceptance to the submission of this tranche, team wallets excluded, counted on the public execution ledger (`GET /v1/ops/adoption`).
- At least 250 Mainnet transactions of those same actions originated through Dig over the same window, each verified on the ledger and listed in the same registry; the app-operated accounts are registered as the on-chain footprint at acceptance, team wallets excluded.

**Budget.** $7,300

**Delivery date.** March 20, 2027
