<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/common/AppHeader.vue'
import AppSidebar from '@/components/common/AppSidebar.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const route = useRoute()
const showSidebar = computed(() => route.meta.hideSidebar !== true)
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <AppHeader />

    <q-drawer
      v-if="showSidebar"
      v-model="appStore.sidebarOpen"
      side="left"
      :width="300"
      bordered
      :breakpoint="700"
      class="sidebar-drawer"
    >
      <AppSidebar />
    </q-drawer>

    <q-page-container>
      <RouterView />
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.sidebar-drawer {
  background: #0c1119 !important;
  border-right: 1px solid #1e2d3d !important;
}

.sidebar-drawer :deep(.q-drawer__content) {
  background: #0c1119;
}
</style>
