import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { LatLng } from '@/types/map'
import type { Season, TimeOfDay, BehaviorLayer } from '@/data/elkBehavior'
import { behaviorWeights } from '@/data/elkBehavior'
import type { PointOfInterest } from '@/data/pointsOfInterest'

export type SidebarTab = 'controls' | 'pois'

export type HuntingPressure = 'low' | 'medium' | 'high' | 'max'

export type BaseLayer = 'streets' | 'satellite' | 'outdoors' | 'hybrid' | 'lidar'

export const useMapStore = defineStore('map', () => {
  // Map view state — centered on Flat Tops, CO
  const center = ref<LatLng>({ lat: 39.955, lng: -107.14 })
  const zoom = ref(13)
  const baseLayer = ref<BaseLayer>('satellite')

  // Elk analysis controls
  const season = ref<Season>('rut')
  const timeOfDay = ref<TimeOfDay>('dawn')
  const activeBehaviors = ref<BehaviorLayer[]>(['feeding', 'water', 'bedding', 'wallows', 'travel', 'security'])
  const intensity = ref(0.7) // heatmap opacity 0–1
  const showHeatmap = ref(false)
  const bufferMiles = ref(0.5) // road/trail/building buffer in miles
  const huntingPressure = ref<HuntingPressure>('medium')
  const seasonLocked = ref(false)

  // POI presentation state (POI list lives in useAIPois; mirrored here so the
  // sidebar and detail panel can read it without a direct composable dependency)
  const currentPois = ref<PointOfInterest[]>([])
  const pinnedPoiId = ref<string | null>(null)
  const hoveredPoiId = ref<string | null>(null)
  const sidebarTab = ref<SidebarTab>('controls')

  // POIs preserved across "New Selection" so previous analyses stay on the map
  const keptPois = ref<PointOfInterest[]>([])

  // Per-POI deletions, persisted to localStorage so they survive refreshes
  const DELETED_POI_KEY = 'ridgeread.deletedPoiIds'
  function loadDeletedIds(): Set<string> {
    try {
      const raw = localStorage.getItem(DELETED_POI_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
    } catch {
      return new Set()
    }
  }
  const deletedPoiIds = ref<Set<string>>(loadDeletedIds())
  watch(
    deletedPoiIds,
    (set) => {
      try { localStorage.setItem(DELETED_POI_KEY, JSON.stringify([...set])) } catch { /* ignore */ }
    },
    { deep: true },
  )

  const pinnedPoi = computed<PointOfInterest | null>(() =>
    pinnedPoiId.value
      ? currentPois.value.find((p) => p.id === pinnedPoiId.value) ?? null
      : null,
  )

  // Pressure multipliers: scales security up and feeding/travel down at high pressure
  const pressureModifiers: Record<Exclude<HuntingPressure, 'max'>, Record<BehaviorLayer, number>> = {
    low:    { feeding: 1.1, water: 1.0, bedding: 0.9, wallows: 1.0, travel: 1.1, security: 0.5 },
    medium: { feeding: 1.0, water: 1.0, bedding: 1.0, wallows: 1.0, travel: 1.0, security: 1.0 },
    high:   { feeding: 0.7, water: 0.8, bedding: 1.1, wallows: 0.6, travel: 0.6, security: 1.5 },
  }

  // Derived: current behavior weights for active season + time + pressure
  const currentWeights = computed(() => {
    if (huntingPressure.value === 'max') {
      return { feeding: 0, water: 0, bedding: 0, wallows: 0, travel: 0, security: 1 }
    }
    const base = behaviorWeights[season.value][timeOfDay.value]
    const mods = pressureModifiers[huntingPressure.value]
    const result = {} as Record<BehaviorLayer, number>
    for (const key of Object.keys(base) as BehaviorLayer[]) {
      result[key] = Math.min(1, base[key] * mods[key])
    }
    return result
  })

  function setView(newCenter: LatLng, newZoom: number) {
    center.value = newCenter
    zoom.value = newZoom
  }

  function setSeason(s: Season) {
    if (!seasonLocked.value) {
      season.value = s
    }
  }

  function lockSeason() {
    seasonLocked.value = true
  }

  function unlockSeason() {
    seasonLocked.value = false
  }

  function setTimeOfDay(t: TimeOfDay) {
    timeOfDay.value = t
  }

  function toggleBehavior(b: BehaviorLayer) {
    const idx = activeBehaviors.value.indexOf(b)
    if (idx >= 0) {
      activeBehaviors.value.splice(idx, 1)
    } else {
      activeBehaviors.value.push(b)
    }
  }

  function setIntensity(val: number) {
    intensity.value = val
  }

  function setBaseLayer(layer: BaseLayer) {
    baseLayer.value = layer
  }

  function setHuntingPressure(p: HuntingPressure) {
    huntingPressure.value = p
  }

  function setCurrentPois(pois: PointOfInterest[]) {
    currentPois.value = pois
    if (pinnedPoiId.value && !pois.some((p) => p.id === pinnedPoiId.value)) {
      pinnedPoiId.value = null
    }
  }

  function pinPoi(id: string | null) {
    pinnedPoiId.value = id
  }

  function setHoveredPoi(id: string | null) {
    hoveredPoiId.value = id
  }

  function setSidebarTab(tab: SidebarTab) {
    sidebarTab.value = tab
  }

  function archivePois(pois: PointOfInterest[]) {
    if (pois.length === 0) return
    const existing = new Set(keptPois.value.map((p) => p.id))
    const newOnes = pois.filter((p) => !existing.has(p.id))
    if (newOnes.length === 0) return
    keptPois.value = [...keptPois.value, ...newOnes]
  }

  function clearKeptPois() {
    keptPois.value = []
  }

  function deletePoi(id: string) {
    deletedPoiIds.value = new Set([...deletedPoiIds.value, id])
    if (pinnedPoiId.value === id) pinnedPoiId.value = null
    if (hoveredPoiId.value === id) hoveredPoiId.value = null
  }

  function restorePoi(id: string) {
    if (!deletedPoiIds.value.has(id)) return
    const next = new Set(deletedPoiIds.value)
    next.delete(id)
    deletedPoiIds.value = next
  }

  function clearDeletedPois() {
    deletedPoiIds.value = new Set()
  }

  return {
    center,
    zoom,
    baseLayer,
    season,
    timeOfDay,
    activeBehaviors,
    intensity,
    showHeatmap,
    bufferMiles,
    huntingPressure,
    seasonLocked,
    currentWeights,
    currentPois,
    pinnedPoiId,
    pinnedPoi,
    hoveredPoiId,
    sidebarTab,
    keptPois,
    deletedPoiIds,
    setView,
    setBaseLayer,
    setSeason,
    setTimeOfDay,
    toggleBehavior,
    setIntensity,
    setHuntingPressure,
    lockSeason,
    unlockSeason,
    setCurrentPois,
    pinPoi,
    setHoveredPoi,
    setSidebarTab,
    archivePois,
    clearKeptPois,
    deletePoi,
    restorePoi,
    clearDeletedPois,
  }
})
