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

import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const API_DIR = path.resolve(__dirname, '../../../api');

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

async function main() {
  console.log('=== Starting wallet alert sweep ===');

  // Full-fleet health sweep: strip any wallet targeting so 81 selects all active
  // wallets (see 81's getTargetWalletId / wallet-selection branch).
  const sweepEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete sweepEnv.WALLET_ID;
  delete sweepEnv.USER_WALLET_ID;

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
