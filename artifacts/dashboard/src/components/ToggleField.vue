<template>
  <div class="flex items-center justify-between py-1">
    <span class="text-sm" style="color:#94a3b8">{{ label }}</span>
    <button @click="toggle"
      class="relative w-10 h-5 rounded-full transition-all"
      :style="modelValue ? 'background:#166534' : 'background:#374151'">
      <span class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
        :style="modelValue ? 'left:22px; background:#22c55e' : 'left:2px; background:#9ca3af'"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ label: string; modelValue: boolean }>()
const emit = defineEmits(['update:modelValue', 'change'])
function toggle() {
  emit('update:modelValue', !props.modelValue)
  emit('change')
}
</script>
