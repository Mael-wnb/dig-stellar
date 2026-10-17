// apps/indexer/src/scripts/85-run-campaign-job.ts
//
// Lot EP (EP1, gate 3): the campaign award orchestrator — the single command a
// cron entry calls (job:campaign), mirroring 82-run-wallet-alert-job.ts. ONE
// step: spawn `pnpm run job:campaign-award` in apps/api (84-campaign-award.ts,
// which owns the SQL through the API's CampaignRepository) and relay its exit
// code. No refresh, no evaluator, nothing else. Serialized on the VPS by
// `flock -n /tmp/dig-stellar-campaign.lock` (docs/runbooks.md, "Campaign
// award job"); the award script is idempotent regardless.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const API_DIR = path.resolve(__dirname, '../../../api');

function runCommand(command: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      cwd: opts.cwd,
      env: { ...process.env },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`));
    });
  });
}

async function main() {
  console.log('=== Starting campaign award job ===');
  try {
    await runCommand('pnpm', ['run', 'job:campaign-award'], { cwd: API_DIR });
  } catch (error) {
    console.error('[campaign-job] award (84) failed.');
    console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log('=== Campaign award job completed successfully ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
