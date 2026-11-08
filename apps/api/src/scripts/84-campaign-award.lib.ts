// apps/api/src/scripts/84-campaign-award.lib.ts
//
// Lot EP (EP1, gate 3): the pure planning half of the award job. EP5 (item 8):
// the implementation lives in modules/campaign/award-planner.ts so the
// immediate per-wallet sync (CampaignService.sync) and this job share ONE
// planner; this file keeps the historical import path for the job and its spec.
export * from '../modules/campaign/award-planner';
