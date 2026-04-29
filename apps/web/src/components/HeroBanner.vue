<script setup lang="ts">
defineProps<{
  title: string
  description: string
  image: string
}>()
</script>

<template>
  <div class="w-full rounded-2xl border border-border bg-card overflow-hidden flex">

    <!-- LEFT -->
    <div class="flex flex-col justify-center p-6 md:p-8 flex-1 gap-3">

      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full border border-accent flex items-center justify-center">
          <span class="text-accent text-lg">◎</span>
        </div>

        <h2 class="text-xl md:text-2xl font-semibold text-text">
          {{ title }}
        </h2>
      </div>

      <p class="text-sm text-muted max-w-md leading-relaxed">
        {{ description }}
      </p>

    </div>

    <!-- RIGHT -->
    <div class="hidden md:flex flex-1 relative items-center justify-center bg-cardSoft">

      <img
        :src="image"
        alt="hero"
        class="w-full h-full object-cover opacity-90"
      />

      <!-- Glow overlay -->
      <div class="absolute inset-0 bg-gradient-to-l from-transparent to-bg/60"></div>

    </div>

  </div>
</template>