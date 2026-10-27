// apps/api/src/common/redact.ts
//
// Lot SEC (G1): scrub operator secrets out of free-text error messages before
// they reach a public surface (/v1/ops/metrics, /v1/ops/status).
//
// Error messages produced by HTTP clients and SDKs routinely embed the request
// URL, and an operator endpoint URL may carry an API key in its path or query.
// The indexer applies the same rules before persisting (apps/indexer/src/lib/
// redact.ts — keep the two in sync); the API applies them again at read time so
// rows written before this rule are covered too.
//
// Rules, in order:
//   1. any http(s) URL → scheme + host only ("https://host/[redacted]");
//   2. "bearer <x>", "api-key=<x>", "token: <x>", "secret=<x>" → value redacted;
//   3. any bare opaque token of 32+ [A-Za-z0-9_-] chars → "[redacted]"
//      (long enough to be a key; readable step messages never need one).

const URL_RE = /https?:\/\/[^\s'"<>()\[\]]+/gi;
const LABELLED_SECRET_RE = /\b(bearer|api[-_]?key|token|secret|password)\b(\s*[=:]\s*|\s+)([^\s'"&]+)/gi;
const OPAQUE_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

function hostOnly(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/[redacted]`;
  } catch {
    return '[redacted-url]';
  }
}

/** Redact secrets from a message; null/undefined pass through unchanged. */
export function redactSecrets<T extends string | null | undefined>(message: T): T {
  if (message == null) return message;
  const text = String(message);
  const out = text
    .replace(URL_RE, (url) => hostOnly(url))
    .replace(LABELLED_SECRET_RE, (_m, label: string, sep: string) => `${label}${sep}[redacted]`)
    .replace(OPAQUE_TOKEN_RE, '[redacted]');
  return out as T;
}
