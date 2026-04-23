<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore } from '@/stores/map'
import { behaviorColors, behaviorLabels, type BehaviorLayer } from '@/data/elkBehavior'
import {
  deriveConfidence,
  gradePoi,
  gradeColor,
  type EnabledLayers,
} from '@/composables/usePoiGrading'

const mapStore = useMapStore()

const enabledLayers = computed<EnabledLayers>(() => ({
  feeding: mapStore.activeBehaviors.includes('feeding'),
  water: mapStore.activeBehaviors.includes('water'),
  bedding: mapStore.activeBehaviors.includes('bedding'),
  wallows: mapStore.activeBehaviors.includes('wallows'),
  travel: mapStore.activeBehaviors.includes('travel'),
  security: mapStore.activeBehaviors.includes('security'),
}))

const conf = computed(() => {
  if (!mapStore.pinnedPoi) return {}
  return deriveConfidence(mapStore.pinnedPoi, mapStore.currentWeights)
})

const grade = computed(() => {
  if (!mapStore.pinnedPoi) return null
  return gradePoi(mapStore.pinnedPoi, conf.value, enabledLayers.value)
})

const gradeC = computed(() => (grade.value ? gradeColor(grade.value.grade) : '#888'))

const visibleBehaviors = computed<BehaviorLayer[]>(() => {
  if (!mapStore.pinnedPoi) return []
  return mapStore.pinnedPoi.relatedBehaviors
    .filter((b) => enabledLayers.value[b])
    .sort((a, b) => (conf.value[b] ?? 0) - (conf.value[a] ?? 0))
})

function close() {
  mapStore.pinPoi(null)
}

function deletePoi() {
  if (!mapStore.pinnedPoi) return
  mapStore.deletePoi(mapStore.pinnedPoi.id)
}
</script>

<template>
  <transition name="panel-slide">
    <div v-if="mapStore.pinnedPoi && grade" class="poi-detail-panel">
      <!-- Header -->
      <header class="poi-header">
        <div class="poi-header-text">
          <div class="poi-header-badge">Point of Interest</div>
          <h3 class="poi-name">{{ mapStore.pinnedPoi.name }}</h3>
        </div>
        <button class="poi-close" @click="close" aria-label="Close">
          <q-icon name="close" size="14px" />
        </button>
      </header>

      <!-- Grade hero -->
      <section class="grade-section">
        <div class="grade-row">
          <div class="grade-letter" :style="{ color: gradeC, textShadow: `0 0 32px ${gradeC}4d` }">
            {{ grade.grade }}
          </div>
          <div class="grade-meta">
            <div class="grade-label" :style="{ color: gradeC }">{{ grade.label }}</div>
            <div class="grade-score">
              <span class="grade-score-num">{{ grade.score }}</span>
              <span class="grade-score-denom">/ 100</span>
            </div>
          </div>
        </div>
        <div class="grade-bar">
          <div
            class="grade-bar-fill"
            :style="{ width: `${grade.score}%`, background: gradeC }"
          />
        </div>
      </section>

      <!-- Meta callouts -->
      <section class="meta-grid">
        <div class="meta-cell">
          <div class="meta-label">Elev</div>
          <div class="meta-value">
            <template v-if="mapStore.pinnedPoi.elevationFt">
              {{ mapStore.pinnedPoi.elevationFt }} <span class="meta-unit">ft</span>
            </template>
            <span v-else class="meta-empty">—</span>
          </div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Aspect</div>
          <div class="meta-value">
            {{ mapStore.pinnedPoi.aspect ?? '—' }}
          </div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Slope</div>
          <div class="meta-value">
            <template v-if="mapStore.pinnedPoi.slope != null">
              {{ mapStore.pinnedPoi.slope.toFixed(0) }}<span class="meta-unit">°</span>
            </template>
            <span v-else class="meta-empty">—</span>
          </div>
        </div>
      </section>

      <!-- Behavior confidence -->
      <section v-if="visibleBehaviors.length" class="conf-section">
        <div class="section-header">
          Behavior Confidence
          <span class="section-header-sep">·</span>
          <span class="section-header-count">{{ visibleBehaviors.length }} signal{{ visibleBehaviors.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="conf-list">
          <div v-for="b in visibleBehaviors" :key="b" class="conf-row">
            <span class="conf-dot" :style="{ background: behaviorColors[b] }" />
            <span class="conf-label">{{ behaviorLabels[b] }}</span>
            <div class="conf-bar">
              <div
                class="conf-bar-fill"
                :style="{ width: `${conf[b] ?? 0}%`, background: behaviorColors[b] }"
              />
            </div>
            <span class="conf-pct" :style="{ color: behaviorColors[b] }">
              {{ conf[b] ?? 0 }}%
            </span>
          </div>
        </div>
      </section>

      <!-- Field notes -->
      <section class="notes-section">
        <div class="section-header">Field Notes</div>
        <p class="notes-body">{{ mapStore.pinnedPoi.description }}</p>
      </section>

      <div class="poi-actions">
        <button class="delete-btn" @click="deletePoi" title="Hide this POI from the map">
          <q-icon name="delete_outline" size="14px" />
          <span>Delete POI</span>
        </button>
      </div>

      <p class="poi-disclaimer">
        High-probability terrain — verify with sign, wind, and conditions on the ground.
      </p>
    </div>
  </transition>
</template>

<style scoped>
.poi-detail-panel {
  position: absolute;
  top: 12px;
  right: 312px;
  width: 360px;
  max-height: calc(100vh - 96px);
  z-index: 1001;
  background: rgba(15, 25, 35, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid var(--bd-0, #1a2735);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

/* ─── Header ─── */
.poi-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--bd-0, #1a2735);
}

.poi-header-text {
  flex: 1;
  min-width: 0;
}

.poi-header-badge {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--amber, #e8c547);
  margin-bottom: 6px;
}

.poi-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--fg-0, #e7eef5);
  margin: 0;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.poi-close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg-3, #556676);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poi-close:hover {
  background: rgba(200, 214, 229, 0.08);
  color: var(--fg-1, #c8d6e5);
}

/* ─── Grade hero ─── */
.grade-section {
  padding: 16px;
  border-bottom: 1px solid var(--bd-0, #1a2735);
}

.grade-row {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 12px;
}

.grade-letter {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  flex-shrink: 0;
}

.grade-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.grade-label {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.grade-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-family: var(--mono, 'JetBrains Mono', monospace);
}

.grade-score-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--fg-0, #e7eef5);
  letter-spacing: -0.02em;
}

.grade-score-denom {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-3, #556676);
}

.grade-bar {
  height: 4px;
  background: rgba(200, 214, 229, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.grade-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 300ms ease-out;
}

/* ─── Meta grid ─── */
.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-bottom: 1px solid var(--bd-0, #1a2735);
}

.meta-cell {
  padding: 14px 16px;
  border-right: 1px solid var(--bd-0, #1a2735);
}

.meta-cell:last-child {
  border-right: none;
}

.meta-label {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-3, #556676);
  margin-bottom: 6px;
}

.meta-value {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 16px;
  font-weight: 700;
  color: var(--fg-0, #e7eef5);
  letter-spacing: -0.02em;
  line-height: 1;
}

.meta-unit {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-2, #8a9cad);
  margin-left: 2px;
}

.meta-empty {
  color: var(--fg-3, #556676);
}

/* ─── Section header (Behavior, Notes) ─── */
.section-header {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-3, #556676);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-header-sep {
  opacity: 0.5;
}

.section-header-count {
  color: var(--fg-2, #8a9cad);
  font-weight: 600;
  letter-spacing: 0.06em;
}

/* ─── Behavior confidence ─── */
.conf-section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--bd-0, #1a2735);
}

.conf-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conf-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.conf-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.conf-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-1, #c8d6e5);
}

.conf-bar {
  flex: 1;
  height: 4px;
  background: rgba(200, 214, 229, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.conf-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 300ms ease-out;
}

.conf-pct {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.02em;
  width: 36px;
  text-align: right;
  flex-shrink: 0;
}

/* ─── Field notes ─── */
.notes-section {
  padding: 14px 16px;
}

.notes-body {
  margin: 0;
  font-size: 12.5px;
  color: var(--fg-1, #c8d6e5);
  line-height: 1.55;
}

/* ─── Actions ─── */
.poi-actions {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid var(--bd-0, #1a2735);
}

.delete-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.45);
}

/* ─── Disclaimer ─── */
.poi-disclaimer {
  margin: 0;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--bd-0, #1a2735);
  font-size: 10px;
  font-style: italic;
  color: var(--fg-3, #556676);
  line-height: 1.45;
}

/* ─── Slide animation ─── */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

@media (max-width: 899px) {
  .poi-detail-panel {
    right: 12px;
    top: 12px;
    width: calc(100vw - 24px);
    max-width: 360px;
  }
}
</style>
