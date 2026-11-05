# S0 — Public Surface Recon (Lot S)

Date: 2026-08-17 · Sources: controllers sweep (`apps/api/src`), live nginx config +
access logs on `stellar-api.getdig.ai`, live HTTP probes. Read-only — no changes made.

---

## 1. Route inventory × protections

Classes: **R** open read · **M** state-mutating (user-scoped) · **B** action build
(costs RPC simulation) · **O** ops · **L** legacy (Prisma path, not the product).

| Route | Class | Validation | Ownership check | Notes |
|---|---|---|---|---|
| `GET /health` | O | — | — | uptime probe |
| `GET /protocols`, `/venues`, `/venues/:key/snapshots` | L | none | — | legacy `AppController`, Prisma tables |
| `GET /v1/protocols`, `/v1/pools`, `/v1/pools/:slug`, `/:slug/flows`, `/:slug/series` | R | slug resolved in SQL, param'd | — | dashboard-hot |
| `GET /v1/network/stats`, `/v1/network/tvl-series` | R | — | — | `stats` hits CoinGecko/DefiLlama/stellar.expert/Horizon **live** — upstream cost per hit |
| `GET /v1/bridge/summary`, `/flows`, `/series` | R | query params normalized | — | |
| `GET /v1/ops/metrics`, `/v1/ops/adoption` | O | — | — | **public — founder decision pending** (see §5) |
| `POST /v1/wallets/connect` | M | strict optional UUID | account recovery by design | |
| `POST /v1/wallets` | M | UUID (400) | userId scope | |
| `GET /v1/wallets`, `/overview` | R/M-scoped | UUID (400) | **absent userId → shared demo account** (standing W1 debt) | |
| `GET /v1/wallets/:id/balances`, `/positions` | R-scoped | UUID both ids | WHERE user_id | |
| `POST /v1/wallets/:id/refresh` | M | UUID | WHERE user_id | triggers Horizon/RPC work |
| `PATCH /v1/wallets/:id{,/primary,/signer,/active}` · `DELETE /v1/wallets/:id` | M | UUID | WHERE user_id, 404-if-not-owned | |
| `POST/GET /v1/alert-rules`, `GET/PATCH/DELETE /v1/alert-rules/:id` | M | manual field checks + UUID (400) | WHERE user_id, 404-if-not-owned | |
| `GET /v1/alert-rules/priced-assets`, `/tvl-pools`, `/apy-pools` | R | — | — | pickers, polled by alerts page |
| `GET /v1/notifications`, `/unread-count` | R-scoped | UUID | WHERE user_id | **hottest endpoint** (45 s poll) |
| `POST /v1/notifications/read-all`, `/:id/read` | M | UUID | WHERE user_id, 404 | |
| `POST /v1/actions/blend/{deposit,withdraw,position}` | B | thorough manual (pubkey regex, amount, pool slug, network gate) | non-custodial: returns XDR only | RPC simulation cost |
| `POST /v1/actions/sdex/{quote,swap}` | B | thorough manual (asset code regex, issuer pubkey, mainnet whitelist) | idem | quote fires interactively |

Validation model: **no global ValidationPipe / class-validator anywhere** (by design,
per code comments). Wallets/alerts/notifications enforce UUIDs manually with clean
400s; actions has the strongest manual validation in the repo. Unknown extra body
fields are silently ignored (no whitelist-strip) — acceptable for beta.

## 2. Current protections — as found

**nginx** (`/etc/nginx/sites-enabled/stellar-api.getdig.ai`, nginx 1.18.0):
- Single bare `location / { proxy_pass http://127.0.0.1:3000; }`. **No `limit_req`/
  `limit_conn` anywhere in /etc/nginx.** No `client_max_body_size` override (default 1 MB).
- No security headers added. `server_tokens` on (version in `Server:` header).
- A second enabled site (`default`) serves `/var/www/html` on `:80 default_server` —
  absorbs scanner noise today; could `return 444` instead.

**Network exposure — CRITICAL:**
- Nest listens on `*:3000`; **ufw is inactive, iptables policy ACCEPT**. External probe
  `http://stellar-api.getdig.ai:3000/v1/pools` → **200** over plain HTTP.
  Any nginx-layer rate limit is bypassable until this is closed. Must be fixed
  before/with S1 (bind `127.0.0.1` in `main.ts` listen + enable ufw allowing 22/80/443).
- API process runs as root (ops debt — noted, out of Lot S scope).

**CORS** (Nest, env-driven):
- `CORS_ORIGINS` on the VPS: `localhost:5173`, `127.0.0.1:5173`,
  `https://dig-stellar-web.vercel.app`, `https://stellar.getdig.ai` — correctly locked.
- Disallowed origin → **HTTP 500** (the origin callback throws) instead of a clean
  CORS denial. Body is a clean `{"statusCode":500,...}` — no leak, wrong semantics.
- **No `Access-Control-Max-Age`** → every state-changing/read request re-preflights:
  OPTIONS = **572 of 1,613 requests today (~35%)**. A 1 h max-age would cut that.
- `credentials: true` is set though the app never uses cookies — harmless, unneeded.

**Headers observed live** (`GET /v1/pools`):
- `X-Powered-By: Express` present. `Server: nginx/1.18.0 (Ubuntu)`.
- Missing: HSTS, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`. ETag/304 works (good — polling is cheap).

**Error responses** (probed live): 404, 400, 500 all return clean Nest JSON — no
stack traces, no internal paths. ✔

## 3. Observed traffic baseline (nginx access logs)

Full day 2026-08-16 (`access.log.1`): **10,679 requests (~7.4/min avg)**.
Today 00:00–07:56: 1,613.

Hot endpoints (Aug 16, full day):

| Endpoint | Hits/day | Driver |
|---|---|---|
| `/v1/notifications/unread-count` | 3,701 | web poll every 45 s |
| `/v1/notifications` | 759 | alerts page poll 30 s |
| `/v1/wallets/overview` | 754 | idem |
| `/v1/alert-rules` (+ pickers ×3) | 745 + ~2,050 | idem — the alerts page refires its whole bundle every 30 s |
| `/v1/pools*` | ~220 | navigation |
| `POST /v1/actions/*` | **29 over 2 days** | interactive only |

Peaks that must NOT trip limits (legit, single IP):
- **62 req/min** (82.233.32.8, Aug 16 09:33) — heaviest observed dashboard navigation.
- 45 req/min (88.176.157.151). Sustained idle-open alerts page ≈ 25–30 req/min
  including preflights.

Noise that SHOULD trip limits: PHP-probe scanner burst **340 req/min** (4.184.238.176),
264 req/min scanner today, stratum-mining and HTTP/2-smuggling probes, ~275 404s/day.

## 4. Proposed rate-limit zones (S1 — for founder go)

All keyed `$binary_remote_addr`, `limit_req_status 429`, JSON 429 body via
`error_page 429`. Values = observed peak × ≥3 headroom.

| Zone | Scope | Rate | Burst | Rationale vs observed |
|---|---|---|---|---|
| `api_general` | everything `/v1/*` not stricter | **10 r/s** | **60 nodelay** | worst legit minute = 62 req/min ≈ 1 r/s avg; a full page load (~20 req incl. preflights) ×3 fits the burst; scanner floods (>340/min) trip |
| `api_actions` | `POST /v1/actions/*` | **30 r/min** | **10 nodelay** | observed 29 POSTs/2 days; burst covers interactive quote typing; ×50 headroom on steady rate |
| `api_mutations` | POST/PATCH/DELETE on `/v1/wallets*`, `/v1/alert-rules*`, `/v1/notifications*` (method-`map` → key, GETs unaffected) | **2 r/s** | **20 nodelay** | mutations are click-driven; connect+refresh on load ≈ a handful |

Pre-condition for S1 to be meaningful: **close direct :3000** (see §2).

## 5. Decisions for the founder

1. **`/v1/ops/metrics` + `/v1/ops/adoption`** — stay public (grant transparency;
   payloads verified to carry no secrets/URLs) **or** static-token gate. Recon
   verdict: content is safe to keep public; it does reveal usage levels.
2. **Port 3000 closure** — recommend both: bind `127.0.0.1` in `main.ts` **and**
   ufw enable (allow OpenSSH first — done carefully, this is the one risky op).
3. Rate-limit values in §4 — go / adjust.

## 6. S2 candidate list (cheap, found missing)

Nginx: `server_tokens off` · HSTS · `X-Content-Type-Options: nosniff` ·
`X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` · `client_max_body_size 100k`
(largest legit body is a small JSON action request — XDR travels in *responses*) ·
default vhost → `444`. API: disable `x-powered-by` · CORS denial without 500
(`callback(null, false)`) · `Access-Control-Max-Age` ≈ 3600 (cuts ~35% of requests).
UUID-vs-demo-userId quirk: **not trivial** (several read routes depend on the demo
default per W1 comment) → stays flagged for S3 documentation, no fix in this lot.
