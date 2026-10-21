# Decision: Points have no monetary value (2026-10-21)

**Status: decided (founder ruling, Lot EP gates 1 to 3) and implemented.**

## Ruling

The Earn & Points campaign (Lot EP, post-grant) issues **points only**:

1. **No payout, no token, no promise of either.** Points are not convertible to money or
   tokens, carry no price and are never folded into an APY. The disclaimer string
   (`DISCLAIMER` in `modules/campaign/campaign-rules.ts`) travels in every campaign payload
   and the web renders it once per surface.
2. **No new server-side key.** The campaign module imports nothing from `modules/faucet/`,
   `modules/actions/` or `modules/wallets/`; the faucet treasury (the one key, invariants §9)
   is never reachable from it. Wallet ownership is proven by a signed text message verified
   with the public key only (`verify-wallet-signature.ts`, invariants INV-11.1).
3. **Perks are the only thing points unlock, and they are non-monetary.** Three tiers, code
   constants (`PERK_TIERS`), granted by the award job from the live balance into `wallet_perks`:

   | Perk | Threshold | What it is |
   |---|---:|---|
   | `early-access` | 100 points | badge + early access to new views |
   | `beta-features` | 500 points | beta flag for features under test |
   | `priority-rwa` | 1500 points | priority access to upcoming RWA products |

   A perk once granted stays granted even if the balance later drops (adjust rows never revoke
   a tier); revocation is a founder-only manual SQL documented in `docs/runbooks.md`. Nothing in
   the product is gated on a perk yet; the web exposes `flags.beta` for later.
4. **Public metrics are counts with a stated boundary**, never a claim of organic adoption:
   `GET /v1/campaign/metrics` says in its own payload that executions, not builds, are counted,
   that social claims are self-declared, that counters start at `CAMPAIGN_STARTS_AT` and that
   there are no page views. Adoption numbers earned under the campaign are always reported with
   that context.

## Update 2026-10-21 (EP4, founder decision)

Perks are recorded by the backend (`wallet_perks`, served on `GET /v1/campaign/me` as `perks`,
`nextPerk`, `flags`) but are **not surfaced in the UI yet**: the Earn view no longer renders the
perks block (component kept). User-facing copy is **neutral by founder decision** — the served
line is "Points unlock perks on Dig as the campaign grows.", rendered once at the top of the Earn
view; it makes no promise and no denial, and the "Are points worth anything?" FAQ entry is gone.
The **internal position is unchanged**: points are non-monetary, nothing pays, no token, no
airdrop; the grep rule on the copy (no "reward", "airdrop", "token", "earn XLM") still applies.

## Why

- **Legal and reputational surface.** A points programme that could be read as a token
  pre-sale, an airdrop promise or a yield would put a post-grant beta under rules it is not
  built for and would contradict the SCF 43 "no financial advice" posture. Saying "no value"
  everywhere, in code and copy, removes the ambiguity.
- **Security.** The faucet (Lot R) already proved that a money path needs a key, a treasury,
  an abuse gate and an incident runbook. A second money path doubles that surface for a
  campaign whose goal is visibility, not distribution. Points cost nothing to issue, so the
  anti-abuse requirement drops to "honest counts".
- **Honesty of the KPI narrative.** The SCF 46 application will cite adoption; an incentive
  that is explicitly non-monetary keeps the distinction between "did something on-chain" and
  "was paid to" visible in the metrics themselves.

## Explicitly out of scope

Tokens, airdrops or any promise of them; payout CSVs; on-chain reward or points contracts;
notional-weighted points; Galxe import (later, only as founder-written `adjust:galxe-import-*`
ledger rows, see `docs/runbooks.md`).
