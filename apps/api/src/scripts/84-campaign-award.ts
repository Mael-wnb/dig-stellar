// apps/api/src/scripts/84-campaign-award.ts
//
// Lot EP (EP1, gate 3): the periodic points award. POINTS ONLY — nothing here
// pays, signs or prices anything. Lives in apps/api because it consumes the
// API's PrismaService + CampaignRepository + the pure campaign rules (same
// reasoning as 83-evaluate-alerts.ts); invoked by the indexer wrapper
// (85-run-campaign-job.ts) from OS cron. Boots no Nest application.
//
// THIS SCRIPT IS THE ONLY WRITER OF action:* AND referral:* LEDGER ROWS. It is
// serialized by the cron flock (/tmp/dig-stellar-campaign.lock), so its inserts
// need no row lock (rule H, gate 1-bis); the ledger's partial unique indexes
// make every insert idempotent (on conflict do nothing), so a re-run, a crash
// mid-way or an overlapping manual run can never double-award.
//
// Steps (each logged as ONE line with counts only — never an address or hash):
//   1. window   — CAMPAIGN_ENABLED + CAMPAIGN_STARTS_AT (+ CAMPAIGN_ENDS_AT);
//                 dark → "campaign dark, nothing to award", exit 0.
//   2. actions  — awardable witnesses of enrolled wallets inside the window
//                 without a ledger row, oldest first; daily caps carried per
//                 (wallet, reason, UTC day); streak multiplier from check-ins
//                 up to D-1; skips counted, never stored.
//   3. referrals— uncredited links whose referee has a qualifying witness at or
//                 after the link, inside the window: two ledger rows + the link
//                 marked, in one transaction.
//   4. perks    — (EP3) for every enrolled wallet, balance = sum(points);
//                 insert the PERK_TIERS reached, on conflict do nothing
//                 (wallet_perks' primary key). Insert-only: a later negative
//                 adjust never removes a perk. This script is the ONLY writer
//                 of wallet_perks.
//   5. rewards  — (EP5, MONEY PATH ALLOCATION ONLY — no payout, no key here)
//                 RewardsRepository.allocateClosedDays: for every CLOSED UTC day
//                 (< today, past the post-midnight grace) with positive points
//                 and no allocation row yet, share the XLM pool by points
//                 (pure allocateDay), insert on conflict do nothing (PK). Dark
//                 while REWARDS_ENABLED is unset: one line, nothing written.
//                 The payment itself only ever happens on a user's claim
//                 (modules/rewards/rewards.service.ts), never in this job.
//   6. summary  — awarded_actions, skipped_by_reason, referrals_credited,
//                 perks_granted, rewards_days / rewards_allocations /
//                 rewards_distributed_xlm, duration_ms. Exit 0; any thrown
//                 error → exit 1.

import 'dotenv/config';
import { PrismaService } from '../db/prisma.service';
import { CampaignRepository } from '../modules/campaign/campaign.repository';
import {
  CAMPAIGN_ID,
  campaignEndsAt,
  campaignMinNotionalXlm,
  campaignStartsAt,
  isCampaignEnabled,
} from '../modules/campaign/campaign-config';
import { perksFor, referralCredit, utcDay } from '../modules/campaign/campaign-rules';
import { RewardsRepository } from '../modules/rewards/rewards.repository';
import {
  checkinSetsFromRows,
  countsFromRows,
  planActionAwards,
  EMPTY_SKIPS,
  type SkipCounts,
} from './84-campaign-award.lib';

export interface AwardSummary {
  campaign: number;
  dark: boolean;
  awardedActions: number;
  skippedByReason: SkipCounts;
  referralsCredited: number;
  referralsPending: number;
  /** EP3: wallet_perks rows inserted this run (every tier reached, all wallets). */
  perksGranted: number;
  /** EP5: reward_allocations — dark (REWARDS_ENABLED off), closed days allocated, rows inserted, Σ XLM allocated this run. */
  rewardsDark: boolean;
  rewardsDaysAllocated: number;
  rewardsAllocations: number;
  rewardsDistributedXlm: string;
  durationMs: number;
}

export async function runCampaignAward(
  repo: CampaignRepository,
  rewards: RewardsRepository,
  opts: { log?: (line: string) => void } = {},
): Promise<AwardSummary> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const startedAt = Date.now();
  const summary: AwardSummary = {
    campaign: CAMPAIGN_ID,
    dark: false,
    awardedActions: 0,
    skippedByReason: EMPTY_SKIPS(),
    referralsCredited: 0,
    referralsPending: 0,
    perksGranted: 0,
    rewardsDark: true,
    rewardsDaysAllocated: 0,
    rewardsAllocations: 0,
    rewardsDistributedXlm: '0.0000000',
    durationMs: 0,
  };

  // 1. window
  const startsAt = campaignStartsAt();
  const endsAt = campaignEndsAt();
  if (!isCampaignEnabled() || startsAt == null) {
    summary.dark = true;
    summary.durationMs = Date.now() - startedAt;
    log(`[campaign-award] campaign dark, nothing to award (campaign=${CAMPAIGN_ID})`);
    return summary;
  }
  const window = { startsAtMs: startsAt.getTime(), endsAtMs: endsAt?.getTime() ?? null };
  const minNotionalXlm = campaignMinNotionalXlm(); // EP5 item 10: the campaign's own minimum
  log(
    `[campaign-award] window campaign=${CAMPAIGN_ID} starts=${startsAt.toISOString()} ends=${endsAt?.toISOString() ?? 'none'} min_notional_xlm=${minNotionalXlm}`,
  );

  // 2. actions
  const [candidates, countedRows, checkinRows] = await Promise.all([
    repo.findActionCandidates(CAMPAIGN_ID, window),
    repo.countedActionsByDay(CAMPAIGN_ID),
    repo.checkinDaysByWallet(CAMPAIGN_ID),
  ]);
  const plan = planActionAwards(
    candidates.map((c) => ({
      txHash: c.tx_hash,
      address: c.address,
      userId: c.user_id,
      kind: c.kind,
      notionalXlm: c.notional_xlm,
      closedAtMs: new Date(c.ledger_closed_at).getTime(),
    })),
    countsFromRows(countedRows),
    checkinSetsFromRows(checkinRows),
    window,
    minNotionalXlm,
  );
  for (const award of plan.awards) {
    summary.awardedActions += await repo.insertActionAward({
      campaign: CAMPAIGN_ID,
      address: award.address,
      userId: award.userId,
      reason: award.reason,
      basePoints: award.basePoints,
      multiplier: award.multiplier,
      points: award.points,
      witnessTxHash: award.txHash,
      countedDay: award.countedDay,
    });
  }
  summary.skippedByReason = plan.skipped;
  log(
    `[campaign-award] actions candidates=${candidates.length} awarded=${summary.awardedActions} ` +
      `skipped=${JSON.stringify(plan.skipped)}`,
  );

  // 3. referrals
  const uncredited = await repo.findUncreditedReferrals(CAMPAIGN_ID);
  for (const link of uncredited) {
    const witness = await repo.findRefereeFirstQualifyingWitness(link.referee_address, new Date(link.linked_at), minNotionalXlm);
    const decision = referralCredit({
      linkedAtMs: new Date(link.linked_at).getTime(),
      witnessClosedAtMs: witness ? new Date(witness.ledger_closed_at).getTime() : null,
      window,
    });
    if (!decision.credit) {
      summary.referralsPending += 1;
      continue;
    }
    await repo.creditReferral({
      campaign: CAMPAIGN_ID,
      refereeAddress: link.referee_address,
      referrerAddress: link.referrer_address,
      txHash: witness!.tx_hash,
      countedDay: utcDay(new Date(witness!.ledger_closed_at)),
      referrerPoints: decision.referrerPoints,
      refereePoints: decision.refereePoints,
    });
    summary.referralsCredited += 1;
  }
  log(
    `[campaign-award] referrals uncredited=${uncredited.length} credited=${summary.referralsCredited} ` +
      `pending=${summary.referralsPending}`,
  );

  // 4. perks (after actions + referrals so this run's awards count)
  const balances = await repo.balancesOfEnrolled(CAMPAIGN_ID);
  for (const { address, balance } of balances) {
    for (const perkKey of perksFor(balance)) {
      summary.perksGranted += await repo.insertPerk({ campaign: CAMPAIGN_ID, address, perkKey, pointsAtGrant: balance });
    }
  }
  log(`[campaign-award] perks wallets=${balances.length} granted=${summary.perksGranted}`);

  // 5. rewards (EP5): allocation of closed days ONLY — the payout happens on
  // the user's claim, never here. Dark while REWARDS_ENABLED is unset.
  const allocation = await rewards.allocateClosedDays(CAMPAIGN_ID, { log });
  summary.rewardsDark = allocation.dark;
  summary.rewardsDaysAllocated = allocation.daysAllocated;
  summary.rewardsAllocations = allocation.allocations;
  summary.rewardsDistributedXlm = allocation.distributedXlm;
  if (allocation.dark) {
    log(`[campaign-award] rewards dark (REWARDS_ENABLED unset), no allocation`);
  } else {
    log(
      `[campaign-award] rewards days_pending=${allocation.daysPending} waiting_grace=${allocation.daysWaitingGrace} ` +
        `days_allocated=${allocation.daysAllocated} allocations=${allocation.allocations} ` +
        `excluded_wallets=${allocation.excludedWallets} distributed_xlm=${allocation.distributedXlm} ` +
        `remainder_xlm=${allocation.remainderXlm} pool_xlm=${allocation.poolXlm} cap_xlm=${allocation.capXlm}`,
    );
  }

  // 6. summary
  summary.durationMs = Date.now() - startedAt;
  log(
    `[campaign-award] summary awarded_actions=${summary.awardedActions} ` +
      `skipped_by_reason=${JSON.stringify(summary.skippedByReason)} ` +
      `referrals_credited=${summary.referralsCredited} perks_granted=${summary.perksGranted} ` +
      `rewards_days=${summary.rewardsDaysAllocated} rewards_allocations=${summary.rewardsAllocations} ` +
      `rewards_distributed_xlm=${summary.rewardsDistributedXlm} ` +
      `duration_ms=${summary.durationMs}`,
  );
  return summary;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await runCampaignAward(new CampaignRepository(prisma), new RewardsRepository(prisma));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[campaign-award] FAILED');
    console.error(err);
    process.exit(1);
  });
}
