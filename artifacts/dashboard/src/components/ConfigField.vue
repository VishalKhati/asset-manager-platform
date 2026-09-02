<template>
  <div>
    <label class="text-xs mb-1 block" style="color:#64748b">{{ label }}</label>
    <input
      :type="type ?? 'text'"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @change="$emit('change')"
      class="w-full px-3 py-2 rounded-lg text-sm outline-none"
      style="background:#0a0e1a; border:1px solid #1e2d4a; color:#e2e8f0"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; modelValue: unknown; type?: string }>()
defineEmits(['update:modelValue', 'change'])
</script>
