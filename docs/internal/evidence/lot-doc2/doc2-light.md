# Lot DOC2-light — internal material out of the reviewer path (2026-11-05)

Branch docs/lot-doc2-light from `main` @ ba6fb5f. Text and file moves only; no code logic change
(code comments citing a moved doc path were updated). Nothing deleted.

## Moves (`git mv`, trees intact)

| From | To | Files |
|---|---|---|
| docs/lot-*.md (20), docs/hotfix-frozen-amm-reserves.md | `docs/internal/briefs/` | 21 |
| docs/alerting/, docs/integrationtrack/ | `docs/internal/alerting/`, `docs/internal/integrationtrack/` | 6 |
| docs/evidence/ (whole tree) | `docs/internal/evidence/` | 582 |
| `docs/status-board.md` (511 lines) | `docs/internal/status-board-archive.md` (header line added, paths rewritten) | 1 |

`git status --short | wc -l` → 644 (610 renames). Path references rewritten in 76 files
(docs, README.md, CLAUDE.md, docker-compose.yml, 2 SQL comments, 11 code comments). Not rewritten:
the `recon` data string in `core-registry.json` / `xoxno-upsert-core.ts` (a persisted metadata value,
not a comment).

## New / rewritten

- `docs/status-board.md`: 67 lines (limit 150); archive kept verbatim apart from the header and paths.
- `docs/internal/README.md`: 10 lines.
- `docs/delivery-playbook.md`: section "Evidence, from Lot DOC2 on".
- `docs/internal/evidence/README.md`: section "Evidence behind public claims", 11 rows.
- `tools/check-doc-links.mjs` + one CI step (`.github/workflows/ci.yml`, job `build-test`).
- Tone pass (facts kept, narration removed): `lot-pre/pre0,pre2,pre3-recon.md`, `lot-doc1/doc1-recon.md`, 21 edits.

## Checks

```
$ node tools/check-doc-links.mjs           # first run after the moves, before fixes
158 markdown files, 691 targets checked, 86 broken
$ node tools/check-doc-links.mjs           # final
161 markdown files, 703 targets checked, 0 broken
$ pnpm -C apps/api build
exit 0
$ wc -l docs/status-board.md
67
```

Pre-existing broken targets fixed on the way (not caused by the move): `docs/tasks/…` (2),
docs/api/openapi.v1.yaml (2, real path `apps/api/openapi/openapi.v1.yaml`), `lot-lm/l0-recon.md`
(2, file exists only on the unmerged `lot-lm` branch), a branch name written as a path (2).
Line-number suffixes (`file.md:12-15`), fenced code blocks, globs and `YYYY` / `-xx-` placeholders
are skipped by the checker.
