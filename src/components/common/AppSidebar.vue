<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore, type HuntingPressure, type SidebarTab } from '@/stores/map'
import {
  seasonLabels,
  timeLabels,
  behaviorLabels,
  behaviorColors,
  type Season,
  type TimeOfDay,
  type BehaviorLayer,
} from '@/data/elkBehavior'
import {
  deriveConfidence,
  gradePoi,
  type EnabledLayers,
} from '@/composables/usePoiGrading'
import RankedPoiList from './RankedPoiList.vue'

const mapStore = useMapStore()

const seasonOptions: { label: string; value: Season }[] = [
  { label: 'Rut', value: 'rut' },
  { label: 'Post-Rut', value: 'post-rut' },
  { label: 'Late Season', value: 'late-season' },
]

const timeOptions: { label: string; value: TimeOfDay }[] = [
  { label: 'Dawn', value: 'dawn' },
  { label: 'Midday', value: 'midday' },
  { label: 'Dusk', value: 'dusk' },
]

const behaviors: BehaviorLayer[] = ['feeding', 'water', 'bedding', 'wallows', 'travel', 'security']

const pressureOptions: { label: string; value: HuntingPressure }[] = [
  { label: 'Low', value: 'low' },
  { label: 'Med', value: 'medium' },
  { label: 'High', value: 'high' },
]

const tabs: { label: string; value: SidebarTab }[] = [
  { label: 'Controls', value: 'controls' },
  { label: 'Ranked POIs', value: 'pois' },
]

const enabledLayers = computed<EnabledLayers>(() => ({
  feeding: mapStore.activeBehaviors.includes('feeding'),
  water: mapStore.activeBehaviors.includes('water'),
  bedding: mapStore.activeBehaviors.includes('bedding'),
  wallows: mapStore.activeBehaviors.includes('wallows'),
  travel: mapStore.activeBehaviors.includes('travel'),
  security: mapStore.activeBehaviors.includes('security'),
}))

const visiblePoiCount = computed(() => {
  let n = 0
  for (const poi of mapStore.currentPois) {
    const conf = deriveConfidence(poi, mapStore.currentWeights)
    if (gradePoi(poi, conf, enabledLayers.value).grade !== '—') n++
  }
  return n
})
</script>

<template>
  <div class="sidebar-root">
    <!-- Tab bar -->
    <nav class="tab-bar" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.value"
        class="tab"
        :class="{ 'tab--active': mapStore.sidebarTab === t.value }"
        role="tab"
        :aria-selected="mapStore.sidebarTab === t.value"
        @click="mapStore.setSidebarTab(t.value)"
      >
        {{ t.label }}
        <span v-if="t.value === 'pois'" class="tab-badge">{{ visiblePoiCount }}</span>
      </button>
    </nav>

    <!-- Tab body -->
    <div class="tab-body">
      <RankedPoiList v-if="mapStore.sidebarTab === 'pois'" />

      <q-scroll-area v-else class="fit">
        <div class="sidebar-content">

          <!-- Season Phase -->
          <div class="sidebar-section">
            <div class="section-title">
              <span class="section-num">01</span>
              Season Phase
            </div>
            <div class="toggle-group" :class="{ 'toggle-group--locked': mapStore.seasonLocked }">
              <button
                v-for="opt in seasonOptions"
                :key="opt.value"
                class="toggle-btn"
                :class="{ 'toggle-btn--active': mapStore.season === opt.value }"
                :disabled="mapStore.seasonLocked"
                @click="mapStore.setSeason(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
            <p v-if="mapStore.seasonLocked" class="lock-hint">
              <q-icon name="lock" size="11px" /> Locked after analysis
            </p>
          </div>

          <!-- Time of Day -->
          <div class="sidebar-section">
            <div class="section-title">
              <span class="section-num">02</span>
              Time of Day
            </div>
            <div class="toggle-group">
              <button
                v-for="opt in timeOptions"
                :key="opt.value"
                class="toggle-btn"
                :class="{ 'toggle-btn--active': mapStore.timeOfDay === opt.value }"
                @click="mapStore.setTimeOfDay(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Hunting Pressure -->
          <div class="sidebar-section">
            <div class="section-title">
              <span class="section-num">03</span>
              Hunting Pressure
              <q-icon name="warning" size="11px" class="section-warn" />
            </div>
            <div class="toggle-group">
              <button
                v-for="opt in pressureOptions"
                :key="opt.value"
                class="toggle-btn"
                :class="{
                  'toggle-btn--active': mapStore.huntingPressure === opt.value,
                  'toggle-btn--pressure-high': mapStore.huntingPressure === 'high' && opt.value === 'high',
                }"
                @click="mapStore.setHuntingPressure(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Behavior Layers + Weights -->
          <div class="sidebar-section">
            <div class="section-title">
              <span class="section-num">04</span>
              Behavior Layers
            </div>
            <div class="behavior-list">
              <label
                v-for="b in behaviors"
                :key="b"
                class="behavior-row"
                :class="{ 'behavior-row--inactive': !mapStore.activeBehaviors.includes(b) }"
              >
                <q-checkbox
                  :model-value="mapStore.activeBehaviors.includes(b)"
                  @update:model-value="mapStore.toggleBehavior(b)"
                  color="amber"
                  dense
                  class="behavior-check"
                />
                <span class="behavior-dot" :style="{ background: behaviorColors[b] }" />
                <span class="behavior-name">{{ behaviorLabels[b] }}</span>
                <div class="behavior-bar-wrap">
                  <div class="behavior-bar-track">
                    <div
                      class="behavior-bar-fill"
                      :style="{
                        width: `${mapStore.currentWeights[b] * 100}%`,
                        background: mapStore.activeBehaviors.includes(b) ? behaviorColors[b] : '#2a3545',
                        opacity: mapStore.activeBehaviors.includes(b) ? 1 : 0.3,
                      }"
                    />
                  </div>
                </div>
                <span class="behavior-weight">
                  {{ (mapStore.currentWeights[b] * 100).toFixed(0) }}%
                </span>
              </label>
            </div>
          </div>

          <!-- Road/Building Buffer -->
          <div class="sidebar-section">
            <div class="section-title">
              <span class="section-num">05</span>
              Road & Building Buffer
            </div>
            <div class="buffer-card">
              <div class="buffer-value">
                {{ mapStore.bufferMiles.toFixed(2) }} <span class="buffer-unit">mi</span>
              </div>
              <q-slider
                :model-value="mapStore.bufferMiles"
                @update:model-value="mapStore.bufferMiles = $event"
                :min="0.1"
                :max="2"
                :step="0.05"
                color="amber"
                track-color="grey-9"
                dense
                class="q-mt-xs"
              />
              <div class="buffer-range">
                <span>0.1 mi</span>
                <span>2.0 mi</span>
              </div>
              <p class="buffer-hint">
                POIs closer than this to any road or building are filtered out.
              </p>
            </div>
          </div>

          <!-- Reference labels (kept for accessibility / parity with previous text) -->
          <p class="sidebar-ref">
            {{ seasonLabels[mapStore.season] }} · {{ timeLabels[mapStore.timeOfDay] }}
          </p>
        </div>
      </q-scroll-area>
    </div>
  </div>
</template>

<style scoped>
.sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ─── Tab bar ─── */
.tab-bar {
  display: flex;
  flex-shrink: 0;
  height: 40px;
  border-bottom: 1px solid var(--bd-0, #1a2735);
  background: var(--bg-1, #0a0e14);
}

.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  background: transparent;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-3, #556676);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab:hover {
  color: var(--fg-1, #c8d6e5);
}

.tab--active {
  color: var(--amber, #e8c547);
  border-bottom-color: var(--amber, #e8c547);
  background: rgba(232, 197, 71, 0.04);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(232, 197, 71, 0.12);
  border: 1px solid rgba(232, 197, 71, 0.25);
  color: var(--amber, #e8c547);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0;
}

.tab-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ─── Sections ─── */
.sidebar-content {
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-section {
  background: #111a24;
  border: 1px solid #1e2d3d;
  border-radius: 10px;
  padding: 14px;
  transition: border-color 0.2s;
}

.sidebar-section:hover {
  border-color: #2a3f55;
}

.section-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #6b7c8d;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-num {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9.5px;
  font-weight: 700;
  color: var(--amber, #e8c547);
  letter-spacing: 0;
}

.section-warn {
  color: var(--amber, #e8c547);
  margin-left: auto;
}

/* ─── Toggle Groups ─── */
.toggle-group {
  display: flex;
  gap: 4px;
  background: #0a0e14;
  border-radius: 8px;
  padding: 3px;
  border: 1px solid #1a2535;
}

.toggle-btn {
  flex: 1;
  padding: 7px 4px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #6b7c8d;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn:hover {
  color: #c8d6e5;
}

.toggle-btn--active {
  background: rgba(232, 197, 71, 0.12);
  color: #e8c547;
  border: 1px solid rgba(232, 197, 71, 0.2);
}

.toggle-btn--pressure-high {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.toggle-group--locked {
  opacity: 0.5;
  pointer-events: none;
}

.lock-hint {
  font-size: 10px;
  color: #4a5e70;
  margin: 6px 0 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ─── Behavior Layers ─── */
.behavior-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.behavior-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.behavior-row:hover {
  background: rgba(200, 214, 229, 0.04);
}

.behavior-row--inactive .behavior-name {
  color: #3d4f5f;
  text-decoration: line-through;
}

.behavior-check {
  flex-shrink: 0;
}

.behavior-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.behavior-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #c8d6e5;
  transition: color 0.15s;
}

.behavior-bar-wrap {
  flex: 1;
  min-width: 0;
}

.behavior-bar-track {
  height: 4px;
  background: #0a0e14;
  border-radius: 2px;
  overflow: hidden;
}

.behavior-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.behavior-weight {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 700;
  color: #6b7c8d;
  font-variant-numeric: tabular-nums;
  width: 32px;
  text-align: right;
  flex-shrink: 0;
}

/* ─── Buffer ─── */
.buffer-card {
  text-align: center;
}

.buffer-value {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 28px;
  font-weight: 800;
  color: #e8c547;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.buffer-unit {
  font-size: 14px;
  font-weight: 600;
  color: #8899aa;
}

.buffer-range {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9.5px;
  color: #4a5e70;
  font-weight: 500;
}

.buffer-hint {
  font-size: 11px;
  color: #4a5e70;
  line-height: 1.5;
  margin: 8px 0 0;
}

.sidebar-ref {
  margin: 4px 4px 0;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--fg-3, #556676);
  text-transform: uppercase;
  text-align: center;
}
</style>
