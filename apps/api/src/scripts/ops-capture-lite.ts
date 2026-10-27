// apps/api/src/scripts/ops-capture-lite.ts
//
// Lot RP (RP1): RPC call capture for the API-side job scripts (83-evaluate-alerts).
//
// A deliberately small twin of apps/indexer/src/lib/ops-metrics.ts. The indexer
// module cannot be imported from here: `nest build` compiles everything under
// apps/api/src, and the capture must patch the API's OWN copy of the SDK's axios
// (pnpm gives each package its own module graph). So this file patches
// `@stellar/stellar-sdk`'s axios as resolved from apps/api and writes samples in
// the SAME JSON-lines shape ({ t, ok, ms, m }) to OPS_METRICS_FILE, which the 82
// orchestrator (indexer) merges with 81's samples into rpc_metrics_runs rows
// (job = 'wallet-alert'). No env var → nothing is written.
//
// Import this as the FIRST import of a script, before any SDK-touching module.
// Samples never contain URLs (RPC paths can embed API keys).

import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type Sample = { t: 'soroban-rpc'; ok: boolean; ms: number; m: string };

const samples: Sample[] = [];
let installed = false;

function methodFromBody(body: unknown): string {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const method = (parsed as { method?: unknown })?.method;
    return typeof method === 'string' ? method : 'unknown';
  } catch {
    return 'unknown';
  }
}

type AxiosLikeConfig = { url?: string; baseURL?: string; data?: unknown };

function isRpcCall(config: AxiosLikeConfig, instance: unknown): boolean {
  const base =
    config.baseURL ??
    (instance as { defaults?: { baseURL?: string } })?.defaults?.baseURL ??
    '';
  const url = /^https?:\/\//i.test(config.url ?? '') ? (config.url ?? '') : base;
  if (!url) return false;
  // JSON-RPC body with a method = a Soroban RPC call; anything else (Horizon GETs
  // the API also makes through the SDK) is out of scope for this lite capture.
  return methodFromBody(config.data) !== 'unknown' && /^https?:\/\//i.test(url);
}

function patchAxios(): void {
  const localRequire = createRequire(__filename);
  const sdkEntry = localRequire.resolve('@stellar/stellar-sdk');
  const axiosMod = createRequire(sdkEntry)('axios') as {
    Axios?: { prototype: Record<string, unknown> };
  };
  const proto = axiosMod?.Axios?.prototype;
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
    if (!isRpcCall(config, this)) {
      return (original as (...args: unknown[]) => unknown).call(this, configOrUrl, maybeConfig);
    }
    const m = methodFromBody(config.data);
    const start = Date.now();
    try {
      const res = await (original as (...args: unknown[]) => Promise<unknown>).call(
        this,
        configOrUrl,
        maybeConfig
      );
      samples.push({ t: 'soroban-rpc', ok: true, ms: Date.now() - start, m });
      return res;
    } catch (err) {
      samples.push({ t: 'soroban-rpc', ok: false, ms: Date.now() - start, m });
      throw err;
    }
  };
  (patched as unknown as { __opsPatched: boolean }).__opsPatched = true;
  proto!.request = patched;
}

export function installOpsCaptureLite(): void {
  if (installed) return;
  installed = true;
  try {
    patchAxios();
  } catch (err) {
    // Capture must never break the job — log and move on.
    console.warn(
      `[ops-capture-lite] axios capture unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  process.on('exit', () => {
    const file = process.env.OPS_METRICS_FILE?.trim();
    if (!file || samples.length === 0) return;
    try {
      appendFileSync(file, `${samples.map((s) => JSON.stringify(s)).join('\n')}\n`, 'utf-8');
    } catch (err) {
      console.warn(
        `[ops-capture-lite] failed to flush ${samples.length} sample(s): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

installOpsCaptureLite();
