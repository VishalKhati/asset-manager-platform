<template>
  <div class="space-y-4">
    <h1 class="text-xl font-black">Users and audit log</h1>
    <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>

    <Section title="Accounts">
      <table class="data-table text-sm">
        <thead><tr><th>User</th><th>Role</th><th>Last seen</th><th>Active</th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }} <span class="faint text-xs">{{ u.email }}</span></td>
            <td>
              <select :value="u.role" class="input w-auto py-1" :disabled="u.id === auth.user?.id" @change="update(u.id, { role: ($event.target as HTMLSelectElement).value })">
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </td>
            <td class="muted text-xs">{{ u.lastSeenAt ? u.lastSeenAt.slice(0, 16).replace('T', ' ') : 'never' }}</td>
            <td class="w-40"><ToggleField v-if="u.id !== auth.user?.id" :model-value="u.active" label="" @update:model-value="(v: boolean) => update(u.id, { active: v })" /></td>
          </tr>
        </tbody>
      </table>
      <form class="grid md:grid-cols-4 gap-3 mt-4 items-end" @submit.prevent="create">
        <ConfigField v-model="form.username" label="New username" />
        <ConfigField v-model="form.password" label="Password (12+ characters)" type="password" />
        <div>
          <label class="text-xs mb-1 block" style="color: #64748b">Role</label>
          <select v-model="form.role" class="input"><option value="viewer">viewer</option><option value="admin">admin</option></select>
        </div>
        <button class="btn btn-gold justify-center" :disabled="!form.username || String(form.password).length < 12">Create account</button>
      </form>
    </Section>

    <Section title="Audit log">
      <table class="data-table text-sm">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>
          <tr v-for="a in audit" :key="a.id">
            <td class="muted text-xs whitespace-nowrap">{{ a.createdAt.slice(0, 19).replace('T', ' ') }}</td>
            <td>{{ a.actorUsername }}</td>
            <td class="num text-xs">{{ a.action }}</td>
            <td class="muted">{{ a.targetUsername ?? a.targetId ?? '' }}</td>
            <td class="faint text-xs num">{{ a.details ? JSON.stringify(a.details) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Section from '../../components/Section.vue'
import ConfigField from '../../components/ConfigField.vue'
import ToggleField from '../../components/ToggleField.vue'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'

interface User {
  id: string
  username: string
  email: string | null
  role: string
  active: boolean
  lastSeenAt: string | null
}
interface Audit {
  id: number
  actorUsername: string
  action: string
  targetId: string | null
  targetUsername: string | null
  details: Record<string, unknown> | null
  createdAt: string
}

const auth = useAuthStore()
const users = ref<User[]>([])
const audit = ref<Audit[]>([])
const error = ref('')
const form = reactive({ username: '', password: '', role: 'viewer' })

async function load(): Promise<void> {
  const [u, a] = await Promise.all([api.get<{ users: User[] }>('/admin/users'), api.get<{ logs: Audit[] }>('/admin/audit?limit=100')])
  users.value = u.users
  audit.value = a.logs
}

async function update(id: string, body: Record<string, unknown>): Promise<void> {
  try {
    await api.patch(`/admin/users/${id}`, body)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Update failed.'
  }
}

async function create(): Promise<void> {
  try {
    await api.post('/admin/users', { username: String(form.username).trim(), password: String(form.password), role: form.role })
    form.username = ''
    form.password = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not create the account.'
  }
}

onMounted(load)
</script>
