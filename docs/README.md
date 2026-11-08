# Docs map

How the documentation of Dig Stellar is organised, which document wins when two disagree, who
keeps each one current, and the order a reviewer should read them in. Written 2026-11-04
(Lot DOC1), internal material moved under `internal/` on 2026-11-05 (Lot DOC2); the inventory
behind it is `docs/internal/evidence/lot-doc1/doc1-recon.md` §R3.

## Reading order for a reviewer

1. `post-grant-summary.md`: what shipped after the grant and where it is going (state at
   2026-11-08).
2. `status-board.md`: one page, where every tranche and lot stands, with its "Last updated" line.
3. `current-state.md`: the detailed as-built reality behind each status line.
4. `internal/evidence/README.md`: the index of proofs (captures, command outputs, transaction
   hashes, incident notes); its first section maps each public claim to its entry document.
5. `decisions/`: the founder rulings that shaped the numbers (network TVL definition, points
   without monetary value, XOXNO pricing, public API surface).
6. `runbooks.md`: how the system is operated day to day.

Then, as needed: `security-invariants.md` for the action and money paths, `api/README.md` for
the public HTTP contract, `reference-deployment.md` to run the stack, and
`TECHNICAL_ARCHITECTURE.md` for the original design, read through its banner.

`internal/` holds the working documents and the proof corpus (execution briefs, evidence, the
archived long-form status board, recon probes); it is kept so that claims stay inspectable, not
written for reviewers (`internal/README.md`).

## Source-of-truth rank

When two documents disagree on a fact, the higher rank wins and the lower one is the drift
to fix. Rank 0 is not a document: the code, the SQL files and the production API.

| Rank | Source | Wins on |
|---|---|---|
| 0 | Code (`apps/*`), schema (`apps/api/src/db/stellar_v*.sql`), production API (`/health`, `/v1/*`) | everything |
| 1 | `CLAUDE.md` "Data architecture (as-built)" + `repo-structure.md` | what exists and where it lives |
| 2 | `status-board.md` (detail: `internal/status-board-archive.md`) | current status and dates of deliverables and lots |
| 3 | `current-state.md` | the detailed behaviour behind a status line |
| 4 | `decisions/*.md` | why a number or a rule is what it is |
| 5 | `security-invariants.md`, `api/README.md` + `apps/api/openapi/openapi.v1.yaml`, `runbooks.md`, `deployment.md`, `reference-deployment.md` | their own domain (security, HTTP contract, operations) |
| 6 | `internal/evidence/**` | the facts of a given date; never updated afterwards |
| 7 | `grant-roadmap.md`, `final-report.md` | the SCF #43 contract and its closing report, historical |
| 8 | `TECHNICAL_ARCHITECTURE.md` | design intent only; its "Design vs as-built" table lists where the build diverged |

## Every document

| Document | Purpose | Current? | Update owner | Read by |
|---|---|---|---|---|
| `post-grant-summary.md` | What shipped after the grant and where it is going, for reviewers | dated snapshot (2026-11-08); refreshed per application window | Claude Code at task completion | reviewer |
| `status-board.md` | One-page board: grant tranches, post-grant lots, next; the long-form history is `internal/status-board-archive.md` (frozen 2026-11-05) | maintained | Claude Code at task completion, founder on rulings | reviewer, founder |
| `current-state.md` | Detailed as-built reality, what is partial or fragile | maintained | Claude Code at task completion | reviewer, contributor |
| `repo-structure.md` | Navigation map of the monorepo | maintained; the alerts, ops, actions, campaign, faucet and auth modules are not mapped yet (DOC2) | Claude Code on structural change | contributor |
| `data-model.md` | Raw SQL schema families as built | maintained | Claude Code on schema change | contributor |
| `decisions/` | One file per founder ruling, dated, with status | append-only | founder (ruling), Claude Code (implementation status line) | reviewer |
| `runbooks.md` | Operating procedures: Node, cron lines, SQL apply order, campaign, API contract | maintained | Claude Code on procedure change, founder on VPS facts | operator |
| `deployment.md` | VPS shape, nginx hardening, per-lot deploy sequences | maintained | Claude Code (sequences), founder (what was actually deployed) | operator |
| `reference-deployment.md` | Proven quickstart: compose path and host-pnpm path | maintained; re-proven from a fresh clone on 2026-08-13 and 2026-08-18 | Claude Code | reviewer, operator |
| `security-invariants.md` | Security contract for mainnet actions, beta access model, money path, ownership proofs | maintained; reviewed before any action-path change | Claude Code, founder sign-off | reviewer, contributor |
| `api/README.md`, `api/CHANGELOG.md` | Public HTTP contract: where it lives, Scalar pin, contract test, changes | maintained | Claude Code on contract change | API consumers, reviewer |
| `internal/evidence/README.md` + `internal/evidence/**` | Proof corpus index and the proofs; from Lot DOC2 one file per lot, ≤ 80 lines (`delivery-playbook.md`, "Evidence") | index maintained; proofs frozen at their date | Claude Code at task completion | reviewer (through the index), contributor |
| `grant-roadmap.md` | SCF #43 criteria verbatim + interpretation | closed (grant complete August 2026) | founder | reviewer (grant history) |
| `final-report.md` | Tranche 4 final report to SDF | historical, not edited | founder | reviewer (grant history) |
| `TECHNICAL_ARCHITECTURE.md` | June 2026 design document with a design-vs-as-built banner and table | design frozen; table dated 2026-11 | Claude Code (table), founder (design) | reviewer |
| `integrationtrack/` | SCF #46 integration-track application: scope overview (`README.md`), architecture of the next layer (`ARCHITECTURE.md`, incl. the Circle CCTP flow), deliverables with completion criteria (`milestones.md`) | maintained; dates set with the SCF advisor | founder (content), Claude Code (sync with the as-built system) | reviewer |
| `delivery-playbook.md` | Standard workflow and branch discipline | maintained | founder | contributor |
| `ai-guidelines.md` | How AI is used on the project | maintained | founder | contributor |
| `internal/briefs/`, `internal/alerting/` | Execution briefs per lot (dated in their first paragraph), T2-D2 recon probes | historical | none | contributor |

## Conventions

- Repo artifacts are in English; chat may be in French.
- A status change is mirrored in `status-board.md` and `current-state.md` in the same change,
  with brutal clarity over optimism.
- Every number in a doc traces to a command, a capture, a hash or a dated evidence file.
- "Contract" in the API documents means the HTTP API contract, never a smart contract.
