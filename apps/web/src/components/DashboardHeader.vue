<script setup lang="ts">
defineProps<{
  stats: { title: string; value: string; change?: string }[]
  description?: string
  links?: { label: string; url: string }[]
}>()
</script>

<template>
  <div class="header-wrap">

    <!-- Top bar -->
    <div class="topbar">
      <div class="logo-group">
        <div class="logo-circle">
          <img src="../assets/stellar.svg" alt="Stellar" width="80" height="80" />
        </div>
        <div class="title-row">
          <h1>Stellar Grant by Dig</h1>
          <span class="badge-beta">BETA</span>
        </div>
      </div>
      <div class="desc-block">
        <p class="desc">{{ description }}</p>
        <div v-if="links?.length" class="links-row">
          <a v-for="link in links" :key="link.url" :href="link.url" target="_blank" class="link-pill">
            {{ link.label }} ↗
          </a>
        </div>
      </div>
    </div>

    <!-- Stats grid -->
    <div class="stats-grid">
      <div v-for="stat in stats" :key="stat.title" class="stat-card">
        <div class="stat-label">{{ stat.title }}</div>
        <div class="stat-value">{{ stat.value }}</div>
        <div
          v-if="stat.change"
          class="stat-change"
          :class="{ down: stat.change.startsWith('▼') || stat.change.startsWith('-') }"
        >
          {{ stat.change }}
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.header-wrap { display: flex; flex-direction: column; gap: 14px; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.logo-group { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.logo-circle {
  width: 80px; height: 80px;
  border-radius: 50%;
  background: #373B26;
  border: 1px solid #D5FF2F;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.title-row { display: flex; align-items: center; gap: 8px; }

h1 {
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;
}

.badge-beta {
  font-size: 15px;
  font-weight: 700;
  color: #D5FF2F;
  background: #373B26;
  border: 1px solid #D5FF2F;
  border-radius: 4px;
  padding: 2px 6px;
  letter-spacing: 0.1em;
}

.desc-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: 340px;
}

.desc {
  font-size: 15px;
  color: #ffffff;
  text-align: right;
  line-height: 1.55;
  margin: 0;
}

.links-row {
  display: flex;
  gap: 6px;
}

.link-pill {
  font-size: 13px;
  font-weight: 600;
  color: #D5FF2F;
  background: #373B26;
  border: 1px solid rgba(213,255,47,0.3);
  border-radius: 4px;
  padding: 3px 8px;
  text-decoration: none;
  letter-spacing: 0.05em;
  transition: background 0.15s;
}
.link-pill:hover { background: rgba(213,255,47,0.2); }

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
}

@media (max-width: 900px) {
  .stats-grid { grid-template-columns: repeat(4, 1fr); }
  .desc-block { display: none; }
}

@media (max-width: 500px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

.stat-card {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: flex-start;
}

.stat-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9A9B99;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-value {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.stat-change {
  font-size: 11px;
  color: #D5FF2F;
  font-weight: 500;
}
.stat-change.down { color: #FF5A5A; }
</style>