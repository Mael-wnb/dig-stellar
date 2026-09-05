// apps/api/src/modules/ops/status.spec.ts
//
// Lot ST: unit tests for the pure status aggregation (computeOpsStatus) —
// the ops module's first tests. Fixture rows only, no DB. The controller's
// window guard (400) is covered at the bottom.
import { BadRequestException } from '@nestjs/common';
import { OpsController } from './ops.controller';
import type { OpsService } from './ops.service';
import {
  computeOpsStatus,
  OPS_STATUS_RULES,
  type OpsStatusInput,
  type RpcRunRow,
  type StepRunRow,
} from './status';

const CADENCE_MS = OPS_STATUS_RULES.cadenceMinutes * 60_000;
const T0 = new Date('2026-09-03T00:00:00.000Z').getTime();
const STALE_AFTER_SECONDS = 45 * 60;

// Run i on the nominal 15-min grid (run 0 = T0).
function runAt(i: number): Date {
  return new Date(T0 + i * CADENCE_MS);
}

function stepRow(
  i: number,
  step: string,
  status: 'SUCCESS' | 'FAILED' = 'SUCCESS',
  message: string | null = null,
): StepRunRow {
  return { runAt: runAt(i), step, status, durationMs: 1200, message };
}

function rpcRow(i: number, target: string, calls: number, errors: number): RpcRunRow {
  return { runAt: runAt(i), target, calls, errors, p50Ms: 100, p95Ms: 250, p99Ms: 400 };
}

// `now` defaults to one cadence after the last grid run so the trailing age is
// fresh (no stale/outage) unless a test wants otherwise. `historySince`
// defaults to the EARLIEST fixture run (fresh-deploy semantics): the span
// before the first run is then "no data", never a leading gap, so fixtures
// exercise only what they construct — leading-gap tests opt in with an
// explicit pre-window historySince.
function compute(
  partial: Partial<OpsStatusInput> & { lastRunIndex?: number },
): ReturnType<typeof computeOpsStatus> {
  const { lastRunIndex, ...rest } = partial;
  const rows = [...(rest.stepRows ?? []), ...(rest.rpcRows ?? [])];
  const earliest = rows.length
    ? new Date(Math.min(...rows.map((r) => r.runAt.getTime())))
    : null;
  return computeOpsStatus({
    now: new Date(runAt(lastRunIndex ?? 0).getTime() + CADENCE_MS),
    staleAfterSeconds: STALE_AFTER_SECONDS,
    historySince: earliest,
    stepRows: [],
    rpcRows: [],
    ...rest,
  });
}

describe('computeOpsStatus', () => {
  it('all-green 96 runs → operational, no gaps, availability 1', () => {
    const indices = Array.from({ length: 96 }, (_, i) => i);
    const result = compute({
      stepRows: indices.map((i) => stepRow(i, 'blend')),
      rpcRows: indices.map((i) => rpcRow(i, 'horizon', 50, 0)),
      lastRunIndex: 95,
    });

    expect(result.runs).toHaveLength(96);
    expect(result.gaps).toEqual([]);
    expect(result.overall).toEqual({
      state: 'operational',
      lastRunAt: runAt(95).toISOString(),
      missedCycles24h: 0,
      failedSteps24h: 0,
    });
    const blend = result.components.find((c) => c.id === 'step:blend')!;
    const horizon = result.components.find((c) => c.id === 'rpc:horizon')!;
    expect(blend.state).toBe('ok');
    expect(blend.availability24h).toBe(1);
    expect(blend.segments).toHaveLength(96);
    expect(blend.label).toBe('Blend refresh');
    expect(horizon.state).toBe('ok');
    expect(horizon.availability24h).toBe(1);
  });

  it('a FAILED step in an OLD run → counter + failed segment, overall stays operational', () => {
    const indices = Array.from({ length: 96 }, (_, i) => i);
    const result = compute({
      stepRows: indices.map((i) =>
        stepRow(i, 'blend', i === 40 ? 'FAILED' : 'SUCCESS', i === 40 ? 'boom' : null),
      ),
      lastRunIndex: 95,
    });

    const blend = result.components.find((c) => c.id === 'step:blend')!;
    expect(blend.segments[40]).toMatchObject({ state: 'failed', message: 'boom' });
    expect(blend.state).toBe('ok'); // latest segment is ok
    expect(blend.availability24h).toBe(Number((95 / 96).toFixed(4)));
    // Current state, not a 24h aggregate: the failure is history (bar + counter).
    expect(result.overall.state).toBe('operational');
    expect(result.overall.failedSteps24h).toBe(1);
  });

  it('a FAILED step in the LATEST run → overall degraded', () => {
    const indices = Array.from({ length: 8 }, (_, i) => i);
    const result = compute({
      stepRows: indices.map((i) =>
        stepRow(i, 'blend', i === 7 ? 'FAILED' : 'SUCCESS', i === 7 ? 'boom' : null),
      ),
      lastRunIndex: 7,
    });

    expect(result.overall.state).toBe('degraded');
    expect(result.overall.failedSteps24h).toBe(1);
  });

  it('a 30-min hole → one 1-cycle gap counted, overall stays operational (fresh latest run)', () => {
    // Runs 0..10 with run 5 missing: 30 min between runs 4 and 6.
    const indices = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10];
    const result = compute({
      stepRows: indices.map((i) => stepRow(i, 'blend')),
      lastRunIndex: 10,
    });

    expect(result.gaps).toEqual([
      {
        after: runAt(4).toISOString(),
        before: runAt(6).toISOString(),
        missedCycles: 1,
      },
    ]);
    expect(result.overall.missedCycles24h).toBe(1);
    expect(result.overall.state).toBe('operational');
    const blend = result.components.find((c) => c.id === 'step:blend')!;
    // 10 observed + 1 missed, 0 failed → 1 − 1/11
    expect(blend.availability24h).toBe(Number((10 / 11).toFixed(4)));
  });

  it('20-min spacing (Lot Z compose drift) → NOT a gap', () => {
    // Real compose cadence: 15 min sleep + run duration → ~20 min apart.
    const spacingMs = 20 * 60_000;
    const times = Array.from({ length: 6 }, (_, i) => new Date(T0 + i * spacingMs));
    const result = compute({
      stepRows: times.map((t) => ({ ...stepRow(0, 'blend'), runAt: t })),
      now: new Date(times[5].getTime() + spacingMs),
    });

    expect(result.gaps).toEqual([]);
    expect(result.overall.missedCycles24h).toBe(0);
    expect(result.overall.state).toBe('operational');
  });

  it('a 60-min hole → one 3-cycle gap (outage span)', () => {
    // Runs 0..3 then 7..8 — cycles 4, 5, 6 missing → 60 min between 3 and 7.
    const indices = [0, 1, 2, 3, 7, 8];
    const result = compute({
      stepRows: indices.map((i) => stepRow(i, 'blend')),
      lastRunIndex: 8,
    });

    expect(result.gaps).toEqual([
      {
        after: runAt(3).toISOString(),
        before: runAt(7).toISOString(),
        missedCycles: 3,
      },
    ]);
    expect(result.overall.missedCycles24h).toBe(3);
    // 1b: history never flips the banner — the 3 missed cycles live in the
    // counter and the grey gap tiles; the latest run is fresh and green.
    expect(result.overall.state).toBe('operational');
  });

  it('rpc thresholds: 0 errors → ok, 10% → degraded, 40% → failed', () => {
    const result = compute({
      rpcRows: [
        rpcRow(0, 'price-sources', 100, 0),
        rpcRow(1, 'price-sources', 100, 10),
        rpcRow(2, 'price-sources', 100, 40),
      ],
      lastRunIndex: 2,
    });

    const comp = result.components.find((c) => c.id === 'rpc:price-sources')!;
    expect(comp.segments.map((s) => s.state)).toEqual(['ok', 'degraded', 'failed']);
    expect((comp.segments[1] as { errorRate: number }).errorRate).toBe(0.1);
    // 1 failed of 3 observed, no missed → 1 − 1/3
    expect(comp.availability24h).toBe(Number((2 / 3).toFixed(4)));
    expect(comp.state).toBe('failed'); // latest segment
  });

  it('degraded segments do NOT reduce availability', () => {
    // Steady 10% error rate (price-sources before R2): bar is amber but
    // availability stays 100% — degraded is visible in state, not the number.
    const result = compute({
      rpcRows: [0, 1, 2].map((i) => rpcRow(i, 'price-sources', 100, 10)),
      lastRunIndex: 2,
    });

    const comp = result.components.find((c) => c.id === 'rpc:price-sources')!;
    expect(comp.availability24h).toBe(1);
    expect(comp.state).toBe('degraded');
    expect(result.overall.state).toBe('operational'); // rpc never flips overall
  });

  it('short history (6 runs) → no padding, historySince carries the honesty', () => {
    const historySince = new Date('2026-09-03T00:00:00.000Z');
    const result = compute({
      stepRows: [0, 1, 2, 3, 4, 5].map((i) => stepRow(i, 'blend')),
      historySince,
      lastRunIndex: 5,
    });

    expect(result.runs).toHaveLength(6);
    expect(result.historySince).toBe(historySince.toISOString());
    expect(result.gaps).toEqual([]);
  });

  it('axis is the union of both tables; missing rows never synthesize segments', () => {
    // Run 1 exists only in rpc_metrics_runs (e.g. the step insert was lost).
    const result = compute({
      stepRows: [stepRow(0, 'blend'), stepRow(2, 'blend')],
      rpcRows: [rpcRow(0, 'horizon', 10, 0), rpcRow(1, 'horizon', 10, 0), rpcRow(2, 'horizon', 10, 0)],
      lastRunIndex: 2,
    });

    // The rpc-only run still appears on the axis…
    expect(result.runs.map((r) => r.runAt)).toEqual(
      [0, 1, 2].map((i) => runAt(i).toISOString()),
    );
    // …and the step component has NO segment for it (2, not 3) — no invented state.
    const blend = result.components.find((c) => c.id === 'step:blend')!;
    expect(blend.segments).toHaveLength(2);
    expect(blend.segments.map((s) => s.runAt)).toEqual(
      [0, 2].map((i) => runAt(i).toISOString()),
    );
  });

  it('unknown step key → raw-key label fallback, never dropped', () => {
    const result = compute({
      stepRows: [stepRow(0, 'discover:blend', 'FAILED', 'db unreachable')],
    });

    const comp = result.components.find((c) => c.id === 'step:discover:blend')!;
    expect(comp.label).toBe('discover:blend');
    expect(comp.kind).toBe('step');
    expect(comp.segments).toHaveLength(1);
  });

  it('trailing age beyond staleAfterSeconds → component stale, overall outage', () => {
    const result = compute({
      stepRows: [stepRow(0, 'blend')],
      rpcRows: [rpcRow(0, 'horizon', 10, 0)],
      // 46 min after the only run (> 45-min staleAfterSeconds).
      now: new Date(runAt(0).getTime() + 46 * 60_000),
    });

    expect(result.overall.state).toBe('outage');
    for (const comp of result.components) {
      expect(comp.state).toBe('stale');
    }
  });

  it('empty window → unknown overall, empty axis/components', () => {
    const result = compute({ historySince: null });

    expect(result.overall).toEqual({
      state: 'unknown',
      lastRunAt: null,
      missedCycles24h: 0,
      failedSteps24h: 0,
    });
    expect(result.runs).toEqual([]);
    expect(result.components).toEqual([]);
    expect(result.historySince).toBeNull();
    expect(result.noDataBefore).toBeNull();
  });

  it('stalled pipeline (one run 23h28m ago, old history) → outage, open-ended trailing gap, ~1% availability', () => {
    // 2b bug fixture: one run, then silence. Before the fix this read as
    // "0 missed cycles, 100% availability" — a dead pipeline must not read 100%.
    const only = runAt(0);
    const now = new Date(only.getTime() + (23 * 60 + 28) * 60_000); // +23h28m
    const result = compute({
      stepRows: [stepRow(0, 'blend')],
      rpcRows: [rpcRow(0, 'horizon', 10, 0)],
      historySince: new Date(only.getTime() - 10 * 86_400_000), // history >> window
      now,
    });

    // Trailing span 1408min → floor(1408/15) = 93 missed cycles, open-ended.
    expect(result.gaps).toContainEqual({
      after: only.toISOString(),
      before: null,
      missedCycles: 93,
    });
    // Leading span (windowStart → run) = 32min → 1 more missed cycle.
    expect(result.overall.missedCycles24h).toBe(94);
    expect(result.overall.state).toBe('outage');
    expect(result.noDataBefore).toBeNull();
    for (const comp of result.components) {
      // 1 observed + 94 missed, 0 failed → 1 − 94/95 ≈ 0.0105.
      expect(comp.availability24h).toBe(Number((1 / 95).toFixed(4)));
      expect(comp.state).toBe('stale');
    }
  });

  it('fresh deploy (history starts 2h ago, 8 runs) → no leading gap, noDataBefore set, availability 1', () => {
    const indices = Array.from({ length: 8 }, (_, i) => i);
    const result = compute({
      stepRows: indices.map((i) => stepRow(i, 'blend')),
      historySince: runAt(0), // history begins INSIDE the window
      lastRunIndex: 7,
    });

    expect(result.gaps).toEqual([]);
    expect(result.overall.missedCycles24h).toBe(0);
    expect(result.overall.state).toBe('operational');
    expect(result.noDataBefore).toBe(runAt(0).toISOString());
    const blend = result.components.find((c) => c.id === 'step:blend')!;
    expect(blend.availability24h).toBe(1);
  });

  it('a late-but-not-stale pipeline (35m since last run) → trailing gap of 2, overall still operational', () => {
    const result = compute({
      stepRows: [stepRow(0, 'blend'), stepRow(1, 'blend')],
      // 35min after the last run: > 1.75×cadence (26.25m) but < 45m stale.
      now: new Date(runAt(1).getTime() + 35 * 60_000),
    });

    expect(result.gaps).toEqual([
      { after: runAt(1).toISOString(), before: null, missedCycles: 2 },
    ]);
    expect(result.overall.missedCycles24h).toBe(2);
    expect(result.overall.state).toBe('operational'); // current state: latest run green
    const blend = result.components.find((c) => c.id === 'step:blend')!;
    // 2 observed + 2 missed → 1 − 2/4.
    expect(blend.availability24h).toBe(0.5);
  });
});

describe('OpsController /v1/ops/status window guard', () => {
  const service = {
    getStatus: jest.fn().mockResolvedValue({ window: '24h' }),
  } as unknown as OpsService;
  const controller = new OpsController(service);

  it('accepts window=24h and no window', async () => {
    await expect(controller.getStatus('24h')).resolves.toEqual({ window: '24h' });
    await expect(controller.getStatus(undefined)).resolves.toEqual({ window: '24h' });
  });

  it('rejects any other window with a 400 listing supported values', () => {
    expect(() => controller.getStatus('7d')).toThrow(BadRequestException);
    expect(() => controller.getStatus('7d')).toThrow(
      "Unsupported window '7d'. Supported: 24h",
    );
  });
});
