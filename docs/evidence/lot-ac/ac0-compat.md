# AC0 — Node 24 local compatibility proof

Date: 2026-08-20 · Machine: macOS (darwin arm64), local dev
Runtime under test: **Node v24.19.0** (nvm) + **pnpm 10.32.1** (matches the indexer
`packageManager` pin and the CI pnpm major). Baseline being replaced: Node v20.x.

## Install

- All `node_modules` removed (root + 4 workspaces), then `pnpm install --frozen-lockfile`
  on Node 24: **clean, 7.6s — no lockfile refresh needed** (`pnpm-lock.yaml` untouched,
  `lockfileVersion: '9.0'`).
- Native/postinstall deps all rebuilt successfully: `esbuild` 0.27.3, `bufferutil`,
  `secp256k1`/`tiny-secp256k1` tree, Prisma 5.22.0 engines (preinstall + client
  postinstall OK; the "could not find your Prisma schema" postinstall warning is the
  usual monorepo-root message, pre-existing and harmless — `prisma:generate` against
  `packages/db/prisma/schema.prisma` succeeds).

## Build + suites (all on Node 24)

| Check | Command | Result |
|---|---|---|
| Prisma generate | `pnpm -C packages/db prisma:generate` | OK |
| API build | `pnpm -C apps/api build` (nest build) | OK |
| API tests | `pnpm -C apps/api test` | **13 suites / 129 tests passed** |
| Web build | `pnpm -C apps/web build` (vue-tsc -b + vite) | OK (typecheck green; pre-existing >500 kB chunk warning) |
| Web tests | `pnpm -C apps/web test` | **3 files / 111 tests passed** |
| Indexer typecheck | `tsc --noEmit` in `apps/indexer` | Errors, but **byte-identical output on Node 20 and Node 24** (diff empty) — pre-existing debt, not a Node 24 regression. All errors are in third-party `.d.ts` (`@stellar/stellar-sdk` / `urijs` missing types) plus 2 pre-existing `TS2352` casts in `src/scripts/discovery/qa-reconcile.ts`. The indexer has no typecheck gate today; left as-is (zero app-code changes). |
| Indexer runtime | `pnpm -C apps/indexer job:refresh` vs local docker Postgres | **All 10 steps SUCCESS, 668s total** (blend, soroswap, aquarius, stellar-native, defindex, protocol-metrics, allbridge, network-stats, prices ×2). This is the exact job the VPS cron runs. |

## engines decision

Floor set per the brief — no dependency forces anything higher (NestJS 11, Vite 8,
Vitest 4, Prisma 5.22, tsx 4, stellar-sdk 14 all run on 24 as proven above):

- root / `apps/api` / `apps/indexer` / `packages/db`: `"engines": { "node": ">=24" }` (new fields)
- `apps/web`: `"20.x"` → **`"24.x"`** — deliberately kept the pin style rather than
  `>=24`: Vercel reads this field to select the build runtime, and an open range would
  let Vercel auto-jump to a future major without a repo change. `24.x` still satisfies
  the ">=24 floor" intent.
- `.nvmrc` (tracked, was `20`): → `24`.
- No `engine-strict` added anywhere — enforcement stays advisory, as before.

## Suspicious / notes

- Nothing required a code change. Zero app-code diffs in this lot.
- Local Homebrew pnpm is 9.14.4; AC0 was run with pnpm 10.32.1 installed under the
  Node 24 nvm tree specifically to match CI (`pnpm/action-setup` v10) and the
  `packageManager` pin. The lockfile is compatible with both.
- Node 20 (v20.20.1) remains installed locally via nvm as rollback, mirroring the
  VPS rollback invariant.
