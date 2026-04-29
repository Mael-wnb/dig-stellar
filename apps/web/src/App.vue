<script setup lang="ts">
import DigDashboard from './components/DigDashboard.vue'
</script>

<template>
  <div class="relative min-h-screen bg-bg text-text overflow-hidden">

    <!-- BACKGROUND -->
    <img
      src="/background.svg"
      class="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none z-0"
    />

    <!-- GLOW / OVERLAY -->
    <div class="absolute inset-0 bg-bg/70 z-0 pointer-events-none"></div>

    <!-- CONTENT -->
    <div class="relative z-10">
      <DigDashboard />
    </div>

  </div>
</template>