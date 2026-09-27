import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import TrackRecord from './views/TrackRecord.vue'
import { setUnauthorizedHandler } from './lib/api'
import { useAuthStore } from './stores/auth'
import './index.css'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    // Public
    { path: '/', component: TrackRecord, meta: { title: 'Track record' } },
    { path: '/signals/:no', component: () => import('./views/SignalDetail.vue'), meta: { title: 'Signal' } },
    { path: '/login', component: () => import('./views/Login.vue'), meta: { title: 'Sign in', guestOnly: true } },
    // Operator
    { path: '/ops', component: () => import('./views/ops/Overview.vue'), meta: { auth: true, title: 'Overview' } },
    { path: '/ops/signals', component: () => import('./views/ops/Signals.vue'), meta: { auth: true, title: 'Signals' } },
    { path: '/ops/evaluations', component: () => import('./views/ops/Evaluations.vue'), meta: { auth: true, title: 'Why no signal' } },
    { path: '/ops/strategy', component: () => import('./views/ops/Strategy.vue'), meta: { auth: true, title: 'Strategy' } },
    { path: '/ops/research', component: () => import('./views/ops/Research.vue'), meta: { auth: true, title: 'Research' } },
    { path: '/ops/alerts', component: () => import('./views/Alerts.vue'), meta: { auth: true, title: 'Alerts' } },
    { path: '/ops/users', component: () => import('./views/ops/Users.vue'), meta: { auth: true, admin: true, title: 'Users' } },
    { path: '/:pathMatch(.*)*', component: () => import('./views/NotFound.vue'), meta: { title: 'Not found' } },
  ],
})

const app = createApp(App)
app.use(createPinia())
const auth = useAuthStore()

router.beforeEach(async (to) => {
  if (!auth.checked) await auth.refresh()
  if (to.meta['auth'] && !auth.isAuthenticated) return { path: '/login', query: { next: to.fullPath } }
  if (to.meta['admin'] && !auth.isAdmin) return '/ops'
  if (to.meta['guestOnly'] && auth.isAuthenticated) return '/ops'
  return true
})
router.afterEach((to) => {
  document.title = `${String(to.meta['title'] ?? '')} · Gold Signals`
})

// Any 401 from an operator request means the session ended: go to sign-in.
setUnauthorizedHandler(() => {
  auth.clear()
  if (router.currentRoute.value.meta['auth']) void router.push({ path: '/login', query: { next: router.currentRoute.value.fullPath } })
})

app.use(router)
app.mount('#app')
