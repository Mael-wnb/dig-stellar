# T3-D2 Mainnet Actions — Transaction Evidence — 2026-08-14

Claim evidence for **T3-D2 — Non-Custodial Mainnet Actions**: real swaps and lending
(vault) interactions executed on **Stellar Pubnet** from the dashboard, all signed by the
user's wallet (non-custodial), all built + simulated by the API and validated client-side
before signing.

**Verification method:** every transaction below was independently re-verified on
2026-08-14 against public Horizon (`https://horizon.stellar.org/transactions/<hash>` +
`/operations`), and the Soroban invocation parameters were decoded from the envelope XDR
with `@stellar/stellar-sdk` (not taken from app logs). Anyone can repeat the check — the
hashes are public.

Acting wallet (the beta demo wallet, public by nature of the chain):
`GAIBRM6YH6O7NYCCTUPZ47VFPABZTSZDSKU3VULGACG6MMSUZINII7GP`.

Companion evidence: `mainnet-ungating-2026-08-02.md` (first mainnet swaps + gate
validation), `pair-vetting-2026-08-01.md` (asset whitelist / pair vetting, incl. the
testnet pair non-regression), `lot-a5-blend-multipool.md` (pool registry verification),
`lot-a3-blend-withdraw.md` (withdraw path).

---

## 1. The six transactions of 2026-08-14 (all successful)

All six in ledgers 63950942–63951343, 2026-08-14 15:29–16:07 UTC, source account
`GAIBRM…I7GP`. Fees in stroops (1 XLM = 10,000,000 stroops).

| # | Hash (prefix) | Time (UTC) | Type | What it did | fee_charged | max_fee |
|---|--------------|-----------|------|-------------|------------:|--------:|
| 1 | `38390736…` | 15:29:31 | Soroban `submit` | Supply 5.0 XLM as collateral → Blend **Fixed** pool | 920,225 | 1,602,468 |
| 2 | `5006b7ae…` | 15:31:46 | classic, 2 ops | `change_trust` USDC + swap **50 XLM → 7.9702353 USDC** | 200 | 20,000 |
| 3 | `7f5a2c41…` | 15:32:48 | Soroban `submit` | Supply 5.0 XLM as collateral → Blend **YieldBlox** pool | 946,470 | 1,647,738 |
| 4 | `d22a0f93…` | 15:33:13 | Soroban `submit` | Supply 5.0 USDC as collateral → Blend **YieldBlox** pool | 544,813 | 954,807 |
| 5 | `c4393fe1…` | 15:34:21 | classic, 2 ops | `change_trust` EURC + swap **10 XLM → 1.3778933 EURC** | 200 | 20,000 |
| 6 | `537a2303…` | 16:07:12 | Soroban `submit` | **Withdraw 4.9999999 XLM collateral ← Blend Fixed pool** | 34,400 | 74,524 |

Full hashes:

```
1  38390736578cbfc6607b2549e173e5f1d5e79ec08833996e55c46f39c8636f69
2  5006b7ae687d090bffc476203f8bccc9ecfd6e357814ddca416e47a221681ab3
3  7f5a2c41332d2e1e2eb94e9694471c8642c2b5098e87974cc98ab434cfcac516
4  d22a0f936b8d7f4c78491f4dbbe6413ae554592d55c0fd5e670f557fc67e1466
5  c4393fe1eb7f0c0bf470a674f5f5efff30283eee8909f92329c4dc7bd33067b4
6  537a230327ff071aec27bb4faecfd8a118e5b7f90b8213889ae000d310c10500
```

### Lending interactions (Blend `submit`, decoded from the envelope XDR)

Each of #1/#3/#4 is a single `invoke_host_function` op calling `submit` on the pool
contract with one request `{ request_type: 2 (SupplyCollateral), amount: 50000000
(= 5.0 at 7 decimals), address: <reserve SAC> }`, `from = spender = to =` the wallet:

| Tx | Pool contract (invoked) | Registry entry | Reserve SAC supplied |
|----|------------------------|----------------|----------------------|
| #1 | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | `blend-fixed-pool` (Fixed) | XLM `CAS3J7GY…XOWMA` |
| #3 | `CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS` | `blend-yieldblox-pool` (YieldBlox) | XLM `CAS3J7GY…XOWMA` |
| #4 | `CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS` | `blend-yieldblox-pool` (YieldBlox) | USDC `CCW67TSZ…MI75` |

Horizon's `asset_balance_changes` confirms the matching token transfer in each: 5.0 XLM
(native) → Fixed, 5.0 XLM → YieldBlox, 5.0 USDC (Circle `GA5ZSE…KZVN`) → YieldBlox.
The invoked pool ids equal the A5 registry entries verified in
`lot-a5-blend-multipool.md` (factory `is_pool`, reward zone, wasm hash, on-chain name).
This is the **multi-pool** claim made real: the same supply flow, executed against two
different vetted pools, in both a native and a credit asset.

### The supply↔withdraw loop, closed on mainnet (#6)

Tx #6 (`537a2303…`, 16:07:12 UTC, ledger 63951343) is `submit` on the **Fixed** pool
with one request `{ request_type: 3 (WithdrawCollateral), amount: 49999999
(= 4.9999999 XLM), address: <XLM SAC> }` — Horizon confirms the 4.9999999 XLM native
transfer FROM the pool contract back TO the wallet. This is the exact position opened
by tx #1 at 15:29: 5.0 XLM supplied, 4.9999999 withdrawn — the 1-stroop difference is
the SDK's deliberate round-DOWN in the bToken → underlying conversion (the position
endpoint's "Max" can never exceed the real position; see `getBlendPosition`). The
withdraw XDR was pinned by the client gate to `WithdrawCollateral` (3), the mirror of
the deposit gate's `SupplyCollateral` (2).

**With #1 + #6 the full non-custodial lending loop — supply on mainnet, then withdraw
the same position back to the wallet — is COMPLETE and publicly verifiable on Pubnet.**
(The testnet loop was proven earlier in `lot-a3-blend-withdraw.md`; the YieldBlox
supplies #3/#4 remain open positions.)

### Swaps (classic SDEX, `path_payment_strict_send`)

- #2: op 1 `change_trust` for USDC (`GA5ZSE…KZVN`, Circle), op 2 strict-send
  **50.0 XLM → 7.9702353 USDC** (min 7.5711380, direct route, no path).
- #5: op 1 `change_trust` for EURC (`GDHU6W…NPP2`, Circle), op 2 strict-send
  **10.0 XLM → 1.3778933 EURC** (min 1.3089986, direct route).

Both assets are entries of the server-enforced `MAINNET_ASSET_WHITELIST`
(issuer-verified — see `pair-vetting-2026-08-01.md`), and both amounts sit under the
100-XLM per-transaction launch cap.

---

## 2. The congestion-tolerant fee bid, checked against reality (post-0c296ef)

Commit `0c296ef` raised the per-operation **inclusion-fee bid** to 10,000 stroops
(`DEFAULT_INCLUSION_FEE_STROOPS`, `apps/api/src/modules/actions/actions.service.ts`)
after a YieldBlox submission was rejected under surge pricing with a 100-stroop bid.
All six transactions above were built post-fix. What the chain actually charged:

**Soroban txs** — the envelope's `max_fee` decomposes as
`sorobanData.resourceFee + inclusion bid`, and for all four:

| Tx | resourceFee (declared) | max_fee | → inclusion bid | fee_charged |
|----|----------------------:|--------:|----------------:|------------:|
| #1 | 1,592,468 | 1,602,468 | **10,000** | 920,225 |
| #3 | 1,637,738 | 1,647,738 | **10,000** | 946,470 |
| #4 |   944,807 |   954,807 | **10,000** | 544,813 |
| #6 |    64,524 |    74,524 | **10,000** | 34,400 |

i.e. the bid is exactly the intended 10,000 stroops on every Soroban tx (supplies AND
the withdraw), and `fee_charged` came in at ~46–59% of the ceiling: the network
**refunded the unused resource fee** and charged the market inclusion fee, not the full
bid. The bid is a ceiling that buys inclusion under congestion — not a cost.

**Classic txs** — #2 and #5 bid 10,000/op (`max_fee` 20,000 for 2 ops) and were charged
the 100-stroop/op base fee: **200 total** (≈ $0.000004). Same conclusion from the other
direction: with no surge in progress, the higher bid costs nothing extra.

This closes the loop on the `0c296ef` failure mode with live data: the earlier
100-stroop bid was rejected under surge (`txInsufficientFee`, required 1,592,563); the
10,000-stroop bid included all six transactions on the first attempt.

---

## 3. Honest counter-example — the frozen Orbit pool (nothing signed)

The A5 registry also vets the Blend **Orbit** pool
(`CAE7QVOMBLZ53CDRGK3UNRRHG5EZ5NQA7HHTFASEMYBWHG6MDFZTYHXC`). A supply attempted there
**never produced a transaction** — there is deliberately no Orbit hash in §1:

1. The API builds the `submit` and **simulates before returning anything signable**.
2. Simulation fails with `HostError: Error(Contract, #1206)` —
   `InvalidPoolStatus` in the Blend error table (`@blend-capital/blend-sdk`
   `ContractErrorType`).
3. The API returns `xdr: ""` with the raw error in `simulation.error` — **the wallet is
   never invoked, nothing is signed, nothing reaches the network, nothing is charged.**

Reproduced live on 2026-08-14 (raw API payload, abridged):

```json
{
  "xdr": "",
  "simulation": {
    "success": false,
    "error": "HostError: Error(Contract, #1206)\n\nEvent log (newest first):\n  0: … topics:[error, Error(Contract, #1206)], data:\"escalating error to VM trap …\"\n  1: … data:[\"failing with contract error\", 1206]\n  2: … topics:[fn_call, CAE7QVOM…, submit], …"
  },
  "fee": { "inclusion": 0, "resource": 0, "total": 0 }
}
```

**Why #1206:** Orbit's live on-chain status is `4` (admin-frozen). Per the deployed pool
contract (`blend-contracts-v2`, `pool/src/pool/pool.rs::require_action_allowed`):

```rust
if (self.config.status > 1 && (action == Borrow || action == DeleteLiquidationAuction))
    || (self.config.status > 3 && (action == Supply || action == SupplyCollateral))
{ panic_with_error!(e, PoolError::InvalidPoolStatus); }  // #1206
```

So status > 3 (Frozen/Setup) blocks supply, while **withdrawals are never
status-blocked** — a user can always exit. Statuses read live the same day: Fixed `1`
(Active), YieldBlox `0` (Active), Orbit `4` (Frozen), Etherfuse `1` (Active).

### Product follow-up (Lot A5b, shipped with this evidence)

- The position endpoint now returns the pool's **live** status
  (`poolStatus: { code, label, supplyBlocked, withdrawBlocked }`), derived from the same
  `PoolV2.load` — never from the registry, since status is governance-dynamic.
- The UI disables the Supply tab on a status-blocked pool with honest copy
  ("Orbit is frozen by Blend governance — deposits are disabled. Withdrawals remain
  available."), shows a status badge for non-Active pools, and auto-selects Withdraw.
- Known Blend contract errors in `simulation.error` are mapped to one-line messages
  (#1206 → "The pool's current status, set by Blend governance, blocks this action.");
  unmapped codes render "The pool contract rejected this action (code #NNNN)" — the raw
  diagnostics stay behind a collapsible "details", and verbatim in the API payload.

---

## 4. Earlier mainnet evidence (context)

- **2026-08-02 — first mainnet swaps** (`mainnet-ungating-2026-08-02.md`): kill-switch
  403 proof, testnet non-regression, first live Pubnet quote, 100-XLM cap 400, and the
  first swap executions incl. USDC → XLM
  `eeeae1996f937328e6923953a75a12c9834974eb97d6bb49ff0a86b52bddc241`.
- **2026-08-01 — pair vetting** (`pair-vetting-2026-08-01.md`): the strict-send
  direct-route probe over the candidate pairs (testnet + mainnet), PASS/THIN/FAIL
  verdicts and issuer verification behind `MAINNET_ASSET_WHITELIST`.
- **Blend withdraw path** (`lot-a3-blend-withdraw.md`) and **multi-pool registry
  verification** (`lot-a5-blend-multipool.md`).

Together: mainnet **swaps** (XLM↔USDC, XLM→EURC), mainnet **lending interactions**
(supply-as-collateral into two distinct Blend pools in two assets, AND the withdraw
closing the Fixed-pool loop — the full non-custodial supply↔withdraw cycle is now
evidenced on Pubnet, not just testnet), executed from the product with server-side
caps, client-side XDR validation before signing, and a demonstrated refusal path when
the target pool's governance state forbids the action.
