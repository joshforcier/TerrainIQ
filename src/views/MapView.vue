<script setup lang="ts">
import { ref, computed } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import HoverTooltip from '@/components/map/HoverTooltip.vue'
import InfoPanel from '@/components/map/InfoPanel.vue'
import PoiDetailPanel from '@/components/map/PoiDetailPanel.vue'
import PoiHoverCard from '@/components/map/PoiHoverCard.vue'
import type L from 'leaflet'
import type { HoverScores } from '@/composables/useHoverInfo'
import { useMapStore, type BaseLayer } from '@/stores/map'
import { downloadGpx } from '@/utils/exportGpx'
import type { PointOfInterest } from '@/data/pointsOfInterest'

const mapStore = useMapStore()

const baseLayerOptions: { label: string; value: BaseLayer; icon: string }[] = [
  { label: 'Streets', value: 'streets', icon: 'map' },
  { label: 'Satellite', value: 'satellite', icon: 'satellite_alt' },
  { label: 'Outdoors', value: 'outdoors', icon: 'terrain' },
  { label: 'Hybrid', value: 'hybrid', icon: 'layers' },
]

const mapContainerRef = ref<InstanceType<typeof MapContainer> | null>(null)

const hoverScores = computed<HoverScores | null>(() => {
  return mapContainerRef.value?.hoverScores ?? null
})

const measuring = computed(() => mapContainerRef.value?.measureActive ?? false)

const aiLoading = computed(() => mapContainerRef.value?.loading ?? false)
const aiError = computed(() => mapContainerRef.value?.error ?? null)
const hasResults = computed(() => mapContainerRef.value?.hasResults ?? false)
const aiPoisCount = computed(() => mapContainerRef.value?.pois?.length ?? 0)
const fromCache = computed(() => mapContainerRef.value?.fromCache ?? false)
const mapInstance = computed<L.Map | null>(() => (mapContainerRef.value?.map as L.Map | null) ?? null)

// `selection` is an object exposed via defineExpose — Vue only auto-unwraps refs at
// the top level of the exposed surface, so we have to read `.value` explicitly here.
const selectionActive = computed(() => mapContainerRef.value?.selection?.isActive?.value ?? false)
const selectionLocked = computed(() => mapContainerRef.value?.selection?.isLocked?.value ?? false)

type Mode = 'idle' | 'selecting' | 'placed' | 'analyzing' | 'done'

const mode = computed<Mode>(() => {
  if (hasResults.value) return 'done'
  if (aiLoading.value) return 'analyzing'
  if (selectionLocked.value) return 'placed'
  if (selectionActive.value) return 'selecting'
  return 'idle'
})

function isStepActive(n: 1 | 2 | 3): boolean {
  if (n === 1) return mode.value === 'idle' || mode.value === 'selecting'
  if (n === 2) return mode.value === 'placed' || mode.value === 'analyzing'
  return mode.value === 'done'
}

function isStepDone(n: 1 | 2): boolean {
  if (n === 1) return mode.value === 'placed' || mode.value === 'analyzing' || mode.value === 'done'
  return mode.value === 'done'
}

function startSelection() {
  mapContainerRef.value?.selection?.activate()
}

function cancelSelection() {
  mapContainerRef.value?.selection?.deactivate()
}

function analyzeArea() {
  mapContainerRef.value?.analyzeSelection()
}

function resetAll() {
  mapContainerRef.value?.resetAll()
}

function exportGpx() {
  const pois = mapContainerRef.value?.pois as PointOfInterest[] | undefined
  if (!pois || pois.length === 0) return
  downloadGpx(pois, {
    season: mapStore.season,
    timeOfDay: mapStore.timeOfDay,
    pressure: mapStore.huntingPressure,
  })
}
</script>

<template>
  <q-page class="map-page">
    <MapContainer ref="mapContainerRef" />
    <HoverTooltip v-if="hoverScores" :scores="hoverScores" />
    <InfoPanel />
    <PoiDetailPanel />
    <PoiHoverCard :map="mapInstance" />

    <!-- Stepper panel -->
    <div class="stepper-card">
      <div class="stepper-track">
        <div class="step" :class="{ 'step--active': isStepActive(1), 'step--done': isStepDone(1) }">
          <span class="step-num">
            <q-icon v-if="isStepDone(1)" name="check" size="12px" />
            <template v-else>1</template>
          </span>
          <span class="step-label">Select</span>
        </div>
        <div class="step-divider" />
        <div class="step" :class="{ 'step--active': isStepActive(2), 'step--done': isStepDone(2) }">
          <span class="step-num">
            <q-icon v-if="isStepDone(2)" name="check" size="12px" />
            <template v-else>2</template>
          </span>
          <span class="step-label">Analyze</span>
        </div>
        <div class="step-divider" />
        <div class="step" :class="{ 'step--active': isStepActive(3) }">
          <span class="step-num">3</span>
          <span class="step-label">Done</span>
        </div>
      </div>

      <div class="stepper-body">
        <template v-if="mode === 'idle'">
          <p class="step-caption">Pick a 5 × 5 mi area to analyze.</p>
          <button class="map-btn map-btn--primary" @click="startSelection">
            <q-icon name="crop_free" size="18px" />
            <span>Select Area</span>
          </button>
        </template>

        <template v-else-if="mode === 'selecting'">
          <p class="step-caption step-caption--pulse">
            <q-icon name="ads_click" size="14px" />
            Click the map to place the box.
          </p>
          <button class="map-btn map-btn--ghost map-btn--sm" @click="cancelSelection">
            Cancel
          </button>
        </template>

        <template v-else-if="mode === 'placed'">
          <p class="step-caption">Box placed. Ready to analyze.</p>
          <button class="map-btn map-btn--primary" @click="analyzeArea">
            <q-icon name="auto_awesome" size="18px" />
            <span>Analyze Area</span>
          </button>
          <button class="map-btn map-btn--ghost map-btn--sm" @click="startSelection">
            <q-icon name="near_me" size="14px" />
            Reposition
          </button>
        </template>

        <template v-else-if="mode === 'analyzing'">
          <p class="step-caption step-caption--pulse">
            <q-spinner-dots color="amber" size="16px" />
            Analyzing all combos...
          </p>
        </template>

        <template v-else-if="mode === 'done'">
          <p class="step-caption">
            <q-icon name="auto_awesome" size="14px" color="amber" />
            <strong>{{ aiPoisCount }}</strong>&nbsp;POIs
            <span v-if="fromCache" class="cache-badge">
              <q-icon name="bookmark" size="10px" />Saved
            </span>
          </p>
          <p class="step-caption-hint">
            {{ fromCache
              ? 'Loaded from a previous analysis of this area.'
              : 'Change time/pressure on the sidebar to update.' }}
          </p>
          <p class="step-disclaimer">
            High-probability terrain for the selected season, time, and pressure.
          </p>
          <button class="map-btn map-btn--ghost map-btn--sm" @click="exportGpx">
            <q-icon name="download" size="14px" />
            Export GPX (OnX)
          </button>
          <button class="map-btn map-btn--ghost map-btn--sm" @click="resetAll">
            <q-icon name="restart_alt" size="14px" />
            New Selection
          </button>
        </template>
      </div>
    </div>

    <!-- Error notification -->
    <div v-if="aiError" class="ai-error">
      <q-icon name="error" size="18px" />
      <span>{{ aiError }}</span>
    </div>

    <!-- Map tools bar -->
    <div class="map-tools-bar">
      <button
        class="layer-btn"
        :class="{ 'layer-btn--active': measuring }"
        @click="mapContainerRef?.toggleMeasure()"
      >
        <q-icon name="straighten" size="16px" />
        <span class="layer-label">Measure</span>
      </button>
    </div>

    <!-- Base map layer switcher -->
    <div class="base-layer-switcher">
      <button
        v-for="opt in baseLayerOptions"
        :key="opt.value"
        class="layer-btn"
        :class="{ 'layer-btn--active': mapStore.baseLayer === opt.value }"
        @click="mapStore.setBaseLayer(opt.value)"
      >
        <q-icon :name="opt.icon" size="16px" />
        <span class="layer-label">{{ opt.label }}</span>
      </button>
    </div>
  </q-page>
</template>

<style scoped>
.map-page {
  position: relative;
}

.map-page :deep(.map-container) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* ─── Stepper Card ─── */
.stepper-card {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  width: 280px;
  background: rgba(15, 25, 35, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.stepper-track {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #1e2d3d;
  background: rgba(10, 14, 20, 0.5);
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  opacity: 0.45;
  transition: opacity 0.2s;
}

.step--active,
.step--done {
  opacity: 1;
}

.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(200, 214, 229, 0.08);
  border: 1px solid rgba(200, 214, 229, 0.2);
  color: #6b7c8d;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.2s;
}

.step--active .step-num {
  background: #e8c547;
  color: #0a0e14;
  border-color: #e8c547;
  box-shadow: 0 0 0 3px rgba(232, 197, 71, 0.18);
}

.step--done .step-num {
  background: rgba(232, 197, 71, 0.2);
  color: #e8c547;
  border-color: rgba(232, 197, 71, 0.4);
}

.step-label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7c8d;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  transition: color 0.2s;
}

.step--active .step-label {
  color: #e8c547;
}

.step--done .step-label {
  color: #c8d6e5;
}

.step-divider {
  flex: 1 1 auto;
  height: 1px;
  background: #1e2d3d;
}

.stepper-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-caption {
  margin: 0;
  font-size: 13px;
  color: #c8d6e5;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-caption--pulse {
  color: #e8c547;
  font-weight: 600;
  animation: pulse-text 1.5s ease-in-out infinite;
}

.step-caption-hint {
  margin: -4px 0 4px;
  font-size: 11px;
  font-weight: 500;
  color: #6b7c8d;
  line-height: 1.4;
}

.step-disclaimer {
  margin: 4px 0 0;
  padding-top: 8px;
  border-top: 1px solid #1e2d3d;
  font-size: 10px;
  font-style: italic;
  font-weight: 500;
  color: #5d6e80;
  line-height: 1.4;
}

.cache-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(232, 197, 71, 0.12);
  border: 1px solid rgba(232, 197, 71, 0.25);
  color: #e8c547;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

@keyframes pulse-text {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* ─── Map Buttons ─── */
.map-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  width: 100%;
}

.map-btn--primary {
  background: #e8c547;
  color: #0a0e14;
  box-shadow: 0 4px 16px rgba(232, 197, 71, 0.2);
}

.map-btn--primary:hover {
  background: #f0d060;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(232, 197, 71, 0.3);
}

.map-btn--primary:disabled {
  opacity: 0.8;
  cursor: wait;
  transform: none;
}

.map-btn--ghost {
  background: rgba(15, 25, 35, 0.6);
  color: #c8d6e5;
  border: 1px solid #1e2d3d;
}

.map-btn--ghost:hover {
  background: rgba(15, 25, 35, 0.85);
  border-color: #3a4f65;
}

.map-btn--sm {
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
}

/* ─── Error ─── */
.ai-error {
  position: absolute;
  bottom: 60px;
  right: 12px;
  z-index: 1000;
  max-width: 380px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(183, 28, 28, 0.9);
  border: 1px solid rgba(244, 67, 54, 0.4);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  backdrop-filter: blur(12px);
}

/* ─── Map Tools Bar ─── */
.map-tools-bar {
  position: absolute;
  bottom: 12px;
  left: 130px;
  z-index: 1000;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(15, 25, 35, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid #1e2d3d;
  border-radius: 10px;
}

/* ─── Base Layer Switcher ─── */
.base-layer-switcher {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(15, 25, 35, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid #1e2d3d;
  border-radius: 10px;
}

.layer-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: #6b7c8d;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.layer-btn:hover {
  color: #c8d6e5;
  background: rgba(200, 214, 229, 0.06);
}

.layer-btn--active {
  border-color: rgba(232, 197, 71, 0.3);
  background: rgba(232, 197, 71, 0.1);
  color: #e8c547;
}

@media (max-width: 599px) {
  .stepper-card {
    width: calc(100vw - 24px);
    max-width: 320px;
  }
  .layer-label {
    display: none;
  }
  .layer-btn {
    padding: 6px 8px;
  }
}
</style>
