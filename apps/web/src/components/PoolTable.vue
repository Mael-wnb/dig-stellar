<!-- src/components/PoolTable.vue -->
<script setup lang="ts">
interface Pool {
  name: string
  icon: string
  iconBg: string
  iconColor: string
  project: string
  tokens: string
  tvl: string
  apy: string
  change30d: string
}

defineProps<{
  pools: Pool[]
  total: number
  currentPage: number
  totalPages: number
}>()

const emit = defineEmits<{
  (e: 'page', page: number): void
}>()
</script>

<template>
  <div class="rounded-xl overflow-hidden" style="background-color: #1a1a1a; border: 1px solid #2a2a2a;">
    <table class="w-full border-collapse text-xs">
      <thead>
        <tr style="border-bottom: 1px solid #2a2a2a;">
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">Pool</th>
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">Project</th>
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">Tokens</th>
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">TVL</th>
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">APY</th>
          <th class="px-4 py-3 text-left font-medium uppercase tracking-widest" style="color: #9A9B99;">% change 30D</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="pool in pools"
          :key="pool.name"
          class="transition-colors"
          style="border-bottom: 1px solid #2a2a2a; cursor: pointer;"
          onmouseover="this.style.backgroundColor='#1e1e1e'"
          onmouseout="this.style.backgroundColor=''"
        >
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <span
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                :style="`background-color: ${pool.iconBg}; color: ${pool.iconColor}; border: 1px solid rgba(255,255,255,0.1);`"
              >
                {{ pool.icon }}
              </span>
              <span class="font-medium text-white">{{ pool.name }}</span>
            </div>
          </td>
          <td class="px-4 py-3" style="color: #888;">{{ pool.project }}</td>
          <td class="px-4 py-3" style="color: #888;">{{ pool.tokens }}</td>
          <td class="px-4 py-3 font-semibold" style="color: #D5FF2F;">{{ pool.tvl }}</td>
          <td class="px-4 py-3 font-semibold" style="color: #D5FF2F;">{{ pool.apy }}</td>
          <td class="px-4 py-3" style="color: #888;">{{ pool.change30d }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Pagination -->
    <div class="flex items-center justify-between px-4 py-3" style="border-top: 1px solid #2a2a2a;">
      <span style="color: #9A9B99; font-size: 11px;">
        1–10 of {{ total }} members
      </span>
      <div class="flex items-center gap-1">
        <button
          class="w-7 h-7 rounded flex items-center justify-center text-xs"
          style="border: 1px solid #2a2a2a; background: transparent; color: #9A9B99; cursor: pointer;"
          @click="emit('page', currentPage - 1)"
        >‹</button>
        <button
          v-for="p in totalPages"
          :key="p"
          class="w-7 h-7 rounded flex items-center justify-center text-xs font-medium"
          :style="p === currentPage
            ? 'background-color: #373B26; color: #D5FF2F; border: 1px solid #D5FF2F; cursor: pointer;'
            : 'border: 1px solid #2a2a2a; background: transparent; color: #9A9B99; cursor: pointer;'"
          @click="emit('page', p)"
        >{{ p }}</button>
        <button
          class="w-7 h-7 rounded flex items-center justify-center text-xs"
          style="border: 1px solid #2a2a2a; background: transparent; color: #9A9B99; cursor: pointer;"
          @click="emit('page', currentPage + 1)"
        >›</button>
      </div>
    </div>
  </div>
</template>