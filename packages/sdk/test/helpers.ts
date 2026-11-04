import type { FetchLike } from '../src/client';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

/** A fetch stub that records every call and answers with the given response. */
export function stubFetch(reply: StubResponse = {}): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const status = reply.status ?? 200;
    const text = reply.rawBody ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return new Response(text, { status, headers: reply.headers ?? {} });
  };
  return { fetch, calls };
}
