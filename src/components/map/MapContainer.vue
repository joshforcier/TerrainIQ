<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type L from 'leaflet'
import { useMap } from '@/composables/useMap'
import { useHeatmap } from '@/composables/useHeatmap'
import { useHoverInfo } from '@/composables/useHoverInfo'
import { useAIPois } from '@/composables/useAIPois'
import { useSelectionBox } from '@/composables/useSelectionBox'
import { useMeasure } from '@/composables/useMeasure'
import { usePOIMarkers } from '@/composables/usePOIMarkers'
import { useUserPinMarkers } from '@/composables/useUserPinMarkers'
import { useMapStore } from '@/stores/map'
import { useUserPinsStore } from '@/stores/userPins'
import { useAuthStore } from '@/stores/auth'
import { useScoutWaypointsStore } from '@/stores/scoutWaypoints'
import { pointsOfInterest as defaultPois } from '@/data/pointsOfInterest'

const mapRef = ref<HTMLElement | null>(null)
const { map } = useMap(mapRef)
const mapStore = useMapStore()

const selection = useSelectionBox(map)
const measure = useMeasure(map)
const { pois, allCombos, hasResults, loading, error, errorCode, analyzedArea, fromCache, generatePOIs, clearPOIs, clearError } = useAIPois(map)

const { terrainCells } = useHeatmap(map, analyzedArea)
const { hoverScores, attach } = useHoverInfo(map, terrainCells)

const scoutWaypointsStore = useScoutWaypointsStore()

// Renderable POI list = (active analysis ∪ kept POIs ∪ imported scout waypoints)
// − user-deleted IDs. Imported waypoints are synthesized into POI shapes so
// the existing render + grading pipeline treats them identically to AI POIs.
const renderedPois = computed(() => {
  const active = pois.value
  const kept = mapStore.keptPois
  const scout = scoutWaypointsStore.synthesizedPois
  const activeIds = new Set(active.map((p) => p.id))
  const uniqueKept = kept.filter((p) => !activeIds.has(p.id))
  const merged = active.length === 0 && uniqueKept.length === 0 && scout.length === 0
    ? defaultPois
    : [...uniqueKept, ...scout, ...active]
  if (mapStore.deletedPoiIds.size === 0) return merged
  return merged.filter((p) => !mapStore.deletedPoiIds.has(p.id))
})

usePOIMarkers(map, renderedPois)
useUserPinMarkers(map)

watch(
  renderedPois,
  (list) => mapStore.setCurrentPois(list),
  { immediate: true },
)

watch(() => map.value, (m) => { if (m) attach() }, { immediate: true })

// ─── User pins: subscribe to Firestore for the signed-in user ───
const userPins = useUserPinsStore()
const auth = useAuthStore()

watch(
  () => auth.user?.uid ?? null,
  (uid) => {
    if (uid) userPins.subscribe(uid)
    else userPins.unsubscribe()
  },
  { immediate: true },
)

// ─── Drop-pin click handler ───
// When dropMode is on, a click on the map (not on an existing marker) opens
// a draft popup at the click location. Existing-marker clicks bypass this
// because useUserPinMarkers stops propagation on its own marker clicks.
function onMapClick(e: L.LeafletMouseEvent) {
  if (!userPins.dropMode) return
  // Don't drop a new pin if a draft popup is already open — finish that one
  // first, otherwise we lose unsaved edits silently.
  if (userPins.draft) return
  userPins.openDraftForNew(e.latlng.lat, e.latlng.lng)
}

watch(
  () => map.value,
  (m, old) => {
    if (old) old.off('click', onMapClick)
    if (m) m.on('click', onMapClick)
  },
  { immediate: true },
)

// Visual cue: crosshair cursor while drop mode is on.
watch(
  () => [map.value, userPins.dropMode] as const,
  ([m, on]) => {
    if (!m) return
    const container = m.getContainer()
    container.classList.toggle('map-container--drop-mode', !!on)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (map.value) map.value.off('click', onMapClick)
  userPins.unsubscribe()
})

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
  pois, allCombos, hasResults, loading, error, errorCode, analyzedArea, fromCache,
  selection,
  measureActive,
  toggleMeasure: () => measure.toggle(),
  analyzeSelection, resetAll, clearError,
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

<!-- Global styles for user pin markers (rendered via Leaflet divIcon — outside
     scoped CSS reach) and the drop-mode cursor. -->
<style>
.map-container--drop-mode {
  cursor: crosshair !important;
}
.map-container--drop-mode .leaflet-grab,
.map-container--drop-mode .leaflet-interactive {
  cursor: crosshair !important;
}

.user-pin-leaflet {
  background: transparent;
  border: none;
}

.user-pin-wrap {
  position: relative;
  width: 32px;
  height: 42px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
  cursor: pointer;
  transition: transform 0.12s ease;
}
.user-pin-wrap:hover {
  transform: translateY(-2px);
}

.user-pin-svg {
  display: block;
}

.user-pin-icon {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 18px !important;
  pointer-events: none;
}

.user-pin-icon--svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.user-pin--draft .user-pin-svg path {
  stroke-dasharray: 3 3;
  animation: user-pin-draft-pulse 1.4s ease-in-out infinite;
}

@keyframes user-pin-draft-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
