# Evidence index

## Evidence behind public claims

Each public statement (the foundation criteria by phase, the items of `docs/post-grant-summary.md`)
and the entry document that supports it. Paths are relative to this folder.

| Public claim | Entry document(s) |
|---|---|
| Foundation Phase 1 (MVP: indexing, dashboard, testnet builder) | `../status-board-archive.md` "Phase 1 — MVP" (tx hashes inline); `lot-p/p0-inventory.md` (pool perimeter) |
| Foundation Phase 2 (multi-wallet, alerting, bridge flows) | `../status-board-archive.md` "Phase 2 — Expansion"; `lot-w/W0-account-model-recon.md`; `lot-n/n0-recon.md` |
| Foundation Phase 3 (mainnet, freshness, actions, observability, reference hand-off) | `t3-d2-mainnet-actions.md`; `lot-b/README.md`; `lot-e/README.md`; `lot-z/z1-compose-fresh-clone.md` |
| Summary §3.1 protocol integrations: XOXNO, price sources v2, lending hotfix | `lot-xo/00-recon-verification.md`; `price-sources-v2/06-phase-b-prod-verification.md`; `hotfix-lending-supplied-side/README.md` |
| Summary §3.2 public API v1 contract | `lot-api/api5-prod-verification.md`; `lot-api/api2-contract-test.md` |
| Summary §3.3 operational maturity: PRE, RP1, status page, Node 24 | `lot-pre/pre3-recon.md`; `lot-rp/rp1-sweep-fix.md`; `status-page/01-lot-st-2026-09-04.md`; `lot-ac/ac4-close-out.md` |
| Summary §3.4 security: SEC Gate 1, S1 host posture, ownership proofs | `lot-sec/g1.md`; `lot-ad/s1-remediation-execution.md`; `lot-ep/ep1-wallet-matrix.md` |
| Summary §3.5 `GET /v1/pools` latency | `perf-pools/README.md` |
| Summary §3.6 product: Earn & Points, analytics, watch-only first, responsive | `lot-ep/00-recon.md`; `lot-an0/an0-implementation.md`; `lot-ab/ab-watch-only-first.md`; `lot-aa/aa4-close-out.md` |
| Summary §3.7 deployment discipline: CI, deploy sequences, reference compose | `lot-ac/ac4-close-out.md`; `lot-ad/ad0-recon.md`; `lot-z/z1-compose-fresh-clone.md` |
| Lot DOC1 / DOC2 docs work | `lot-doc1/doc1-recon.md`; `lot-doc2/doc2-light.md` |

## Full index

One row per lot folder or top-level evidence file under `docs/internal/evidence/`: what it supports, its
entry document, and whether it belongs to the foundation era (phases closed July–August 2026)
or to the production era since. Nothing was moved or deleted to build this index (Lot API, 2026-11-03; the whole tree moved intact
from docs/evidence to `docs/internal/evidence/` in Lot DOC2, 2026-11-05;
corpus figures from `lot-api/api0-recon.md` §B: 559 files, 73 MB, 97 % PNG/JPG, 0 broken links,
49 duplicate groups).

Era rule: first commit on or before the Phase 3 validation (around 2026-08-20) = **foundation**;
later = **production**. Lots AA/AB/AC first landed on 2026-08-20 and are counted as
production hardening, as the status board does.

| Folder / file | Supports | Entry document | Era |
|---|---|---|---|
| `analytics/` | Build-side intent of SDEX swap usage (T3-D2 adoption reading, 2026-08-17) | `analytics/swap-usage-2026-08-16.md` | foundation |
| `dead-reserves-2026-08-14.md` | T1-D1 data correctness: TVL counted reserves the pools no longer had (fix 2026-08-14) | itself | foundation |
| `hotfix-lending-supplied-side/` | 2026-09-28 hotfix: lending "supplied" side summed from the wrong column (series + top assets) | `hotfix-lending-supplied-side/README.md` | production |
| `hotfix-xlm-price-fallback/` | 2026-09-29 XLM price fallback hotfix, origin of price-sources v2 | `hotfix-xlm-price-fallback/00-recon.md` | production |
| `lot-a3-blend-withdraw.md` | T3-D2 Blend withdraw in-app (Lot A3), testnet evidence | itself | foundation |
| `lot-a5-blend-multipool.md` | T3-D2 multi-pool Blend actions (Lot A5) | itself | foundation |
| `lot-aa/` | Responsive / mobile hardening (AA0–AA4): breakage catalog, arbitration, close-out, 81 captures | `lot-aa/aa0-breakage-catalog.md` | production |
| `lot-ab/` | Watch-only as first wallet (API mini-lot) | `lot-ab/ab-watch-only-first.md` | production |
| `lot-ac/` | Node 24 upgrade (compat proof, execution, VPS runbook, close-out) | `lot-ac/ac0-compat.md` | production |
| `lot-ad/` | CI/CD deploy pipeline recon + S1 Postgres-exposure remediation | `lot-ad/ad0-recon.md` | production |
| `lot-an0/` | Google Analytics 4, consent-first (AN0) | `lot-an0/an0-implementation.md` | production |
| `lot-api/` | Public API contract: recon, contract-test run, docs-page capture | `lot-api/api0-recon.md` | production |
| `lot-b/` | T3-D1 freshness system + DeFindex onboarding | `lot-b/README.md` | foundation |
| `lot-c/` | T3-D3 final UI polish: design-handoff port (shell, views, modals) | `lot-c/README.md` | foundation |
| `lot-doc1/` | Reviewer-facing docs before the application window: README rewrite, architecture design-vs-as-built table, docs map, drift fixes | `lot-doc1/doc1-recon.md` | production |
| `lot-e/` | T3-D3 observability: `/health`, RPC metrics, adoption counters, reference quickstart; frozen-AMM-reserves hotfix | `lot-e/README.md` | foundation |
| `lot-ep/` | Earn & Points campaign (EP0 recon, EP1–EP4 implementation, deploy notes, wallet matrix, EP5 in progress) | `lot-ep/00-recon.md` | production |
| `lot-f/` | T3-D3 advisor-feedback polish (F1–F5): empty states, pair logos, underfunded-swap copy | `lot-f/advisor-feedback-2026-08-10.md` | foundation |
| `lot-g/` | T3-D3 founder review 1 (G0–G4): network-TVL persistence + chart, quick wins, dashboard cleanup, adaptive pools table | `lot-g/G0-network-tvl-persistence.md` | foundation |
| `lot-h/` | T3-D3 founder review 2 (H0–H7): flows coverage, position breakdown, chips + HF gauge | `lot-h/h0-flows-recon.md` | foundation |
| `lot-n/` | T2-D2 alerting families beyond health factor (price, pool status, TVL drop, APY) | `lot-n/n0-recon.md` | foundation |
| `lot-p/` | T1-D1 pool perimeter (inventory + local validation of the 19-pool seed) | `lot-p/p0-inventory.md` | foundation |
| `lot-q/` | T3-D3 visual polish (logos/naming, frames, protocol cards, swaps24h) | `lot-q/q1-q2-logos-naming-2026-08-16.md` | foundation |
| `lot-r/` | T3-D2 execution witness + reward faucet (R1–R4), 2026-08-17 prod incident | `lot-r/r1-witness.md` | foundation |
| `lot-r2/` | Faucet campaign 2, per-family rewards, testnet end-to-end | `lot-r2/testnet-e2e.md` | foundation |
| `lot-rp/` | RPC cost reconciliation + wallet-sweep fix (RP1) | `lot-rp/00-rpc-cost-recon.md` | production |
| `lot-s/` | API edge hardening: public surface recon, nginx rate limits, pm2 supervision | `lot-s/s0-surface-recon.md` | foundation |
| `lot-sec/` | Request validation + refresh admission + ops redaction (SEC Gate 1), nginx wallet zones | `lot-sec/g1.md` | production |
| `lot-w/` | T2-D1 wallet management: account model, identity attach, labels / assets / breakdown | `lot-w/W0-account-model-recon.md` | foundation |
| `lot-xo/` | XOXNO Lending onboarding (XO-1): recon verification, build and RPC call budget | `lot-xo/00-recon-verification.md` | production |
| `lot-z/` | T3-D3 reference Docker compose proven from a clean clone | `lot-z/z1-compose-fresh-clone.md` | foundation |
| `mainnet-ungating-2026-08-02.md` | T3-D2 mainnet actions ungating | itself | foundation |
| `pair-vetting-2026-08-01.md` | T3-D2 mainnet SDEX pair vetting | itself | foundation |
| `perf-pools/` | `GET /v1/pools` latency: partial swap index + 90 s list cache, EXPLAIN before/after | `perf-pools/README.md` | production |
| `price-sources-v2/` | Price sources v2 (phases A1, A2, B): reference prices, cross-check, stablecoin mcap diagnosis | `price-sources-v2/00-recon.md` | production |
| `status-page/` | Lot ST status page (`/v1/ops/status`, `#status`) | `status-page/00-recon-2026-09-03.md` | production |
| `t3-d2-mainnet-actions.md` | T3-D2 mainnet actions: transaction evidence (2026-08-14) | itself | foundation |

## Markdown files without an inbound link

The recon (`lot-api/api0-recon.md` §B.10) found these 30 Markdown files referenced by no other
document in `docs/`. They are kept as they are; this index is their first inbound link. The
figure "26" in the recon's §B.10 summary undercounted the list it printed.

| File | Flag |
|---|---|
| `lot-aa/aa2-arbitration.md`, `lot-aa/aa4-close-out.md` | no inbound link |
| `lot-ab/ab-watch-only-first.md` | no inbound link (entry document above) |
| `lot-ep/ep1-implementation.md`, `lot-ep/ep2-implementation.md`, `lot-ep/ep3-implementation.md` | no inbound link |
| `lot-f/f4-empty-states-2026-08-10.md`, `lot-f/f5-pair-logos-2026-08-12.md` | no inbound link |
| `lot-g/G0-network-tvl-persistence.md`, `lot-g/G1-quick-wins.md`, `lot-g/G2-dashboard-cleanup.md`, `lot-g/G3-adaptive-pools-table.md`, `lot-g/G4-network-tvl-chart.md`, `lot-g/G4-phase1-recon.md` | no inbound link (G0 is the entry document above) |
| `lot-n/n0-recon.md`, `lot-n/n1-price-family.md`, `lot-n/n2-pool-status.md`, `lot-n/n3-tvl-drop.md`, `lot-n/n4-apy-threshold.md` | no inbound link (n0 is the entry document above) |
| `lot-p/p0-inventory.md`, `lot-p/p1-p2-local-validation.md` | no inbound link (p0 is the entry document above) |
| `lot-r/r2-claims.md`, `lot-r/r3b-promo.md` | no inbound link |
| `lot-w/W0-account-model-recon.md`, `lot-w/W2-W3-W4-labels-assets-breakdown.md` | no inbound link (W0 is the entry document above) |
| `lot-xo/xo1-build-and-calls.md` | no inbound link |
| `price-sources-v2/01-phase-a1-implementation.md`, `price-sources-v2/03-phase-a1-prod-verification.md`, `price-sources-v2/06-phase-b-prod-verification.md` | no inbound link |
| `status-page/01-lot-st-2026-09-04.md` | no inbound link |

## Housekeeping candidates (not done)

- 49 groups of byte-identical files (113 files, 101 of them under `lot-aa/captures/`): smoke
  captures re-saved across AA2/AA3/AA4 and identical before/after pairs.
- The four `lot-f/f5-pairlogo-*.png` and `lot-c/c*.png` screenshots are 0.7–1.5 MB each.
- Six lots are a single top-level file rather than a folder (listed above as "itself").
