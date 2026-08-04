// apps/indexer/src/scripts/shared/retry.ts
//
// Standardized exponential-backoff retry for the refresh orchestrator (T3-D1).
// One mechanism for every step of the refresh chain (71-refresh-all-metrics),
// so a transient RPC / provider hiccup retries instead of failing the cycle.
//
// Backoff: baseDelayMs * 4^(attempt-1) + jitter → 5s, 20s, then give up
// (attempts=3, baseDelayMs=5000). Each retry logs the step label + delay.
import { spawn } from 'node:child_process';

export type RunTsxWithRetryOptions = {
  /** Extra env vars merged over process.env for the child (e.g. ENTITY_SLUG). */
  env?: Record<string, string>;
  /** Total attempts before giving up (default 3). */
  attempts?: number;
  /** Base backoff in ms; grows ×4 per attempt (default 5000 → 5s, 20s). */
  baseDelayMs?: number;
  /** Human label for logs (defaults to the script path). */
  label?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single run of `pnpm tsx <scriptPath>` — resolves on exit 0, rejects otherwise.
function runTsxOnce(
  scriptPath: string,
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['tsx', scriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(env ?? {}),
      },
    });

    child.on('error', reject);

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed (${code}): pnpm tsx ${scriptPath}`));
      }
    });
  });
}

// Run a tsx step with exponential backoff. Throws the last error if all
// attempts fail (callers that must stay non-fatal wrap this in try/catch — the
// retries happen INSIDE, catch-and-log stays the last resort).
export async function runTsxWithRetry(
  scriptPath: string,
  options: RunTsxWithRetryOptions = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 5000;
  const label = options.label ?? scriptPath;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runTsxOnce(scriptPath, options.env);
      if (attempt > 1) {
        console.log(`[retry] ${label} succeeded on attempt ${attempt}/${attempts}`);
      }
      return;
    } catch (error) {
      lastError = error;

      if (attempt >= attempts) {
        console.error(
          `[retry] ${label} failed after ${attempts} attempt(s); giving up`
        );
        break;
      }

      // Exponential backoff with jitter: base * 4^(attempt-1) + up to base/2.
      // Jitter is index-derived (no Math.random) so runs stay deterministic.
      const backoff = baseDelayMs * Math.pow(4, attempt - 1);
      const jitter = (baseDelayMs / 2) * ((attempt * 37) % 10) / 10;
      const delay = Math.round(backoff + jitter);

      console.warn(
        `[retry] ${label} attempt ${attempt}/${attempts} failed; backing off ${delay}ms`
      );
      console.warn(error instanceof Error ? error.message : String(error));

      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${attempts} attempts`);
}
