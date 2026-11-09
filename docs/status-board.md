# Dig Stellar — Status Board

One page: the foundation, what shipped since, what is next. Every fact here comes from
`internal/status-board-archive.md` (the long-form board, frozen 2026-11-05) and the evidence
files linked per row; the archive keeps the per-deliverable detail and the dated notes.

Status vocabulary: `done` · `in_progress` · `planned` · `blocked` · `dropped`.
"Prod" is the git SHA reported by the production API `/health` when the row's evidence records
one; "on main" means merged into `main` and present in the production checkout without a
separate production capture.

Last updated: 2026-11-09 (Lot DOC6, reviewer-path wording).

## 1. Foundation (August 2026)

| Phase | Deliverables | Status | Completed | Detail |
|---|---|---|---|---|
| MVP | T1-D1 data indexing (Horizon + Soroban), T1-D2 analytics dashboard, T1-D3 transaction builder (testnet) | done | late July 2026 | [archive, "MVP"](internal/status-board-archive.md#tranche-1--mvp-reviewed-for-the-scf-20-disbursement) |
| Testnet | T2-D1 multi-wallet portfolio and active signer, T2-D2 in-app alerting, T2-D3 bridge-flow monitoring | done | early August 2026 | [archive, "Expansion"](internal/status-board-archive.md#tranche-2--expansion-internal-reviewed-later-for-the-30-disbursement) |
| Mainnet | T3-D1 mainnet deployment and freshness, T3-D2 non-custodial mainnet actions, T3-D3 observability, polish, reference hand-off | done | around 20 August 2026 | [archive, "Mainnet"](internal/status-board-archive.md#tranche-3--mainnet--operational-maturity-internal-reviewed-for-the-40-disbursement) |

Post-delivery note: the T2-D3 Allbridge integration was retired from the refresh pipeline and the
dashboard on 2026-11-03 (Lot PRE) after the venue wound down upstream in July 2026; its data,
API routes and adapter remain as a historical record.

## 2. Lots shipped since (2026-08-20 → 2026-11-05)

Public-facing statements per item: `post-grant-summary.md`.

| Lot | What | Status | Prod | Evidence |
|---|---|---|---|---|
| AA | Responsive overhaul: drawer shell, mobile pass, modals as bottom sheets | done (2026-08-20) | on main | `internal/evidence/lot-aa/aa4-close-out.md` |
| AB | Watch-only address as the first wallet, never promoted to signer | done (2026-08-20) | on main | `internal/evidence/lot-ab/ab-watch-only-first.md` |
| AC | Node 24 runtime on CI, VPS and Vercel | done (2026-08-21) | on main | `internal/evidence/lot-ac/ac4-close-out.md` |
| AD | CI/CD deploy pipeline: recon done, deploy gate not built | in_progress | on main (recon) | `internal/evidence/lot-ad/ad0-recon.md` |
| ST | Status page `#status` + `GET /v1/ops/status` | done (2026-09-05) | on main | `internal/evidence/status-page/01-lot-st-2026-09-04.md` |
| hotfix | Lending supplied side summed from the wrong column (series, top assets) | done (2026-09-28) | `18072ca` | `internal/evidence/hotfix-lending-supplied-side/README.md` |
| price v2 | Price sources v2: on-chain sources, max price age, Reflector primary; fresh-price rule in the alert evaluator | done (2026-10-15) | on main | `internal/evidence/price-sources-v2/00-recon.md` |
| S1 | Host network posture: loopback-only compose bindings, Docker firewall rule, rotated DB password | done (2026-09-29) | on main | `internal/evidence/lot-ad/s1-remediation-execution.md` |
| SEC G1 | Request validation, wallet-refresh admission, ops redaction, nginx wallet zones | done (2026-10-27) | on main | `internal/evidence/lot-sec/g1.md` |
| EP | Engagement module (in place, not announced): wallet-ownership proofs, award job; daily XLM rewards path isolated in `modules/rewards/`, dark by default | done (EP1–4 2026-10-21; EP5 on main 2026-11-08); activation is a founder decision | on main | `internal/evidence/lot-ep/00-recon.md`, `internal/evidence/lot-ep/ep5.md` |
| AN0 | Google Analytics 4, consent-first, six product events | done (2026-10-21) | on main | `internal/evidence/lot-an0/an0-implementation.md` |
| XO | XOXNO Lending as sixth protocol: 3 hubs, 25 markets, read-only | done (2026-10-30; `xoxno` fresh on prod `/health` 2026-11-04) | on main | `internal/evidence/lot-xo/00-recon-verification.md` |
| RP1 | Alert-sweep RPC calls 3,312 → 36 per run; per-method cost rows | done (2026-10-27) | on main | `internal/evidence/lot-rp/rp1-sweep-fix.md` |
| perf-pools | `GET /v1/pools` latency: partial swap index, statement rewrite, 90 s list cache | done (2026-10-30) | on main | `internal/evidence/perf-pools/README.md` |
| API | Public API v1 contract: OpenAPI 3.1, Scalar page, contract test (40 checks) | done (2026-11-03) | `de1b8bb` | `internal/evidence/lot-api/api5-prod-verification.md` |
| PRE | Pre-dossier fixes: bridge retired, TVL caption, Horizon calls, internal metrics route gated, native step exit code | done (closed 2026-11-05) | `14c8bb8` | `internal/evidence/lot-pre/pre3-recon.md` |
| DOC1 | Reviewer-facing docs: README, design-vs-as-built table, docs map, post-grant summary | done (2026-11-04) | on main (`438971f`) | `internal/evidence/lot-doc1/doc1-recon.md` |
| SDK0 | Vercel-preview CORS matcher + TypeScript SDK v0 (`@getdig/stellar-api`, not published) | done (2026-11-04) | `b34f07d` | `internal/evidence/lot-sdk/sdk0-build.md` |
| DOC2 | Internal material out of the reviewer path, one-page board, doc link check in CI | done (2026-11-05) | on main (`8f6e2b4`) | `internal/evidence/lot-doc2/` |
| SDK1 | SDK publish readiness (`@getdig/stellar-api` 0.1.0) + MCP server `@getdig/stellar-mcp` 0.1.0 (six read-only tools) | done (2026-11-07; both published on npm at 0.1.0) | on main | `internal/evidence/lot-sdk/sdk1-build.md` |

## 3. Next

| Item | What | Status |
|---|---|---|
| SEC Gate 2 | Second security gate (scope: founder brief) | planned |
| KEY | Access keys on the public API (not built today, `post-grant-summary.md` §3) | planned |
| DATA | Scope to be stated in the lot brief | planned |
| REC | Scope to be stated in the lot brief | planned |
| DOC2 follow-ups | `CLAUDE.md` test/CI and network-stats lines, `repo-structure.md` module map, `data-model.md` overview, `internal/history/final-report.md` Redis footnote, integration-track headers (`internal/evidence/lot-doc1/doc1-recon.md` §6) | planned |

## Update rule

Update when a lot changes status, lands in production (add the SHA) or is dropped; one row per
lot, facts only, the detail goes to the evidence file. Mirror any status change into `current-state.md`.
