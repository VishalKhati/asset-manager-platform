<template>
  <div class="card p-5 mb-4">
    <div class="text-sm font-bold mb-4" style="color:var(--text-1)">{{ title }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
</script>
