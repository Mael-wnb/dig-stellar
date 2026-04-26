<script setup>
defineProps({
  pool:     { type: Object, required: true },
  protocol: { type: Object, required: true },
})
</script>

<template>
  <transition name="fade" mode="out-in">
    <div :key="pool.id" class="flex flex-col gap-3">

      <!-- TOP GRID -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">

        <!-- LEFT: METRICS -->
        <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-4">

          <!-- Header -->
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="text-xs font-semibold px-2 py-1 rounded border"
              :style="{
                color: protocol.iconColor,
                background: protocol.iconBg,
                borderColor: protocol.iconColor + '44'
              }"
            >
              {{ pool.name }}
            </span>

            <span
              class="text-sm font-semibold"
              :style="{ color: protocol.iconColor }"
            >
              {{ protocol.name }}
            </span>
          </div>

          <!-- Metrics -->
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div
              v-for="m in pool.metrics"
              :key="m.label"
              class="bg-cardSoft border border-border rounded-lg p-3 flex flex-col gap-1"
            >
              <span class="text-[10px] uppercase tracking-wider text-muted">
                {{ m.label }}
              </span>

              <span
                class="text-sm font-semibold"
                :class="m.lime ? 'text-accent' : 'text-text'"
              >
                {{ m.value }}
              </span>
            </div>
          </div>

          <!-- Description -->
          <p class="text-xs text-muted leading-relaxed bg-cardSoft border-l-2 border-accent p-3 rounded">
            {{ pool.description }}
          </p>
        </div>

        <!-- RIGHT: ON-CHAIN INFO -->
        <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-4">

          <!-- Header -->
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="text-xs font-semibold px-2 py-1 rounded border"
              :style="{
                color: protocol.iconColor,
                background: protocol.iconBg,
                borderColor: protocol.iconColor + '44'
              }"
            >
              {{ pool.name }}
            </span>

            <span
              class="text-sm font-semibold"
              :style="{ color: protocol.iconColor }"
            >
              {{ protocol.name }}
            </span>

            <span class="text-xs text-muted">
              On-chain info
            </span>
          </div>

          <!-- Table -->
          <div class="flex flex-col">
            <div
              v-for="row in pool.onChainInfo"
              :key="row.key"
              class="flex justify-between items-center py-2 border-b border-border text-xs"
            >
              <span class="text-muted">
                {{ row.key }}
              </span>

              <span
                class="font-medium"
                :class="row.lime ? 'text-accent' : 'text-text'"
              >
                {{ row.value }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- RESERVES TABLE -->
      <div
        v-if="pool.reserves && pool.reserves.length"
        class="bg-card border border-border rounded-xl overflow-hidden"
      >
        <table class="w-full text-xs">

          <!-- HEADER -->
          <thead class="bg-cardSoft border-b border-border">
            <tr class="text-muted uppercase tracking-wider text-[10px]">
              <th class="px-4 py-3 text-left">Asset</th>
              <th class="px-4 py-3 text-left">Supplied</th>
              <th class="px-4 py-3 text-left">Borrowed</th>
              <th class="px-4 py-3 text-left">CF</th>
              <th class="px-4 py-3 text-left">LF</th>
              <th class="px-4 py-3 text-left">Supply APY</th>
              <th class="px-4 py-3 text-left">Borrow APY</th>
            </tr>
          </thead>

          <!-- BODY -->
          <tbody>
            <tr
              v-for="r in pool.reserves"
              :key="r.symbol"
              class="border-b border-border hover:bg-cardSoft transition-colors"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full"
                    :style="{ background: protocol.iconColor }"
                  ></span>

                  <div class="flex flex-col">
                    <span class="font-semibold text-text">
                      {{ r.symbol }}
                    </span>
                    <span class="text-[10px] text-muted">
                      {{ r.project }}
                    </span>
                  </div>
                </div>
              </td>

              <td class="px-4 py-3 font-semibold text-accent">
                {{ r.supplied }}
              </td>

              <td class="px-4 py-3 text-text">
                {{ r.borrowed }}
              </td>

              <td class="px-4 py-3 text-muted">
                {{ r.collateral }}
              </td>

              <td class="px-4 py-3 text-muted">
                {{ r.liability }}
              </td>

              <td class="px-4 py-3 font-semibold text-accent">
                {{ r.supplyApy }}
              </td>

              <td class="px-4 py-3 text-red-400">
                {{ r.borrowApy }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </transition>
</template>