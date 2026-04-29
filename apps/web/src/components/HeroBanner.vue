<script setup lang="ts">
defineProps<{
  title: string
  description: string
  image: string
  logo: string
}>()
</script>

<template>
  <div
    class="w-full rounded-xl border overflow-hidden flex bg-[var(--card)] border-[var(--border)]"
  >

    <!-- LEFT -->
    <div
      class="flex flex-col justify-center items-start text-left flex-1 p-[54px] gap-[24px]"
    >

      <!-- TITLE ROW -->
      <div class="flex items-center gap-[14px]">

        <!-- LOGO -->
        <div
          class="w-[38px] h-[38px] rounded-full flex items-center justify-center bg-[#373B26] border border-[var(--accent)]"
        >
          <img :src="logo" alt="logo" class="w-[20px] h-[20px]" />
        </div>

        <!-- TITLE -->
        <h2
          class="text-[48px] font-bold tracking-[0.4px] text-[#FFF]"
          style="font-family: 'Clash Display', sans-serif;"
        >
          {{ title }}
        </h2>

      </div>

      <!-- DESCRIPTION -->
      <p
        class="max-w-[630px] text-[16px] leading-[24px] text-[var(--grey-11)]"
        style="font-family: 'IBM Plex Sans', sans-serif;"
      >
        {{ description }}
      </p>

    </div>

    <!-- RIGHT -->
    <div
      class="hidden md:flex flex-1 relative items-center justify-center bg-[var(--card-soft)]"
    >
      <img
        :src="image"
        alt="hero"
        class="w-full h-full object-cover opacity-90"
      />

      <div class="absolute inset-0 bg-gradient-to-l from-transparent to-bg/70"></div>
    </div>

  </div>
</template>