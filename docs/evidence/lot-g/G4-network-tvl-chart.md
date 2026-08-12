# G4 — Network TVL 7-day chart (snapshots path) — T3-D3, Lot G

The hero's flagship: a 7-day network-TVL curve, served from G0's
`network_tvl_snapshots` per the accepted phase-1 recon verdict (full reconstruction
not viable — only Blend has historized reserves). API façade + web chart. Gates:
`pnpm -C apps/web build` (vue-tsc) + `pnpm -C apps/web test` **49/49** + `pnpm -C apps/api build`
all green. Visual: `g4-tvl-chart.png`; raw response: `g4-tvl-series-response.json`.

## API — `GET /v1/network/tvl-series`

`NetworkService.getTvlSeries()` (`apps/api/src/modules/network/`). On-read aggregation,
no external calls:

- **Hourly buckets over up to 7d:** `distinct on (date_trunc('hour', as_of)) … order by
  bucket asc, as_of desc` — one row per hour, keeping the **latest** snapshot in that hour
  as its TVL. `where as_of >= now() − 7d`.
- **Gaps stay gaps:** only hours that have a snapshot are emitted; missing hours are simply
  absent (no zero-fill, no interpolation).
- **Payload:** `{ series: [{ t, tvlUsd, protocolCount }], meta: { source: 'snapshots',
  from, to, firstSnapshotAt, partial, bucket: 'hour' } }`. `from = to − 7d`; `partial` is
  true while `firstSnapshotAt > from` (history younger than the window) — drives the note.

### Verified live (local DB, seeded across hours incl. a deliberate 14:00 gap)

```
series: 11:00 → 12:00 → 13:00 → 15:00 → 16:00   (14:00 absent = gap kept)
        the 11:40 point collapsed into 11:00, latest-in-hour value retained
meta:   source=snapshots, from=to−7d, firstSnapshotAt=11:00, partial=true
```

(The `$1` bind needed an explicit `::timestamptz` cast — Prisma passes it as text.)

## Web — hero chart in the G2 slot

- `NetworkTvlChart.vue` — dumb reactive-SVG chart reusing the BridgeChart pattern
  (same SVG + hover-tooltip approach, `#B8E640` accent, area gradient). `useNetworkTvl.ts`
  fetches on mount; `DashboardView` renders it in the G2 chart slot.
- **7d window, x is real time** → a missing hour shows as horizontal space; the line is
  split into segments and **breaks across any gap > ~1.5 buckets** (never bridged/smoothed).
- **Tooltip:** hover snaps to the nearest bucket, showing the UTC date+hour and exact TVL.
- **Honest partial note:** while `meta.partial`, renders *"Building history since
  &lt;firstSnapshotAt date&gt; — the curve fills toward 7 days as snapshots accrue."*
- **y-axis** is zoomed to the data range (a TVL curve is read for shape); the tooltip always
  gives the exact figure so the zoom can't mislead. The big hero TVL number stays
  authoritative from `/v1/network/stats` (unchanged).
- **States:** loading skeleton · error + retry · cold-start message when no points yet.

`g4-tvl-chart.png` — panel A is the **real** endpoint response (5 hourly points clustered
at the right edge of the 7d axis with the 14:00 gap-break and the honest note — the true
current partial state); panel B is an **illustrative** mature 7d curve (synthetic values,
identical chart math) showing a mid-window gap-break and the tooltip.

## Prod status

G0 confirmed writing per cron tick (4 points 15:03→15:48 UTC today). Once this deploys,
the endpoint serves those points and the hero renders the honest "building history since"
curve, growing toward the full 7-day window day by day.

## Files

- `apps/api/src/modules/network/network.service.ts` — `getTvlSeries()` + types.
- `apps/api/src/modules/network/network.controller.ts` — `GET tvl-series` route.
- `apps/web/src/api/network.ts` — client + types.
- `apps/web/src/composables/useNetworkTvl.ts` — fetch composable.
- `apps/web/src/components/NetworkTvlChart.vue` — the chart.
- `apps/web/src/components/views/DashboardView.vue` — wired into the hero slot.
