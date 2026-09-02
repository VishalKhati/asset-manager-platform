<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium">{{ label }}</label>
      <div class="flex items-center gap-1">
        <button @click="dec"
          class="w-6 h-6 rounded flex items-center justify-center text-sm transition-all"
          style="background:var(--bg-card-2); border:1px solid var(--border); color:var(--text-2)">−</button>
        <span class="font-mono font-bold text-sm min-w-[42px] text-center" style="color:var(--gold)">
          {{ modelValue }}{{ suffix }}
        </span>
        <button @click="inc"
          class="w-6 h-6 rounded flex items-center justify-center text-sm transition-all"
          style="background:var(--bg-card-2); border:1px solid var(--border); color:var(--text-2)">+</button>
      </div>
    </div>
    <input
      type="range"
      :min="min" :max="max" :step="step"
      :value="modelValue"
      @input="onInput"
      class="w-full h-1.5 rounded-full outline-none cursor-pointer"
      style="accent-color:var(--gold)" />
    <div v-if="desc" class="text-xs" style="color:var(--text-3)">{{ desc }}</div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label:      string
  suffix:     string
  modelValue: number
  min:        number
  max:        number
  step:       number
  desc?:      string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
  'change': []
}>()

function onInput(e: Event) {
  emit('update:modelValue', parseFloat((e.target as HTMLInputElement).value))
  emit('change')
}

function dec() {
  const v = Math.max(props.min, Math.round((props.modelValue - props.step) * 100) / 100)
  emit('update:modelValue', v)
  emit('change')
}

function inc() {
  const v = Math.min(props.max, Math.round((props.modelValue + props.step) * 100) / 100)
  emit('update:modelValue', v)
  emit('change')
}
</script>
