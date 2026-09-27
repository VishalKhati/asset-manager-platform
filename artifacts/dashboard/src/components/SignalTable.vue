<template>
  <div class="overflow-x-auto">
    <table class="data-table text-sm">
      <thead>
        <tr>
          <th>#</th>
          <th>Time</th>
          <th>Side</th>
          <th class="text-right">Entry</th>
          <th class="text-right">SL</th>
          <th class="text-right">TP2</th>
          <th>Result</th>
          <th class="text-right">R</th>
          <th v-if="showMode">Mode</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in signals" :key="s.id" class="cursor-pointer" @click="$emit('open', s)">
          <td class="num faint">{{ s.publicNo }}</td>
          <td class="num muted whitespace-nowrap">{{ dateTime(s.t) }}</td>
          <td>
            <span class="pill" :style="s.direction === 'long' ? 'background:var(--green-dim);color:#6ee7b7' : 'background:var(--red-dim);color:#fca5a5'">
              {{ s.direction === 'long' ? 'BUY' : 'SELL' }}
            </span>
          </td>
          <td class="num text-right">{{ price(s.entry) }}</td>
          <td class="num text-right faint">{{ price(s.sl) }}</td>
          <td class="num text-right faint">{{ price(s.tp2) }}</td>
          <td :style="{ color: outcomeColor(s) }">{{ status(s) }}</td>
          <td class="num text-right" :style="{ color: outcomeColor(s) }">{{ s.outcome && s.outcome !== 'expired' ? r(s.rNet) : '' }}</td>
          <td v-if="showMode" class="faint">{{ s.mode }}{{ s.published ? '' : ' · not posted' }}</td>
        </tr>
        <tr v-if="!signals.length">
          <td :colspan="showMode ? 9 : 8" class="text-center faint py-8">No signals yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { dateTime, outcomeColor, price, r, status } from '../lib/format'
import type { Signal } from '../lib/types'

defineProps<{ signals: Signal[]; showMode?: boolean }>()
defineEmits<{ open: [s: Signal] }>()
</script>
