// apps/web/src/lib/pointsForAction.ts
//
// Lot EP (EP2): the ONE place the web reads an action's points — straight from
// the API's rules block (CampaignState.rules.actions[kind].basePoints). Pure
// and dependency-free so the PointsChip spec can pin "from the API value only"
// without pulling the wallet kit into the test runner. Nothing here computes
// a value: it looks one up, or returns null when the campaign is not active.
import type { ActionKind, CampaignState } from '../api/campaign'

export function pointsForActionIn(state: CampaignState | null, kind: ActionKind): number | null {
  if (!state?.active) return null
  const v = state.rules?.actions?.[kind]?.basePoints
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
