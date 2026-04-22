<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useRouter, useRoute } from 'vue-router'

const appStore = useAppStore()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const navItems = [
  { name: 'Dashboard', path: '/app', icon: 'dashboard' },
  { name: 'Map', path: '/map', icon: 'map' },
  { name: 'Analysis', path: '/analysis', icon: 'analytics' },
  { name: 'Settings', path: '/settings', icon: 'settings' },
]

async function handleSignOut() {
  await authStore.signOut()
  router.push('/')
}
</script>

<template>
  <q-header class="app-header">
    <q-toolbar class="toolbar q-px-md">
      <q-btn
        flat
        dense
        round
        icon="menu"
        color="grey-5"
        class="menu-btn"
        @click="appStore.toggleSidebar"
      />

      <q-toolbar-title class="logo" shrink>
        <span class="logo-text">Ridge</span><span class="logo-accent">Read</span>
        <span class="logo-badge q-ml-sm">ELK TERRAIN INTELLIGENCE</span>
      </q-toolbar-title>

      <q-space />

      <nav class="nav-links">
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
      </nav>

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
  gap: 0;
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

/* ─── Navigation ─── */
.nav-links {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #6b7c8d;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.nav-item:hover {
  color: #c8d6e5;
  background: rgba(200, 214, 229, 0.06);
}

.nav-item--active {
  color: #e8c547 !important;
  background: rgba(232, 197, 71, 0.1);
  border: 1px solid rgba(232, 197, 71, 0.15);
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

/* ─── Mobile ─── */
@media (max-width: 599px) {
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
</style>
