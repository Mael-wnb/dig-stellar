# Lot S — API Hardening & Rate Limiting

Execution brief for Claude Code. Founder ask 2026-08-16: a security check-up of the
public API + a first rate-limiting layer, ahead of the faucet lot (which will add
abuse incentives). Beta-first: harden what is cheap and measurable, document the
rest honestly. NO auth system in this lot. Evidence: `docs/evidence/lot-s/`.

## S0 — Surface recon (REPORT before any change)

Enumerate the real public surface and its current protections:

- Every route Nest exposes (controllers sweep) × the nginx config actually
  in front of it. Classify: open reads / state-mutating (POST actions builds,
  wallets connect + PATCH, alert rules CRUD, tx submits) / ops.
- **`/v1/ops/metrics` and `/v1/ops/adoption`**: currently public? They leak
  usage/adoption data to anyone. Recommend: keep public (grant transparency)
  or gate behind a static token — report, founder decides.
- Current state of: CORS (locked to the app origin or `*`?), body-size limits,
  validation coverage (which endpoints accept unvalidated params), error
  responses (stack traces / internal paths leaking in prod?), response headers
  (x-powered-by, missing security headers), and anything sensitive in responses.
- Observed traffic shape (nginx access logs + ops metrics): requests/min
  baseline overall and per hot endpoint — rate limits must come from OBSERVED
  traffic, not guesses; the dashboard legitimately fires several calls per load.

STOP-and-report: inventory table + proposed limits. Then continue on go.

## S1 — Rate limiting (nginx layer — one layer, measured)

- `limit_req` zones in the nginx site config, keyed by IP:
  - general API zone: generous (from the S0 baseline — the dashboard must never
    trip it; think per-IP burst covering a full page load ×3);
  - strict zone on `POST /v1/actions/*` (build endpoints — these cost RPC
    simulation): low steady rate, small burst;
  - medium zone on wallet/alert mutations (POST/PATCH/DELETE).
- 429 responses with a plain JSON body (the web can show an honest "slow down"
  rather than a parse error).
- Prove it: curl loops in the evidence — a burst trips 429, normal cadence
  never does; the web app under normal navigation stays clean.
- Document the zones + values in `deployment.md` (they are ops config, they
  must survive the next VPS rebuild).
- NestJS `@nestjs/throttler` as a second layer: NOT in this lot unless S0 finds
  an endpoint nginx cannot distinguish — one measured layer beats two guessed.

## S2 — Cheap hardening from the recon

Only what S0 shows is missing, typically:

- security headers (helmet or nginx `add_header`), x-powered-by off;
- CORS locked to the real app origins;
- body-size limit consistent with the largest legit payload (XDR submits);
- prod error responses: no stack traces, no internal paths (Nest exception
  filter check);
- validation gaps on params S0 flagged (UUID format enforcement where absent —
  this may also be the moment the known UUID-regex-vs-demo-userId quirk gets
  fixed IF trivial; otherwise leave flagged).

## S3 — The userId bearer-token debt (document, don't solve)

The standing model (userId in localStorage = bearer token) stays for the beta.
This lot only: confirm consistent ownership checks on every user-scoped
endpoint (wallets, alerts, overview — the W1 pattern), consistent 404-vs-403
behavior (no resource enumeration oracle), and a short honest paragraph in
`security-invariants.md` stating the model, its limits, and the rate-limit layer
now in front of it. A real auth system is post-beta scope.

## Validation & evidence

- Endpoint inventory + protections table (S0) · before/after header diffs ·
  429 proof curls · app-navigation-under-limits check · docs flagged
  (deployment.md zones, security-invariants.md §S3).
- API tests stay 85/85; no contract changes.

## Out of scope

Auth/login/sessions · WAF/CDN · the faucet (own lot, depends on this one) ·
infra beyond the nginx site config + api app · request signing.
