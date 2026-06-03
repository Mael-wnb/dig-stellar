# Dig Stellar — Deployment

## Purpose
Describe the target deployment shape for Dig Stellar beta and how to operate it.

---

## Recommended beta architecture

### Frontend
- deploy `apps/web` on Vercel

### Backend
- deploy `apps/api` on a VPS or equivalent server runtime

### Indexer / jobs
- run `apps/indexer` on the same VPS or another controlled environment
- use cron or equivalent scheduler for refresh jobs

---

## Why this architecture
- Vercel is convenient for the frontend
- API and indexer benefit from a more controllable runtime
- cron and script execution are easier to reason about outside frontend hosting

---

## Deployment principles
- keep environments explicit
- front should only call the deployed API
- indexer should be runnable independently of user traffic
- API should expose a health endpoint

---

## Environment variables
Document separately for:
- web
- api
- indexer

Include only what is actually required.

---

## Operational goals for beta
- frontend is reachable and stable
- API is reachable and stable
- data refresh jobs run without manual babysitting
- stale or failing sources can be diagnosed quickly

---

## Future additions
Later, this doc should include:
- exact hosting layout
- process manager strategy
- cron schedule details
- deployment commands
- rollback notes
