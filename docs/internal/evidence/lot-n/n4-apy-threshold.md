# Lot N — N4 Evidence: APY-THRESHOLD alerts (2026-08-16)

The last Lot N step — the "opportunity" family. Builds + tests green:
**api 85/85** (78 + 7 new N4 specs), **web 111/111**, both builds clean. Live
smoke passed (stale skip → fire → resolve, state cleaned). Working tree =
N4-only diff (N3 founder-committed as ccd1456).

## Backend

- **Two metrics, one family bucket**: `supply_apy` and `borrow_apy` share the
  `apy` partition bucket and one evaluator; the rule's metric picks the
  `pool_metrics_latest` column. Metric CHECK widened (additive SQL, applied
  locally — **the single VPS `psql -f` re-apply now covers all of N1–N4**).
- **Unit contract**: `weighted_*_apy` stores FRACTIONS (0.0215 = 2.15%); rule
  thresholds are in PERCENT (user-facing), so the evaluator converts (×100)
  before feeding the unchanged `evaluate()` machine. Edge state reuses
  `alert_rule_subject_state` (subject = pool). No new tables.
- **Direction is free**: all four operators allowed — "supply APY rises above
  8%" (opportunity) and "borrow APY falls below 5%" (cheap leverage) are both
  legitimate; copy words the direction from the operator.
- **Honesty guards** (verified live): `as_of` older than 24h (stale pipeline)
  → skip with a warning; a rule on a side the pool doesn't have (e.g. borrow
  on a supply-only pool) → skip, never a fabricated zero.
- **Scope discipline**: `GET /v1/alert-rules/apy-pools` restricts eligibility
  to **lending venues** (Blend ×4, each with supply + borrow). DeFindex vault
  APYs exist in `pool_metrics_latest` but the adapter is explicitly
  unvalidated (CLAUDE.md scope note) — offering alerts on them would violate
  the honesty rule, so they are excluded.
- **Validation**: pool required; wallet/asset must be null (shared pool-family
  shape with tvl_drop_pct); metric immutable as before.
- **Copy**: fired "Blend Fixed supply APY rose to 2.15% (alert threshold > 2%)
  — as of 09:12 UTC."; resolved "…back to 2.15% — as of …". Payload carries
  side, percent value (machine-grade), threshold, operator, asOf + pool-page
  route hint.

## Web

- Venue scope now shows **Supply APY** and **Borrow APY** as separate creatable
  chips (the old single "APY" chip is gone); TVL delta unchanged. Still
  honestly "soon" after Lot N: utilization, netflow, wallet
  balance/exposure/position-value, all protocol-scope metrics.
- **Per-target gating**: APY side flags ride the pool target list — picking an
  AMM pool + an APY metric shows "…doesn't have a supply APY — pick a lending
  pool" and blocks create (the backend would never evaluate it).
- Rules list renders "Blend Fixed · Supply APY" / `supply_apy > 5% · Blend
  Fixed`; feed maps APY fires to **info/activity** (lowest criticality, per the
  brief), trend icon, pool deep-link.

## Live smoke (local stack)

1. `GET /v1/alert-rules/apy-pools` → 4 Blend pools, supply+borrow each,
   DeFindex absent.
2. Create supply_apy > 2% on Fixed → ok; borrow_apy without pool → 400.
3. Run on REAL stale `as_of` (Aug 14) → **skipped with stale warning**.
4. `as_of` bumped to now → **fired**: "Blend Fixed supply APY rose to 2.15%
   (alert threshold > 2%) — as of 09:12 UTC." (real mainnet-derived value).
5. Threshold raised to 5% → **resolved**: "back to 2.15%".
6. Cleanup: original `as_of` restored byte-exact, rule deleted, subject state
   cascaded to 0.

## Lot N wrap-up

N0–N4 all landed green within the timebox. Evaluated families now: wallet
health-factor, asset price, pool TVL-drop, pool supply/borrow APY, plus the
automatic pool-status protection. Deploy checklist (unchanged, once):
VPS `psql -f stellar_v3_alerting.sql` → API build + PM2 restart → web deploy;
`job:wallet-alert` cron untouched. Docs to sync at commit time:
`docs/status-board.md`, `docs/runbooks.md`, CLAUDE.md v3 family note.
