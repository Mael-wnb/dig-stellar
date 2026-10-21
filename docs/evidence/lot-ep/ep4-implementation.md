# EP4 — Earn v1.1 (daily streak ramp, hero, actions, activity, neutral copy): implementation evidence (2026-10-21)

Scope: what EP4 delivers on `feat/lot-ep4` (uncommitted at the time of writing; the founder
commits) and the local runs that exercised it. Points only: no payout, no token, no new key,
nothing touched in `modules/actions`, `modules/faucet`, validators, flags or whitelists. Not
deployed anywhere. Every number below comes from a command output or a browser run of
2026-10-21 (Node 24.22.0, local Postgres 16 with v6 + v7 + v8 applied), labelled. Founder
decisions taken at the EP4 brief and at STOP-AND-SHOW 1 are listed in §2.

## 1. Delivered

| Area | What |
|---|---|
| **Streak ramp (API)** | `campaign-rules.ts`: `STREAK_RAMP = { stepPerDay: 0.05, cap: 1.35 }` replaces `STREAK_MULTIPLIERS`. `streakMultiplier(days) = min(1 + 0.05 × days, 1.35)` computed in integer hundredths (0 → ×1.00, 1 → ×1.05, 4 → ×1.20, 6 → ×1.30, 7+ → ×1.35); `STREAK_DAYS_TO_CAP = 7`; `streakLadder()` (days 1..7 with their multiplier); `pointsFor(base, multiplier)` rounds `base × multiplier` in integer hundredths, half up (50 × 1.15 → 58, not 57.49999… → 57). Still computed on D-1 (`streakLengthBefore`, determinism rule unchanged). **Ledger history is untouched**: every row stores its own `multiplier`; only awards written after the change use the ramp (the local swap row keeps its ×1.00). |
| **GET /v1/campaign** | `rules.streak = { stepPerDay, cap, dailyPoints, daysToCap, ladder }`; `rules.streakMultipliers` is gone. `rules.streakDailyPoints` kept. |
| **GET /v1/campaign/me** | New: `pointsToday` (sum of `points` with `counted_day` = today UTC, adjust rows included), `actionsToday: { sdex-swap: {counted, cap}, blend-deposit: {counted, cap} }` from the ledger (cap from `ACTION_RULES`), `pendingByKind` from `action_witnesses` in window without a ledger row (sum = `pendingVerification`, unchanged), `streak.daysToCap` (= max(0, 7 − current)), `streak.last7` (7 UTC days ending today, oldest first, `{day, checkedIn, multiplier}` — `multiplier` is the one that applied ON that day under the D-1 rule, `streakMultiplier(streakLengthBefore(checkins, day))`, computed in the service; today's entry equals `multiplierForToday`). `streak.current` / `multiplierForToday` unchanged in meaning. `perks` / `nextPerk` / `flags` still served. |
| **GET /v1/campaign/me/activity** | New, `?address&userId`, same access rule as `/me` (no proof for reads), `Cache-Control: no-store`: the last 20 ledger rows newest first, `{reason, points, multiplier, countedDay, createdAt, txHashShort}`; `txHashShort` = first 8 chars, truncated in SQL (`left(witness_tx_hash, 8)`), action rows only, null elsewhere. No handle, no full hash, no other address. |
| **Repository** | `pendingVerificationByKind` (the EP1 count now delegates to it and sums), `pointsOn(day)`, `actionsCountedOn(day)`, `recentLedger(limit)`. Reads only; no new table, no schema change. |
| **Copy (neutral)** | `DISCLAIMER = 'Points unlock perks on Dig as the campaign grows.'` — no promise, no denial. Rendered ONCE at the top of the Earn view and nowhere else: the lines under `GetStartedCard`, the swap and the Blend-deposit success blocks and the FAQ are removed (the PointsChip still carries it as its `title` attribute, not visible text). Earn tagline no longer says "perks, not money". FAQ: "Are points worth anything?" removed; every other entry kept (there was no "Which perks" entry to remove). |
| **Web — hero** | `components/earn/EarnHeroCard.vue` replaces the balance card: balance large, "+N today" from `pointsToday`, rank line, the pending badge "N action(s) awaiting verification (next check within 15 min)", and the bar "Streak day n / 7 · ×m today · ×1.35 after 7 days" from `streak.daysToCap` and `rules.streak`. Founder precision: when `daysToCap` is 0 but `multiplierForToday` is below the cap, the line reads "×1.35 from tomorrow"; at the cap it reads "cap reached". |
| **Web — strip** | `StreakStrip.vue` redesigned: 7 boxes from `last7` (weekday label, ✓ on checked days, today highlighted with `multiplierForToday`), each checked day labelled with `last7[i].multiplier` (the multiplier that applied ON that day, D-1 rule, from the API), "—" on unchecked days, the check-in button inside the card, copy "Check in once per UTC day. Miss a day and the streak resets. Your multiplier each day comes from the days you checked in before it: 7 in a row → ×1.35." (from `rules.streak`). Phone width: `grid-cols-7 max-md:grid-cols-4` → two rows (4 + 3). SHOW 2 correction: the first cut labelled boxes by position with the ladder, which read as a drop today; `rules.streak.ladder` is still served but no longer rendered. |
| **Web — Earn more** | `EarnMoreCard.vue`: one row per awardable kind — "+50 pts per verified swap · 2/5 today" / "+100 pts per verified deposit · 0/3 today", points from `rules.actions[kind].basePoints`, counts from `actionsToday[kind]`, a "N pending" pill from `pendingByKind[kind]`, "Open swap" / "Open deposit" through the existing action modal (`useModals.openAction`) with the SAME contexts as the Get-started card: the selection of the advertised Blend pool (highest finite supply APY) moved from `GetStartedCard` into `lib/advertisedBlendPool.ts` + `composables/useAdvertisedBlendPool.ts`, shared by both cards (founder fix at STOP-AND-SHOW 2; `EarnMoreCard.spec.ts` asserts the deposit button carries the advertised pool's slug and the network-default fallback). Min-notional rule stated once in small text. The social tasks list follows as today. |
| **Web — activity** | `ActivityFeed.vue` + `lib/activityLabels.ts`: the 20 rows with labels per reason (Swap verified, Blend deposit verified, Daily check-in, Follow Dig on X, Repost on X, Join the Dig Discord, Referral, Adjustment), relative time, points with sign, ×multiplier when not ×1, the API's short hash. Honest empty state. `useCampaign` refreshes it with every `/me` refresh (after each write). |
| **Deploy order** | The EP4 fields are optional in the web types: with an older API still live (no `rules.streak`, no `last7` / `daysToCap` / `pointsToday` / `actionsToday` / `pendingByKind`) the hero renders without the streak line and the bar, the strip without boxes and multiplier labels (button + first copy sentence only), the Earn-more rows with points only; no error (`EarnHeroCard.spec.ts`, `StreakStrip.spec.ts`). |
| **Perks hidden** | `PerksBlock` is no longer rendered on the Earn view (one comment in `EarnView.vue` says why); the component and its spec are kept; `/me` keeps `perks` / `nextPerk` / `flags`; `#status` keeps `perksGranted`. |
| **Docs** | `docs/current-state.md` (dated EP4 sentence under the Lot EP paragraph), `docs/runbooks.md` ("Streak ramp (EP4)" with the values and the rounding rule; perks note), `docs/security-invariants.md` INV-11.2 reworded ("the copy makes no promise of monetary value, tokens or airdrops", grep rule unchanged), `docs/decisions/2026-10-21-points-have-no-monetary-value.md` dated paragraph (perks recorded, not surfaced; neutral copy; internal position unchanged), `docs/status-board.md` one line. |

Out of scope, said plainly: Galxe import; gating any feature on a perk; a dedicated phone
design beyond the wrap; any change to the award job's writes (it only consumes the new rules).

## 2. Founder rulings taken

- **Brief (2026-10-21):** daily ramp +0.05/day capped at ×1.35, still on D-1; neutral copy, no promise
  and no denial; perks hidden in the UI but kept in the API and on `#status`; FAQ minus two entries.
- **STOP-AND-SHOW 1 (2026-10-21), the seven decisions approved as stated:** `rules.streak` carries
  `ladder` + `daysToCap` so the web computes no multiplier; `daysToCap` = max(0, 7 − current);
  `pointsFor` rounds in integer hundredths; `pointsToday` reads `counted_day = today` literally (a
  founder adjust counts toward a day only when its `counted_day` is set; the runbook's adjust SQL does
  not set it); the award integration spec seeds 4 check-ins instead of 7 (under the ramp 7 would be the
  cap and push wallet A past 500 on run 1); `pendingVerificationCount` delegates to the by-kind query;
  ledger history untouched.
- **SHOW 2 (2026-10-21):** per-day multipliers on `last7` from the API (D-1 rule), "×1.35 after 7 days" and the
  D-1 sentence in the strip copy (both pinned in the specs), the stale-API guard, and the shared advertised-pool
  selection for "Open deposit".
- **Two precisions at SHOW 1:** "×1.35 from tomorrow" when the bar is full but the D-1 multiplier is
  below the cap (`EarnHeroCard.spec.ts` pins it); the Earn-more rows read points from `rules.actions`
  and counts from `actionsToday` with nothing computed (`EarnMoreCard.spec.ts` proves it with odd
  payload values: 73 / 111 points, 2/9 and 1/4 counts, and asserts the rules' daily caps are NOT shown).

## 3. Local runs (API built from the working tree, campaign env set in the shell only, second API on :3077)

`GET /v1/campaign`: `rules.streak = { stepPerDay 0.05, cap 1.35, dailyPoints 5, daysToCap 7, ladder [1 → 1.05, 2 → 1.1, 3 → 1.15, 4 → 1.2, 5 → 1.25, 6 → 1.3, 7 → 1.35] }`, no `streakMultipliers`, `disclaimer` = the neutral line.

`GET /v1/campaign/me` for the one local enrolment (pre-EP4 state: 55 points, one check-in today, one awarded swap):

| Field | Value |
|---|---|
| `balance` / `pointsToday` | 55 / 55 |
| `actionsToday` | swap 1/5 · deposit 0/3 |
| `pendingByKind` / `pendingVerification` | 0 / 0 · 0 |
| `streak` | current 1 · multiplierForToday 1 · daysToCap 6 · last7 = 15 Oct → 21 Oct, only today checked |
| response header | `Cache-Control: no-store` |

`GET /v1/campaign/me/activity`: 2 rows newest first — `action:sdex-swap` +50 ×1 `txHashShort "7ed13386"`, then `streak:daily` +5 ×1 `txHashShort null`; `no-store`. Missing `userId` or a malformed address → 400.

## 4. Browser-verified (local, API on :3077 + Vite on :5173 pointed at it with `VITE_API_BASE`, founder's API on :3000 untouched)

For the captures the browser session on the :5173 origin was switched to the enrolled local wallet
and app user (localStorage), and TEMPORARY rows were added then deleted: four check-ins on D-4..D-1
and one Horizon-style `blend-deposit` witness without a ledger row. After the run the session was
restored to its previous wallet/user and the DB is back to its pre-EP4 state (`points_ledger` 2,
`wallet_daily_checkins` 1, `wallet_perks` 0, `campaign_enrollments` 1, `action_witnesses` 1).

| Capture | What it shows |
|---|---|
| `shots-ep4/01-hero-card.png` | "YOUR POINTS 55 · +55 today · Rank #1", badge "1 action awaiting verification (next check within 15 min)", "Streak day 5 / 7 · ×1.20 today · ×1.35 at day 7", bar at 5/7 (taken before the SHOW 2 copy fix; the current line reads "after 7 days", see `05-phone-hero-strip.png`). |
| `shots-ep4/02-streak-strip.png` | Seven boxes THU…TODAY, five ✓ (D-4..today), labels "—", "—", ×1.00, ×1.05, ×1.10, ×1.15 and today highlighted "×1.20" (each day's own multiplier under the D-1 rule), "Checked in today ✓", the copy line with the D-1 sentence. |
| `shots-ep4/03-earn-more.png` | "Swap +50 pts per verified swap · 1/5 today · Open swap"; "Deposit on Blend +100 pts per verified deposit · 0/3 today · 1 pending · Open deposit"; the min-notional line. |
| `shots-ep4/04-activity-feed.png` | "Swap verified · 7h ago · 7ed13386 · +50 pts", "Daily check-in · 7h ago · +5 pts". |
| `shots-ep4/05-phone-hero-strip.png` | 390 px viewport (same-origin iframe, the browser window would not resize reliably): hero stacked with "×1.35 after 7 days", badge on its own line, strip wrapped 4 + 3 with the per-day labels, no horizontal scroll. |

The disclaimer line appears once, under the page title; no perks block; FAQ without the worth entry.

## 5. Test and build runs (2026-10-21, Node 24.22.0)

| Command | Output |
|---|---|
| `pnpm -C apps/api test` | `Test Suites: 3 skipped, 26 passed, 26 of 29 total` · `Tests: 43 skipped, 309 passed, 352 total` (EP3: 341) |
| `CAMPAIGN_IT=1 pnpm -C apps/api test` (local Postgres) | `Test Suites: 29 passed, 29 total` · `Tests: 352 passed, 352 total` |
| `nest build` | clean |
| `pnpm -C apps/web test` | `Test Files 11 passed (11)` · `Tests 157 passed (157)` (EP3: 6 / 123) |
| `pnpm -C apps/web build` (`vue-tsc -b && vite build`) | `✓ built`; main chunk `1,847.75 kB │ gzip: 525.26 kB` (EP3: 1,838.30 kB / 522.33 kB) |
| dist grep (`apps/web/dist/assets/index-*.js`) | "earn XLM" 0, "Non-monetary" 0, "perks, not money" 0, "no monetary value" 0, "Are points worth anything" 0, "streakMultipliers" 0, "at day 7" 0, "Day 7 of a streak" 0. "reward" 22 and "airdrop" 2 hits are all the Lot R faucet (real XLM rewards) and SDK / wallet-kit strings (SEP docs, Solana `requestAirdrop`), none in campaign copy. The neutral line is API-served, so it is absent from the bundle by design. |
| source grep over `components/earn/`, `EarnView.vue`, `lib/activityLabels.ts` | no "airdrop", "reward", "earn XLM", "token". |

New or extended specs. API: `campaign-rules.spec.ts` (ramp values, ladder, `pointsFor` rounding, ramp
on D-1, neutral disclaimer pinned and the forbidden words), `campaign.service.spec.ts` (`rules.streak`,
`last7` with per-day multipliers incl. the 4-days-ending-yesterday case and a month boundary, `daysToCap`, cap reached, `pointsToday` / `actionsToday` read for the DB
UTC day, `activity` mapping, dark `/me` shape), `campaign.controller.spec.ts` (`me/activity`
validation), `campaign.repository.integration.spec.ts` (EP4 block: `pointsOn` with adjust rows counted /
not counted / undated, `actionsCountedOn`, `pendingVerificationByKind` vs the awarded / below-min
witnesses, `recentLedger` order, limit and hash truncation, `service.me` + `activity` on the real DB with the
per-day multipliers 1.00 / 1.05 / 1.10 / 1.15 / 1.20),
`84-campaign-award.lib.spec.ts` (ramp 0 / 1 / 4 / 7 days), `84-campaign-award.integration.spec.ts`
(4 seeded check-ins). Web: `EarnHeroCard.spec.ts`, `StreakStrip.spec.ts` (useCampaign mocked),
`EarnMoreCard.spec.ts` (incl. the shared advertised-pool selection and the deposit context), `ActivityFeed.spec.ts`, shared `earn.fixtures.ts`; `PerksBlock.spec.ts` and
`PointsChip.spec.ts` fixtures updated to the new payload shape.

Pre-existing and left alone: `tsc --noEmit` over `apps/api` reports type errors in four unrelated spec
files (actions spendable, alerts evaluate, wallets connect, verify-wallet-signature); Jest passes and
none are in files EP4 touched.

## 6. Not done, said plainly

- **Not deployed.** The API change is backward-compatible for reads except `rules.streakMultipliers`
  (removed); deploy API and web together.
- **No artifact of "Paul's layout" was available to me** beyond the brief's description (7 boxes,
  checked days, today highlighted, multiplier labels, check-in inside the card); the strip follows
  that description.
- **The hero's "from tomorrow" state and a non-empty pending swap pill were not captured in the
  browser** (no local data produces them without faking a ledger); both are pinned by vitest.
- The phone capture uses a same-origin iframe because the extension could not resize the browser
  window reliably; the media queries saw a real 390 px viewport. The retaken desktop strip
  (`02-streak-strip.png`) was captured the same way through a 1180 px iframe scaled to fit, so it is
  about half the pixel size of the other desktop captures.
- The phone pass surfaced one layout fix taken on the spot: the hero's pending badge now wraps on
  narrow screens instead of overflowing its pill (`min-h` + `py`, same copy).
