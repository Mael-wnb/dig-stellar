// apps/indexer/src/lib/ops-metrics.ts
//
// E2 (Lot E — T3-D3): RPC latency + error capture for the refresh pipeline.
//
// Every external call the indexer makes flows through exactly two HTTP stacks:
//   1. global fetch      — fetchJson/rpcCall (00-common), Horizon reads,
//                          CoinGecko/DefiLlama/stellar.expert fetches
//   2. the axios copy    — @stellar/stellar-sdk rpc.Server (simulateTransaction),
//      shared by the SDKs  @blend-capital/blend-sdk internals, @defindex/sdk
// installOpsCapture() wraps both at that lowest shared layer with a timer that
// records { target, ok, durationMs } per call, in memory, for THIS process.
//
// Persistence: on process exit the samples are appended as JSON lines to the
// file named by OPS_METRICS_FILE (set by the 71 orchestrator, inherited by the
// spawned step processes). No env var -> capture stays in-memory only and
// nothing is written. Samples never contain URLs (RPC paths can embed API keys).
//
// Beta-first: no metrics libraries, no daemon — plain wrappers + one JSONL file
// merged into rpc_metrics_runs by the orchestrator at end of run.

import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveRpcUrl } from './rpc-config';

export type OpsTarget = 'soroban-rpc' | 'horizon' | 'defindex-api' | 'price-sources';

export type OpsSample = {
  target: OpsTarget;
  ok: boolean;
  durationMs: number;
};

export type OpsTargetSummary = {
  target: OpsTarget;
  calls: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

const samples: OpsSample[] = [];

export function recordOpsSample(sample: OpsSample): void {
  samples.push(sample);
}

// ── Target classification (host only — never inspect/keep paths) ─────────────

// The stable target set from the Lot E brief. price-sources covers ALL external
// price/stats providers on the live path (CoinGecko, DefiLlama, stellar.expert).
const PRICE_SOURCE_HOSTS = ['coingecko.com', 'llama.fi', 'stellar.expert'];

let rpcHostsCache: Set<string> | null = null;

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function rpcHosts(): Set<string> {
  if (!rpcHostsCache) {
    rpcHostsCache = new Set<string>();
    for (const candidate of [
      resolveRpcUrl(),
      process.env.STELLAR_RPC_URL,
      process.env.SOROBAN_RPC_URL,
      'https://mainnet.sorobanrpc.com',
    ]) {
      const host = hostOf(candidate);
      if (host) rpcHostsCache.add(host);
    }
  }
  return rpcHostsCache;
}

export function classifyOpsTarget(url: string): OpsTarget | null {
  const host = hostOf(url);
  if (!host) return null;

  if (rpcHosts().has(host)) return 'soroban-rpc';
  if (host === hostOf(process.env.HORIZON_URL) || host.includes('horizon')) {
    return 'horizon';
  }
  if (host.includes('defindex')) return 'defindex-api';
  if (PRICE_SOURCE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return 'price-sources';
  }

  return null;
}

// ── Capture installation ─────────────────────────────────────────────────────

let installed = false;

export function installOpsCapture(): void {
  if (installed) return;
  installed = true;

  patchGlobalFetch();
  patchSdkAxios();

  // appendFileSync so the flush survives process.exit(1) paths ('exit' handlers
  // must be synchronous). SIGKILL loses the process's samples — acceptable.
  process.on('exit', () => {
    flushSamplesToFile();
  });
}

function patchGlobalFetch(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const target = classifyOpsTarget(url);
    if (!target) return originalFetch(input as RequestInfo, init);

    const start = Date.now();
    try {
      const res = await originalFetch(input as RequestInfo, init);
      // Non-2xx counts as an error: fetchJson treats it as a failure (only 429
      // is retried) and the grant criterion is error RATE, not exception rate.
      recordOpsSample({ target, ok: res.ok, durationMs: Date.now() - start });
      return res;
    } catch (err) {
      recordOpsSample({ target, ok: false, durationMs: Date.now() - start });
      throw err;
    }
  }) as typeof globalThis.fetch;
}

// Reach the axios module instance each SDK actually uses (pnpm keeps transitive
// deps out of our node_modules, so a plain import of 'axios' would not resolve).
// Patching Axios.prototype.request covers every axios instance created from
// that module copy — rpc.Server clients, blend-sdk internals, defindex client.
function patchSdkAxios(): void {
  const localRequire = createRequire(__filename);

  const entryPoints = [
    '@stellar/stellar-sdk',
    '@blend-capital/blend-sdk',
    '@defindex/sdk',
  ];

  const patchedModules = new Set<unknown>();

  for (const pkg of entryPoints) {
    try {
      const pkgEntry = localRequire.resolve(pkg);
      const pkgRequire = createRequire(pkgEntry);
      // blend-sdk reaches axios through ITS stellar-sdk copy, not directly.
      const axiosMod =
        pkg === '@blend-capital/blend-sdk'
          ? createRequire(pkgRequire.resolve('@stellar/stellar-sdk'))('axios')
          : pkgRequire('axios');

      if (!patchedModules.has(axiosMod)) {
        patchedModules.add(axiosMod);
        patchAxiosModule(axiosMod);
      }
    } catch (err) {
      // Capture must never break ingestion — log and move on.
      console.warn(
        `[ops-metrics] axios capture unavailable for ${pkg}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

type AxiosLikeConfig = { url?: string; baseURL?: string };

function fullAxiosUrl(config: AxiosLikeConfig, instance: unknown): string | null {
  const url = config.url ?? '';
  if (/^https?:\/\//i.test(url)) return url;

  const baseURL =
    config.baseURL ??
    (instance as { defaults?: { baseURL?: string } })?.defaults?.baseURL;
  if (!baseURL) return url || null;

  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function patchAxiosModule(axiosMod: unknown): void {
  const AxiosClass = (axiosMod as { Axios?: { prototype: Record<string, unknown> } })?.Axios;
  const proto = AxiosClass?.prototype;
  const original = proto?.request;
  if (typeof original !== 'function' || (original as { __opsPatched?: boolean }).__opsPatched) {
    return;
  }

  const patched = async function (
    this: unknown,
    configOrUrl: AxiosLikeConfig | string,
    maybeConfig?: AxiosLikeConfig
  ) {
    const config: AxiosLikeConfig =
      typeof configOrUrl === 'string'
        ? { ...(maybeConfig ?? {}), url: configOrUrl }
        : (configOrUrl ?? {});

    const fullUrl = fullAxiosUrl(config, this);
    const target = fullUrl ? classifyOpsTarget(fullUrl) : null;
    if (!target) {
      return (original as (...args: unknown[]) => unknown).call(this, configOrUrl, maybeConfig);
    }

    const start = Date.now();
    try {
      // axios resolves only on 2xx by default, so resolved == ok here.
      const res = await (original as (...args: unknown[]) => Promise<unknown>).call(
        this,
        configOrUrl,
        maybeConfig
      );
      recordOpsSample({ target, ok: true, durationMs: Date.now() - start });
      return res;
    } catch (err) {
      recordOpsSample({ target, ok: false, durationMs: Date.now() - start });
      throw err;
    }
  };
  (patched as unknown as { __opsPatched: boolean }).__opsPatched = true;
  proto!.request = patched;
}

// ── Flush (child processes) + read/summarize (orchestrator) ──────────────────

function flushSamplesToFile(): void {
  const file = process.env.OPS_METRICS_FILE?.trim();
  if (!file || samples.length === 0) return;

  try {
    const lines = samples
      .map((s) => JSON.stringify({ t: s.target, ok: s.ok, ms: s.durationMs }))
      .join('\n');
    appendFileSync(file, `${lines}\n`, 'utf-8');
  } catch (err) {
    console.warn(
      `[ops-metrics] failed to flush ${samples.length} sample(s): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function parseSamplesFile(content: string): OpsSample[] {
  const parsed: OpsSample[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as { t?: unknown; ok?: unknown; ms?: unknown };
      if (
        typeof row.t === 'string' &&
        typeof row.ok === 'boolean' &&
        typeof row.ms === 'number' &&
        Number.isFinite(row.ms)
      ) {
        parsed.push({ target: row.t as OpsTarget, ok: row.ok, durationMs: Math.round(row.ms) });
      }
    } catch {
      // Skip torn/partial lines (e.g. a killed writer) rather than losing the run.
    }
  }

  return parsed;
}

// Nearest-rank percentile over the run's ACTUAL samples (sorted array — no
// libraries, no interpolation): honest per-run numbers, never averaged.
function percentile(sortedAsc: number[], q: number): number {
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[index];
}

export function summarizeOpsSamples(all: OpsSample[]): OpsTargetSummary[] {
  const byTarget = new Map<OpsTarget, OpsSample[]>();

  for (const sample of all) {
    const bucket = byTarget.get(sample.target);
    if (bucket) {
      bucket.push(sample);
    } else {
      byTarget.set(sample.target, [sample]);
    }
  }

  return Array.from(byTarget.entries())
    .map(([target, targetSamples]) => {
      const durations = targetSamples.map((s) => s.durationMs).sort((a, b) => a - b);
      return {
        target,
        calls: targetSamples.length,
        errors: targetSamples.filter((s) => !s.ok).length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
      };
    })
    .sort((a, b) => a.target.localeCompare(b.target));
}
