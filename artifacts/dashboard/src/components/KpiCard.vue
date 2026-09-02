<template>
  <div class="card p-4 flex flex-col gap-2 transition-all hover:border-blue-900">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">{{ label }}</span>
      <span class="text-base opacity-30 leading-none">{{ icon }}</span>
    </div>
    <div class="text-2xl font-black tracking-tight leading-none" :style="{ color: accent }">{{ value }}</div>
    <div class="text-xs" style="color:var(--text-3)">{{ sub }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label:  string
  value:  string
  sub?:   string
  accent?: string
  icon?:  string
}>()
</script>
