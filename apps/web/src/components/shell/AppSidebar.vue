<script setup lang="ts">
// AppSidebar — Lot C shell sidebar (design: Dig Stellar.dc.html SIDEBAR block).
// Nav → the five views · real user_wallets list (active-signer vs watch-only) ·
// footer (live dot + real network + socials). All data is real: the Alerts badge
// is the live unread notifications count; the wallets are the connected user's
// tracked wallets. "+ Add wallet" drives the real connect flow.

import { computed } from 'vue'
import { useView, type AppView } from '../../composables/useView'
import { useNotifications } from '../../composables/useNotifications'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useModals } from '../../composables/useModals'
import digWordmark from '../../assets/design/dig-wordmark.svg'

const { view, setView } = useView()
const { unreadCount } = useNotifications()
const { openConnect } = useModals()

// Shared wallets instance (loads the user's overview once, reused by the
// portfolio view + pool-detail "Your position" card).
const { wallets } = useSharedWallets()

type NavKey = Exclude<AppView, 'pool'>
interface NavItem {
  key: NavKey
  label: string
  icon: string
  badge?: number
}

const ICONS: Record<string, string> = {
  grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  layers: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>',
  wallet: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.3" fill="currentColor" stroke="none"/></svg>',
  bell: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
}

const navItems = computed<NavItem[]>(() => [
  { key: 'dashboard', label: 'Dashboard', icon: ICONS.grid },
  { key: 'protocols', label: 'Protocols', icon: ICONS.layers },
  { key: 'portfolio', label: 'Portfolio', icon: ICONS.wallet },
  {
    key: 'alerts',
    label: 'Alerts',
    icon: ICONS.bell,
    badge: unreadCount.value > 0 ? unreadCount.value : undefined,
  },
])

// "Protocols" stays active while the pool sub-view is open.
function isActive(key: NavKey): boolean {
  if (key === 'protocols') return view.value === 'protocols' || view.value === 'pool'
  return view.value === key
}

const WALLET_DOTS = ['#63A7FF', '#2E9E63', '#D86A3E', '#7B45D6', '#B98A00', '#159A8C', '#D0522E']

const walletsNav = computed(() =>
  wallets.value.map((w, i) => ({
    id: w.id,
    // W2: short-address fallback, never the literal 'Wallet'.
    label: w.label || shortAddr(w.address),
    short: shortAddr(w.address),
    // Active signer → lime dot; watch-only → its palette colour, dimmed intent.
    dot: w.isActiveSigner ? '#D5FF2F' : WALLET_DOTS[i % WALLET_DOTS.length],
  })),
)

function shortAddr(a: string): string {
  return a && a.length > 10 ? `${a.slice(0, 3)}…${a.slice(-3)}` : a
}

function goWallet() {
  setView('portfolio')
}

// The footer names the DATA PLANE, which is always Mainnet (portfolio + analytics
// are Mainnet by app rule). The Mainnet/Testnet selector scopes signing only, so
// it must NOT flip this label — otherwise the footer would read "testnet" while
// the whole dashboard/portfolio still shows Mainnet data.
const networkLabel = 'Stellar mainnet'
</script>

<template>
  <aside
    class="w-[236px] flex-shrink-0 h-full flex flex-col px-[14px] py-[18px]"
    style="background: var(--dig-surface); border-right: 1px solid var(--dig-line)"
  >
    <!-- Wordmark -->
    <div
      class="flex items-center px-[10px] pt-[8px] pb-[18px] mb-[8px]"
      style="border-bottom: 1px solid #2A2A27"
    >
      <img :src="digWordmark" alt="Dig" class="h-[30px] w-auto flex-shrink-0" />
    </div>

    <!-- Overview -->
    <div
      class="px-[10px] pt-[6px] pb-[6px] text-[10.5px] font-semibold uppercase tracking-[0.09em]"
      style="color: var(--dig-faint)"
    >
      Overview
    </div>
    <button
      v-for="item in navItems"
      :key="item.key"
      type="button"
      :class="isActive(item.key) ? 'dig-navon' : 'dig-nav'"
      class="flex items-center gap-[11px] px-[10px] py-[9px] rounded-[10px] cursor-pointer text-[13.5px] mb-[2px] w-full text-left transition-colors"
      :style="{
        fontWeight: isActive(item.key) ? 600 : 500,
        color: isActive(item.key) ? 'var(--dig-text)' : 'var(--dig-faint)',
        background: isActive(item.key) ? '#2A2A27' : 'transparent',
      }"
      @click="setView(item.key)"
    >
      <span class="w-[18px] flex justify-center" v-html="item.icon" />
      <span>{{ item.label }}</span>
      <span
        v-if="item.badge"
        class="ml-auto text-[11px] font-semibold px-[7px] py-[1px] rounded-[20px]"
        style="background: #2A2A27; color: var(--dig-accent)"
      >
        {{ item.badge }}
      </span>
    </button>

    <!-- Wallets -->
    <div
      class="px-[10px] pt-[18px] pb-[6px] text-[10.5px] font-semibold uppercase tracking-[0.09em]"
      style="color: var(--dig-faint)"
    >
      Wallets
    </div>
    <button
      v-for="w in walletsNav"
      :key="w.id"
      type="button"
      class="dig-nav flex items-center gap-[10px] px-[10px] py-[8px] rounded-[10px] cursor-pointer w-full text-left transition-colors"
      @click="goWallet"
    >
      <span
        class="w-[8px] h-[8px] rounded-full flex-shrink-0"
        :style="{ background: w.dot }"
      />
      <span class="text-[13px] font-medium truncate" style="color: var(--dig-faint)">
        {{ w.label }}
      </span>
      <span
        class="ml-auto text-[12px] font-mono-geist flex-shrink-0"
        style="color: var(--dig-faint)"
      >
        {{ w.short }}
      </span>
    </button>
    <p
      v-if="!walletsNav.length"
      class="px-[10px] py-[6px] text-[12px]"
      style="color: var(--dig-faint)"
    >
      No wallets tracked yet.
    </p>

    <button
      type="button"
      class="dig-chip flex items-center gap-[8px] px-[10px] py-[8px] rounded-[10px] cursor-pointer text-[13px] font-medium mt-[2px] w-full text-left transition-colors"
      style="color: var(--dig-faint)"
      @click="openConnect"
    >
      <span class="text-[15px] leading-none">+</span> Add wallet
    </button>

    <!-- System status (Lot ST): plain link at the bottom of the nav, outside
         the product views. No live dot for the beta — a dot would mean polling
         the full status payload from every view. -->
    <button
      type="button"
      class="dig-nav mt-auto flex items-center gap-[8px] px-[10px] py-[7px] rounded-[10px] cursor-pointer text-[12.5px] w-full text-left transition-colors"
      :style="{
        fontWeight: view === 'status' ? 600 : 500,
        color: view === 'status' ? 'var(--dig-text)' : 'var(--dig-faint)',
        background: view === 'status' ? '#2A2A27' : 'transparent',
      }"
      title="View system status"
      @click="setView('status')"
    >
      System status
    </button>

    <!-- Footer -->
    <div class="px-[10px] pt-[14px] pb-[4px]" style="border-top: 1px solid #2C2C29">
      <div class="flex items-center gap-[8px]">
        <div
          class="w-[8px] h-[8px] rounded-full flex-shrink-0"
          style="background: #3FA46A; box-shadow: 0 0 0 3px #12301F"
        />
        <span class="text-[12px] font-medium" style="color: var(--dig-muted)">Live</span>
        <span class="text-[12px]" style="color: var(--dig-faint)">/</span>
        <span class="text-[12px] font-medium" style="color: var(--dig-muted)">{{ networkLabel }}</span>
      </div>
      <div class="flex gap-[8px] mt-[12px]">
        <a
          href="https://x.com/Dig_Agentic"
          target="_blank"
          rel="noopener"
          title="Follow on X"
          class="dig-social flex-1 flex items-center justify-center gap-[7px] h-[34px] rounded-[10px] no-underline text-[12px] font-semibold transition-all"
          style="background: #242422; border: 1px solid var(--dig-line); color: var(--dig-muted)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          X
        </a>
        <a
          href="https://discord.gg/sDpqGfmDgF"
          target="_blank"
          rel="noopener"
          title="Join Discord"
          class="dig-social flex-1 flex items-center justify-center gap-[7px] h-[34px] rounded-[10px] no-underline text-[12px] font-semibold transition-all"
          style="background: #242422; border: 1px solid var(--dig-line); color: var(--dig-muted)"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Discord
        </a>
      </div>
    </div>
  </aside>
</template>
