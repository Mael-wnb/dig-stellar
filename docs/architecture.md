# Dig Stellar — Technical Architecture

This document describes the system architecture for Dig’s Stellar module: protocol analytics, multi-wallet portfolio monitoring, alerts, and optional non-custodial actions.

## Design principles
- Protocol-first: focus on Stellar DeFi protocols (e.g., Blend, DeFindex, Aquarius, Soroswap), with adapters to add more.
- Near real-time analytics: normalized snapshots (e.g., every 5–15 minutes) for TVL/liquidity, volume/flows, yields, utilization, and risk signals.
- Multi-wallet portfolio: users can connect multiple wallets and view consolidated exposure.
- Non-custodial: users always approve/sign from their wallet; Dig prepares action proposals only.

---

## 1) System Architecture (High-level)

```mermaid
flowchart TB
  %% Users & Frontend
  U[User] --> UI[Dig Web App - Dashboard]

  %% Multi-wallet connection
  UI --> WK[Stellar Wallets Kit - Freighter / xBull / WalletConnect / others]
  WK -->|Wallet session + user approvals| UI

  %% Backend gateway
  UI --> API[Dig Stellar API - Gateway / BFF]
  API --> Cache[Redis Cache - hot data + rate limits]
  API --> DB[(Postgres - Prisma data store)]

  %% Data & Indexing
  subgraph Data[Data and Indexing Layer]
    Horizon[Horizon API - ledger activity, balances, trustlines, ops]
    SorobanRPC[Soroban RPC - contract state and events]
    Adapters[Protocol Adapters - Blend / DeFindex / Aquarius / Soroswap]
    Indexer[Indexer and Normalizer - unified schema]
    Agg[Metrics Aggregator - snapshots: TVL, flows, yields, risk]
  end

  Horizon --> Indexer
  SorobanRPC --> Indexer
  Adapters --> Indexer
  Indexer --> DB
  Agg --> DB
  DB --> API

  %% Portfolio
  subgraph Portfolio[Portfolio and Position Monitoring]
    PortSvc[Portfolio Service - multi-wallet consolidation]
    PosSvc[Position Resolvers - protocol-level positions]
  end

  API --> PortSvc
  PortSvc --> DB
  PortSvc --> PosSvc
  PosSvc --> SorobanRPC
  PosSvc --> Adapters

  %% Alerts & Optional Actions
  subgraph Actions[Alerts and Optional Actions]
    Rules[Rules Engine - thresholds + anomalies]
    Notif[Notifications - in-app]
    Exec[Action Builder - non-custodial action proposals]
  end

  API --> Rules --> Notif
  API --> Exec
  Exec -->|Prepare action proposal| UI
  UI -->|User reviews and approves| WK
  UI -->|Submit to network| SorobanRPC
```

## 2) Closer Look — Data Pipeline (Indexing → Snapshots → API)

This diagram zooms into the data path: sources feed a protocol-first adapter layer, data is normalized into unified entities, stored, and served to the dashboard.

```mermaid
flowchart LR
  subgraph Sources[Sources]
    H[Horizon API]
    S[Soroban RPC]
    P[Protocol APIs/SDKs]
    B[Bridge data - Allbridge]
  end

  subgraph Indexing[Indexing and Normalization]
    A[Adapter layer - protocol-first]
    N[Normalizer - unified entities]
    J[Jobs/Scheduler - run-once + periodic]
  end

  subgraph Storage[Storage]
    DB[(Postgres - Prisma)]
    Snap[Snapshots - time-windowed]
  end

  subgraph Serving[Serving]
    API[REST API]
    UI[Dashboard]
  end

  H --> A
  S --> A
  P --> A
  B --> A
  J --> A
  A --> N --> DB
  DB --> Snap --> API --> UI
```

## 3) Closer Look — Portfolio, Alerts, and Optional Actions

This diagram focuses on the user-facing loop: multi-wallet portfolio consolidation, alerting derived from snapshots/events, and optional action proposals approved by the user.

```mermaid
flowchart TB
  U[User] --> UI[Dashboard]

  UI --> WK[Stellar Wallets Kit]
  WK -->|Connected wallet addresses| UI

  UI --> API[API Gateway]
  API --> DB[(Postgres)]

  subgraph Portfolio[Portfolio]
    Port[Consolidation (multi-wallet overview)]
    Pos[Position resolvers (protocol-level)]
  end

  API --> Port
  Port --> DB
  Port --> Pos
  Pos --> DB

  subgraph Alerts[Alerts]
    Rules[Rule engine (thresholds + anomalies)]
    Feed[In-app alerts feed]
  end

  DB --> Rules --> Feed
  API --> Feed

  subgraph Actions[Optional actions (non-custodial)]
    Propose[Build action proposal (swap/deposit/withdraw where supported)]
    Review[User review + approval]
  end

  API --> Propose --> UI
  UI --> Review --> WK