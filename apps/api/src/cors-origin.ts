// apps/api/src/cors-origin.ts
//
// CORS origin policy for the API process (Lot S2 exact list + Lot SDK0 Vercel previews).
// Pure functions so the policy is unit-testable without booting Nest.

// Vercel preview deployments of the web app (branch previews
// `dig-stellar-web-git-<branch>-…` and per-deployment URLs `dig-stellar-web-<hash>-…`).
// The team suffix `dig-7a565626` is part of the pattern on purpose: a same-named Vercel
// project under another team does not match. Previews are allowed so UI work can be
// validated against production data; the beta grouping key travels in a request header,
// not a cookie, so an allowed origin cannot borrow a user's identity
// (docs/security-invariants.md §7).
export const VERCEL_PREVIEW_ORIGIN =
  /^https:\/\/dig-stellar-web-[a-z0-9-]+-dig-7a565626\.vercel\.app$/;

export function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw || 'http://localhost:5173,http://127.0.0.1:5173';

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(
  origin: string,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}
