import { ref, watch, onUnmounted, type ShallowRef } from 'vue'
import L from 'leaflet'

// Box size in miles
const BOX_MILES = 2

const MILE_LAT = 1 / 69.0
function mileLng(lat: number): number {
  return 1 / (69.0 * Math.cos((lat * Math.PI) / 180))
}

export interface SelectionBounds {
  north: number
  south: number
  east: number
  west: number
}

export function useSelectionBox(map: ShallowRef<L.Map | null>) {
  const isActive = ref(false)      // Selection mode on/off
  const isLocked = ref(false)      // Box placed and locked
  const bounds = ref<SelectionBounds | null>(null)

  let previewRect: L.Rectangle | null = null
  let lockedRect: L.Rectangle | null = null

  const previewStyle: L.PathOptions = {
    color: '#e8c547',
    weight: 2,
    dashArray: '8 6',
    fillColor: '#e8c547',
    fillOpacity: 0.08,
    interactive: false,
  }

  const lockedStyle: L.PathOptions = {
    color: '#e8c547',
    weight: 2.5,
    dashArray: '',
    fillColor: '#e8c547',
    fillOpacity: 0.12,
    interactive: false,
  }

  function getBoundsAround(lat: number, lng: number): L.LatLngBoundsExpression {
    const halfLat = (MILE_LAT * BOX_MILES) / 2
    const halfLng = (mileLng(lat) * BOX_MILES) / 2
    return [
      [lat - halfLat, lng - halfLng],
      [lat + halfLat, lng + halfLng],
    ]
  }

  function onMouseMove(e: L.LeafletMouseEvent) {
    if (!map.value || isLocked.value) return

    const rectBounds = getBoundsAround(e.latlng.lat, e.latlng.lng)

    if (!previewRect) {
      previewRect = L.rectangle(rectBounds, previewStyle).addTo(map.value)
    } else {
      previewRect.setBounds(rectBounds)
    }
  }

  function onMapClick(e: L.LeafletMouseEvent) {
    if (!map.value || !isActive.value) return

    const lat = e.latlng.lat
    const lng = e.latlng.lng
    const halfLat = (MILE_LAT * BOX_MILES) / 2
    const halfLng = (mileLng(lat) * BOX_MILES) / 2

    bounds.value = {
      north: lat + halfLat,
      south: lat - halfLat,
      east: lng + halfLng,
      west: lng - halfLng,
    }

    // Remove preview, add locked rect
    if (previewRect) {
      previewRect.remove()
      previewRect = null
    }

    const rectBounds = getBoundsAround(lat, lng)
    if (lockedRect) {
      lockedRect.setBounds(rectBounds)
    } else {
      lockedRect = L.rectangle(rectBounds, lockedStyle).addTo(map.value)
    }

    isLocked.value = true
  }

  function activate() {
    if (!map.value) return
    isActive.value = true
    isLocked.value = false
    bounds.value = null

    if (lockedRect) {
      lockedRect.remove()
      lockedRect = null
    }

    map.value.getContainer().style.cursor = 'crosshair'
    map.value.on('mousemove', onMouseMove as L.LeafletEventHandlerFn)
    map.value.on('click', onMapClick as L.LeafletEventHandlerFn)
  }

  function deactivate() {
    if (!map.value) return
    isActive.value = false

    map.value.getContainer().style.cursor = ''
    map.value.off('mousemove', onMouseMove as L.LeafletEventHandlerFn)
    map.value.off('click', onMapClick as L.LeafletEventHandlerFn)

    if (previewRect) {
      previewRect.remove()
      previewRect = null
    }
  }

  function clearSelection() {
    deactivate()
    isLocked.value = false
    bounds.value = null

    if (lockedRect) {
      lockedRect.remove()
      lockedRect = null
    }
  }

  // Auto-deactivate click listener once box is locked (keep box visible)
  watch(isLocked, (locked) => {
    if (locked && map.value) {
      map.value.getContainer().style.cursor = ''
      map.value.off('mousemove', onMouseMove as L.LeafletEventHandlerFn)
      map.value.off('click', onMapClick as L.LeafletEventHandlerFn)
    }
  })

  onUnmounted(() => {
    if (map.value) {
      map.value.off('mousemove', onMouseMove as L.LeafletEventHandlerFn)
      map.value.off('click', onMapClick as L.LeafletEventHandlerFn)
      map.value.getContainer().style.cursor = ''
    }
    previewRect?.remove()
    lockedRect?.remove()
  })

  return {
    isActive,
    isLocked,
    bounds,
    activate,
    deactivate,
    clearSelection,
  }
}
