# Public API changelog

One line per change to `apps/api/openapi/openapi.v1.yaml`, newest first. Rules in
`docs/decisions/2026-11-03-public-api-v1-surface.md`: additive only inside `/v1`; a
breaking change ships as `/v2`; `beta` operations may change shape but still take a line here.

## 1.0.0 — 2026-11-03

- Initial public surface: 15 operations (9 stable, 6 beta), served at `GET /v1/openapi.json`,
  rendered at `GET /v1/docs`.
