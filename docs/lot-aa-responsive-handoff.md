# Lot AA — Mobile Responsive Pass — Handoff Brief

Repo: `~/Documents/Eon/Dig/dig-stellar` · Owner app: `apps/web` only (no API/indexer changes)
Branch: `feat/responsive` · Evidence: `docs/evidence/lot-aa/`

Claude Code: as usual, you may override implementation details in this brief when the
actual codebase shows a better path — but the Workflow Rules (§1) and Invariants (§2)
are **not overridable**. Flag conflicts instead of silently deviating.

## 0. Context

- Tranche 4 is submitted (form + video + final report). SCF reviewers may open
  stellar.getdig.ai at any time during review, including from phones. The app is
  currently hard to use on mobile (fixed sidebar, no mobile shell).
- Faucet campaign 2 is LIVE (60-claim budget, per-family anti-sybil rule). Campaign
  traffic comes from Discord/Twitter → majority mobile. Every mobile visitor who
  bounces on a broken layout is a lost claim and a lost witnessed tx.
- Lot Z (reference compose) and the style pass are merged and deployed. This
  responsive pass is the main remaining UI debt.
- Cautionary tale: the 2026-08-17 prod incident — a promo note inserted mid
  v-if/v-else chain hid the entire Blend supply form only when a campaign was live.
  Layout work during a live campaign must explicitly test campaign-live states.

## 1. Workflow Rules — NEW STANDING DISCIPLINE (applies to this lot and all future lots)

The app is released, in SCF review, and running a live incentive campaign.
Direct-to-main is over.

1. **Never commit or push to `main` directly.** All work happens on `feat/responsive`
   (sub-branches per sub-lot allowed: `feat/responsive-aa1`, etc., merged into
   `feat/responsive`).
2. **Merge to `main` only after ALL of:**
   - `pnpm -C apps/web build` green + full test suite green (49 tests) locally;
   - CI workflow (`.github/workflows/ci.yml`) green on the pushed branch;
   - local smoke test at 390×844, 768×1024, 1440×900 (checklist per sub-lot below);
   - founder validation on the Vercel Preview URL (see rule 3) — explicit "go" in chat.
3. **Vercel Preview for real-device validation:** push `feat/responsive` to
   `public-origin` (Mael-wnb/dig-stellar) to trigger a branch Preview deployment. The
   founder tests the preview URL on a real iPhone (Safari, cellular) before any merge.
   This is the primary validation gate for this lot — emulation does not catch
   dvh/keyboard/momentum-scroll issues.
4. **Merges:** fast-forward into `main`, then push BOTH remotes (`origin` +
   `public-origin`). Remember: pushing `main` to `public-origin` is the prod frontend
   deploy.
5. **Campaign freeze rule:** while a faucet campaign is live, no merge that touches
   ActionModal, the campaign card, the claim panel, or any component in their render
   path — unless every campaign state has been reproduced and verified locally first
   (see AA3 gate).
6. If a hotfix on `main` is genuinely needed mid-lot, it gets its own `fix/*` branch
   and the same preview validation — rebase `feat/responsive` on top afterward.

## 2. Invariants (unchanged from prior lots — zero tolerance)

- SDEX-swap / Blend-deposit widgets and XDR validators: **0 lines changed**.
  Responsive adaptation happens on containers/wrappers only. If a widget overflows on
  mobile, fix its wrapper, never the widget. The review gate is the same as Lots C/H:
  script diff on widget files must be empty.
- No router. `useView` + hash sync stays as-is. Responsive = CSS/layout, not
  navigation logic.
- Design tokens stay in `src/style.css` (`--dig-*`); responsive behavior uses standard
  Tailwind breakpoints (sm/md/lg), no scattered magic values.
- Modals keep their `<body>` teleport (Lot H1). Do not re-wrap them.
- Use `dvh` (not `vh`) for any full-height mobile surface — iOS Safari dynamic
  address bar.
- Touch targets ≥ 44×44px on all interactive controls.
- Flags regime, whitelists, campaign server logic: untouched.

## Sub-lots

### AA0 — Recon (read-only, no code changes) — DO THIS FIRST

**AA0-a: Mobile signing path recon.** Determine what Stellar Wallets Kit actually
supports on mobile browsers today:

- Which wallets are reachable from iOS Safari / Android Chrome? (xBull mobile, Lobstr,
  Albedo web, WalletConnect, HOT — Freighter is desktop-extension-only.)
- Test the real connect flow from a phone against the current prod app or a preview
  build.
- Verdict shapes the lot:
  - Mobile signing works → ConnectModal + ActionModal mobile UX is high priority
    (campaign conversion); a witnessed mainnet tx signed from mobile becomes a target
    evidence piece.
  - Mobile signing doesn't work / is fragile → the lot is consultation-first, and
    ConnectModal must show an honest "signing currently requires a desktop wallet"
    state on mobile instead of a silently failing flow.
- Write the verdict to `docs/evidence/lot-aa/aa0-mobile-signing.md`.

**AA0-b: Breakage catalog.** Headless-CDP sweep at 390×844, 768×1024, 1024×768 across:

- all 5 views (Dashboard, Protocols, Pool detail, Portfolio, Alerts);
- all 3 modals (Connect, AlertRule, Action — both swap and Blend tabs);
- connected AND disconnected states;
- campaign-live states: campaign card, claim panel in each of its states, countdown,
  campaign-ended (reproduce locally via `FAUCET_ENDS_AT` flag — do not test against
  prod);
- newer surfaces: hero TVL curve (G4), YourPositionsPanel (H2), adaptive pools table
  (G3), TokenSelect drop-up behavior in a constrained viewport.

Screenshot every breakage; classify: blocking (unusable) / degraded (usable but bad) /
cosmetic. Output: `docs/evidence/lot-aa/aa0-breakage-catalog.md` + captures.

**Stop after AA0 and report** — the founder arbitrates AA2 table decisions on this
catalog.

### AA1 — Shell (the "unusable" fix — ship this fast, alone)

- Below `lg`: sidebar becomes an off-canvas drawer (overlay + backdrop), opened by a
  burger in the topbar. Reuse the existing sidebar component content as-is inside the
  drawer — no bottom nav (out of scope).
- Topbar mobile compaction: burger + logo + bell + condensed connect. If the signer
  selector doesn't fit, it moves into the drawer.
- Drawer behavior: body scroll-lock while open; closes on navigation, Esc, backdrop
  click.
- Does NOT touch ActionModal / campaign surfaces → safe to merge during the live
  campaign (after the §1 validation gates).
- Smoke checklist: drawer open/close on all 5 views; no horizontal overflow at 390px;
  desktop ≥ `lg` pixel-identical to current prod (screenshot diff on the 3 main views).
- Merge and deploy AA1 as soon as validated — every campaign day without it costs
  traffic.

### AA2 — Views

Driven by the AA0-b catalog; expected items:

- Dashboard: verify the H2 two-panel stack (<1100px) holds at 390px;
  padding/typography pass.
- Protocols / pools tables: default = `overflow-x-auto` + sticky first column (zero
  data-logic change). Card variant only where the catalog shows horizontal scroll is
  genuinely unreadable — founder arbitrates per surface, not globally.
- Portfolio: wallet cards single-column; the ⋯ wallet-management menu must be
  tap-friendly (verify it is not hover-dependent).
- Alerts + Pool detail: chart/table/feed stacking; freshness chips wrap cleanly.
- Hero TVL curve: legible at 390px (axis labels, methodology footnote).

### AA3 — Modals & action surfaces — GATED

Gate: campaign 2 has ended, OR every campaign-live state is reproduced locally and
verified in the new layout before merge. This is where the 2026-08-17 incident class
lives.

- Below `sm`: the 3 modals render as full-height sheets (`inset-x-0 bottom-0`,
  `max-h-[100dvh]`, inner scroll — extend the H1 `max-h-[90vh]` inner-scroll pattern).
- ActionModal: wrapper adapts; embedded widgets byte-identical. Verify TokenSelect's
  space-constrained drop-up inside a sheet.
- ConnectModal: apply the AA0-a verdict (honest mobile-signing state if needed).
- Virtual-keyboard check: amount fields must stay visible with the keyboard open (iOS).

### AA4 — QA + evidence + docs

- Re-sweep CDP at the 3 viewports: zero horizontal overflow, zero console errors, all
  loading/stale/error/empty states legible, campaign states included.
- Real-device pass on the founder's iPhone via the Vercel Preview (Safari, cellular):
  dvh behavior, momentum scroll, keyboard, drawer feel.
- If AA0-a positive: one witnessed mainnet tx signed from mobile → capture as evidence
  (double value: responsive proof + KPI tx).
- Before/after captures per view → `docs/evidence/lot-aa/`.
- Update `current-state.md`, `status-board.md` (responsive debt line), and add the §1
  Workflow Rules to `delivery-playbook.md` as standing policy.

## Explicitly out of scope

PWA/manifest, bottom navigation, swipe gestures, generalized table→card refactor,
mobile perf work (bundle splitting), <360px support, any API/indexer change.

## Definition of done (lot level)

- All 5 views + 3 modals usable at 390px with no blocking item from the AA0 catalog
  left open.
- Desktop unchanged (screenshot-diff evidence).
- Widgets/validators diff empty; flags untouched.
- All merges went through the §1 gates (branch → CI → preview → founder go → FF →
  both remotes).
- Evidence folder complete; docs updated.
