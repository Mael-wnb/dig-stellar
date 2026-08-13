# Lot A3 — Blend Withdraw (in-app): implementation + testnet evidence

Date: 2026-08-13 · Brief: `docs/lot-a3-blend-withdraw.md` · Contract: `docs/security-invariants.md`

Completes the supply↔withdraw loop in the action modal. Not required by any SCF criterion
(T3-D2's "vault/lending interactions" is satisfied by the deposit) — product completeness
before the advisor re-review, plus a bonus mainnet evidence pair once reviewed.

**Status: testnet money path PROVEN E2E (supply + withdraw, both confirmed on-chain).**
Mainnet pair pending — to be done via Maël's wallet after this review.

---

## 1. What shipped

| Layer | Change |
|-------|--------|
| `apps/api` | `POST /v1/actions/blend/withdraw` (mirror of `blend/deposit`), `POST /v1/actions/blend/position` (live on-chain position read), `buildBlendWithdraw` + `getBlendPosition` in `actions.service.ts` |
| `apps/api` | `blend-withdraw-build` added to the `action_events` kind set (E3 adoption counter) |
| `apps/web` | `validateWithdrawXdr` in `lib/validateDepositXdr.ts` (shared submit gate, request type pinned per action) + 20 new red tests |
| `apps/web` | `BlendDepositCard.vue` → Supply \| Withdraw tabs, live supplied position, Max, "nothing to withdraw" state |
| `apps/api` | **Soroban resource headroom** on BOTH Blend builders — see §5, this is the one non-obvious fix |

Flags regime unchanged: the withdraw rides the SAME kill-switches as the deposit
(`ACTIONS_MAINNET_BLEND_ENABLED` / `VITE_ACTIONS_MAINNET_BLEND_ENABLED`). **No new flag.**

## 2. The security decision that differs from the deposit

**No amount cap on withdraw** — enforced nowhere, deliberately. The 100 XLM mainnet cap exists
to limit how much a user commits INTO a protocol during launch; a withdraw returns the user's
own funds to their own wallet, and capping it could strand a position larger than the cap and
push the user off-app to unwind it. Documented at both enforcement points
(`actions.controller.ts` `blendWithdraw`, `validateDepositXdr.ts` `validateWithdrawXdr`).

The amount is still bounded by reality: the pool can only return what the position holds, the
build is simulated (a failure yields no XDR at all), and the UI refuses to build a withdraw
above the live position.

Also different, each safe:
- **No trustline step.** The asset was supplied FROM this account, so its classic trustline
  existed at supply time. If it were removed since, the SAC transfer back traps with Contract
  #13 and the tx fails ATOMICALLY on-chain — no partial state, only the fee burnt.
- **No spendable preflight.** A withdraw receives the asset rather than sending it; the only
  balance it needs is XLM for the fee, which simulation covers.

## 3. The validation gate (the real work)

`validateDepositXdr.ts` now hosts one shared decoder, `validateSubmitXdr`, parameterized by the
expected Blend request type. `validateDepositXdr` pins `SupplyCollateral` (2);
`validateWithdrawXdr` pins `WithdrawCollateral` (**3**, read from the
`@blend-capital/blend-sdk` enum source: `Supply=0, Withdraw=1, SupplyCollateral=2,
WithdrawCollateral=3, Borrow=4, Repay=5, …` — never from memory).

Asserted for a withdraw, all against client-side `config/blendPools.ts` (never the API response):
parses under the intent passphrase ∈ {TESTNET, PUBLIC} · not a fee-bump · tx source = user ·
exactly ONE `invokeHostFunction` op · contract id = expected pool · fn = `submit` ·
`from`/`spender`/`to` = user · exactly one request · `request_type` = WithdrawCollateral ·
request `address` = expected SAC · request `amount` = exact BigInt of the user's amount scaled
to decimals · total fee ≤ 2 XLM.

### Red tests — `apps/web/src/lib/validateDepositXdr.spec.ts` (72 tests total, all green)

Withdraw gate: unparseable XDR · unrecognized passphrase · wrong tx source · wrong pool ·
wrong function name · wrong asset SAC · wrong amount · `request_type` = **Withdraw (1)** (unwinds
a non-collateral supply, not our position) · `request_type` = Borrow (4) · foreign `from` ·
foreign `spender` · **foreign `to`** (would send the withdrawn funds to an attacker) · extra op ·
inflated fee · zero requests · two requests (withdraw + hidden borrow) · multi-violation collection.

**Cross-type (the critical new ones)** — everything else about the two envelopes is identical
and valid, so only the pinned request type can be rejecting them:
- a SupplyCollateral XDR **fails** the withdraw gate → `expected WithdrawCollateral (3), got 2`
- a WithdrawCollateral XDR **fails** the deposit gate → `expected SupplyCollateral (2), got 3`
- a canary asserting both constants still equal the SDK's values and remain distinct.

Both cross-type checks are re-run against REAL API-built envelopes in the E2E below, not just
hand-built fixtures.

## 4. Testnet E2E — the money path

Run 2026-08-13 against the live API (`localhost:3000`, repo `.env`, **all mainnet flags unset**),
Blend testnet pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`, asset XLM
(SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`). Friendbot-funded account
`GBKAOV3HOEAVBSRL4A5YT5YLBHCFYSXY6TPHTR5SOBMKCHMLZBCYZGO5`. Every XDR was run through the REAL
browser gate before signing; nothing bypassed a gate.

| # | Step | Result |
|---|------|--------|
| 1 | `blend/withdraw` `network:"mainnet"`, flags unset | **403** "Mainnet Blend deposits are not enabled." |
| 1 | `blend/position` `network:"mainnet"`, flags unset | **403** (same switch) |
| 1 | `blend/deposit` `network:"mainnet"`, flags unset | **403** — unchanged from A2 |
| 2 | position before | collateral `0.0000000` |
| 3 | withdraw with an EMPTY position | `xdr:""`, `simulation.success:false`, Contract #1217 → **nothing signable** |
| 4 | **SUPPLY 5 XLM** | deposit gate `{ok:true}`; withdraw gate on the same XDR → `request_type mismatch: expected WithdrawCollateral (3), got 2` |
| 5 | position after supply | collateral `5.0000001` |
| 6 | over-withdraw probe (10× position) — **built, never submitted** | `simulation.success:true` → the contract **clamps** an over-withdraw to the full position (user can never receive more than they hold). XDR discarded. |
| 7 | **WITHDRAW 5.0000001 XLM (Max)** | withdraw gate `{ok:true}`; deposit gate on the same XDR → `expected SupplyCollateral (2), got 3`; tampered-intent amount → `request amount mismatch: expected 5000000 (scaled), got 50000001` |
| 8 | position after withdraw | collateral `0.0000008` (dust — see below) |

### Transaction pair (both `SUCCESS` on-chain, verified independently via RPC `getTransaction`)

| | hash | ledger | fee charged |
|---|------|--------|-------------|
| **supply** | `b199a1d763d838c6b9535d083e76be77af425e9c80f64e6fc29b848a19217c48` | 4123415 | 0.0471208 XLM |
| **withdraw** | `322d760e43698f1337fbeecc1de1d900c950e6350e99d520866192378facba7a` | 4123416 | 0.0027875 XLM |

- https://stellar.expert/explorer/testnet/tx/b199a1d763d838c6b9535d083e76be77af425e9c80f64e6fc29b848a19217c48
- https://stellar.expert/explorer/testnet/tx/322d760e43698f1337fbeecc1de1d900c950e6350e99d520866192378facba7a

(The A2 testnet deposit precedent was `a842f370…`; this pair supersedes it as the current
end-to-end proof, and adds the withdraw half.)

**Max leaves dust.** Supplied collateral accrues interest continuously, so a Max computed at
read time is marginally below the position by the time the transaction applies — here 8 stroops
(0.0000008 XLM) remained. Honest, harmless, and inherent to pinning an EXACT amount in the
gate; the alternative (an unbounded "withdraw everything" sentinel) would weaken the amount
invariant, which is not a trade worth making.

## 5. The non-obvious fix: Soroban resource headroom

**The first withdraw attempt failed on-chain** (`267bb75bce7d123df3d58a10f8273a73e2f14fecc313622268a15f1b2037112f`,
`INVOKE_HOST_FUNCTION_RESOURCE_LIMIT_EXCEEDED`). Decoded diagnostics named it exactly:

```
["error",{"type":"system","code":5,"value":"scecExceededLimit"}]
  => ["operation byte-write resources exceeds amount specified", "1024", "996"]
```

A simulation measures resources against the ledger **as it is at that moment**, and those
limits are enforced **exactly** at apply time seconds later. A Max withdraw is the sharpest case
of the resulting drift: the collateral accrues interest between simulation and apply, so a
simulation that zeroed the position (small write) can apply against a position with a dust
remainder — one extra i128 map entry, ~28 bytes more written than declared.

Fix (`padResources` in `actions.service.ts`, applied to BOTH Blend builders): widen the declared
resource LIMITS, not just the fee — instructions/read/write × 1.25 + 128 bytes, resource fee ×
1.5. The declared fee is a ceiling, not a charge: the observed charge went 24,177 → 27,875
stroops (**+0.00037 XLM**) and the client gate still refuses anything above its 2 XLM cap.

Two smaller correctness wins came with it:
- The envelope's fee now equals the `fee.total` the API reports. Previously `assembleTransaction`
  re-added the resource fee on top of an already-summed total, so the signed envelope bid roughly
  double what the response advertised (harmless, but the number the user is shown should be the
  number they sign).
- The deposit path inherits the headroom, so it can no longer lose the same race. Its behavior is
  otherwise unchanged and was re-proven E2E in step 4 above.

## 6. Reproducing

The E2E harness is `e2e-lot-a3.ts` in the session scratchpad (not committed — it holds a
throwaway testnet secret). It generates + friendbot-funds an account, drives the real HTTP
endpoints, runs every XDR through the real `validate*Xdr` gates, signs locally, submits via
Soroban RPC and polls to a terminal status. `SECRET=S… AMOUNT=5` reuses an account.

## 7. Follow-ups (not blockers)

- **Mainnet pair** — supply + withdraw via Maël's wallet after this review, becoming T3-D2 bonus
  evidence. Follow `docs/runbooks.md` → "Blend withdraw ungating (Lot A3)".
- `apps/web/src/lib/validateDepositXdr.ts` now validates deposits AND withdraws; the filename is
  a leftover. Rename when something else touches the module (a rename now is churn on a money
  path mid-review).
- The withdraw pane reads the position live from the API on every entry. If it ever gets chatty,
  cache per (address, network) — deliberately not done now: a stale Max on a money path is worse
  than an extra RPC read.
