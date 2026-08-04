# Mainnet Actions Ungating — 2026-08-02

Claim evidence for **T3-D2 — Non-Custodial Mainnet Actions** ("Validation of strict security" +
first successful mainnet executions from the dashboard). Companion pieces:
`docs/security-invariants.md` (the contract), `docs/evidence/pair-vetting-2026-08-01.md` (the
asset-whitelist story), `docs/runbooks.md` § "Mainnet actions (T3-D2) — gating regime" (the
procedure followed here).

## Deployment

- Code: commit `6532d48` — "feat(actions): secure and enable mainnet SDEX swaps behind launch
  controls (T3-D2)" (+ follow-up commit "fix(web): open the actions section on mainnet when
  ungated"), pushed to both remotes; VPS pulled from `public-origin`, `nest build`, PM2 restart.
- Front: Vercel with `VITE_ACTIONS_MAINNET_ENABLED=true` (Production).
- API launch controls in force: `ACTIONS_MAINNET_ENABLED=true`, per-transaction cap **100 XLM**
  (server-enforced), mainnet asset whitelist **XLM, USDC, EURC, AQUA, yXLM, PYUSD**
  (issuer-verified — see pair-vetting evidence).

## Gate validation in production (curl, executed on the VPS, 2026-08-01/02)

**1. Kill-switch holds (flag off → 403):**
```
{"message":"Mainnet actions are not enabled.","error":"Forbidden","statusCode":403}
```

**2. Testnet unchanged (non-regression):**
```
{"sourceAmount":"10","destAmount":"18.3904272","rate":1.8390427200000001}
```

**3. Flag on → real Pubnet quote** (10 XLM → 1.7456 USDC, i.e. XLM ≈ $0.175 — live market price,
in contrast with the fantasy testnet rate above):
```
{"sourceAmount":"10","destAmount":"1.7456303","rate":0.17456303}
```

**4. Per-transaction cap enforced server-side (500 XLM > 100 cap → 400):**
```
{"message":"amount exceeds the mainnet per-transaction cap of 100 XLM","error":"Bad Request","statusCode":400}
```

**5. Asset whitelist enforced server-side (look-alike USDC with a non-Circle issuer → 400):**
```
{"message":"toAsset: asset USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56 is not on the mainnet whitelist (XLM, USDC, EURC, AQUA, yXLM, PYUSD)","error":"Bad Request","statusCode":400}
```

## First real mainnet executions from the dashboard

Both directions of the flagship pair, executed from `stellar.getdig.ai` by the founder's wallet,
signed **exclusively in-wallet** (Freighter via Stellar Wallets Kit), each envelope passing the
client-side XDR validation gate (`validateSwapXdr`) before the signing prompt opened. The backend
handled public addresses only, per INV-1.x.

| # | Direction | Size | Transaction hash | Verify |
|---|---|---|---|---|
| 1 | XLM → USDC | 1 XLM | *TODO: add hash (first swap of 2026-08-02)* | stellar.expert/explorer/public |
| 2 | USDC → XLM | ~0.3 USDC → ~1.7 XLM | `eeeae1996f937328e6923953a75a12c9834974eb97d6bb49ff0a86b52bddc241` | stellar.expert/explorer/public |

## Rollback path (verified by construction)

Unset `ACTIONS_MAINNET_ENABLED` on the VPS + PM2 restart → the API returns to 403 on every
mainnet action immediately, independent of the web deploy (fail-safe direction).

## Notes

- This opens the T3-D2 KPI window (50+ unique mainnet wallets, 200+ mainnet transactions).
- The Blend deposit remains testnet-only (its own gate; T3-D2 Lot A2).
