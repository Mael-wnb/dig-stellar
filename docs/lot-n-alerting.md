# Lot N — Alerting Expansion (families + UX) — Implementation Brief

Execution brief for Claude Code. Expands the T2-D2 alerting from its single evaluated
family (wallet · health-factor) to the families the CURRENT data makes cheap, plus the
UX base (modal, rule management, feed). Founder-directed sprint, 2026-08-15 — deadline
tomorrow evening, so the sequencing below is a GRACEFUL-DEGRADATION order: every step
lands green and shippable on its own; stopping after any step leaves a coherent
product. Evidence: `docs/evidence/lot-n/`.

## Architecture rule (unchanged)

The T2-D2 shape stays: OS-cron sweep (82→81→83, `job:wallet-alert`), rules in
`alert_rules`, edge-detection state in `alert_rule_state` (fire on crossing, resolve
on return), one `notifications` row per edge. NO broker, NO in-process scheduler, no
new delivery channels (in-app only). New families are new evaluator functions over
the snapshot DB inside the existing sweep.

## Honesty rules (specific to alerts)

- A family is creatable in the UI IFF its evaluator actually runs — "soon" only for
  what remains genuinely unbuilt after this lot.
- Notification copy carries the OBSERVED value and its `as_of` ("XLM crossed $0.17 —
  $0.1712 at 14:32 UTC"), never just "your alert fired".
- Evaluation cadence = the sweep's cron cadence; say so in the modal ("checked every
  N minutes") — no pretense of real-time.

## N0 — Recon (30 min, report before code)

- `alert_rules` schema: how family/metric/threshold are encoded; what a new family
  needs (columns vs payload JSON).
- Evaluator structure (`81`/`83`): where a family plugs in; how edge state is keyed.
- Rule management today: can a rule be paused/deleted via API/UI? Mark-all-read?
- The modal's current "soon" families list (what we promise vs what we'll now build).
- For N3: where per-pool TVL history actually lives post-dead-reserves (batch
  recompute vs the `/series` logic) — pick the evaluator's source.

## N1 — UX base + PRICE alerts (the universal family)

**Price rule**: asset (vetted list = the assets `asset_prices` actually tracks),
direction (above/below), threshold USD. Evaluator: latest price vs threshold, edge
state on crossing, resolve on return. Fire copy: observed price + as_of.

**UX base (lands with N1):**
- Modal: family picker shows REAL families as creatable (HF + price now; N2-N4 join
  as they land); per-family config step; keep the 4-step structure, tighten copy.
- Rules list: pause/unpause + delete per rule (API additions if the recon finds them
  missing — same ownership pattern as the wallet ops).
- Feed/bell: deep-link each notification to its subject (pool page, portfolio for
  HF/wallet alerts); severity derived from payload (the T2 optional polish);
  mark-all-read if missing; relative times.

## N2 — POOL-STATUS alerts (zero-config, the Orbit story)

Not a user-created rule — an AUTOMATIC protection: when a Blend pool's status
changes (Active ↔ On-Ice ↔ Frozen), notify every user with a tracked-wallet position
in that pool. Mechanics:
- The sweep loads the 4 mainnet pools' status per run (PoolV2.load × 4 — cheap;
  reuse `derivePoolStatus` semantics from A5b, do not duplicate the mapping).
- Last-seen status persisted (small table or a synthetic `alert_rule_state` key —
  recon decides; first run seeds silently, no retroactive firing).
- On change: one notification per affected user ("YieldBlox pool status changed:
  Active → Frozen. Supplies are disabled; withdrawals remain available." — reuse the
  A5b status semantics in the copy).
- Surfaced in the Alerts page as a system rule ("Pool status — automatic, covers
  pools where you have a position") so its existence is visible and honest.

## N3 — POOL TVL-DROP alerts

User rule: pool (tracked pools list), drop threshold % over a 24h window. Evaluator
source per the N0 recon (latest complete snapshot batch vs the batch closest to 24h
ago — the dead-reserves batch filter applies; never compare across incomplete
batches). Fire copy: "Pool X TVL −12.4% over 24h ($8.0M → $7.0M)". Edge state on the
threshold crossing; resolve when back within threshold.

## N4 — APY-THRESHOLD alerts

User rule: pool + metric (supply APY; borrow APY for lending), direction, threshold %.
Evaluator on `pool_metrics_latest` with edge state. The "opportunity" family — lowest
risk-criticality, hence last.

## Sequencing & timebox

N0 → N1 → N2 → N3 → N4, STOP-and-report after each. Realistic total: 6-8h — if time
runs out, the cut line falls after whichever step last landed green; N1 alone is
already a visible product upgrade. Each step: builds + tests green (api 51 / web 111
baselines + new evaluator tests per family — red tests for edge detection: no
double-fire while beyond threshold, resolve edge, seed-run silence for N2), captures
to `docs/evidence/lot-n/`, founder commits.

## Deploy note (per step or at the end)

Evaluator changes ride `job:wallet-alert` (indexer-only: pull is enough); API/web per
the usual (build + PM2 restart / Vercel). If `alert_rules`/state need schema
additions, additive SQL in the v3 alerting file + apply on VPS.

## Out of scope

Email/push/webhook delivery · alert history page beyond the existing feed · per-user
cadence config · non-Blend position alerts · price sources beyond `asset_prices`.
