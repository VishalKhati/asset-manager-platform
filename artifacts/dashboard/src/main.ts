import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './index.css'

import Dashboard     from './views/Dashboard.vue'
import History        from './views/History.vue'
import Logs           from './views/Logs.vue'
import Config         from './views/Config.vue'
import Backtest       from './views/Backtest.vue'
import Login          from './views/Login.vue'
import MT5Setup       from './views/MT5Setup.vue'
import Admin          from './views/Admin.vue'
import Notifications  from './views/Notifications.vue'
import Alerts         from './views/Alerts.vue'

const base = import.meta.env.BASE_URL

const router = createRouter({
  history: createWebHistory(base),
  routes: [
    { path: '/login',     component: Login,    meta: { public: true } },
    { path: '/',          component: Dashboard },
    { path: '/history',   component: History   },
    { path: '/backtest',  component: Backtest  },
    { path: '/logs',      component: Logs      },
    { path: '/config',    component: Config    },
    { path: '/mt5-setup',      component: MT5Setup       },
    { path: '/notifications',  component: Notifications  },
    { path: '/alerts',         component: Alerts         },
    { path: '/admin',          component: Admin,    meta: { adminOnly: true } },
    { path: '/:pathMatch(.*)*', component: () => import('./views/NotFound.vue') },
  ],
})

// Auth + admin guard
router.beforeEach((to) => {
  const isAuth   = !!(localStorage.getItem('smc_jwt') && localStorage.getItem('smc_user'))
  const userJson = localStorage.getItem('smc_user')
  const role     = userJson ? (() => { try { return JSON.parse(userJson)?.role } catch { return null } })() : null

  if (to.meta.public)    return isAuth ? '/' : true
  if (!isAuth)           return '/login'
  if (to.meta.adminOnly && role !== 'admin') return '/'
  return true
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
