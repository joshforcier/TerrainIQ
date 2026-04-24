import { watch, onUnmounted, type ShallowRef, type Ref } from 'vue'
import L from 'leaflet'
import type { PointOfInterest } from '@/data/pointsOfInterest'
import { useMapStore } from '@/stores/map'
import { behaviorColors, type BehaviorLayer } from '@/data/elkBehavior'
import {
  deriveConfidence,
  dominantBehavior,
  gradePoi,
  gradeColor,
  type EnabledLayers,
} from './usePoiGrading'

// Unicode geometric characters — rendered in the system font (no external
// font dependency, no ligature substitution, always available). Each is
// visually distinct so a hunter can recognize the behavior at a glance.
// Material Icons text glyphs — semantic icons that match what each behavior
// represents. The Material Icons font is loaded globally via @quasar/extras;
// .poi-hex-glyph CSS provides the ligature substitution so text like "grass"
// resolves to the actual icon glyph.
const glyphIcon: Record<BehaviorLayer, string> = {
  feeding: 'grass',
  water: 'water_drop',
  bedding: 'bedtime', // crescent moon
  wallows: 'lens_blur', // soft concentric blur — wallow / mud puddle
  travel: 'compare_arrows',
  security: 'shield',
}

function glyphFor(behavior: BehaviorLayer, color: string): string {
  return `<i class="material-icons poi-hex-glyph" style="color:${color}">${glyphIcon[behavior]}</i>`
}

function enabledLayersFromActive(active: BehaviorLayer[]): EnabledLayers {
  return {
    feeding: active.includes('feeding'),
    water: active.includes('water'),
    bedding: active.includes('bedding'),
    wallows: active.includes('wallows'),
    travel: active.includes('travel'),
    security: active.includes('security'),
  }
}

function buildHexHtml(
  poi: PointOfInterest,
  dom: BehaviorLayer,
  gradeLetter: string,
  isTop: boolean,
): string {
  const color = behaviorColors[dom]
  const gc = gradeColor(gradeLetter as never)
  const glyphColor = '#ffffff'
  // All hexes use the same translucent behavior-color fill regardless of grade.
  // The inner ring is kept as a subtle marker for top-grade (A/A+) POIs only.
  const innerRing = isTop
    ? `<polygon points="17,5 29,12 29,26 17,33 5,26 5,12" fill="none" stroke="${color}" stroke-width="0.8" stroke-opacity="0.5"/>`
    : ''
  return `
<div class="poi-hex-wrap" data-poi-id="${poi.id}">
  <div class="poi-hex" style="--c:${color}; --gc:${gc}">
    <svg class="poi-hex-shape" width="34" height="38" viewBox="0 0 34 38">
      <polygon points="17,2 32,10.5 32,27.5 17,36 2,27.5 2,10.5"
        fill="${color}"
        fill-opacity="0.18"
        stroke="${color}" stroke-width="1.5"/>
      ${innerRing}
    </svg>
    <span class="poi-hex-icon">${glyphFor(dom, glyphColor)}</span>
    <span class="poi-hex-grade" style="color:${gc}; border-color:${gc}">${gradeLetter}</span>
  </div>
</div>`.trim()
}

export function usePOIMarkers(
  map: ShallowRef<L.Map | null>,
  dynamicPois: Ref<PointOfInterest[]>,
) {
  const mapStore = useMapStore()
  const markersById = new Map<string, L.Marker>()

  function clearMarkers() {
    for (const marker of markersById.values()) marker.remove()
    markersById.clear()
  }

  function applyClassByState() {
    for (const [id, marker] of markersById.entries()) {
      const el = marker.getElement()?.querySelector<HTMLElement>('.poi-hex-wrap')
      if (!el) continue
      el.classList.toggle('poi-hex--hovered', mapStore.hoveredPoiId === id)
      el.classList.toggle('poi-hex--pinned', mapStore.pinnedPoiId === id)
    }
  }

  function rebuildMarkers(m: L.Map, pois: PointOfInterest[]) {
    clearMarkers()
    const enabled = enabledLayersFromActive(mapStore.activeBehaviors as BehaviorLayer[])
    const weights = mapStore.currentWeights

    for (const poi of pois) {
      const conf = deriveConfidence(poi, weights)
      const dom = dominantBehavior(poi, conf, enabled)
      if (!dom) continue
      const grade = gradePoi(poi, conf, enabled)
      const isTop = grade.score >= 82

      const icon = L.divIcon({
        className: 'poi-hex-leaflet',
        html: buildHexHtml(poi, dom, grade.grade, isTop),
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      })
      const marker = L.marker([poi.lat, poi.lng], { icon, riseOnHover: true }).addTo(m)
      marker.on('mouseover', () => mapStore.setHoveredPoi(poi.id))
      marker.on('mouseout', () => mapStore.setHoveredPoi(null))
      marker.on('click', () => {
        mapStore.pinPoi(mapStore.pinnedPoiId === poi.id ? null : poi.id)
      })
      markersById.set(poi.id, marker)
    }
    applyClassByState()
  }

  // Re-render when POIs, weights, or enabled layers change
  watch(
    () => [
      dynamicPois.value,
      mapStore.season,
      mapStore.timeOfDay,
      mapStore.huntingPressure,
      [...mapStore.activeBehaviors].sort().join(','),
    ],
    () => {
      if (map.value) rebuildMarkers(map.value, dynamicPois.value)
    },
    { deep: true },
  )

  // Initial render once map is ready
  watch(
    () => map.value,
    (m) => {
      if (m && dynamicPois.value.length > 0) rebuildMarkers(m, dynamicPois.value)
    },
    { immediate: true },
  )

  // Hover/pin state from sidebar → reflect in marker classes
  watch(
    () => [mapStore.hoveredPoiId, mapStore.pinnedPoiId],
    () => applyClassByState(),
  )

  onUnmounted(clearMarkers)

  return { markersById }
}
