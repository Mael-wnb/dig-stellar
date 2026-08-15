# Lot N — N0 Recon Report (2026-08-15)

Scope: answers to the five N0 questions in `docs/lot-n-alerting.md`, verified against the
code (not the docs). No code written.

## 1. `alert_rules` — how a family is encoded, what a new one needs

Schema (`apps/api/src/db/stellar_v3_alerting.sql`):

- `metric text CHECK (metric in ('health_factor'))` — the family discriminator. **Adding a
  family requires additive SQL: drop + recreate the CHECK with the widened list.**
- Subject columns: `user_wallet_id` (FK → user_wallets, NULL = all wallets),
  `pool_entity_id` (plain uuid, NULL = all pools). No asset reference exists.
- Condition: `operator CHECK (lt|lte|gt|gte)`, `threshold numeric`,
  `cooldown_seconds` (default 3600), `rearm_hysteresis numeric NULL`, `enabled`.
- `extra jsonb` exists and is **unused** — available for family-specific config.

For N1 (price): recommend an additive nullable `asset_id uuid` column (typed/indexable;
we're doing DDL for the CHECK anyway) over stuffing the asset into `extra`.

## 2. Evaluator structure (81/83) — plug-in point + edge-state keying

- Chain: `82-run-wallet-alert-job.ts` → indexer `81` (refresh `wallet_pool_health`, non-zero
  exit aborts) → api `83-evaluate-alerts.ts`. VPS cron `7,22,37,52 * * * *` → **cadence = 15 min**
  (the modal's honesty line: "checked every 15 minutes").
- `evaluate()` (`modules/alerts/evaluate.ts`) is a **pure, family-agnostic** state machine
  (operator direction, cooldown, hysteresis, null = never-breach). Reusable as-is for
  price / TVL-drop / APY. Unit specs exist (`evaluate.spec.ts`).
- **⚠ Key finding:** `83` loads ALL enabled rules with **no `metric` filter** and matches
  every rule against health rows. A new metric value without a per-family dispatch in 83
  would evaluate price thresholds against health factors. N1 must introduce family
  dispatch (existing path becomes the `health_factor` branch).
- Edge state: `alert_rule_state` PK `(rule_id, user_wallet_id, pool_entity_id)`, both
  NOT NULL, `user_wallet_id` has an FK. **Wallet-less families (price, pool-TVL, APY)
  cannot key into it** — no sentinel possible (FK). Recommendation: one additive generic
  table `alert_rule_subject_state (rule_id FK cascade, subject_key text, status,
  last_value, last_evaluated_at, last_fired_at, PK(rule_id, subject_key))` — covers N1
  (subject = asset_id), N3/N4 (subject = pool entity_id). N2 (no rule at all) gets its own
  tiny last-seen table `pool_status_state (entity_id PK, status, changed_at, seen_at)`.

## 3. Rule management today

| Capability | API | Web client | UI |
|---|---|---|---|
| Pause/unpause | ✅ PATCH `/v1/alert-rules/:id` (enabled) | ✅ | ✅ toggle in AlertsView |
| Delete | ✅ DELETE `/v1/alert-rules/:id` | ✅ `deleteAlertRule` | ❌ **not wired** (composable has `deleteRule`, view never calls it) |
| Mark one read | ✅ | ✅ | ✅ bell row click |
| Mark ALL read | ✅ POST `/v1/notifications/read-all` | ✅ | ✅ bell header ("Mark all read") |
| Deep-link notification → subject | — | — | ❌ none; rows only mark-read. `payload` has walletId/poolEntityId but **no pool slug** → add slug/route hint to payload at write time for new notifications |

N1 UI additions: delete button on the rules list (+ confirm), deep-links, cadence line in
the modal. Ownership pattern (userId scoping) already uniform — reuse.

## 4. Modal "soon" families (promised vs will-build)

Gate = `SUPPORTED_METRICS` in `useAlerts.ts`; today only `wallet · health`. Shown as "soon":

- venue: APY, TVL delta, Utilization, Netflow, Price
- wallet: Balance change, Net exposure, Position value
- protocol: TVL delta, Volume spike, Netflow, Protocol health

After full Lot N: creatable = wallet·health (existing) + **price** (N1, needs an asset
target list — vetted = symbols priced by `job:refresh` steps 62/63: XLM, USDC, PYUSD, EURC,
SolvBTC, xSolvBTC, USTRY, CETES, TESOURO, oUSD, AQUA, USDGLO + Soroswap-derived; no
`/v1/assets` endpoint exists → N1 adds a small priced-assets read) + **venue·TVL delta**
(N3) + **venue·APY** (N4). Still honestly "soon" after Lot N: utilization, netflow,
balance/exposure/position value, volume, all protocol-scope metrics. Note: venue targets in
the modal are hardcoded samples — N3/N4 must source real pools from `/v1/pools`. Severity
is display-only (no column) — keep derived.

## 5. N3 — where per-pool TVL history actually lives (evaluator source decision)

- `pool_metrics_latest` = single-row upsert (no history). `pool_snapshots` has **no TVL**.
- **`reserve_snapshots` is the source.** Post dead-reserves fix (2026-08-14) each refresh
  writes one atomic batch per entity under a single `snapshot_at` — "latest batch" =
  `max(snapshot_at)` per entity; batches are complete by construction (transactional).
- Coverage: Blend (weeks of history) + Soroswap/Aquarius (live writers added 2026-08-13 —
  ~24h+ of batches by build time). Stellar-native: no reserve batches (reserves live in
  `pool_snapshots.metadata`) → **excluded from N3**, honest "not covered".
- **Decision: evaluator compares the latest batch vs the batch closest to now−24h (same
  entity, both complete by construction), valuing both with the same latest-price map and
  the SAME formula as `compute-pool-metrics.ts` (supplied = `b_supply_scaled`).**
- **⚠ Flag (pre-existing, not Lot N):** `/v1/pools/:slug/series` (`stellar.service.ts:798`)
  sums `d_supply_scaled × price` — the column `compute-pool-metrics` treats as *borrowed*
  after the blend.capital validation. The series may be plotting the wrong side. Do NOT
  mirror the series logic in the N3 evaluator; worth a separate founder look.

## N1 build plan (for review before code)

1. Additive SQL in `stellar_v3_alerting.sql`: widen metric CHECK to
   `('health_factor','price')`, add `asset_id uuid NULL` to `alert_rules`, create
   `alert_rule_subject_state`. Apply locally + VPS.
2. API: family dispatch in 83; price evaluator (latest `asset_prices` per asset,
   `observed_at` as the honest `as_of` in copy); service validation (price rule requires
   asset_id, wallet/pool must be null); priced-assets read for the modal.
3. Web: modal — price creatable with asset target list, cadence honesty line; rules list —
   delete; feed/bell — deep-links, mark-all-read stays, relative times exist.
4. Tests: evaluator specs for price (fire edge, no double-fire in cooldown, resolve edge,
   dispatch isolation health-vs-price). Baselines: api 51 / web 111 green.
