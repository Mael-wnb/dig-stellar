# Dig Stellar — Runbooks

## Purpose
This document captures practical procedures used regularly during development and operations.

---

## Local development

### Start frontend
Document the exact command used in the repo.

### Start API
Document the exact command used in the repo.

### Start / run indexer scripts
Document the exact commands for each important script.

---

## Wallet troubleshooting
- how to test wallet connect flow
- how to test wallet overview endpoint
- how to refresh a wallet manually
- how to inspect `user_wallets`
- how to inspect `wallet_balance_snapshots`

---

## Database checks

### Connect with psql
Example:
```bash
psql "postgresql://dig:dig@localhost:5432/dig_stellar"
```

### Useful checks
- inspect wallet rows
- inspect latest wallet balance snapshots
- inspect latest protocol snapshots
- inspect freshness timestamps

---

## Prisma / schema regeneration
Document exactly:
- where the Prisma schema lives
- how to regenerate client
- common pitfalls already encountered

---

## Common debug situations
Examples:
- frontend is blank
- wallet connects but no data appears
- API starts but Prisma client is broken
- refresh script runs manually but not through API
- stale protocol data in UI
