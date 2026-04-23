<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type L from 'leaflet'
import { useMapStore } from '@/stores/map'
import { behaviorColors, behaviorLabels, type BehaviorLayer } from '@/data/elkBehavior'
import {
  deriveConfidence,
  gradePoi,
  gradeColor,
  type EnabledLayers,
} from '@/composables/usePoiGrading'

const props = defineProps<{ map: L.Map | null }>()
const mapStore = useMapStore()

const enabledLayers = computed<EnabledLayers>(() => ({
  feeding: mapStore.activeBehaviors.includes('feeding'),
  water: mapStore.activeBehaviors.includes('water'),
  bedding: mapStore.activeBehaviors.includes('bedding'),
  wallows: mapStore.activeBehaviors.includes('wallows'),
  travel: mapStore.activeBehaviors.includes('travel'),
  security: mapStore.activeBehaviors.includes('security'),
}))

const hoveredPoi = computed(() => {
  const id = mapStore.hoveredPoiId
  if (!id) return null
  // Suppress hover card on the currently pinned POI (its detail panel already shows full info)
  if (id === mapStore.pinnedPoiId) return null
  return mapStore.currentPois.find((p) => p.id === id) ?? null
})

const conf = computed(() => {
  if (!hoveredPoi.value) return {}
  return deriveConfidence(hoveredPoi.value, mapStore.currentWeights)
})

const grade = computed(() => {
  if (!hoveredPoi.value) return null
  return gradePoi(hoveredPoi.value, conf.value, enabledLayers.value)
})

const gradeC = computed(() => (grade.value ? gradeColor(grade.value.grade) : '#888'))

const visibleBehaviors = computed<BehaviorLayer[]>(() => {
  if (!hoveredPoi.value) return []
  return hoveredPoi.value.relatedBehaviors
    .filter((b) => enabledLayers.value[b])
    .sort((a, b) => (conf.value[b] ?? 0) - (conf.value[a] ?? 0))
})

const screenPos = ref<{ x: number; y: number; placeRight: boolean } | null>(null)

function updatePosition() {
  const m = props.map
  const poi = hoveredPoi.value
  if (!m || !poi) {
    screenPos.value = null
    return
  }
  const pt = m.latLngToContainerPoint([poi.lat, poi.lng])
  const container = m.getContainer()
  // Default: place card to the right; if too close to right edge, place to the left
  const placeRight = pt.x < container.clientWidth - 280
  screenPos.value = { x: pt.x, y: pt.y, placeRight }
}

watch(() => [hoveredPoi.value?.id, props.map], updatePosition, { immediate: true })

onMounted(() => {
  if (props.map) {
    props.map.on('move zoom', updatePosition)
  }
})

onUnmounted(() => {
  if (props.map) {
    props.map.off('move zoom', updatePosition)
  }
})

watch(
  () => props.map,
  (m, prev) => {
    if (prev) prev.off('move zoom', updatePosition)
    if (m) m.on('move zoom', updatePosition)
  },
)
</script>

<template>
  <div
    v-if="hoveredPoi && grade && screenPos"
    class="poi-hover-card"
    :class="{ 'poi-hover-card--right': screenPos.placeRight, 'poi-hover-card--left': !screenPos.placeRight }"
    :style="{ left: `${screenPos.x}px`, top: `${screenPos.y}px` }"
  >
    <div class="poi-hover-head">
      <div class="poi-hover-name">{{ hoveredPoi.name }}</div>
      <div class="poi-hover-grade" :style="{ color: gradeC, borderColor: gradeC }">
        <span class="poi-hover-grade-letter">{{ grade.grade }}</span>
        <span class="poi-hover-grade-label">{{ grade.label }}</span>
      </div>
    </div>

    <div v-if="visibleBehaviors.length" class="poi-hover-behaviors">
      <div v-for="b in visibleBehaviors" :key="b" class="poi-hover-row">
        <span class="poi-hover-swatch" :style="{ background: behaviorColors[b] }" />
        <span class="poi-hover-label">{{ behaviorLabels[b] }}</span>
        <span class="poi-hover-score" :style="{ color: behaviorColors[b] }">{{ conf[b] ?? 0 }}%</span>
      </div>
    </div>

    <div class="poi-hover-meta">
      <span v-if="hoveredPoi.elevationFt">{{ hoveredPoi.elevationFt }} ft</span>
      <span v-if="hoveredPoi.elevationFt && hoveredPoi.aspect" class="meta-dot">·</span>
      <span v-if="hoveredPoi.aspect">{{ hoveredPoi.aspect }}-facing</span>
      <span v-if="hoveredPoi.aspect && hoveredPoi.slope != null" class="meta-dot">·</span>
      <span v-if="hoveredPoi.slope != null">{{ hoveredPoi.slope.toFixed(0) }}° slope</span>
    </div>
  </div>
</template>

<style scoped>
.poi-hover-card {
  position: absolute;
  z-index: 1100;
  width: 240px;
  background: rgba(15, 25, 35, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid var(--bd-0, #1a2735);
  border-radius: 10px;
  padding: 12px 14px;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  transform: translateY(-50%);
}

.poi-hover-card--right {
  margin-left: 28px;
}

.poi-hover-card--left {
  margin-left: -268px; /* -(width + offset) */
}

.poi-hover-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.poi-hover-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--fg-0, #e7eef5);
  line-height: 1.25;
}

.poi-hover-grade {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 8px;
  border: 1px solid;
  border-radius: 6px;
  flex-shrink: 0;
  background: rgba(10, 14, 20, 0.7);
}

.poi-hover-grade-letter {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}

.poi-hover-grade-label {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  line-height: 1;
}

.poi-hover-behaviors {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.poi-hover-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.poi-hover-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.poi-hover-label {
  flex: 1;
  font-weight: 500;
  color: var(--fg-1, #c8d6e5);
}

.poi-hover-score {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.poi-hover-meta {
  font-size: 11px;
  color: var(--fg-3, #556676);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  padding-top: 8px;
  border-top: 1px solid var(--bd-0, #1a2735);
}

.meta-dot {
  opacity: 0.6;
}
</style>
