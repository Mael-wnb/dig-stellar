import type { NestError, NestInternalError, RateLimited } from './types';

/**
 * The documented non-2xx body shapes (`NestError`, `NestInternalError`, `RateLimited`).
 * Not validated at runtime: an undocumented JSON body is still exposed under this type,
 * and `rawBody` always carries the exact text the server sent.
 */
export type ApiErrorBody = NestError | NestInternalError | RateLimited;

export interface DigApiErrorInit {
  status: number;
  method: string;
  url: string;
  body: ApiErrorBody | undefined;
  rawBody: string;
  retryAfterSeconds?: number;
}

/** Thrown for every non-2xx response. `status` is the HTTP status, `body` the parsed JSON. */
export class DigApiError extends Error {
  override readonly name = 'DigApiError';
  readonly status: number;
  readonly method: string;
  readonly url: string;
  /** Parsed JSON body, `undefined` when the body was empty or not JSON. */
  readonly body: ApiErrorBody | undefined;
  /** The response text, unparsed. */
  readonly rawBody: string;
  /** Only set on `429`, parsed from the `Retry-After` header (seconds or HTTP-date). */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: DigApiErrorInit) {
    super(describe(init));
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
    this.rawBody = init.rawBody;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Thrown when the request exceeds `timeoutMs` (the SDK aborts it via AbortController). */
export class DigTimeoutError extends Error {
  override readonly name = 'DigTimeoutError';
  readonly method: string;
  readonly url: string;
  readonly timeoutMs: number;

  constructor(method: string, url: string, timeoutMs: number) {
    super(`${method} ${url} timed out after ${timeoutMs} ms`);
    this.method = method;
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

function describe(init: DigApiErrorInit): string {
  const message =
    init.body && typeof init.body === 'object' && 'message' in init.body
      ? String(init.body.message)
      : init.rawBody.slice(0, 200) || '(empty body)';
  return `${init.method} ${init.url} -> ${init.status}: ${message}`;
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP-date. Returns whole seconds,
 * never negative, or `undefined` when the header is absent or unreadable.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Every HTTP-date form (IMF-fixdate, RFC 850, asctime) starts with a weekday name;
  // without that guard Date.parse reads strings like "-5" as a year.
  if (!/^[A-Za-z]{3}/.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
