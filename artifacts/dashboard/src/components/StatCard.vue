<template>
  <div class="card px-4 py-3 flex flex-col justify-between"
    :class="small ? 'min-w-[90px]' : ''">
    <div class="text-xs font-semibold uppercase tracking-widest mb-1" style="color:var(--text-3)">{{ label }}</div>
    <div class="font-bold" :class="small ? 'text-lg' : 'text-2xl'" :style="{ color: accent ?? 'var(--text-1)' }">
      {{ value }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string; accent?: string; small?: boolean }>()
</script>
