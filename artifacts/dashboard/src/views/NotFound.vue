<template>
  <div class="flex flex-col items-center justify-center min-h-full py-24 px-6 text-center">
    <div class="text-7xl font-black font-mono mb-4" style="color:var(--border)">404</div>
    <div class="text-lg font-bold mb-2" style="color:var(--text-1)">Page not found</div>
    <div class="text-sm mb-8" style="color:var(--text-3)">
      The route <code class="font-mono px-1.5 py-0.5 rounded" style="background:var(--bg-card); color:var(--text-2)">{{ route.path }}</code> doesn't exist.
    </div>
    <router-link to="/"
      class="px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
      style="background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.05)); color:#7dd3fc; border:1px solid rgba(59,130,246,0.25)">
      ← Back to Dashboard
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>
