<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMapStore } from '@/stores/map'
import { tacticalNotes, seasonLabels, timeLabels } from '@/data/elkBehavior'

const mapStore = useMapStore()
const dismissed = ref(true)

const currentNote = computed(() => {
  return tacticalNotes[mapStore.season][mapStore.timeOfDay]
})

const heading = computed(() => {
  return `${seasonLabels[mapStore.season]} \u2014 ${timeLabels[mapStore.timeOfDay]}`
})

function dismiss() {
  dismissed.value = true
}

function show() {
  dismissed.value = false
}
</script>

<template>
  <!-- Collapsed: small button to reopen -->
  <button
    v-if="dismissed"
    class="intel-toggle"
    @click="show"
  >
    <q-icon name="info" size="16px" />
    <span>Elk Intel</span>
  </button>

  <!-- Expanded panel -->
  <div v-else class="info-panel">
    <div class="panel-header">
      <span class="panel-badge">Elk Intel</span>
      <button class="panel-close" @click="dismiss">
        <q-icon name="close" size="14px" />
      </button>
    </div>
    <div class="panel-heading">{{ heading }}</div>
    <div class="panel-body">{{ currentNote }}</div>
    <div class="panel-disclaimer">
      High-probability terrain for the selected season, time, and pressure.
      But ultimately, elk are where they are.
    </div>
  </div>
</template>

<style scoped>
.info-panel {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 1000;
  background: rgba(15, 25, 35, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid #1e2d3d;
  border-radius: 10px;
  max-width: 360px;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px;
  flex-shrink: 0;
}

.panel-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #0a0e14;
  background: #e8c547;
  padding: 2px 8px;
  border-radius: 4px;
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #6b7c8d;
  cursor: pointer;
  transition: all 0.15s;
}

.panel-close:hover {
  background: rgba(200, 214, 229, 0.1);
  color: #c8d6e5;
}

.panel-heading {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  padding: 2px 10px 6px;
  flex-shrink: 0;
}

.panel-body {
  font-size: 12px;
  line-height: 1.55;
  color: #8899aa;
  padding: 0 10px 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.panel-body::-webkit-scrollbar {
  width: 4px;
}

.panel-body::-webkit-scrollbar-thumb {
  background: #2a3f55;
  border-radius: 2px;
}

.panel-disclaimer {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  border-top: 1px solid #1e2d3d;
  font-size: 10px;
  font-style: italic;
  font-weight: 500;
  color: #5d6e80;
  line-height: 1.4;
}

/* ─── Collapsed toggle ─── */
.intel-toggle {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(232, 197, 71, 0.2);
  background: rgba(15, 25, 35, 0.9);
  backdrop-filter: blur(8px);
  color: #e8c547;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.intel-toggle:hover {
  border-color: rgba(232, 197, 71, 0.4);
  background: rgba(15, 25, 35, 0.95);
}

@media (max-width: 599px) {
  .info-panel {
    max-width: calc(100vw - 24px);
    left: 12px;
    right: 12px;
  }
}
</style>
