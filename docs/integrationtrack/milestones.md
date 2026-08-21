# Dig: Stellar DeFi Intelligence & Position Management Layer — Milestones

> SCF Round 45 (integration track) submission. An extension of Dig's existing Stellar work
> (SCF 43), built in the same monorepo on top of the already-delivered indexing, analytics,
> transaction-builder, and multi-wallet infrastructure.

## Positioning

The unified management layer for Stellar DeFi: rank and compare every yield source across
lending, AMM liquidity, yield vaults, and tokenized real-world assets; manage positions deeply
on each protocol (backstop, LP, reward claims, vault allocation, health-factor); act in one
click with non-custodial, in-wallet signing; bring native USDC into Stellar via Circle CCTP;
and get alerted on Telegram/Discord when a position needs attention.

This builds directly on Dig's existing Stellar indexing and analytics infrastructure: a hybrid
Horizon + Soroban RPC pipeline that already ingests and normalizes real-time data from
integrated protocols (Blend, Aquarius, Soroswap, DeFindex, SDEX) into a unified Postgres store,
served through internal API endpoints, with grouped multi-wallet portfolio tracking, a
non-custodial transaction builder, and in-app alerting already in place. That infrastructure is
the foundation this project extends; the work below is the deep protocol execution,
Etherfuse RWA integration, external notification delivery, CCTP capital import, and
cross-category intelligence layers built on top of it.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the technical architecture and
[`README.md`](./README.md) for the scope overview and integration map.

## Summary

**8 deliverables across 3 tranches (3 + 3 + 2). Project window: late September → mid-December 2026. Total budget: $75,000.**

| Tranche | Deliverable | Estimated completion | Budget |
|---|---|---|---|
| T1 — MVP | 1.1 Blend Position Management (Backstop, Claim, Health Factor, Batch Rebalance) | September 22, 2026 | $10,800 |
| T1 — MVP | 1.2 Etherfuse RWA Integration (Stablebonds Indexing + Buy/Sell) | October 3, 2026 | $7,300 |
| T1 — MVP | 1.3 Notification Bots (Telegram / Discord) | October 13, 2026 | $6,100 |
| **T1 subtotal** | | | **$24,200** |
| T2 — Testnet | 2.1 Aquarius LP Management (Deposit, Withdraw, Claim AQUA, IL Tracking, Bribes) | October 27, 2026 | $10,400 |
| T2 — Testnet | 2.2 Soroswap LP + DeFindex Vaults + SDEX Limit Orders | November 10, 2026 | $9,300 |
| T2 — Testnet | 2.3 Cross-Chain USDC Import (Circle CCTP) | November 21, 2026 | $8,200 |
| **T2 subtotal** | | | **$27,900** |
| T3 — Mainnet | 3.1 Cross-Category Intelligence Engine | December 1, 2026 | $9,600 |
| T3 — Mainnet | 3.2 Enriched Portfolio + Mainnet Launch | December 19, 2026 | $13,300 |
| **T3 subtotal** | | | **$22,900** |
| **Total** | | | **$75,000** |

---

## Tranche 1 — MVP

### Deliverable 1.1: Blend Position Management (Backstop, Claim, Health Factor, Batch Rebalance)

**Description:**

Build a full position management layer for Blend. Users can deposit into and withdraw from a
pool's backstop fund, the insurance layer that absorbs defaults in exchange for BLND emissions,
with the q4w queue-for-withdrawal cycle managed directly in the UI. Users can claim accumulated
BLND emissions from their positions. When a health factor drops below a configured threshold,
the platform surfaces a warning with recommended actions such as adding collateral or making a
partial repayment, ready to execute. Users can also execute intra-pool rebalances, for example
withdrawing one collateral and depositing another, using Blend's batched submit with mixed
Request types. All actions are non-custodial: transactions are built server-side and signed in
the user's wallet.

**How to measure completion:**

- A user can deposit into and withdraw from a Blend pool's backstop fund, with the q4w queue
  cycle managed in the UI
- A user can claim accumulated BLND emissions from their positions
- The platform surfaces health-factor warnings with recommended resolution actions ready to
  execute
- A user can execute intra-pool position adjustments, such as collateral swap or partial repay
  + withdraw

**Estimated date of completion:** September 22, 2026

**Budget:** $10,800

### Deliverable 1.2: Etherfuse RWA Integration (Stablebonds Indexing + Buy/Sell)

**Description:**

Integrate Etherfuse stablebonds, including tokenized sovereign bonds such as CETES, USTRY, and
EUROB, as a new asset category. Build a read adapter that indexes stablebond balances, prices,
and accrued yield. Enable buy and sell via the Stellar DEX or Etherfuse API, with automatic
trustline setup where needed. Stablebond positions appear in the consolidated portfolio
alongside other positions.

**How to measure completion:**

- Etherfuse stablebonds are indexed with yield estimates and risk signals
- A user can buy and sell stablebonds from the platform, with a trustline created
  automatically if missing
- Stablebond holdings are tracked in the portfolio with accrued yield displayed

**Estimated date of completion:** October 3, 2026

**Budget:** $7,300

### Deliverable 1.3: Notification Bots (Telegram / Discord)

**Description:**

Build external notification delivery via Telegram and Discord bots. Health-factor alerts tell
users which position is at risk and what action is recommended. Yield-change notifications
trigger when a pool or vault APY moves beyond a configured delta. Users configure alert
preferences, including thresholds and channels, in their profile. When users open the
platform, any active warning is surfaced with the recommended action ready to execute, with
the transaction built at that moment using current on-chain state.

**How to measure completion:**

- Users can configure alert preferences, including thresholds and channels, in their profile
- Alerts are delivered via Telegram and Discord bots with the position at risk and the
  recommended action
- When users open the platform, active warnings are surfaced with the resolution action ready
  to execute
- Yield-change and opportunity alerts are delivered across configured channels

**Estimated date of completion:** October 13, 2026

**Budget:** $6,100

---

## Tranche 2 — Testnet

### Deliverable 2.1: Aquarius LP Management (Deposit, Withdraw, Claim AQUA, IL Tracking, Bribes)

**Description:**

Build LP management for Aquarius. Users can add and remove liquidity across the pool types
exposed by the Aquarius contract, including volatile, stableswap, and concentrated pools, and
claim accumulated AQUA rewards. Each LP position displays impermanent loss tracking, comparing
the current position value with the hold-equivalent value, as well as net P&L including fees
and emissions. Active bribes per pool returned by the Aquarius Bribes API are surfaced, and
bribe yield is integrated into APR calculations.

**How to measure completion:**

- A user can add and remove liquidity in Aquarius pools from the platform
- A user can claim accumulated AQUA rewards
- LP positions display impermanent loss and net P&L, including fees + rewards - IL
- Bribe yield returned by the Aquarius Bribes API is integrated into each pool's APR

**Estimated date of completion:** October 27, 2026

**Budget:** $10,400

### Deliverable 2.2: Soroswap LP + DeFindex Vaults + SDEX Limit Orders

**Description:**

Build LP management on Soroswap, including adding and removing liquidity via the Router. Build
vault deposit and withdrawal on DeFindex, with a strategy comparison view showing which vault
uses which strategy and its historical performance. Add limit order management on the native
SDEX, allowing users to place, modify, and cancel orders.

**How to measure completion:**

- A user can add and remove liquidity in Soroswap pairs
- A user can deposit into and withdraw from DeFindex vaults, with a comparison view of
  available vaults and their strategies
- A user can manage limit orders on the SDEX, including place, modify, and cancel
- All actions are non-custodial

**Estimated date of completion:** November 10, 2026

**Budget:** $9,300

### Deliverable 2.3: Cross-Chain USDC Import (Circle CCTP)

**Description:**

Integrate Circle's CCTP for native USDC cross-chain transfers using a burn-and-mint
architecture with no wrapped assets, allowing users to bring USDC from other chains into
Stellar. The user connects a source-chain wallet and signs the burn transaction. The platform
then polls for Circle's attestation and builds the mint transaction on Stellar. Arriving USDC
can optionally be routed directly into an opportunity surfaced by Dig.

**How to measure completion:**

- USDC can be moved from a supported source chain into Stellar via CCTP
- The orchestration flow, including burn, attestation, and mint, works end to end
- Arriving USDC can be directed into an opportunity from the interface

**Estimated date of completion:** November 21, 2026

**Budget:** $8,200

---

## Tranche 3 — Mainnet

### Deliverable 3.1: Cross-Category Intelligence Engine

**Description:**

Build the intelligence engine that consumes protocol metrics from all integrations developed
in Tranches 1 and 2 and automatically detects, scores, and ranks yield opportunities across
categories: lending and backstop on Blend, AMM liquidity on Aquarius and Soroswap,
auto-compound yield on DeFindex vaults, and real-world asset yield on Etherfuse stablebonds.
Each opportunity includes a yield estimate, category-specific risk signals, and a composite
ranking score. The key output is cross-category comparison: users can view yield sources from
different categories side by side, understand their respective risk profiles, and act on them
from the same interface.

**How to measure completion:**

- A backend service computes ranked opportunities from Stellar data across the integrated
  protocols and asset categories
- Each opportunity includes a yield estimate, risk signals, and a ranking score
- The dashboard renders a ranked feed with filtering by protocol, asset, yield, risk, and
  category
- Ranked opportunities link to the corresponding execution action when available

**Estimated date of completion:** December 1, 2026

**Budget:** $9,600

### Deliverable 3.2: Enriched Portfolio + Mainnet Launch

**Description:**

Surface all new position types in the portfolio view: backstop positions with q4w status and
claimable BLND, LP positions with impermanent loss and net P&L, stablebond holdings with
accrued yield, and a cross-protocol summary showing total exposure and blended yield. Bring
all new layers live on Stellar Mainnet with production configuration. The complete flow from
opportunity ranking to on-chain action works end to end on mainnet.

**How to measure completion:**

- The portfolio displays backstop, LP, and stablebond positions alongside existing positions,
  each with its relevant metrics
- A cross-protocol summary shows total exposure and blended yield
- All new layers run on Stellar Mainnet
- CCTP operates with Mainnet USDC
- Notification bots deliver alerts based on Mainnet data

**Estimated date of completion:** December 19, 2026

**Budget:** $13,300
