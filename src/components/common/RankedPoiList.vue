<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore } from '@/stores/map'
import { behaviorColors, behaviorLabels, type BehaviorLayer } from '@/data/elkBehavior'
import {
  deriveConfidence,
  dominantBehavior,
  gradePoi,
  gradeColor,
  type EnabledLayers,
} from '@/composables/usePoiGrading'

const mapStore = useMapStore()

const enabledLayers = computed<EnabledLayers>(() => {
  if (mapStore.huntingPressure === 'max') {
    return { feeding: true, water: true, bedding: true, wallows: true, travel: true, security: true }
  }
  return {
    feeding: mapStore.activeBehaviors.includes('feeding'),
    water: mapStore.activeBehaviors.includes('water'),
    bedding: mapStore.activeBehaviors.includes('bedding'),
    wallows: mapStore.activeBehaviors.includes('wallows'),
    travel: mapStore.activeBehaviors.includes('travel'),
    security: mapStore.activeBehaviors.includes('security'),
  }
})

interface RankedRow {
  id: string
  name: string
  grade: string
  score: number
  label: string
  gradeC: string
  dominant: BehaviorLayer
}

const rows = computed<RankedRow[]>(() => {
  const list: RankedRow[] = []
  for (const poi of mapStore.currentPois) {
    const conf = deriveConfidence(poi, mapStore.currentWeights)
    const grade = gradePoi(poi, conf, enabledLayers.value)
    if (grade.grade === '—') continue
    const dom = dominantBehavior(poi, conf, enabledLayers.value)
    if (!dom) continue
    list.push({
      id: poi.id,
      name: poi.name,
      grade: grade.grade,
      score: grade.score,
      label: grade.label,
      gradeC: gradeColor(grade.grade),
      dominant: dom,
    })
  }
  return list.sort((a, b) => b.score - a.score)
})

function onHover(id: string | null) {
  mapStore.setHoveredPoi(id)
}

function onClick(id: string) {
  mapStore.pinPoi(mapStore.pinnedPoiId === id ? null : id)
}
</script>

<template>
  <q-scroll-area class="fit">
    <div class="ranked-content">
      <div v-if="rows.length === 0" class="empty">
        <q-icon name="search_off" size="32px" />
        <p>No POIs match the current behavior layers.</p>
      </div>

      <div v-else class="rank-summary">
        <span class="rank-summary-num">{{ rows.length }}</span>
        <span class="rank-summary-label">visible POIs</span>
      </div>

      <ul class="rank-list">
        <li
          v-for="(row, i) in rows"
          :key="row.id"
          class="rank-row"
          :class="{
            'rank-row--hovered': mapStore.hoveredPoiId === row.id,
            'rank-row--pinned': mapStore.pinnedPoiId === row.id,
          }"
          @mouseenter="onHover(row.id)"
          @mouseleave="onHover(null)"
          @click="onClick(row.id)"
        >
          <span class="rank-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="rank-grade" :style="{ color: row.gradeC, borderColor: row.gradeC + '66' }">
            {{ row.grade }}
          </span>
          <div class="rank-info">
            <div class="rank-name">{{ row.name }}</div>
            <div class="rank-meta">
              <span class="rank-dot" :style="{ background: behaviorColors[row.dominant] }" />
              <span class="rank-meta-label">{{ behaviorLabels[row.dominant] }}</span>
              <span class="rank-meta-sep">·</span>
              <span class="rank-score" :style="{ color: row.gradeC }">{{ row.score }}</span>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </q-scroll-area>
</template>

<style scoped>
.ranked-content {
  padding: 12px 10px 16px;
}

.empty {
  text-align: center;
  padding: 40px 16px;
  color: var(--fg-3, #556676);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty p {
  font-size: 12px;
  margin: 0;
}

.rank-summary {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px 12px;
  border-bottom: 1px solid var(--bd-0, #1a2735);
  margin-bottom: 8px;
}

.rank-summary-num {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 18px;
  font-weight: 700;
  color: var(--amber, #e8c547);
}

.rank-summary-label {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--fg-3, #556676);
  text-transform: uppercase;
}

.rank-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.rank-row:hover,
.rank-row--hovered {
  background: rgba(232, 197, 71, 0.04);
}

.rank-row--pinned {
  background: rgba(232, 197, 71, 0.08);
  border-color: rgba(232, 197, 71, 0.3);
}

.rank-num {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 700;
  color: var(--fg-3, #556676);
  width: 18px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.rank-grade {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: -0.02em;
  border: 1px solid;
  border-radius: 5px;
  padding: 2px 6px;
  min-width: 28px;
  text-align: center;
  flex-shrink: 0;
}

.rank-info {
  flex: 1;
  min-width: 0;
}

.rank-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-1, #c8d6e5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--fg-3, #556676);
  margin-top: 2px;
}

.rank-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.rank-meta-label {
  font-weight: 500;
}

.rank-meta-sep {
  color: var(--fg-3, #556676);
  opacity: 0.5;
}

.rank-score {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  letter-spacing: -0.02em;
}
</style>
