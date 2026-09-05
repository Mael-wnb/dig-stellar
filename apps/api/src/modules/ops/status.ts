// apps/api/src/modules/ops/status.ts
//
// Lot ST — post-grant upgrade (Sept 2026), builds on Lot E: pure aggregation
// for GET /v1/ops/status.
// Turns raw `refresh_step_runs` + `rpc_metrics_runs` rows (24h window) into the
// Statuspage-style payload the web renders dumbly. No I/O here — the service
// fetches rows and calls computeOpsStatus(); everything below is unit-testable
// with fixture rows.
//
// Honest boundary (same as /v1/ops/metrics): this reflects the INDEXER's
// refresh pipeline and its outbound calls — it is visibility on our own runs,
// not an external uptime probe. Known data limits (recon 00-recon-2026-09-03):
// retries are invisible (final SUCCESS/FAILED only), and a missed cycle leaves
// no row — gaps are inferred from the run_at axis and are indistinguishable
// from "cron ran but crashed before the persist step".

export type SegmentState = 'ok' | 'degraded' | 'failed';
export type ComponentState = SegmentState | 'stale';
export type OverallState = 'operational' | 'degraded' | 'outage' | 'unknown';

export type StepRunRow = {
  runAt: Date;
  step: string;
  status: string; // 'SUCCESS' | 'FAILED' (anything else is treated as failed)
  durationMs: number;
  message: string | null;
};

export type RpcRunRow = {
  runAt: Date;
  target: string;
  calls: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

// ── Rules (ONE place; the UI hard-codes nothing) ─────────────────────────────
//
// cadenceMinutes — the intended refresh cadence (VPS cron */15).
//
// gapFactor — a gap is flagged only when consecutive runs are more than
//   gapFactor × cadence apart (1.75 × 15 min = 26.25 min). Rationale: the VPS
//   cron fires at :00/:15/:30/:45 (+ seconds), but the Lot Z compose loop is
//   "sleep 15 min AFTER each run", so its real cadence is 15 min + run
//   duration (~18–21 min observed). 1.75× tolerates that drift; a genuinely
//   skipped cron slot (~30 min) still trips it.
//   missedCycles for a flagged gap = round(gap / cadence) − 1.
//
// rpcFailedErrorRate — rpc segment state: errors = 0 → ok;
//   0 < errorRate < rpcFailedErrorRate → degraded; ≥ rpcFailedErrorRate → failed.
//
// Step segments are binary: SUCCESS → ok, FAILED → failed. Retries are
// invisible in the DB, so no amber is invented (not from duration either).
//
// availability24h = 1 − (failed segments + missed expected runs)
//                     / (observed runs + missed expected runs), 4 decimals.
//   `degraded` segments do NOT reduce availability — a target with a steady
//   10% error rate would otherwise show 0% availability, which is absurd.
//   Degradation stays visible in the bar and in `state`, not the percentage.
//   "missed expected runs" is the window-wide missedCycles sum: a missed cycle
//   is a whole-pipeline absence, so it counts against every component alike.
//
// overall.state is the CURRENT state (latest run + trailing age only), never
// a 24h aggregate — history lives in gaps[], the 24h counters and the bars.
// See the Overall block in computeOpsStatus() for the exact derivation.
export const OPS_STATUS_RULES = {
  window: '24h',
  cadenceMinutes: 15,
  gapFactor: 1.75,
  rpcFailedErrorRate: 0.25,
} as const;

// Fixed human labels (public payload never carries env values or URLs — these
// are the same fixed internal labels /v1/ops/metrics exposes). An unknown key
// falls back to the raw key and is never dropped. Order here = display order
// (steps in pipeline execution order); unknown keys append alphabetically.
export const STEP_LABELS: Record<string, string> = {
  'prices:reference': 'Reference prices',
  'prices:soroswap-derived': 'Soroswap-derived prices',
  blend: 'Blend refresh',
  soroswap: 'Soroswap refresh',
  aquarius: 'Aquarius refresh',
  'stellar-native': 'Stellar-native DEX refresh',
  defindex: 'DeFindex refresh',
  'protocol-metrics': 'Protocol rollup',
  allbridge: 'Allbridge bridge flows',
  'network-stats': 'Network stats',
};

export const RPC_LABELS: Record<string, string> = {
  'soroban-rpc': 'Soroban RPC',
  horizon: 'Horizon',
  'defindex-api': 'DeFindex API',
  'price-sources': 'Price sources',
};

export type OpsStatusInput = {
  now: Date;
  // From common/freshness.ts (staleAfterSeconds()) — never a new constant.
  staleAfterSeconds: number;
  // min(run_at) across BOTH tables, all time — honest "history since" copy.
  historySince: Date | null;
  stepRows: StepRunRow[];
  rpcRows: RpcRunRow[];
};

type StepSegment = {
  runAt: string;
  state: SegmentState;
  durationMs: number;
  message: string | null;
};

type RpcSegment = {
  runAt: string;
  state: SegmentState;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type OpsStatusComponent = {
  id: string;
  kind: 'step' | 'rpc';
  label: string;
  state: ComponentState;
  availability24h: number | null;
  segments: Array<StepSegment | RpcSegment>;
};

// `before: null` = the open-ended TRAILING gap (last run → now): the next run
// is overdue. The leading entry (window start → first run) uses the window
// start as `after`; it exists only when history predates the window.
export type OpsStatusGap = {
  after: string;
  before: string | null;
  missedCycles: number;
};

export type OpsStatusPayload = {
  window: string;
  generatedAt: string;
  cadenceMinutes: number;
  staleAfterSeconds: number;
  historySince: string | null;
  // Set when history starts INSIDE the window (fresh deploy): the span before
  // it is "no data", not missed cycles — the UI draws it as empty slots.
  noDataBefore: string | null;
  runs: Array<{ runAt: string }>;
  gaps: OpsStatusGap[];
  overall: {
    state: OverallState;
    lastRunAt: string | null;
    missedCycles24h: number;
    failedSteps24h: number;
  };
  components: OpsStatusComponent[];
};

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function rpcSegmentState(calls: number, errors: number): SegmentState {
  if (errors === 0) return 'ok';
  const rate = calls > 0 ? errors / calls : 1;
  return rate >= OPS_STATUS_RULES.rpcFailedErrorRate ? 'failed' : 'degraded';
}

// Availability + current state shared by both component kinds.
function finishComponent(
  segments: Array<{ runAt: string; state: SegmentState }>,
  missedCycles: number,
  now: Date,
  staleAfterSeconds: number,
): { state: ComponentState; availability24h: number | null } {
  const observed = segments.length;
  const denominator = observed + missedCycles;
  const failed = segments.filter((s) => s.state === 'failed').length;
  const availability24h =
    denominator === 0 ? null : round4(1 - (failed + missedCycles) / denominator);

  if (observed === 0) {
    // No rows for this component in the window — nothing to claim.
    return { state: 'stale', availability24h };
  }

  const last = segments[observed - 1];
  const ageMs = now.getTime() - new Date(last.runAt).getTime();
  const state: ComponentState =
    ageMs > staleAfterSeconds * 1000 ? 'stale' : last.state;

  return { state, availability24h };
}

// Display order: known keys in their labels-map order, unknown keys appended
// alphabetically — never dropped.
function orderKeys(keys: string[], labels: Record<string, string>): string[] {
  const known = Object.keys(labels).filter((k) => keys.includes(k));
  const unknown = keys.filter((k) => !(k in labels)).sort();
  return [...known, ...unknown];
}

export function computeOpsStatus(input: OpsStatusInput): OpsStatusPayload {
  const { now, staleAfterSeconds, historySince, stepRows, rpcRows } = input;
  const cadenceMs = OPS_STATUS_RULES.cadenceMinutes * 60_000;

  // ── Time axis: union of distinct run_at across BOTH tables, ascending ──────
  const axisSet = new Set<number>();
  for (const row of stepRows) axisSet.add(row.runAt.getTime());
  for (const row of rpcRows) axisSet.add(row.runAt.getTime());
  const axis = Array.from(axisSet).sort((a, b) => a - b);

  // ── Gaps (jitter-tolerant; see OPS_STATUS_RULES.gapFactor) ────────────────
  // The window is a TIME axis (now − 24h … now), not just the observed runs:
  // gap candidates are the spans between consecutive events in
  // [windowStart, run₁ … runₙ, now]. Without the boundary spans, a pipeline
  // dead for 23h read as "0 missed cycles, 100% availability" (2b bug).
  const windowStartMs = now.getTime() - 24 * 3_600_000;
  const gapThresholdMs = OPS_STATUS_RULES.gapFactor * cadenceMs;
  const gaps: OpsStatusGap[] = [];
  let noDataBefore: string | null = null;

  // Leading span (windowStart → first run): real missed cycles ONLY when
  // history predates the window — runs were expected. A historySince inside
  // the window is a fresh deploy: "no data", not a gap (no fake grey history).
  if (historySince && historySince.getTime() > windowStartMs) {
    noDataBefore = historySince.toISOString();
  } else if (axis.length && historySince) {
    const leadingSpanMs = axis[0] - windowStartMs;
    if (leadingSpanMs > gapThresholdMs) {
      gaps.push({
        after: new Date(windowStartMs).toISOString(),
        before: new Date(axis[0]).toISOString(),
        missedCycles: Math.round(leadingSpanMs / cadenceMs) - 1,
      });
    }
  }

  for (let i = 1; i < axis.length; i += 1) {
    const gapMs = axis[i] - axis[i - 1];
    if (gapMs > gapThresholdMs) {
      gaps.push({
        after: new Date(axis[i - 1]).toISOString(),
        before: new Date(axis[i]).toISOString(),
        missedCycles: Math.round(gapMs / cadenceMs) - 1,
      });
    }
  }

  // Trailing span (last run → now): ALWAYS a real gap once the next run is
  // overdue by the gap factor. Open-ended (`before: null`). missedCycles is
  // floor(span/cadence) — the next run is simply late, so the first cycle
  // counts as soon as it is overdue (not round − 1 like a closed span).
  if (axis.length) {
    const trailingSpanMs = now.getTime() - axis[axis.length - 1];
    if (trailingSpanMs > gapThresholdMs) {
      gaps.push({
        after: new Date(axis[axis.length - 1]).toISOString(),
        before: null,
        missedCycles: Math.floor(trailingSpanMs / cadenceMs),
      });
    }
  }

  const missedCycles24h = gaps.reduce((sum, g) => sum + g.missedCycles, 0);

  // ── Step components ───────────────────────────────────────────────────────
  const stepsByKey = new Map<string, StepSegment[]>();
  for (const row of [...stepRows].sort((a, b) => a.runAt.getTime() - b.runAt.getTime())) {
    const segment: StepSegment = {
      runAt: row.runAt.toISOString(),
      state: row.status === 'SUCCESS' ? 'ok' : 'failed',
      durationMs: row.durationMs,
      message: row.message ?? null,
    };
    const bucket = stepsByKey.get(row.step);
    if (bucket) bucket.push(segment);
    else stepsByKey.set(row.step, [segment]);
  }

  // ── Rpc components ────────────────────────────────────────────────────────
  const rpcByKey = new Map<string, RpcSegment[]>();
  for (const row of [...rpcRows].sort((a, b) => a.runAt.getTime() - b.runAt.getTime())) {
    const segment: RpcSegment = {
      runAt: row.runAt.toISOString(),
      state: rpcSegmentState(row.calls, row.errors),
      calls: row.calls,
      errors: row.errors,
      errorRate: row.calls > 0 ? round4(row.errors / row.calls) : 0,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
      p99Ms: row.p99Ms,
    };
    const bucket = rpcByKey.get(row.target);
    if (bucket) bucket.push(segment);
    else rpcByKey.set(row.target, [segment]);
  }

  const components: OpsStatusComponent[] = [];

  for (const key of orderKeys(Array.from(stepsByKey.keys()), STEP_LABELS)) {
    const segments = stepsByKey.get(key)!;
    const { state, availability24h } = finishComponent(
      segments,
      missedCycles24h,
      now,
      staleAfterSeconds,
    );
    components.push({
      id: `step:${key}`,
      kind: 'step',
      label: STEP_LABELS[key] ?? key,
      state,
      availability24h,
      segments,
    });
  }

  for (const key of orderKeys(Array.from(rpcByKey.keys()), RPC_LABELS)) {
    const segments = rpcByKey.get(key)!;
    const { state, availability24h } = finishComponent(
      segments,
      missedCycles24h,
      now,
      staleAfterSeconds,
    );
    components.push({
      id: `rpc:${key}`,
      kind: 'rpc',
      label: RPC_LABELS[key] ?? key,
      state,
      availability24h,
      segments,
    });
  }

  // ── Overall ───────────────────────────────────────────────────────────────
  // overall.state is the CURRENT state, not a 24h aggregate: a banner answers
  // "is the pipeline delivering right now?" — history lives in the bars,
  // gaps[] and the 24h counters beside it. Derived from the LATEST run only:
  //   unknown     — no runs in the window at all.
  //   outage      — now − lastRunAt > staleAfterSeconds: the pipeline is not
  //                 delivering (same 2-missed-cycles rule freshness uses).
  //   degraded    — ≥1 FAILED step in the LATEST run.
  //   operational — everything else.
  // Upstream rpc health never flips overall — a flaky provider is visible
  // per-component, the pipeline banner stays ours (mirrors /health).
  const failedSteps24h = stepRows.filter((r) => r.status !== 'SUCCESS').length;
  const lastMs = axis.length ? axis[axis.length - 1] : null;
  const failedStepsLatestRun =
    lastMs === null
      ? 0
      : stepRows.filter(
          (r) => r.runAt.getTime() === lastMs && r.status !== 'SUCCESS',
        ).length;

  let state: OverallState;
  if (lastMs === null) {
    state = 'unknown';
  } else if (now.getTime() - lastMs > staleAfterSeconds * 1000) {
    state = 'outage';
  } else if (failedStepsLatestRun > 0) {
    state = 'degraded';
  } else {
    state = 'operational';
  }

  return {
    window: OPS_STATUS_RULES.window,
    generatedAt: now.toISOString(),
    cadenceMinutes: OPS_STATUS_RULES.cadenceMinutes,
    staleAfterSeconds,
    historySince: historySince ? historySince.toISOString() : null,
    noDataBefore,
    runs: axis.map((ms) => ({ runAt: new Date(ms).toISOString() })),
    gaps,
    overall: {
      state,
      lastRunAt: lastMs === null ? null : new Date(lastMs).toISOString(),
      missedCycles24h,
      failedSteps24h,
    },
    components,
  };
}
