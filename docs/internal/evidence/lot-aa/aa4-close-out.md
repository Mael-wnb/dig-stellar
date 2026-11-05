# AA4 — Lot AA close-out (final QA + evidence)

Date: 2026-08-20 · Lot AA shipped in three founder-validated merges:
AA1 shell (`4210d5d`), AA2 views (`b72e2f2`), AA3 modals (`2101493`, rebased
over Lot AB `3618c03`). Every merge went through the §1 gates (branch → build +
tests → CI on the pushed branch → smoke → Vercel Preview → founder real-iPhone
"go" → FF → both remotes).

## Definition of done — measured

- **All 5 views + 3 modals usable at 390px; no blocking catalog item open.**
  Final re-sweep on the shipped tree (`captures/aa4/`, sweep tooling identical
  to AA0): **81 capture records** at 390×844 / 768×1024 / 1024×768 ×
  connected/disconnected × campaign **live** and **ended** —
  **zero horizontal-overflow elements, zero console errors** (the AA0 baseline
  had a blocking shell at 390 and a local-env 403 artifact; both gone —
  `findings-live.json` / `findings-ended.json`).
- **Desktop unchanged:** screenshot-diff evidence per sub-lot
  (`captures/aa1|aa2|aa3/desktop-diff/` — 0 differing pixels except live-data
  drift: countdown seconds, metric ticks).
- **Widgets/validators diff: 0 lines** across the whole lot (verified per
  sub-lot with `git diff` on the widget + validator files); flags regime
  untouched. The one API change the lot needed was **scoped OUT to Lot AB** —
  Lot AA itself kept a zero-API-change invariant.
- **Campaign states:** live + ended reproduced locally for every merge that
  touched the banner render path (AA2) and in the final sweep; the 2026-08-17
  incident class never reproduced. Post-action claim-panel states remain
  covered by the panel's own bounded state machine (R3c) — not re-verified
  headless; campaign 2 had ended before AA3 (gate condition).
- **Real-device passes (founder, iPhone Safari):** AA1 go · AA2 go · AA3 go.
- **AA0-a verdict applied:** consultation-first confirmed on device → the
  ConnectModal now presents watch-only as the primary mobile entry (Lot AB
  minting) with honest signing copy; the planned "witnessed mainnet tx signed
  from mobile" evidence piece is **not claimable** (mobile signing unreliable)
  and is explicitly dropped, per the brief's negative-verdict branch.

## Before / after

- Before: `captures/aa0/` (blocking shell at 390; catalog:
  `aa0-breakage-catalog.md`). After: `captures/aa4/` + per-sub-lot captures.

## Docs synced in this close-out

- `status-board.md` — responsive debt line cleared (T1-D2 gap cell + risks list).
- `current-state.md` — web "partial/weak" updated; Lot AA/AB summary added;
  priorities renumbered.
- `delivery-playbook.md` — §1 Workflow Rules recorded as STANDING policy
  (+ the Lot AB deploy-order rule).

## Remaining outside this repo (founder / VPS)

- [ ] Remove the branch-preview origin from VPS `CORS_ORIGINS`
  (`aa4-cleanup-notes.md`) — the branch is deleted; founder runs this on the VPS.
- [x] VPS API deploy of Lot AB (`3618c03`) — DONE by the founder BEFORE the AA3
  go (health verified: version `3618c03`, db ok; `allbridge` freshness null is
  expected-dormant — see the /health note in `docs/runbooks.md`). The §1
  deploy-order rule was respected; watch-only-first is live in prod.
