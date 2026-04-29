<script setup lang="ts">
import DigDashboard from './components/DigDashboard.vue'
</script>

<template>
  <div class="layout">

    <div class="content">
      <DigDashboard />
    </div>

  </div>
</template>

<style scoped>
.layout {
  position: relative;
  min-height: 100vh;
  background-color: #0e0e0e;

  /* 🔥 LE FIX IMPORTANT */
  background-image: url('/background.svg');
  background-repeat: no-repeat;

  /* 👉 on ancre le visuel sur TON coin important */
  background-position: top right;

  /* 👉 comportement responsive clean */
  background-size: cover;
}

/* 🔥 AJUSTEMENT FIN PAR BREAKPOINT */

@media (max-width: 640px) {
  .layout {
    background-size: 140%;
    background-position: top right;
  }
}

@media (min-width: 1024px) {
  .layout {
    background-size: 110%;
    background-position: top right;
  }
}

.content {
  position: relative;
  z-index: 10;
}
</style>