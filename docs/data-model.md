# Data Model (Unified Schema)

This module normalizes Stellar and protocol data into a small set of entities used across analytics, portfolio monitoring, and alerting.

## Core entities
- **Protocol**
  - `key`, `name`, `category`
- **Venue**
  - A protocol-specific object such as `pool`, `market`, `vault`, `bridge` (and additional types as needed)
  - `key`, `type`, `label`, `meta`
  - Example keys:
    - `blend:pool:<poolId>`
    - `blend:reserve:<poolId>:<assetId>`
    - `horizon:network-activity`
- **Snapshot**
  - Time-windowed metrics for a venue at timestamp `ts`
  - Typical fields: `tvl/liquidity`, `volume`, `apy`, `utilization`, `inflow/outflow/netflow`, plus `data` (JSON)

## Portfolio entities
- **Position**
  - User exposure derived from protocol state/events
  - `walletAddress`, `protocolKey`, `venueKey`, `ts`, `exposure` (JSON)

## Alerting entities
- **Alert**
  - Triggered by snapshot deltas or event patterns
  - `walletAddress?`, `protocolKey?`, `venueKey?`, `ts`, `type`, `severity`, `payload?`

## Snapshot cadence
Metrics are computed into snapshots (e.g., every 5–15 minutes) to keep infrastructure costs predictable while enabling near real-time dashboards and in-app alerting.