# Evidence index

One row per lot folder or top-level evidence file under `docs/evidence/`: what it supports, its
entry document, and whether it belongs to the SCF #43 grant era (tranches paid July–August 2026)
or to post-grant work. Nothing was moved or deleted to build this index (Lot API, 2026-11-03;
corpus figures from `lot-api/api0-recon.md` §B: 559 files, 73 MB, 97 % PNG/JPG, 0 broken links,
49 duplicate groups).

Era rule: first commit on or before the Tranche 4 validation (around 2026-08-20) = **grant**
(SCF #43); later = **post-grant**. Lots AA/AB/AC first landed on 2026-08-20 and are counted as
post-grant hardening, as the status board does.

| Folder / file | Supports | Entry document | Era |
|---|---|---|---|
| `analytics/` | Build-side intent of SDEX swap usage (T3-D2 adoption reading, 2026-08-17) | `analytics/swap-usage-2026-08-16.md` | grant |
| `dead-reserves-2026-08-14.md` | T1-D1 data correctness: TVL counted reserves the pools no longer had (fix 2026-08-14) | itself | grant |
| `hotfix-lending-supplied-side/` | 2026-09-28 hotfix: lending "supplied" side summed from the wrong column (series + top assets) | `hotfix-lending-supplied-side/README.md` | post-grant |
| `hotfix-xlm-price-fallback/` | 2026-09-29 XLM price fallback hotfix, origin of price-sources v2 | `hotfix-xlm-price-fallback/00-recon.md` | post-grant |
| `lot-a3-blend-withdraw.md` | T3-D2 Blend withdraw in-app (Lot A3), testnet evidence | itself | grant |
| `lot-a5-blend-multipool.md` | T3-D2 multi-pool Blend actions (Lot A5) | itself | grant |
| `lot-aa/` | Responsive / mobile hardening (AA0–AA4): breakage catalog, arbitration, close-out, 81 captures | `lot-aa/aa0-breakage-catalog.md` | post-grant |
| `lot-ab/` | Watch-only as first wallet (API mini-lot) | `lot-ab/ab-watch-only-first.md` | post-grant |
| `lot-ac/` | Node 24 upgrade (compat proof, execution, VPS runbook, close-out) | `lot-ac/ac0-compat.md` | post-grant |
| `lot-ad/` | CI/CD deploy pipeline recon + S1 Postgres-exposure remediation | `lot-ad/ad0-recon.md` | post-grant |
| `lot-an0/` | Google Analytics 4, consent-first (AN0) | `lot-an0/an0-implementation.md` | post-grant |
| `lot-api/` | Public API contract: recon, contract-test run, docs-page capture | `lot-api/api0-recon.md` | post-grant |
| `lot-b/` | T3-D1 freshness system + DeFindex onboarding | `lot-b/README.md` | grant |
| `lot-c/` | T3-D3 final UI polish: design-handoff port (shell, views, modals) | `lot-c/README.md` | grant |
| `lot-e/` | T3-D3 observability: `/health`, RPC metrics, adoption counters, reference quickstart; frozen-AMM-reserves hotfix | `lot-e/README.md` | grant |
| `lot-ep/` | Earn & Points campaign (EP0 recon, EP1–EP4 implementation, deploy notes, wallet matrix) | `lot-ep/00-recon.md` | post-grant |
| `lot-f/` | T3-D3 advisor-feedback polish (F1–F5): empty states, pair logos, underfunded-swap copy | `lot-f/advisor-feedback-2026-08-10.md` | grant |
| `lot-g/` | T3-D3 founder review 1 (G0–G4): network-TVL persistence + chart, quick wins, dashboard cleanup, adaptive pools table | `lot-g/G0-network-tvl-persistence.md` | grant |
| `lot-h/` | T3-D3 founder review 2 (H0–H7): flows coverage, position breakdown, chips + HF gauge | `lot-h/h0-flows-recon.md` | grant |
| `lot-n/` | T2-D2 alerting families beyond health factor (price, pool status, TVL drop, APY) | `lot-n/n0-recon.md` | grant |
| `lot-p/` | T1-D1 pool perimeter (inventory + local validation of the 19-pool seed) | `lot-p/p0-inventory.md` | grant |
| `lot-q/` | T3-D3 visual polish (logos/naming, frames, protocol cards, swaps24h) | `lot-q/q1-q2-logos-naming-2026-08-16.md` | grant |
| `lot-r/` | T3-D2 execution witness + reward faucet (R1–R4), 2026-08-17 prod incident | `lot-r/r1-witness.md` | grant |
| `lot-r2/` | Faucet campaign 2, per-family rewards, testnet end-to-end | `lot-r2/testnet-e2e.md` | grant |
| `lot-rp/` | RPC cost reconciliation + wallet-sweep fix (RP1) | `lot-rp/00-rpc-cost-recon.md` | post-grant |
| `lot-s/` | API edge hardening: public surface recon, nginx rate limits, pm2 supervision | `lot-s/s0-surface-recon.md` | grant |
| `lot-sec/` | Request validation + refresh admission + ops redaction (SEC Gate 1), nginx wallet zones | `lot-sec/g1.md` | post-grant |
| `lot-w/` | T2-D1 wallet management: account model, identity attach, labels / assets / breakdown | `lot-w/W0-account-model-recon.md` | grant |
| `lot-xo/` | XOXNO Lending onboarding (XO-1): recon verification, build and RPC call budget | `lot-xo/00-recon-verification.md` | post-grant |
| `lot-z/` | T3-D3 reference Docker compose proven from a clean clone | `lot-z/z1-compose-fresh-clone.md` | grant |
| `mainnet-ungating-2026-08-02.md` | T3-D2 mainnet actions ungating | itself | grant |
| `pair-vetting-2026-08-01.md` | T3-D2 mainnet SDEX pair vetting | itself | grant |
| `perf-pools/` | `GET /v1/pools` latency: partial swap index + 90 s list cache, EXPLAIN before/after | `perf-pools/README.md` | post-grant |
| `price-sources-v2/` | Price sources v2 (phases A1, A2, B): reference prices, cross-check, stablecoin mcap diagnosis | `price-sources-v2/00-recon.md` | post-grant |
| `status-page/` | Lot ST status page (`/v1/ops/status`, `#status`) | `status-page/00-recon-2026-09-03.md` | post-grant |
| `t3-d2-mainnet-actions.md` | T3-D2 mainnet actions: transaction evidence (2026-08-14) | itself | grant |

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
