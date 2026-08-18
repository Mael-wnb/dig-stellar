#!/bin/sh
# apps/indexer/docker-entrypoint.sh — container refresh loop (Lot Z — T3-D3).
#
# Replaces the VPS 15-min cron+flock: one sequential loop, so a refresh can
# never overlap itself by construction. Cadence matches the cron (900s between
# run STARTS is approximated as 900s between runs — the drift is irrelevant to
# the 45-min staleness rule).
#
# Startup order:
#   1. bootstrap:core  — seeds the vetted perimeter (venues/entities/assets)
#      from the committed core-registry.json. Idempotent; REQUIRED before the
#      first refresh (the pipeline reads its perimeter from `entities`).
#      Failure is fatal: compose restarts the container until postgres is ready.
#   2. bootstrap:logos — brand/asset logo URLs. Optional polish, non-fatal.
#   3. job:refresh immediately, then every REFRESH_INTERVAL_SECONDS (default 900).
#      A failed refresh logs and waits for the next tick — same behavior as a
#      failed cron run.
set -u

echo "[indexer] bootstrap:core (idempotent perimeter seed)"
pnpm -C apps/indexer run bootstrap:core || {
  echo "[indexer] FATAL: bootstrap:core failed — exiting so compose restarts us"
  exit 1
}

echo "[indexer] bootstrap:logos (optional polish, non-fatal)"
pnpm -C apps/indexer run bootstrap:logos \
  || echo "[indexer] bootstrap:logos failed (non-fatal, continuing)"

INTERVAL="${REFRESH_INTERVAL_SECONDS:-900}"

while true; do
  echo "[indexer] job:refresh starting at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if pnpm -C apps/indexer run job:refresh; then
    echo "[indexer] job:refresh OK — next run in ${INTERVAL}s"
  else
    echo "[indexer] job:refresh FAILED (exit $?) — retrying in ${INTERVAL}s"
  fi
  sleep "${INTERVAL}"
done
