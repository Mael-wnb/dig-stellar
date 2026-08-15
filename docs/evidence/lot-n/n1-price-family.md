# Lot N — N1 Evidence: PRICE family + UX base (2026-08-15)

All five confirmed N0 decisions implemented. Builds + tests green: **api 64/64**
(51 baseline + 13 new family/dispatch/copy specs), **web 111/111**, `nest build` and
`vue-tsc && vite build` clean. Live end-to-end smoke passed on the local stack.

## Backend

- **SQL (additive, idempotent, applied locally)** — `stellar_v3_alerting.sql`:
  metric CHECK widened to `('health_factor','price')`; `alert_rules.asset_id uuid`
  (typed column, no FK — same convention as `pool_entity_id`); new
  `alert_rule_subject_state (rule_id, subject_key)` for wallet-less families.
  **VPS: re-apply the v3 file with `psql -f` before the next sweep.**
- **Family dispatch (FIRST change)** — `modules/alerts/families.ts`:
  `partitionRulesByFamily()`; script 83 now routes health_factor rules to the
  health evaluator, price rules to the price evaluator, and skips unknown
  metrics loudly. Cross-family red tests in `families.spec.ts` (price never
  enters the HF bucket and vice versa).
- **Price evaluator** (in 83, reusing the pure `evaluate()` state machine):
  latest `asset_prices` per rule asset (one query per sweep), edge state in
  `alert_rule_subject_state` keyed by asset_id, cooldown + hysteresis identical
  to HF. A missing/stale-beyond-window price = skip (never fire, never resolve).
- **Copy honesty**: price notifications carry observed value + as_of
  ("XLM crossed above $0.1500 — $0.1610 at 14:32 UTC."); as_of older than 24h
  shows its full date. HF notifications now also append "— as of <time>".
- **Payload route hints (new notifications only)**: HF → `link:{view:'portfolio'}`;
  price → none (assets have no page — honest).
- **Validation**: price ⇒ assetId required, wallet/pool must be null; HF ⇒ assetId
  must be null; `metric` is now immutable via PATCH (delete + recreate instead);
  subject patches re-validate the merged family shape.
- **New endpoint**: `GET /v1/alert-rules/priced-assets` — vetted list = assets with
  a price observed in the last 7 days (12 today: XLM, USDC, PYUSD, EURC, AQUA…).

## Web (UX base)

- **Modal**: new "Asset" scope tile (Price creatable now); price moved OUT of the
  venue scope (a venue-price family will never exist — no false "soon" promise);
  targets = the vetted priced-assets list with live price shown; honest empty
  state when the list is empty; cadence line "checked every ~15 minutes"; 'pct'
  operator hidden for creatable families (no backend equivalent).
- **Rules list**: delete per rule (confirm dialog; notifications kept — rule_id
  SET NULL) + existing pause/unpause; price rules render as "XLM · Price" with
  `price > $0.1700 · XLM` condition strings.
- **Feed/bell**: notifications with a route hint are clickable and deep-link to
  their subject (portfolio for HF); severity derived from payload (HF fire =
  critical, price fire = info/activity); mark-all-read + relative times already
  present.

## Live smoke (local stack, real DB + running API)

1. `GET /v1/alert-rules/priced-assets` → 12 assets.
2. `POST` price rule XLM `gt 0.15` → created; invalid shapes rejected
   (price without assetId → 400; HF with assetId → 400).
3. `job:alerts` run 1 → **fired**: "XLM crossed above $0.1500 — $0.1610 at
   2026-08-13 10:20 UTC." (stale local price honestly dated).
4. Run 2 → no double-fire (edge state breached, cooldown holding).
5. `PATCH` threshold to 0.20 → run 3 → **resolved**: "XLM is back below $0.2000…",
   subject state back to `ok`.
6. `DELETE` rule → subject state cascaded (0 rows), notifications kept.

## Known notes / deferred

- Pre-existing quirk (unchanged): the service's UUID regex rejects the docs'
  default userId `…-001` (version nibble 0); real app user ids are v4 and fine.
- `/v1/pools/:slug/series` d_supply/b_supply flag from N0 — still open, outside Lot N.
- Docs to sync at founder-commit time: `docs/status-board.md` (T2-D2 families),
  `docs/runbooks.md` (v3 apply now includes N1 DDL), CLAUDE.md v3 family note.
- Deploy: VPS psql apply (above) + API build/PM2 restart + web deploy; the
  sweep itself (`job:wallet-alert`) needs no cron change.
