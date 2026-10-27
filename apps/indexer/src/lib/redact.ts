// apps/indexer/src/lib/redact.ts
//
// Lot SEC (G1): scrub operator secrets out of step error messages BEFORE they
// are persisted to refresh_step_runs (read by the public ops endpoints).
//
// HTTP client and SDK errors routinely embed the request URL, and the operator
// RPC endpoint may carry an API key in its path or query (see rpc-config.ts).
// Mirror of apps/api/src/common/redact.ts — keep the two in sync. The API also
// redacts at read time, so older rows are covered; this is the write-side half.
//
// Rules, in order:
//   1. any http(s) URL → scheme + host only ("https://host/[redacted]");
//   2. "bearer <x>", "api-key=<x>", "token: <x>", "secret=<x>" → value redacted;
//   3. any bare opaque token of 32+ [A-Za-z0-9_-] chars → "[redacted]".

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

export function redactSecrets(message: string): string {
  return String(message)
    .replace(URL_RE, (url) => hostOnly(url))
    .replace(LABELLED_SECRET_RE, (_m, label: string, sep: string) => `${label}${sep}[redacted]`)
    .replace(OPAQUE_TOKEN_RE, '[redacted]');
}
