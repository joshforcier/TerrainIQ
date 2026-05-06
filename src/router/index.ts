import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingPage.vue'),
      meta: { public: true, hideChrome: true },
    },
    {
      path: '/app',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/map',
      name: 'map',
      component: () => import('@/views/MapView.vue'),
    },
    {
      path: '/analysis',
      name: 'analysis',
      component: () => import('@/views/AnalysisView.vue'),
    },
    {
      path: '/points',
      name: 'points',
      component: () => import('@/views/PointsView.vue'),
      meta: { hideSidebar: true },
    },
    {
      path: '/reminders',
      name: 'reminders',
      component: () => import('@/views/NotificationsView.vue'),
      meta: { hideSidebar: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
  ],
})

// Auth guard — redirect unauthenticated users to landing page
router.beforeEach(async (to) => {
  if (to.meta.public) return true

  // Lazy-import the auth store to avoid circular dependency
  const { useAuthStore } = await import('@/stores/auth')
  const authStore = useAuthStore()

  // Wait for Firebase to resolve initial auth state
  if (authStore.loading) {
    await new Promise<void>((resolve) => {
      const unwatch = authStore.$subscribe(() => {
        if (!authStore.loading) {
          unwatch()
          resolve()
        }
      })
      if (!authStore.loading) {
        unwatch()
        resolve()
      }
    })
  }

  if (!authStore.isAuthenticated) {
    return { name: 'landing' }
  }

  return true
})

export default router
