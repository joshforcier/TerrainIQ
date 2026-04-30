import { watch, ref, onUnmounted, type ShallowRef, type Ref } from 'vue'
import L from 'leaflet'
import 'leaflet.heat'
import { useMapStore } from '@/stores/map'
import { generateTerrainGrid, computeCellScore, type TerrainCell } from '@/data/terrainGrid'
import type { AnalyzedArea } from '@/composables/useAIPois'
import type { BehaviorLayer } from '@/data/elkBehavior'

// Higher grid density = more defined hotspots instead of uniform wash
const GRID_SIZE = 80

export function useHeatmap(
  map: ShallowRef<L.Map | null>,
  analyzedArea: Ref<AnalyzedArea | null>
) {
  const mapStore = useMapStore()

  const terrainCells = ref<TerrainCell[]>(generateTerrainGrid(39.955, -107.14, GRID_SIZE, 0.001))
  let heatLayer: L.HeatLayer | null = null

  function regenerateGrid(area: AnalyzedArea | null) {
    if (area) {
      const centerLat = (area.north + area.south) / 2
      const centerLng = (area.east + area.west) / 2
      const latSpan = area.north - area.south
      const lngSpan = area.east - area.west
      const maxSpan = Math.max(latSpan, lngSpan)
      const cellSpacing = maxSpan / GRID_SIZE

      terrainCells.value = generateTerrainGrid(centerLat, centerLng, GRID_SIZE, cellSpacing)
    } else {
      terrainCells.value = generateTerrainGrid(39.955, -107.14, GRID_SIZE, 0.001)
    }
  }

  function buildHeatData(): Array<[number, number, number]> {
    const activeBehaviors: BehaviorLayer[] = mapStore.huntingPressure === 'max'
      ? ['security']
      : mapStore.activeBehaviors
    const points = terrainCells.value
      .map(cell => {
        const score = computeCellScore(cell, activeBehaviors, mapStore.currentWeights)
        return [cell.lat, cell.lng, score] as [number, number, number]
      })
      .filter(point => point[2] > 0.25) // Higher threshold — only real hotspots

    return points
  }

  function removeHeatLayer() {
    if (heatLayer && map.value) {
      map.value.removeLayer(heatLayer)
      heatLayer = null
    }
  }

  function updateHeatmap() {
    if (!map.value) return

    const container = map.value.getContainer()
    if (container.clientHeight === 0 || container.clientWidth === 0) return

    // Always recreate the layer so radius/blur are reapplied
    removeHeatLayer()

    if (!mapStore.showHeatmap) return

    const data = buildHeatData()
    if (data.length === 0) return

    heatLayer = L.heatLayer(data, {
      radius: 12,         // Tight radius — distinct hotspots, not a blanket
      blur: 10,           // Minimal blur — keeps spots separated
      maxZoom: 17,
      max: 1.0,
      minOpacity: mapStore.intensity * 0.15,
      gradient: {
        0.0: 'transparent',
        0.15: 'rgba(66, 10, 104, 0.3)',
        0.35: 'rgba(147, 38, 103, 0.5)',
        0.5: 'rgba(221, 81, 58, 0.65)',
        0.7: 'rgba(252, 165, 10, 0.8)',
        1.0: '#fcffa4',
      },
    })
    heatLayer.addTo(map.value)
  }

  // Regenerate grid when the analyzed area changes
  watch(
    () => analyzedArea.value,
    (area) => {
      regenerateGrid(area)
      updateHeatmap()
    }
  )

  // React to sidebar control changes
  watch(
    () => [
      mapStore.season,
      mapStore.timeOfDay,
      mapStore.huntingPressure,
      [...mapStore.activeBehaviors],
      mapStore.intensity,
      mapStore.showHeatmap,
    ],
    () => updateHeatmap(),
    { deep: true }
  )

  // Initial render once map is available
  watch(
    () => map.value,
    (m) => {
      if (!m) return
      updateHeatmap()
      if (!heatLayer) {
        const onReady = () => {
          updateHeatmap()
          m.off('resize', onReady)
          m.off('moveend', onReady)
        }
        m.on('resize', onReady)
        m.on('moveend', onReady)
      }
    },
    { immediate: true }
  )

  onUnmounted(removeHeatLayer)

  return { terrainCells, updateHeatmap }
}
