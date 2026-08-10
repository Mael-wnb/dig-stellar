# Failed mainnet swap — underfunded (2026-08-10)

Real user swap that failed on Stellar **mainnet**. Motivates **F2** (spendable-balance
preflight) and the failed-tx copy in **F4.3**.

## Transaction

- **Hash:** `a3acf8fa9eb98935bcfa3d99ddc685b1d77cdf9fa5ec647afb7b27054a481d21`
- **Network:** mainnet (public)
- **Operation:** path payment strict send (SDEX swap)
- **Decoded result:** `pathPaymentStrictSendUnderfunded`
- **Outcome:** failed **atomically** — no assets moved. Only the network fee (100 stroops =
  0.00001 XLM) was charged.

## Root cause

The user had enough **total** XLM but not enough **spendable** XLM. Stellar locks part of the
balance as reserves and liabilities:

```
spendable(XLM) = balance − (2 + subentries) × 0.5 (base + subentry reserves)
                         − selling_liabilities
                         − fee buffer (~0.01)
```

The swap's send amount exceeded that spendable figure, so the ledger rejected it. The widget
let the user build and sign a transaction that could not succeed — the failure was only
visible after submission.

## Fix (F2)

Preflight the spendable balance in `apps/api buildSwap` (reuses the Horizon account already
fetched for the INV-5.1 trustline gate). If `sendAmount > spendable`, return a clean
`400 INSUFFICIENT_SPENDABLE_BALANCE` with the spendable amount, and render it in
`SdexSwapWidget` as: *"Insufficient balance: X.XX XLM available — the rest is reserved by the
Stellar network."* Same guard for the Blend deposit build. This makes the underfunded failure
mode of this tx unreachable at the signing step.

## Before/after

Captures land here when F2 ships.
