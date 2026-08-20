# AA0-a — Mobile signing path recon

Date: 2026-08-20 · Lot AA (mobile responsive pass) · read-only recon, no code changes.

## Question

What does the Stellar Wallets Kit, as shipped in this app, actually support from a
mobile browser (iOS Safari / Android Chrome) — and therefore: is the lot
conversion-oriented (mobile signing works) or consultation-first (it doesn't)?

## What the app ships (verified in code)

- `@creit.tech/stellar-wallets-kit` **v1.0.0** (latest published: **2.5.0**).
- Both connect paths (`useWalletSession.ts`, module-scoped kit) register
  `allowAllModules()`, which in v1.0.0 is exactly: **Albedo, Freighter, Rabet,
  xBull, LOBSTR, Hana**.
- **No WalletConnect module and no HOT module exist in v1.0.0** — the handoff
  brief's assumed list (xBull mobile, Lobstr, Albedo web, WalletConnect, HOT) is
  partly aspirational. WalletConnect ships in newer kit majors as an opt-in module
  (needs a WalletConnect project id); HOT/Klever/OneKey/Bitget likewise.
- The ConnectModal footer copy says "Freighter, xBull, Albedo, WalletConnect (via
  Stellar Wallets Kit)" — the WalletConnect claim is **inaccurate today** (module
  not registered). Fix the copy in AA3 (or whenever ConnectModal is next touched).
- Dead-code note: `useStellarWalletConnect.ts` (the signMessage "prove ownership"
  flow) is imported nowhere — the live connect is `useConnectFlow` →
  `useWalletSession.connectWallet()`, which needs only `getAddress()`. Good news
  for mobile: most v1.0.0 modules `throw` on `signMessage`, but nothing in the
  live flow calls it.

## Per-wallet availability from a mobile browser (module `isAvailable()` logic)

| Wallet | Mechanism (v1.0.0 module) | Plain mobile browser |
|---|---|---|
| Albedo | Web intent — opens albedo.link popup/tab; `isAvailable()` always true | **Offered.** Popup-based; works in principle, iOS Safari popup handling is the risk |
| xBull | `xbull-wallet-connect` web bridge — popup to wallet.xbull.app (talks to xBull mobile app / PWA); always "available" | **Offered.** Same popup caveat; pairs with the xBull mobile app |
| Freighter | Browser-extension API (`isConnected()`) | Not available (desktop extension only) |
| Rabet | `window.rabet` injection | Not available |
| LOBSTR | LOBSTR **signer extension** API (desktop Chrome ext) | Not available (LOBSTR *mobile* connects only via WalletConnect — not registered) |
| Hana | `window.hanaWallet.stellar` injection | Not available in Safari/Chrome (works only inside Hana's own in-app dApp browser) |

Both "offered" wallets support `signTransaction` (Albedo via `albedo.tx`, xBull
via the bridge), which is the only signing call the action widgets make
(`useWalletSession.signTransaction`).

## Empirical check (emulated iPhone, headless CDP)

- **Against prod `stellar.getdig.ai`** (read-only: opened the connect modal and the
  kit modal, no signing, no claims): kit modal lists **Albedo and xBull as
  selectable; Freighter, Rabet, LOBSTR, Hana badged "Not available"** — matching
  the code read. Captures:
  `captures/aa0/prod/prod-390-{dashboard,connect-modal,walletskit-modal}.png`,
  raw shadow-DOM extract in `captures/aa0/prod/prod-kit-extract.json`.
- Same result on the local build at 390/768/1024 (`captures/aa0/*/modal-walletskit.png`).
- The kit modal itself renders acceptably at 390×844 (full-width sheet).

## What emulation cannot prove (founder real-device step, §1 rule 3)

The Albedo and xBull flows both hinge on popup/new-tab + return-to-tab behavior,
exactly the class of thing iOS Safari breaks (popup blocking after `await`,
tab-switch state loss, no extension context). Headless CDP cannot honestly
verify end-to-end connect → sign on a phone. **The real-iPhone pass on the
Vercel Preview is the deciding test** for whether "works in principle" is
"works".

## Verdict (recon-level, pending real-device confirmation)

**Fragile-but-possible, via exactly two web-bridge wallets (xBull, Albedo).**
Four of the six offered wallets are dead on mobile, and the two live ones depend
on popup flows that are unproven on real iOS Safari. Treat the lot as
**consultation-first with a signing upside**:

1. ConnectModal must present an honest mobile state: on mobile, show that
   desktop-extension wallets (Freighter/Rabet/LOBSTR-ext/Hana) won't work and
   that xBull (mobile app) / Albedo (web) are the two real options — instead of a
   list where 4/6 entries are "Not available". Fix the "WalletConnect" footer
   copy at the same time. (AA3, campaign-gated.)
2. If the founder's real-device test shows xBull or Albedo connect+sign working:
   a witnessed mainnet tx signed from mobile becomes the AA4 evidence target
   (responsive proof + KPI tx double value).
3. Post-AA recommendation (NOT this lot): evaluate upgrading the kit 1.0.0 →
   2.x to gain the opt-in WalletConnect module — that is the only path that
   reaches **LOBSTR mobile** (the largest consumer Stellar wallet) and HOT.
   Major-version bump touching the signing path ⇒ its own lot, never during a
   live campaign.

## Consequences for the AA sub-lots

- AA1 (shell) proceeds unchanged — highest value regardless of verdict.
- AA2 unchanged (views work is signing-independent).
- AA3 must include the honest ConnectModal mobile state (point 1 above).
- AA4's "witnessed mobile tx" evidence piece is **conditional** on the founder's
  real-device result; do not promise it in docs until it exists.
