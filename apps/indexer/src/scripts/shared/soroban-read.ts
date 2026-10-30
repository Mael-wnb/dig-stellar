// apps/indexer/src/scripts/shared/soroban-read.ts
//
// Sequential, read-only Soroban contract reader for the price sources (phase B).
// One `simulateTransaction` per call, through the RPC the indexer is configured
// with (resolveRpcUrl: operator endpoint first). Design rules, from the recon:
//   - the account sequence is fetched ONCE per reader, not once per call (the
//     recon hit HTTP 429 on the public endpoint after ~40 unspaced calls that
//     each refetched the account);
//   - calls are strictly sequential with a small spacing;
//   - a 429 / timeout / network error is retried once after a backoff, then the
//     read is reported as absent. The reader NEVER throws: a dead source is a
//     missing price for this run, never a failed refresh.
import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

export type ReadErrorKind = 'rate_limited' | 'timeout' | 'network' | 'simulation' | 'account';

export type ReadResult =
  | { ok: true; value: unknown; latestLedger: number | null }
  | { ok: false; kind: ReadErrorKind; error: string };

// Raw variant (Lot XO): the undecoded return value, for callers that decode by
// XDR type themselves (struct-keyed maps, i128 kept as BigInt until scaled).
export type RawReadResult =
  | { ok: true; retval: xdr.ScVal | null; latestLedger: number | null }
  | { ok: false; kind: ReadErrorKind; error: string };

export type SorobanReaderOptions = {
  rpcUrl: string;
  sourceAccount: string;
  /** Minimum gap between two simulations (ms). Default 120. */
  spacingMs?: number;
  /** Per-request timeout (ms). Default 15 000. */
  timeoutMs?: number;
  /** Backoff before the single retry on 429 / timeout / network (ms). Default 2 000. */
  retryBackoffMs?: number;
  /** Set to 0 to disable the retry. Default 1. */
  retries?: number;
  /** Observability hook: one call per simulation attempt (ops-metrics `price-oracle` target). */
  onSample?: (sample: { ok: boolean; durationMs: number }) => void;
};

export type ReaderStats = { calls: number; retries: number; failures: number };

// Pure: map an RPC / HTTP error message to a kind the caller can reason about.
export function classifyReadError(message: string): ReadErrorKind {
  const m = message.toLowerCase();
  if (m.includes('429') || m.includes('too many requests') || m.includes('rate limit')) return 'rate_limited';
  if (m.includes('timeout') || m.includes('econnaborted') || m.includes('timed out')) return 'timeout';
  if (
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('network error') ||
    m.includes('socket hang up') ||
    m.includes('fetch failed')
  ) {
    return 'network';
  }
  return 'simulation';
}

export function isRetryable(kind: ReadErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'timeout' || kind === 'network';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SorobanReader {
  readonly stats: ReaderStats = { calls: 0, retries: 0, failures: 0 };
  private readonly server: rpc.Server;
  private readonly opts: Required<Omit<SorobanReaderOptions, 'onSample'>> & Pick<SorobanReaderOptions, 'onSample'>;
  private sequence: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastCallAt = 0;

  constructor(options: SorobanReaderOptions) {
    this.opts = {
      spacingMs: 120,
      timeoutMs: 15_000,
      retryBackoffMs: 2_000,
      retries: 1,
      ...options,
    };
    this.server = new rpc.Server(this.opts.rpcUrl, { timeout: this.opts.timeoutMs });
  }

  /** Read-only simulation of `method(args)` on `contractId`; never throws. */
  async read(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<ReadResult> {
    const raw = await this.readRaw(contractId, method, args);
    if (!raw.ok) return raw;
    return { ok: true, value: raw.retval ? scValToNative(raw.retval) : null, latestLedger: raw.latestLedger };
  }

  /** Same as `read`, but returns the raw `xdr.ScVal` (no scValToNative); never throws. */
  readRaw(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<RawReadResult> {
    // Serialise every call on one chain so reads are strictly sequential.
    const run = this.queue.then(() => this.readSequential(contractId, method, args));
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async readSequential(contractId: string, method: string, args: xdr.ScVal[]): Promise<RawReadResult> {
    let attempt = 0;
    for (;;) {
      await this.space();
      this.stats.calls += 1;
      const startedAt = Date.now();
      const result = await this.simulateOnce(contractId, method, args);
      this.opts.onSample?.({ ok: result.ok, durationMs: Date.now() - startedAt });
      if (result.ok) return result;
      if (attempt < this.opts.retries && isRetryable(result.kind)) {
        attempt += 1;
        this.stats.retries += 1;
        if (result.kind === 'account') this.sequence = null;
        await sleep(this.opts.retryBackoffMs);
        continue;
      }
      this.stats.failures += 1;
      return result;
    }
  }

  private async space(): Promise<void> {
    const wait = this.lastCallAt + this.opts.spacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async loadSequence(): Promise<string> {
    if (this.sequence !== null) return this.sequence;
    const account = await this.server.getAccount(this.opts.sourceAccount);
    this.sequence = account.sequenceNumber();
    return this.sequence;
  }

  private async simulateOnce(contractId: string, method: string, args: xdr.ScVal[]): Promise<RawReadResult> {
    let sequence: string;
    try {
      sequence = await this.loadSequence();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = classifyReadError(message);
      return { ok: false, kind: kind === 'simulation' ? 'account' : kind, error: `getAccount: ${message}` };
    }
    try {
      const tx = new TransactionBuilder(new Account(this.opts.sourceAccount, sequence), {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(new Contract(contractId).call(method, ...args))
        .setTimeout(30)
        .build();
      const sim = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        return { ok: false, kind: 'simulation', error: sim.error.slice(0, 300) };
      }
      const success = sim as rpc.Api.SimulateTransactionSuccessResponse;
      const retval = success.result?.retval;
      return {
        ok: true,
        retval: retval ?? null,
        latestLedger: typeof success.latestLedger === 'number' ? success.latestLedger : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, kind: classifyReadError(message), error: message.slice(0, 300) };
    }
  }
}

// Small ScVal builders shared by the price readers.
export const scU32 = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);
export const scU128 = (n: bigint): xdr.ScVal => {
  const hi = n >> 64n;
  const lo = n & ((1n << 64n) - 1n);
  return xdr.ScVal.scvU128(
    new xdr.UInt128Parts({ hi: xdr.Uint64.fromString(hi.toString()), lo: xdr.Uint64.fromString(lo.toString()) })
  );
};
