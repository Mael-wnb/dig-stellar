# S1 — Postgres port reachable from outside through Docker (found during the Lot AD audit)

Date: 2026-09-28/29. Found while auditing the deploy surface for Lot AD (CI/CD & deploy
discipline). Remediation: `s1-remediation-runbook.md` (founder executes; outcomes in
`s1-remediation-execution.md`).

## Finding

Docker publishes container ports through its own iptables chains (`DOCKER`, `DOCKER-USER`,
in the FORWARD path). ufw filters INPUT and never sees that traffic, so a compose
`ports: "5432:5432"` (host address `0.0.0.0`) is reachable from outside even under ufw
default-deny. That was the case for the Postgres container on the VPS: an external TCP
connection to the Postgres port succeeded.

Repo cross-checks: the compose file at `0d0a868` bound Postgres, Redis and the Lot Z api
service without a host address. `pgcrypto`, the one non-default extension present, is created
by `apps/api/src/db/stellar_v1.sql:1` for `gen_random_uuid()`.

Redis: the compose `redis` service (no authentication) had the same binding, but it does not
run in prod — the VPS Redis is a native systemd service on loopback, and nothing in `apps/api`
or `apps/indexer` depends on Redis. Disabling that native service is separate housekeeping,
outside S1; the compose service keeps the loopback binding as hygiene.

## Fix (this branch, `fix/s1-postgres-bind`)

- `docker-compose.yml`: every `ports:` entry binds `127.0.0.1`; `POSTGRES_PASSWORD` has no
  default (`${POSTGRES_PASSWORD:?…}`) and feeds the container `DATABASE_URL`s, so a rotated
  password is recorded in the root `.env` (gitignored) and a volume re-init cannot fall back to
  the dev value; `json-file` log rotation on every service (`max-size 20m`, `max-file 5`) since
  `log_connections` is switched on. CI never runs compose (`ci.yml` has no docker step); local
  dev copies `.env.example` (`POSTGRES_PASSWORD=dig`).
- Password rotation in place (`ALTER USER`), value generated on the VPS and never printed.
- `docs/security-invariants.md` §10 (INV-10.1 … 10.4); `docs/deployment.md` §Network posture;
  `docs/reference-deployment.md` gains the `cp .env.example .env` step.
- Persistent, generalised `DOCKER-USER` rule (drop new inbound from the public interfaces to
  any container), applied in a separate slot (runbook phase 7).

## Verification

- External test before the fix: connection to the Postgres port open. After the temporary
  `DOCKER-USER` rules and again after the permanent fix: closed (timeout). Recorded in the
  execution note.
- Instance review: roles, databases, extensions and container processes checked; active
  connections all originated from the host. No indicator of compromise was found.
- Limit, stated as is: `log_connections` was off on the container, so the absence of a
  successful external login before the fix cannot be proven from the logs. The password is
  rotated regardless, and `log_connections` is on from the remediation onwards.

## Lot S

The Lot S recon treated ufw as the perimeter and did not enumerate Docker-published ports;
the point was missed then and is covered by INV-10.1 now. The S2 edge hardening is unaffected.

Note on the file name the brief used: the invariants live at `docs/security-invariants.md`.
