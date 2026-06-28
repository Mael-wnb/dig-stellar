# Probe 03 — In-App Notification Delivery for the Alerting Engine (D2)

**Type:** read-only recon. Nothing was modified. Every claim is quoted from source; gaps are
flagged as gaps, not inferred.

**Sources inspected:** `apps/api/src/**`, `apps/web/src/**`, `apps/api/src/main.ts`,
`apps/api/src/app.module.ts`, `docker-compose.yml`. Search commands quoted inline.

---

## TL;DR

- **Notification/feed infra: net-new.** No notification/inbox/unread table, entity, module, or
  endpoint exists in `apps/api`. (The only "feed" in the code is the Bridge *recent-flows* feed —
  unrelated analytics.)
- **Real-time delivery: none. The web app polls (load-on-mount + manual refresh).** No WebSocket
  gateway, no SSE, no `socket.io`, no `EventSource` anywhere in api or web. An "alert fired"
  notification must ride on the same **HTTP request/response polling** the rest of the app uses.
- **Web has no Pinia and no toast/list component library.** State = **module-scoped `ref`s inside
  composables** (`useX()` singletons). API calls = a thin `apiFetch` wrapper. The closest reusable
  feed UI to copy is `BridgeFlows.vue` + `useBridge.ts`.
- **Auth: there is none.** No guard, no JWT, no session, no Passport. `userId` is a plain
  query/body param, defaulting to a hardcoded UUID. Per-user scoping = "the caller passes its
  `userId`," held client-side in `localStorage`.

---

## 1. apps/api — existing notification / feed infrastructure → **NET-NEW**

```
grep -rniE "notification|feed|unread|inbox|@Sse" apps/api/src   (excluding /dist)
```
- **No `notification`/`notifications` table** in any `apps/api/src/db/*.sql`. The wallet-layer
  schema (`stellar_v2_multiwallet.sql`) stops at `user_wallets`, `wallet_balance_snapshots`,
  `wallet_protocol_positions`, `wallet_pool_health`. No `*_read`/`unread`/`seen_at`/`inbox` column
  anywhere.
- **No notification module/controller/service.** Registered modules
  (`app.module.ts`): `DbModule, StellarModule, WalletsModule, NetworkModule, ActionsModule,
  BridgeModule` — none is a notifications feature.
- **No read/unread model, no notification pagination.** The only "feed" + pagination construct is
  **Bridge recent flows** (`bridge.service.ts:19` *"Recent-flows feed: default page size + hard
  cap"*) — a window/limit query over `bridge_flows`, *not* a per-user inbox. It is a useful
  *pagination shape to copy* (limit + hard cap), nothing more.

**Conclusion:** the notification store, read/unread state, and feed endpoints are **net-new**. There
is no infra to extend — only conventions to mirror (raw SQL v2 table + a NestJS module reading via
`prisma.$queryRawUnsafe`, exactly like `WalletsService`).

---

## 2. Real-time delivery api → web → **NONE. The web polls.**

```
grep -rniE "@WebSocketGateway|websocket|socket\.io|@Sse|EventSource|server-sent" apps/api/src apps/web/src
  → (zero matches in either app)
```
- **API:** no `@WebSocketGateway`, no `@nestjs/websockets`/`@nestjs/platform-socket.io` dep, no
  `@Sse()` endpoint. `apps/api` is plain HTTP (`@nestjs/platform-express` only). `main.ts` only
  configures CORS (`enableCors({ origin: …, credentials: true })`) and `app.listen(PORT)` — no
  gateway bootstrap.
- **Web:** no `new WebSocket(...)`, no `EventSource`, no `socket.io-client` dep
  (`apps/web/package.json` deps = `@creit.tech/stellar-wallets-kit`, `@stellar/freighter-api`,
  `buffer`, `vue` — nothing realtime).
- **The actual delivery model = HTTP polling / fetch-on-demand.** Composables fetch on mount and on
  user action. Example (`useBridge.ts`): `onMounted`-driven `load()` doing `Promise.all([
  fetchBridgeSummary(...), fetchBridgeFlows(...) ])`; window changes re-fetch. Wallets refresh is
  user-triggered (`useWallets.refreshOneWallet`). There is **no background timer/`setInterval`
  poller** today either — data is pulled when a view loads or the user clicks.

**What "alert fired" rides on:** a new **`GET /v1/notifications` (or `/v1/alerts`) endpoint**,
fetched by the web on mount and on a lightweight interval. Sub-second push is not available and is
out of scope (matches probe-02: snapshot DB, sweep cadence ~5–15 min — polling every ~30–60 s on
the client is more than enough to surface new alerts).

---

## 3. apps/web — where a notifications feed UI lives + patterns to reuse

**Layout** (`apps/web/src/`): `api/`, `components/`, `composables/`, `types/`, `mappers/`,
`utils/`, `constants/`. App root `App.vue` mounts a single `DigDashboard.vue`. **No `stores/` dir.**

### State management: composables with module-scoped refs (NO Pinia)
```
grep -rniE "pinia|defineStore|createPinia" apps/web/src  → (zero matches)
```
Two idioms in use:
- **Singleton store** = `ref`s declared at module top-level, returned by the composable, e.g.
  `useAppUser.ts` (`const userId = ref<string|null>(null)` outside the function → shared across all
  callers; `localStorage`-backed).
- **Per-instance state** = `ref`s declared *inside* the composable, e.g. `useWallets.ts`
  (`const wallets = ref<WalletItem[]>([]); const overviewLoading = ref(true); const error =
  ref("")`). This is the **canonical `{ data, loading, error }` triad** to copy for a feed.

### API-call pattern
- Thin wrapper `api/client.ts` → `apiFetch<T>(path, init)` (prepends `…/v1`, sets JSON headers,
  throws on `!response.ok`).
- One module per feature in `api/` (`wallets.ts`, `bridge.ts`, …). `userId` is passed explicitly
  and serialized into the query string, e.g. `api/wallets.ts`:
  ```ts
  export async function fetchWalletPositions(walletId, userId) {
    const query = new URLSearchParams({ userId }).toString();
    return apiFetch<WalletPositionsResponse>(`/wallets/${walletId}/positions?${query}`);
  }
  ```
  → a notifications client would be `api/notifications.ts` with
  `fetchNotifications(userId, { unreadOnly?, limit? })` and `markNotificationRead(id, userId)`.

### Feed/list/toast component to reuse
- **No toast, bell, dropdown, or generic list component exists** (`ls components/` shows none).
- **Closest reusable feed = `BridgeFlows.vue` + `useBridge.ts`.** `BridgeFlows.vue` is a
  `<script setup lang="ts">` SFC that consumes `useBridge()` (`{ summary, flows, loading, error }`),
  renders a header + a recent list, and has a Tailwind-styled `relativeTime()` helper ("3h ago")
  — exactly the shape a notifications feed needs (list of timestamped events with relative time).
  Copy its structure: composable owns `{ items, loading, error, load() }`; SFC renders
  loading/empty/error/list states.

**Recommended placement:** new `composables/useNotifications.ts` (per-instance triad +
`markRead`), `api/notifications.ts` (mirrors `api/wallets.ts`), and a `NotificationsFeed.vue` /
bell component modeled on `BridgeFlows.vue`, surfaced in `DashboardHeader.vue` or `WalletSection.vue`.

---

## 4. Auth / session — how the API scopes data per-user → **NO real auth; `userId` param**

```
grep -rniE "Guard|@UseGuards|jwt|passport|session" apps/api/src  → (zero auth matches)
```
- **No guard, no JWT, no session, no Passport.** `main.ts` has no global guard; controllers have no
  `@UseGuards`. CORS uses `credentials: true` but nothing reads cookies/sessions.
- **Scoping = an explicit `userId` request param.** Every wallets endpoint takes
  `@Query('userId')` (and some also accept it in the body), e.g. `wallets.controller.ts`:
  ```ts
  getWallets(@Query('userId') userId?: string) { return this.walletsService.getWallets(userId); }
  refreshWallet(@Param('walletId') walletId, @Query('userId') queryUserId?, @Body() body?) {
    return this.walletsService.refreshWallet({ userId: queryUserId ?? body?.userId, walletId });
  }
  ```
- **Server-side normalization + default user** (`wallets.service.ts:128-137`):
  ```ts
  private normalizeUserId(userId?: string): string {
    const value = (userId ?? '00000000-0000-0000-0000-000000000001').trim();
    // … must be a valid UUID, else BadRequestException
  }
  ```
  → when no `userId` is supplied it falls back to the hardcoded default user
  `00000000-0000-0000-0000-000000000001`. Ownership checks are by joining on `user_id`
  (e.g. `getWalletOrThrow(walletId, userId)`), **not** by an authenticated principal.
- **Web side:** `useAppUser.ts` holds `userId` in a module ref backed by `localStorage`
  (`dig_stellar_user_id`); it is created on wallet connect (`connectWallet` returns a generated
  `userId`, `wallets.service.ts:444-447`) and passed into every API call.

**Implication for notifications:** scope them the **same way** — `notifications.user_id` column,
filtered by the `userId` query param (FK to `user_wallets`/owning user). Do **not** invent an auth
mechanism for D2; that would diverge from the whole app. (Honest caveat: this means notifications
are only as private as the opaque `userId` UUID — acceptable for beta, consistent with the existing
wallet data, and a known T3 hardening item, not a D2 task.)

---

## DECISIONS UNBLOCKED

### (a) Extend existing infra vs build net-new → **BUILD NET-NEW (but mirror existing conventions)**
There is no notification infra to extend. Build it net-new, copying the house style end-to-end:
- **Store:** new raw SQL v2 table (e.g. `notifications` in a new `stellar_v3_alerting.sql` or
  appended to `stellar_v2_multiwallet.sql`) — `id uuid pk`, `user_id uuid not null` (the scope key),
  optional `user_wallet_id`/`entity_id` FKs (`on delete cascade`), `type`, `severity`, `title`,
  `body`, `payload jsonb`, `read_at timestamptz null` (read/unread model), `created_at`. Index on
  `(user_id, created_at desc)` and a partial index `where read_at is null` for the unread badge.
  Applied via `psql -f` like every other v2 table.
- **API:** new `NotificationsModule` (controller + service, raw SQL via `prisma.$queryRawUnsafe`),
  registered in `app.module.ts`. Endpoints: `GET /v1/notifications?userId=…&unreadOnly=&limit=`
  (limit + hard cap, copying `bridge.service.ts` pagination), `POST
  /v1/notifications/:id/read?userId=…`, optionally `GET /v1/notifications/unread-count`.
- **Writer:** the D2 evaluator (probe-02's indexer sweep, script `83`) **inserts** rows into this
  table; dedup via the threshold-crossing logic (no separate `last_fired` infra needed).
- **Web:** `api/notifications.ts` + `useNotifications.ts` (`{ items, loading, error, unreadCount,
  load, markRead }`) + a `NotificationsFeed.vue`/bell modeled on `BridgeFlows.vue`, scoped with
  `useAppUser().userId`.

### (b) Delivery mechanism → **POLLING (no push channel)**
There is no WebSocket/SSE and building one is out of scope and unjustified for a snapshot-DB,
sweep-driven engine (probe-02). Deliver via HTTP:
- The feed composable fetches on mount (like `useBridge`) **and** on a lightweight client interval
  (~30–60 s `setInterval`, cleared on unmount) to refresh the unread badge/list. This is the first
  background poller in the app — keep it small and single-purpose.
- **End-to-end latency** = evaluator sweep interval (≈5–15 min, probe-02) **+** client poll
  interval (≈30–60 s). Adequate for liquidation/health-factor warnings; no real-time push needed.
- Defer SSE/WebSocket to a later tranche *only if* a product need for instant push emerges; do not
  pre-build it.
