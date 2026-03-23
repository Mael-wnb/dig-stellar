// src/scripts/ingest/72-run-refresh-job.ts
import { spawn } from 'node:child_process';

function runCommand(
  command: string,
  args: string[],
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        ...(env ?? {}),
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
  const stellarRpcUrl = process.env.STELLAR_RPC_URL ?? process.env.SOROBAN_RPC_URL ?? '';

  if (!stellarRpcUrl) {
    throw new Error('Missing STELLAR_RPC_URL (or SOROBAN_RPC_URL)');
  }

  const jobEnv: Record<string, string> = {
    STELLAR_RPC_URL: stellarRpcUrl,
    LEDGER_LOOKBACK: process.env.LEDGER_LOOKBACK ?? '20000',
    EVENTS_LIMIT: process.env.EVENTS_LIMIT ?? '200',
    MAX_EVENT_PAGES: process.env.MAX_EVENT_PAGES ?? '50',
  };

  console.log('=== Starting global refresh job ===');
  console.log({
    stellarRpcUrl: jobEnv.STELLAR_RPC_URL,
    ledgerLookback: jobEnv.LEDGER_LOOKBACK,
    eventsLimit: jobEnv.EVENTS_LIMIT,
    maxEventPages: jobEnv.MAX_EVENT_PAGES,
  });

  await runCommand('pnpm', ['tsx', 'src/scripts/ingest/71-refresh-all-metrics.ts'], jobEnv);

  console.log('=== Global refresh job completed successfully ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});