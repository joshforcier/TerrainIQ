<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionStore } from '@/stores/subscription'
import { useRoute, useRouter } from 'vue-router'
import FeedbackModal from '@/components/common/FeedbackModal.vue'
import { useMapStore, type AppMode } from '@/stores/map'

const appStore = useAppStore()
const authStore = useAuthStore()
const subscriptionStore = useSubscriptionStore()
const mapStore = useMapStore()
const route = useRoute()
const router = useRouter()
const feedbackOpen = ref(false)
const isDevMode = import.meta.env.DEV

const usageBadge = computed<{ short: string; tooltip: string } | null>(() => {
  if (!authStore.isAuthenticated || subscriptionStore.loading) return null
  const limit = subscriptionStore.analysesLimit
  if (limit === Infinity) return null // Guide — don't bother showing a counter
  const used = subscriptionStore.analysesUsed
  const remaining = Math.max(0, limit - used)
  const free = !subscriptionStore.hasAccess
  return {
    short: free ? `Free: ${remaining} left` : `${remaining} / ${limit} left`,
    tooltip: free
      ? `${remaining} free analysis${remaining === 1 ? '' : 'es'} left before checkout.`
      : `${used} of ${limit} monthly analyses used. Resets on the 1st (UTC).`,
  }
})

const trialBadge = computed<{ short: string; tooltip: string } | null>(() => {
  if (!subscriptionStore.isOnTrial) return null
  const days = subscriptionStore.trialDaysLeft
  const end = subscriptionStore.trialEndDate
  if (days == null || !end) return null

  const short =
    days <= 0 ? 'Trial ends today'
    : days === 1 ? '1 day left'
    : `${days} days left`

  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const tooltip = `Free trial — billing begins ${endStr}`

  return { short, tooltip }
})

const modeLinks: Array<{ label: string; sub: string; mode: AppMode; icon: string }> = [
  { label: 'Scouting', mode: 'scouting', icon: 'travel_explore' },
  { label: 'PLANNING', mode: 'in-season', icon: 'event_note' },
]

const featureLinks = [
  { label: 'Point Tracker', path: '/points', icon: 'scoreboard', comingSoon: true },
  { label: 'Reminders', path: '/reminders', icon: 'notifications_active', comingSoon: true },
]

const showSidebarToggle = computed(() => route.meta.hideSidebar !== true)

function selectMode(mode: AppMode) {
  mapStore.setAppMode(mode)
  if (route.path !== '/map') {
    void router.push('/map')
  }
}

async function handleSignOut() {
  await authStore.signOut()
  router.push('/')
}
</script>

<template>
  <q-header class="app-header">
    <q-toolbar class="toolbar q-px-md">
      <q-btn
        v-if="showSidebarToggle"
        flat
        dense
        round
        icon="menu"
        color="grey-5"
        class="menu-btn"
        @click="appStore.toggleSidebar"
      />

      <q-toolbar-title class="logo" shrink>
        <svg class="logo-mark" viewBox="0 0 68 68" fill="none" aria-hidden="true">
          <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
            <path d="M6 56 L24 30 L34 42 L44 22 L62 56" />
            <path d="M14 50 L26 36 L34 46 L44 30 L54 50" opacity="0.7" />
            <path d="M22 46 L28 40 L34 48 L42 36 L48 46" opacity="0.45" />
            <path d="M28 44 L34 50 L40 44" opacity="0.25" />
          </g>
        </svg>
        <span class="logo-wordmark"><span class="logo-text">Ridge</span><span class="logo-accent">Read</span></span>
        <!-- <span class="logo-badge q-ml-sm">ELK TERRAIN INTELLIGENCE</span> -->
      </q-toolbar-title>

      <nav class="mode-links" aria-label="RidgeRead mode">
        <button
          v-for="item in modeLinks"
          :key="item.mode"
          class="mode-link"
          :class="{ 'mode-link--active': route.path === '/map' && mapStore.appMode === item.mode }"
          type="button"
          @click="selectMode(item.mode)"
        >
          <q-icon :name="item.icon" size="16px" />
          <span class="mode-link-copy">
            <span class="mode-link-sub">{{ item.sub }}</span>
            <span class="mode-link-label">{{ item.label }}</span>
          </span>
          <span v-if="item.mode === 'in-season'" class="mode-link-live">
            <span class="mode-link-live-dot" />
            Beta
          </span>
        </button>
      </nav>

      <nav class="feature-links" aria-label="RidgeRead tools">
        <router-link
          v-if="isDevMode"
          v-for="item in featureLinks"
          :key="item.path"
          :to="item.path"
          class="feature-link"
          :class="{ 'feature-link--active': route.path === item.path }"
        >
          <q-icon :name="item.icon" size="16px" />
          <span>{{ item.label }}</span>
          <span v-if="item.comingSoon" class="feature-link-badge">Soon</span>
        </router-link>
        <button
          v-else
          v-for="item in featureLinks"
          :key="item.path"
          class="feature-link feature-link--disabled"
          type="button"
          disabled
          title="Coming soon"
        >
          <q-icon :name="item.icon" size="16px" />
          <span>{{ item.label }}</span>
          <span class="feature-link-badge">Soon</span>
        </button>
      </nav>

      <q-space />

      <!-- <nav class="nav-links">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ 'nav-item--active': route.path === item.path }"
        >
          <q-icon :name="item.icon" size="18px" />
          <span class="nav-label">{{ item.name }}</span>
        </router-link>
      </nav> -->

      <!-- Trial badge -->
      <div
        v-if="trialBadge"
        class="trial-badge"
        :title="trialBadge.tooltip"
        :aria-label="trialBadge.tooltip"
      >
        <q-icon name="schedule" size="13px" />
        <span class="trial-badge-text">Trial: {{ trialBadge.short }}</span>
      </div>

      <!-- Usage badge (free + Pro; Guide is unlimited) -->
      <div
        v-if="usageBadge"
        class="usage-badge q-ml-sm"
        :class="{ 'usage-badge--low': subscriptionStore.analysesRemaining <= 3 }"
        :title="usageBadge.tooltip"
        :aria-label="usageBadge.tooltip"
      >
        <q-icon name="bolt" size="13px" />
        <span class="usage-badge-text">{{ usageBadge.short }}</span>
      </div>

      <!-- User menu -->
      <div v-if="authStore.isAuthenticated" class="q-ml-md">
        <q-btn flat round dense class="user-btn">
          <q-avatar size="34px" class="user-avatar">
            <img v-if="authStore.photoURL" :src="authStore.photoURL" referrerpolicy="no-referrer" />
            <q-icon v-else name="person" color="grey-5" />
          </q-avatar>
          <q-menu class="user-menu" anchor="bottom right" self="top right">
            <q-list style="min-width: 220px">
              <q-item class="q-py-md">
                <q-item-section avatar>
                  <q-avatar size="40px">
                    <img v-if="authStore.photoURL" :src="authStore.photoURL" referrerpolicy="no-referrer" />
                    <q-icon v-else name="person" size="24px" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-white">{{ authStore.displayName }}</q-item-label>
                  <q-item-label caption class="text-grey-6">{{ authStore.email }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-separator color="grey-9" />
              <q-item clickable v-close-popup class="feedback-item" @click="feedbackOpen = true">
                <q-item-section avatar>
                  <q-icon name="lightbulb" color="amber-5" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="feedback-label">Feedback or Idea</q-item-label>
                </q-item-section>
              </q-item>
              <q-separator color="grey-9" />
              <q-item clickable v-close-popup @click="handleSignOut" class="signout-item">
                <q-item-section avatar>
                  <q-icon name="logout" color="red-4" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-red-4">Sign Out</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>
    </q-toolbar>
  </q-header>

  <FeedbackModal v-model="feedbackOpen" />
</template>

<style scoped>
.app-header {
  background: linear-gradient(180deg, #0a0e14 0%, #0c1119 100%) !important;
  border-bottom: 1px solid #1e2d3d;
}

.toolbar {
  min-height: 56px;
}

.menu-btn {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.menu-btn:hover {
  opacity: 1;
}

/* ─── Logo ─── */
.logo {
  font-size: 19px;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.logo-mark {
  width: 45px;
  height: 45px;
  flex: 0 0 auto;
  color: #e8c547;
  filter: drop-shadow(0 0 12px rgba(232, 197, 71, 0.16));
}

.logo-wordmark {
  display: inline-flex;
  align-items: baseline;
}

.logo-text {
  color: #fff;
  font-weight: 800;
}

.logo-accent {
  color: #e8c547;
  font-weight: 800;
}

.logo-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: #e8c547;
  background: rgba(232, 197, 71, 0.08);
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid rgba(232, 197, 71, 0.15);
}

/* ─── Mode links ─── */
.mode-links {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 28px;
}

.mode-link {
  min-width: 0;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #6b7c8d;
  transition: all 0.2s ease;
  cursor: pointer;
}

.mode-link:hover {
  color: #c8d6e5;
  background: rgba(200, 214, 229, 0.06);
}

.mode-link--active {
  color: #e8c547 !important;
  background: rgba(232, 197, 71, 0.1);
  border: 1px solid rgba(232, 197, 71, 0.15);
}

.mode-link-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.mode-link-sub,
.mode-link-label,
.mode-link-live {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  text-transform: uppercase;
}

.mode-link-sub {
  color: #556676;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1;
}

.mode-link-label {
  color: currentColor;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1.2;
}

.mode-link-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 5px;
  border: 1px solid rgba(74, 222, 128, 0.28);
  border-radius: 4px;
  background: rgba(74, 222, 128, 0.1);
  color: #4ade80;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.mode-link-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: header-live-pulse 1.6s ease-in-out infinite;
}

@keyframes header-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ─── Feature links ─── */
.feature-links {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 24px;
  padding-left: 24px;
  border-left: 1px solid rgba(37, 55, 74, 0.7);
}

.feature-link {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #6b7c8d;
  text-decoration: none;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: all 0.2s ease;
}

.feature-link:disabled {
  font: inherit;
}

.feature-link:hover {
  color: #c8d6e5;
  background: rgba(200, 214, 229, 0.06);
}

.feature-link--disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.feature-link--disabled:hover {
  color: #6b7c8d;
  background: transparent;
}

.feature-link--active {
  color: #e8c547;
  background: rgba(232, 197, 71, 0.08);
  border-color: rgba(232, 197, 71, 0.15);
}

.feature-link-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 5px;
  border: 1px solid rgba(232, 197, 71, 0.28);
  border-radius: 4px;
  background: rgba(232, 197, 71, 0.08);
  color: #e8c547;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
}

/* ─── Trial badge ─── */
.trial-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #e8c547;
  background: rgba(232, 197, 71, 0.1);
  border: 1px solid rgba(232, 197, 71, 0.25);
  border-radius: 12px;
  cursor: default;
  white-space: nowrap;
}

.trial-badge-text {
  line-height: 1;
}

@media (max-width: 599px) {
  .trial-badge-text,
  .usage-badge-text {
    display: none;
  }
  .trial-badge,
  .usage-badge {
    padding: 5px 7px;
  }
}

/* ─── Usage badge ─── */
.usage-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #8aaedb;
  background: rgba(96, 165, 250, 0.08);
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 12px;
  cursor: default;
  white-space: nowrap;
}

.usage-badge--low {
  color: #ff8a8a;
  background: rgba(213, 78, 78, 0.12);
  border-color: rgba(213, 78, 78, 0.3);
}

.usage-badge-text {
  line-height: 1;
}

/* ─── User ─── */
.user-avatar {
  border: 2px solid #1e2d3d;
  transition: border-color 0.2s;
}

.user-btn:hover .user-avatar {
  border-color: rgba(232, 197, 71, 0.3);
}

.user-menu {
  background: #111a24 !important;
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  overflow: hidden;
}

.signout-item:hover {
  background: rgba(244, 67, 54, 0.08);
}

.feedback-label {
  color: #c8d6e5;
}

.feedback-item:hover {
  background: rgba(232, 197, 71, 0.08);
}

/* ─── Mobile ─── */
@media (max-width: 599px) {
  .logo-mark {
    width: 27px;
    height: 27px;
  }
  .logo-badge {
    display: none;
  }
  .nav-label {
    display: none;
  }
  .nav-item {
    padding: 6px 10px;
  }
}

@media (max-width: 940px) {
  .mode-link-live,
  .mode-link-sub {
    display: none;
  }
}

@media (max-width: 760px) {
  .mode-links {
    margin-left: 6px;
    gap: 3px;
  }

  .mode-link {
    min-height: 32px;
    padding: 5px 8px;
  }

  .mode-link-label {
    display: none;
  }

  .feature-links {
    margin-left: 8px;
    padding-left: 8px;
    gap: 3px;
  }

  .feature-link {
    padding: 6px 8px;
  }

  .feature-link span {
    display: none;
  }
}
</style>
