// apps/web/src/lib/activityLabels.ts
//
// Lot EP (EP4): the human label per ledger reason and the signed points
// string for the activity feed. Pure and dependency-free so ActivityFeed.spec.ts
// pins the wording without a renderer. Nothing here computes a value: it maps
// the API's reason string to copy and formats the API's points with a sign.

/** Reason → label. Prefix match for the open 'adjust:<note>' family and the two referral sides. */
export function activityLabel(reason: string): string {
  if (reason === 'action:sdex-swap') return 'Swap verified'
  if (reason === 'action:blend-deposit') return 'Blend deposit verified'
  if (reason === 'streak:daily') return 'Daily check-in'
  if (reason === 'social:x-follow') return 'Follow Dig on X'
  if (reason === 'social:x-repost') return 'Repost on X'
  if (reason === 'social:community-join') return 'Join the Dig Discord'
  if (reason.startsWith('referral:')) return 'Referral'
  if (reason.startsWith('adjust:')) return 'Adjustment'
  return reason
}

/** "+50", "−5" (typographic minus), "0". */
export function signedPoints(points: number): string {
  if (points > 0) return `+${points.toLocaleString('en-US')}`
  if (points < 0) return `−${Math.abs(points).toLocaleString('en-US')}`
  return '0'
}
