// apps/indexer/src/scripts/82-run-wallet-alert-job.ts
//
// D2 alerting — lot 0, the periodic sweep orchestrator. The single command a cron
// entry calls. Mirrors the spawn-chain idiom of 72-run-refresh-job.ts:
//
//   1. script 81 (indexer) — refresh wallet_pool_health for ALL active wallets.
//      Invoked with NO WALLET_ID, so its existing wallet-selection branch sweeps
//      every chain='stellar' is_active=true wallet (unchanged).
//   2. script 83 (apps/api) — the evaluator. Reads the fresh snapshots, fires/
//      resolves notifications. Lives in apps/api because it consumes the API's
//      Prisma + the lot-1 AlertsRepository, so we spawn it in that package.
//
// A non-zero exit from 81 ABORTS the run (we do not evaluate stale/half-written
// health rows) — logged, not thrown uncaught.
//
// Lot RP (RP1) — observability. Both children inherit OPS_METRICS_FILE and
// append their RPC call samples there on exit (81 through lib/ops-capture, 83
// through the API's ops-capture-lite). At the end of the run — successful or
// not — the samples are summarized per target (calls, errors, latency
// percentiles, calls per method) and persisted as rpc_metrics_runs rows with
// job = 'wallet-alert', the same shape 71 writes for job = 'refresh'. Non-fatal:
// observability must never fail the sweep.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createPgClient } from './shared/db';
import { parseSamplesFile, summarizeOpsSamples } from '../lib/ops-metrics';

const API_DIR = path.resolve(__dirname, '../../../api');
const JOB_NAME = 'wallet-alert';

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...(opts.env ?? {}),
      },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`)
      );
    });
  });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Merge the children's sample file into per-target rows (job = 'wallet-alert').
// Mirrors persistOpsObservability in 71-refresh-all-metrics.ts.
async function persistOpsObservability(runAt: Date, opsFile: string): Promise<void> {
  let samples: ReturnType<typeof parseSamplesFile> = [];
  try {
    if (existsSync(opsFile)) {
      samples = parseSamplesFile(readFileSync(opsFile, 'utf-8'));
      unlinkSync(opsFile);
    }
  } catch (error) {
    console.error(`[ops] could not read ${path.basename(opsFile)} (non-fatal): ${toMessage(error)}`);
    return;
  }

  const summaries = summarizeOpsSamples(samples);
  if (summaries.length === 0) {
    console.log('[ops] no RPC samples captured for this sweep');
    return;
  }

  for (const s of summaries) {
    console.log(
      `[ops] ${JOB_NAME} ${s.target}: ${s.calls} calls, ${s.errors} errors, p50 ${s.p50Ms} ms, methods ${JSON.stringify(s.methods)}`
    );
  }

  const client = createPgClient();
  try {
    await client.connect();
    for (const s of summaries) {
      await client.query(
        `
        insert into rpc_metrics_runs (run_at, target, calls, errors, p50_ms, p95_ms, p99_ms, job, methods)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (run_at, target) do nothing
        `,
        [
          runAt,
          s.target,
          s.calls,
          s.errors,
          s.p50Ms,
          s.p95Ms,
          s.p99Ms,
          JOB_NAME,
          JSON.stringify(s.methods),
        ]
      );
    }
    console.log(
      `[ops] persisted ${summaries.length} rpc target summary(ies) for job=${JOB_NAME} run_at=${runAt.toISOString()}`
    );
  } catch (error) {
    console.error(`[ops] persist failed (non-fatal): ${toMessage(error)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  console.log('=== Starting wallet alert sweep ===');
  const runAt = new Date();

  // RP1: one sample file per run, inherited by both children.
  const opsFile = path.resolve(process.cwd(), 'tmp', `ops-metrics-${JOB_NAME}-${runAt.getTime()}.jsonl`);
  try {
    mkdirSync(path.dirname(opsFile), { recursive: true });
    process.env.OPS_METRICS_FILE = opsFile;
  } catch (error) {
    console.error(`[ops] could not prepare ${opsFile} (non-fatal): ${toMessage(error)}`);
  }

  // Full-fleet health sweep: strip any wallet targeting so 81 selects all active
  // wallets (see 81's getTargetWalletId / wallet-selection branch).
  const sweepEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete sweepEnv.WALLET_ID;
  delete sweepEnv.USER_WALLET_ID;

  try {
    try {
      console.log('\n--- 1. Refresh wallet_pool_health (all active wallets) ---');
      await runCommand(
        'pnpm',
        ['tsx', 'src/scripts/wallets/81-stellar-wallet-blend-positions.ts'],
        { env: sweepEnv }
      );
    } catch (error) {
      console.error('[wallet-alert-job] health refresh (81) failed — aborting evaluator.');
      console.error(error);
      process.exitCode = 1;
      return;
    }

    try {
      console.log('\n--- 2. Evaluate alert rules ---');
      await runCommand('pnpm', ['run', 'job:alerts'], { cwd: API_DIR });
    } catch (error) {
      console.error('[wallet-alert-job] evaluator (83) failed.');
      console.error(error);
      process.exitCode = 1;
      return;
    }

    console.log('\n=== Wallet alert sweep completed successfully ===');
  } finally {
    await persistOpsObservability(runAt, opsFile);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
