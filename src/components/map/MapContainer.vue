<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useMap } from '@/composables/useMap'
import { useHeatmap } from '@/composables/useHeatmap'
import { useHoverInfo } from '@/composables/useHoverInfo'
import { useAIPois } from '@/composables/useAIPois'
import { useSelectionBox } from '@/composables/useSelectionBox'
import { useMeasure } from '@/composables/useMeasure'
import { usePOIMarkers } from '@/composables/usePOIMarkers'
import { useMapStore } from '@/stores/map'
import { pointsOfInterest as defaultPois } from '@/data/pointsOfInterest'

const mapRef = ref<HTMLElement | null>(null)
const { map } = useMap(mapRef)
const mapStore = useMapStore()

const selection = useSelectionBox(map)
const measure = useMeasure(map)
const { pois, hasResults, loading, error, analyzedArea, fromCache, generatePOIs, clearPOIs } = useAIPois(map)

const { terrainCells } = useHeatmap(map, analyzedArea)
const { hoverScores, attach } = useHoverInfo(map, terrainCells)

// Renderable POI list = (active analysis ∪ kept POIs from prior analyses) − user-deleted IDs.
// Falls back to the bundled defaults only when nothing else is loaded.
const renderedPois = computed(() => {
  const active = pois.value
  const kept = mapStore.keptPois
  const activeIds = new Set(active.map((p) => p.id))
  const uniqueKept = kept.filter((p) => !activeIds.has(p.id))
  const merged = active.length === 0 && uniqueKept.length === 0
    ? defaultPois
    : [...uniqueKept, ...active]
  if (mapStore.deletedPoiIds.size === 0) return merged
  return merged.filter((p) => !mapStore.deletedPoiIds.has(p.id))
})

usePOIMarkers(map, renderedPois)

watch(
  renderedPois,
  (list) => mapStore.setCurrentPois(list),
  { immediate: true },
)

watch(() => map.value, (m) => { if (m) attach() }, { immediate: true })

async function analyzeSelection() {
  if (!selection.bounds.value) return
  await generatePOIs(selection.bounds.value)
}

function resetAll() {
  // Preserve the current analysis's POIs on the map after the reset
  mapStore.archivePois(pois.value)
  clearPOIs()
  selection.clearSelection()
}

const measureActive = computed(() => measure.active.value)

defineExpose({
  map, hoverScores,
  pois, hasResults, loading, error, analyzedArea, fromCache,
  selection,
  measureActive,
  toggleMeasure: () => measure.toggle(),
  analyzeSelection, resetAll,
})
</script>

<template>
  <div ref="mapRef" class="map-container"></div>
</template>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
}
</style>
