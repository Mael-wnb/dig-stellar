# Lot XO-LOGO — official XOXNO mark (2026-11-08)

- **Source:** official mark sent by the XOXNO team on 2026-11-05 (`xoxno-logo.png`, 192×192 RGBA,
  fully opaque, solid black background, 8,912 B).
- **Conversion:** black knocked out by un-premultiplying against black (alpha = max channel,
  colour ÷ alpha), cropped to the mark's bounding box + 8 % margin, squared around the centre.
  Result: 113×113 RGBA PNG, transparent background, 8,137 B.
- **Asset:** `apps/web/src/assets/protocols/xoxno-logo.png` (same folder and naming as the four
  bundled protocol marks).
- **Imports:** `apps/web/src/data/venueTheme.ts` (`logo: xoxnoLogo`, `letter: 'X'` kept as the
  last-resort monogram) and `apps/web/src/data/protocolMeta.ts` (`logo: xoxnoLogo`).
- **Checked:** renders through `BrandLogo` at 34 px (dashboard tile), 42 px (protocol card),
  30 px (pools table hub rows) and 46 px (pool detail header), at 1440 and 390 px, against the
  production API. Same visual weight as the other marks, no black square, gradient intact.
- **Capture:** `screenshots/xo2-protocols-card-and-rows-1440.png` (card + the three hub rows).
- **Production path:** Vercel deploy of `apps/web` on merge to `main`. No API or DB change:
  `venues.logo_url` stays null for `xoxno`, exactly like Blend, Soroswap, Aquarius and DeFindex.
