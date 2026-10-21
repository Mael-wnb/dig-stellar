// apps/web/src/lib/inviteLink.ts
//
// Lot EP (EP2): the referral invite link. Built from the ORIGIN only (founder
// ruling 2026-10-21): `https://stellar.getdig.ai/#earn?ref=CODE` in production,
// `http://localhost:5173/#earn?ref=CODE` locally — never from the current
// pathname, so a deep page can never leak into the shared link. Pure so the
// spec pins the shape; useView parses the same `#earn?ref=` form back.
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/#earn?ref=${encodeURIComponent(code)}`
}
