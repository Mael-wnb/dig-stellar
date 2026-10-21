<script setup lang="ts">
// EarnFaq — Lot EP (EP2, trimmed in EP4). Short, honest answers (English).
// Numbers here are the API's (rules), never hard-coded; the only fixed facts
// are the witness window (recon §9.11) and the supported wallets
// (ep1-wallet-matrix.md). EP4 (founder decision 2026-10-21, neutral copy):
// the "Are points worth anything?" entry is gone and the disclaimer is no
// longer repeated here — it is rendered once at the top of the Earn view.
import type { CampaignRules } from '../../api/campaign'

defineProps<{ rules: CampaignRules | null }>()
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
  >
    <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">FAQ</h2>
    <dl class="m-0 mt-[10px] flex flex-col gap-[10px] text-[12.5px] leading-[1.6]">
      <div>
        <dt class="font-semibold" style="color: var(--dig-text)">Which actions count?</dt>
        <dd class="m-0" style="color: var(--dig-text-2)">
          Swaps and Blend deposits signed in Dig and verified on-chain, from the campaign start.
          Actions you made since the campaign started count once you enrol; actions before the
          campaign never do. Withdrawals do not count.
          <template v-if="rules">
            Daily caps apply ({{ rules.actions['sdex-swap'].dailyCap }} swaps,
            {{ rules.actions['blend-deposit'].dailyCap }} deposits per UTC day).
          </template>
        </dd>
      </div>
      <div>
        <dt class="font-semibold" style="color: var(--dig-text)">My action does not show up.</dt>
        <dd class="m-0" style="color: var(--dig-text-2)">
          Points are credited by a periodic verification run, not instantly. A swap signed more than
          an hour after it was built is not counted. Very small amounts below the minimum are not counted either.
        </dd>
      </div>
      <div>
        <dt class="font-semibold" style="color: var(--dig-text)">How do social tasks work?</dt>
        <dd class="m-0" style="color: var(--dig-text-2)">
          They are self-declared: do the task, then declare your handle. One handle per wallet, one
          claim per task<template v-if="rules">, at most {{ rules.socialDailyCap }} social points per UTC day</template>.
          You can remove a claim at any time; its points are reversed and the handle is deleted.
        </dd>
      </div>
      <div>
        <dt class="font-semibold" style="color: var(--dig-text)">Which wallets can join?</dt>
        <dd class="m-0" style="color: var(--dig-text-2)">
          Joining requires signing a short text message (not a transaction). Freighter and xBull
          support it today; Lobstr does not yet.
        </dd>
      </div>
    </dl>
  </section>
</template>
