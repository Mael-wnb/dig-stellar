# Advisor feedback — 2026-08-10 (paraphrase)

Source: front-advisor review of the mainnet beta, received 2026-08-10. Maël holds the
original message; the points below are a paraphrase, dated for the tranche record. This
feedback is the origin of **Lot F (T3-D3 — "Final UI polish based on Mainnet feedback")**;
each point traces to a Lot F step.

## The five points

1. **Faint text is unreadable on the dark cards.** Small labels/metadata sit at too low a
   contrast against the charcoal surfaces — hard to read. → **F1** (raise `--dig-faint`
   until text usage clears WCAG AA 4.5:1). Measured: old `#5E5F5D` is ~2.4–2.9:1 on the
   dig surfaces; fails AA.

2. **Scrollbars look broken/ugly on the dark theme.** Default OS scrollbars clash with the
   dark UI, and only some containers were styled. → **F1** (global scrollbar styling in the
   `--dig-*` tokens, Firefox + WebKit, across every overflow container).

3. **Protocol/asset logos are missing (placeholder monograms everywhere).** The product
   looks unfinished without real venue/asset marks. → **F3** (backend-served `logo_url` with
   a safe monogram fallback).

4. **Empty / logged-out states are hollow.** A disconnected wallet and a connected-but-empty
   portfolio show an empty shell with no guidance or next action. → **F4** (designed
   no-wallet and no-positions states + honest get-started card).

5. **A real user swap failed and the UX did not explain it.** A mainnet swap failed on-chain
   (underfunded — reserves) and the widget gave no useful, honest explanation. → **F2**
   (spendable-balance preflight → clean 400 + friendly copy) and **F4.3** (failed-tx copy:
   "failed atomically, no funds moved"). See `failed-swap-underfunded-2026-08-10.md`.

## Trace

F1 → points 1 & 2 · F2 → point 5 · F3 → point 3 · F4 → points 4 & 5.
This is the feedback→fix loop the tranche reviewer asked to see; before/after captures for
each step land in this folder as the step ships.
