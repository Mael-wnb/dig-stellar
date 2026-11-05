# Lot R — R3b evidence: engaging promo banner (founder feedback)

Done 2026-08-17. Web-only + one small campaign-payload addition. Captures:
`r3b-promo-before.png` (the flat text strip the feedback targeted) →
`r3b-promo-after.png` (redesigned card, countdown + CTAs, taken against the
live local API with `FAUCET_ENDS_AT` set +36h).

## What changed

- **Server**: optional `FAUCET_ENDS_AT` (ISO). When set it joins the campaign
  payload (`endsAt`) and is **enforced** — `campaignState` goes inactive and
  eligibility/claim return a new `campaign-ended` reason once passed (verified
  live: past date → `active:false` + `campaign-ended`). When unset, `endsAt`
  is null and NO time pressure renders anywhere (verified visually — no fake
  urgency). Payload also gains `maxClaims` for the honest "34/40 left"
  progress. Specs: +2 (api suite **122**).
- **FaucetPromoBanner redesign** (design-system consistent — dark card, lime
  accent, same button idiom as the Swap CTA):
  - "Limited reward" badge + bold "Earn 5 XLM" headline with the canonical
    Stellar mark (same BrandLogo + TrustWallet source as TokenSelect);
  - condition line unchanged, live server values;
  - **primary CTA "Swap now"** and secondary **"Supply on Blend"**, opening
    the exact ActionModal contexts the dashboard's own Swap/Deposit buttons
    use — the banner acts, not just reads;
  - claims-left as `remaining/max` + progress bar, live from the server;
  - countdown "Ends in H:MM:SS" ticking every second client-side, end value
    ALWAYS the server's `endsAt`; hidden entirely when no deadline; at zero
    the banner hides itself (and the server has already closed eligibility).
- Widget/Blend one-line notes untouched (per brief). Claim-panel copy gained
  the `campaign-ended` reason.

## Validation

- API 122/122, `nest build` + web `vue-tsc`/vite build green.
- Live checks against the built API: `endsAt` in payload; past deadline →
  campaign inactive + `campaign-ended` on wallet eligibility; no deadline →
  banner without countdown (screenshot-verified); countdown renders and ticks
  from the server value (screenshot-verified).
