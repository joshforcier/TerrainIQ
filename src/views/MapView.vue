<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import HoverTooltip from '@/components/map/HoverTooltip.vue'
import InfoPanel from '@/components/map/InfoPanel.vue'
import PoiDetailPanel from '@/components/map/PoiDetailPanel.vue'
import PoiHoverCard from '@/components/map/PoiHoverCard.vue'
import UserPinPopup from '@/components/map/UserPinPopup.vue'
import LimitReachedModal from '@/components/common/LimitReachedModal.vue'
import InSeasonPlanPage from '@/components/inseason/InSeasonPlanPage.vue'
import { fetchOpenMeteoCurrentWeather } from '@/services/weather'
import { useUserPinsStore } from '@/stores/userPins'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionStore } from '@/stores/subscription'
import { useScoutWaypointsStore } from '@/stores/scoutWaypoints'
import L from 'leaflet'
import type { HoverScores } from '@/composables/useHoverInfo'
import { useMapStore, type BaseLayer, type HuntingPressure } from '@/stores/map'
import { isInElkRange } from '@/utils/elkRange'
import type { PointOfInterest } from '@/data/pointsOfInterest'
import type { TimeOfDay } from '@/data/elkBehavior'
import type { HuntLocation } from '@/types/map'

const mapStore = useMapStore()
const userPinsStore = useUserPinsStore()
const authStore = useAuthStore()
const subscriptionStore = useSubscriptionStore()
const scoutWaypointsStore = useScoutWaypointsStore()
const isDevBuild = import.meta.env.DEV

// ─── GPX import ───
const gpxFileInput = ref<HTMLInputElement | null>(null)
function openGpxFilePicker() {
  if (!authStore.isAuthenticated) return
  gpxFileInput.value?.click()
}
async function onGpxFileChosen(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset so re-selecting the same file fires `change` again.
  if (target) target.value = ''
  if (!file) return
  try {
    await scoutWaypointsStore.importGpx(file)
  } catch {
    /* error message lives on store.importError */
  }
}

const limitReachedModalOpen = ref(false)

const dropPinDisabled = computed(() => !authStore.isAuthenticated)
const dropPinActive = computed(() => userPinsStore.dropMode)
function toggleDropPin() {
  if (dropPinDisabled.value) return
  if (userPinsStore.dropMode) {
    userPinsStore.exitDropMode()
    return
  }
  // Turning ON drop pin → ensure Measure is OFF.
  if (measuring.value) mapContainerRef.value?.toggleMeasure()
  userPinsStore.enterDropMode()
}

function toggleMeasure() {
  // Turning ON measure → ensure drop pin is OFF.
  if (!measuring.value && userPinsStore.dropMode) {
    userPinsStore.exitDropMode()
  }
  mapContainerRef.value?.toggleMeasure()
}

// Esc exits drop mode (UserPinPopup handles Esc on its own when open).
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (mapStore.huntLocationSelecting) {
    mapStore.cancelHuntLocationSelection()
    return
  }
  if (userPinsStore.dropMode && !userPinsStore.draft) userPinsStore.exitDropMode()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stopAnalysisTimer()
  stopViewportListener()
  stopHuntLocationListener()
  removeHuntLocationMarker()
})

const baseLayerOptions: { label: string; value: BaseLayer; icon: string }[] = [
  { label: 'Streets', value: 'streets', icon: 'map' },
  { label: 'Satellite', value: 'satellite', icon: 'satellite_alt' },
  { label: 'Topo', value: 'outdoors', icon: 'terrain' },
  { label: 'Hybrid', value: 'hybrid', icon: 'layers' },
  { label: 'LIDAR', value: 'lidar', icon: 'landscape' },
]

const mapContainerRef = ref<InstanceType<typeof MapContainer> | null>(null)
const stepperCollapsed = ref(false)

function toggleStepper() {
  stepperCollapsed.value = !stepperCollapsed.value
}

const hoverScores = computed<HoverScores | null>(() => {
  return mapContainerRef.value?.hoverScores ?? null
})

const measuring = computed(() => mapContainerRef.value?.measureActive ?? false)

const aiLoading = computed(() => mapContainerRef.value?.loading ?? false)
const aiError = computed(() => mapContainerRef.value?.error ?? null)
const aiErrorCode = computed(() => mapContainerRef.value?.errorCode ?? null)

const analysisStartedAt = ref<number | null>(null)
const analysisElapsedSeconds = ref(0)
let analysisTimer: ReturnType<typeof setInterval> | null = null

const analysisPhases = [
  { icon: 'terrain', label: 'Reading terrain and elevation layers' },
  { icon: 'water_drop', label: 'Checking water, cover, roads, and burns' },
  { icon: 'grid_view', label: 'Scoring dawn, midday, and dusk combos' },
  { icon: 'verified', label: 'Verifying coordinates against real terrain' },
  { icon: 'route', label: 'Ranking access, pressure, and setup quality' },
]

const currentAnalysisPhase = computed(() => {
  const index = Math.min(
    analysisPhases.length - 1,
    Math.floor(analysisElapsedSeconds.value / 12),
  )
  return analysisPhases[index]
})

const analysisElapsedLabel = computed(() => {
  const total = analysisElapsedSeconds.value
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
})

const analysisPatienceLabel = computed(() => {
  if (analysisElapsedSeconds.value >= 90) return 'Still working through the full terrain pass.'
  if (analysisElapsedSeconds.value >= 45) return 'Larger boxes can take a minute or two.'
  return 'Nine scenarios are being checked before POIs appear.'
})

function stopAnalysisTimer() {
  if (analysisTimer) {
    clearInterval(analysisTimer)
    analysisTimer = null
  }
}

watch(aiLoading, (loading) => {
  stopAnalysisTimer()
  if (!loading) {
    analysisStartedAt.value = null
    analysisElapsedSeconds.value = 0
    return
  }

  analysisStartedAt.value = Date.now()
  analysisElapsedSeconds.value = 0
  analysisTimer = setInterval(() => {
    if (!analysisStartedAt.value) return
    analysisElapsedSeconds.value = Math.floor((Date.now() - analysisStartedAt.value) / 1000)
  }, 1000)
})

// When the analyze endpoint reports a quota exhaustion, surface the
// dedicated upgrade modal instead of letting the generic error toast linger.
watch(aiErrorCode, (code) => {
  if (code === 'LIMIT_EXCEEDED') {
    limitReachedModalOpen.value = true
    mapContainerRef.value?.clearError()
  }
})
const hasResults = computed(() => mapContainerRef.value?.hasResults ?? false)
const fromCache = computed(() => mapContainerRef.value?.fromCache ?? false)
const mapInstance = computed<L.Map | null>(() => (mapContainerRef.value?.map as L.Map | null) ?? null)
let stopHuntLocationListener: () => void = () => {}
let huntLocationMarker: L.Marker | null = null

function huntLocationLabel(lat: number, lng: number): string {
  return `Hunt Location ${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function removeHuntLocationMarker() {
  if (!huntLocationMarker) return
  huntLocationMarker.remove()
  huntLocationMarker = null
}

function placeHuntLocationMarker(location: HuntLocation) {
  const map = mapInstance.value
  if (!map) return
  removeHuntLocationMarker()
  const icon = L.divIcon({
    className: 'hunt-location-marker-leaflet',
    html: `
      <div class="hunt-location-marker">
        <span class="material-symbols-outlined">location_searching</span>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 32],
  })
  huntLocationMarker = L.marker([location.lat, location.lng], {
    icon,
    interactive: false,
    zIndexOffset: 1500,
  }).addTo(map)
}

async function loadWeatherForHuntLocation(location: HuntLocation) {
  mapStore.setWeatherLoading(true)
  mapStore.setWeatherError(null)
  try {
    const weather = await fetchOpenMeteoCurrentWeather(location)
    mapStore.setLiveWeather(weather)
  } catch (error) {
    mapStore.setWeatherError(error instanceof Error ? error.message : 'Weather request failed')
  } finally {
    mapStore.setWeatherLoading(false)
  }
}

function setHuntLocationFromMap(lat: number, lng: number) {
  const location: HuntLocation = {
    label: huntLocationLabel(lat, lng),
    lat,
    lng,
    source: 'map-click',
    updatedAt: new Date().toISOString(),
  }
  mapStore.setHuntLocation(location)
  placeHuntLocationMarker(location)
  void loadWeatherForHuntLocation(location)
}

const timeOptions: Array<{ label: string; value: TimeOfDay }> = [
  { label: 'Dawn', value: 'dawn' },
  { label: 'Midday', value: 'midday' },
  { label: 'Dusk', value: 'dusk' },
]

const pressureOptions: Array<{ label: string; value: HuntingPressure }> = [
  { label: 'Low', value: 'low' },
  { label: 'Med', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Max', value: 'max' },
]

const viewportVersion = ref(0)
let stopViewportListener: () => void = () => {}

function comboKey(timeOfDay: TimeOfDay, pressure: HuntingPressure): string {
  return `${timeOfDay}_${pressure}`
}

function poiCoordKey(poi: PointOfInterest): string {
  return `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`
}

function visibleComboCoordSets(): Record<string, Set<string>> {
  void viewportVersion.value
  const combos = mapContainerRef.value?.allCombos
  const map = mapInstance.value
  if (!combos || !map) return {}

  const bounds = map.getBounds()
  const result: Record<string, Set<string>> = {}
  for (const [key, comboPois] of Object.entries(combos)) {
    const coords = new Set<string>()
    for (const poi of comboPois) {
      if (mapStore.deletedPoiIds.has(poi.id)) continue
      if (!bounds.contains(L.latLng(poi.lat, poi.lng))) continue
      coords.add(poiCoordKey(poi))
    }
    result[key] = coords
  }
  return result
}

const visibleScenarioCounts = computed<Record<string, number>>(() => {
  const sets = visibleComboCoordSets()
  const counts: Record<string, number> = {}
  for (const [key, coords] of Object.entries(sets)) {
    counts[key] = coords.size
  }
  return counts
})

const aiPoisCount = computed(() => {
  const uniqueCoords = new Set<string>()
  for (const coords of Object.values(visibleComboCoordSets())) {
    for (const coord of coords) uniqueCoords.add(coord)
  }
  return uniqueCoords.size
})

function scenarioCount(timeOfDay: TimeOfDay, pressure: HuntingPressure): number {
  return visibleScenarioCounts.value[comboKey(timeOfDay, pressure)] ?? 0
}

function scenarioIsActive(timeOfDay: TimeOfDay, pressure: HuntingPressure): boolean {
  if (pressure === 'max' && mapStore.huntingPressure === 'max') return true
  return mapStore.timeOfDay === timeOfDay && mapStore.huntingPressure === pressure
}

function selectScenario(timeOfDay: TimeOfDay, pressure: HuntingPressure) {
  mapStore.setTimeOfDay(timeOfDay)
  mapStore.setHuntingPressure(pressure)
}

watch(mapInstance, (map) => {
  stopViewportListener()
  if (!map) return
  const updateViewport = () => { viewportVersion.value++ }
  map.on('moveend zoomend', updateViewport)
  updateViewport()
  stopViewportListener = () => {
    map.off('moveend zoomend', updateViewport)
    stopViewportListener = () => {}
  }
}, { immediate: true })

watch(mapInstance, (map) => {
  stopHuntLocationListener()
  removeHuntLocationMarker()
  if (!map) return

  const onClick = (event: L.LeafletMouseEvent) => {
    if (!mapStore.huntLocationSelecting) return
    event.originalEvent?.preventDefault()
    event.originalEvent?.stopPropagation()
    setHuntLocationFromMap(event.latlng.lat, event.latlng.lng)
  }

  map.on('click', onClick)
  if (mapStore.huntLocation) placeHuntLocationMarker(mapStore.huntLocation)
  stopHuntLocationListener = () => {
    map.off('click', onClick)
    stopHuntLocationListener = () => {}
  }
}, { immediate: true })

watch(
  () => mapStore.huntLocationSelecting,
  (selecting) => {
    if (!selecting) return
    if (userPinsStore.dropMode) userPinsStore.exitDropMode()
    if (measuring.value) mapContainerRef.value?.toggleMeasure()
    mapContainerRef.value?.selection?.deactivate()
  },
)

watch(
  () => mapStore.huntLocation,
  (location) => {
    if (!location) {
      removeHuntLocationMarker()
      return
    }
    placeHuntLocationMarker(location)
  },
)

// `selection` is an object exposed via defineExpose — Vue only auto-unwraps refs at
// the top level of the exposed surface, so we have to read `.value` explicitly here.
const selectionActive = computed(() => mapContainerRef.value?.selection?.isActive?.value ?? false)
const selectionLocked = computed(() => mapContainerRef.value?.selection?.isLocked?.value ?? false)
const selectionBounds = computed(() => mapContainerRef.value?.selection?.bounds?.value ?? null)

const selectionOutsideElkRange = computed(() => {
  const b = selectionBounds.value
  if (!b) return false
  return !isInElkRange(b)
})

type Mode = 'idle' | 'selecting' | 'placed' | 'analyzing' | 'done'

const mode = computed<Mode>(() => {
  if (aiLoading.value) return 'analyzing'
  if (selectionLocked.value) return 'placed'
  if (selectionActive.value) return 'selecting'
  if (hasResults.value) return 'done'
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

function beginAreaSelection() {
  if (mapStore.huntLocationSelecting) mapStore.cancelHuntLocationSelection()
  if (userPinsStore.dropMode) userPinsStore.exitDropMode()
  if (measuring.value) mapContainerRef.value?.toggleMeasure()
  if (hasResults.value) mapContainerRef.value?.resetAll()
  mapContainerRef.value?.selection?.activate()
}

function startSelection() {
  beginAreaSelection()
}

function cancelSelection() {
  mapContainerRef.value?.selection?.deactivate()
}

function analyzeArea() {
  // Soft paywall: signed-in users get one free analysis before checkout.
  // While we're still loading the sub state for an authenticated user, hold
  // off — the snapshot lands within ms.
  if (authStore.isAuthenticated) {
    if (subscriptionStore.loading) return
    if (!subscriptionStore.hasAnalysisAccess) {
      limitReachedModalOpen.value = true
      return
    }
  }
  mapContainerRef.value?.analyzeSelection()
}

function clearKept() {
  // resetAll archives the current active POIs into keptPois as part of its
  // reset, so we have to clear keptPois AFTER, not before — otherwise we
  // just re-populate the array we were trying to empty.
  mapStore.clearDeletedPois()
  mapContainerRef.value?.resetAll()
  mapStore.clearKeptPois()
}

const keptCount = computed(() => mapStore.keptPois.length)

// ─── Dev: inspect-point tool ───
interface InspectFeature { detected: boolean; reason: string }
interface InspectResult {
  point: { lat: number; lng: number; elevation: number; elevationFt: number; slope: number; aspect: string }
  neighbors: Record<'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW', number>
  features: Record<'saddle' | 'ridge' | 'drainage' | 'bench' | 'fingerRidge', InspectFeature>
}

type InspectFeatureKey = keyof InspectResult['features']

const inspectFeatureLabels: Record<InspectFeatureKey, string> = {
  saddle: 'Saddle',
  ridge: 'Ridge',
  drainage: 'Drainage',
  bench: 'Bench',
  fingerRidge: 'Finger ridge',
}

const inspectPoiPriority: InspectFeatureKey[] = ['saddle', 'bench', 'fingerRidge', 'ridge', 'drainage']

const inspectExpanded = ref(false)
const inspectCoords = ref('')
const inspectSpacing = ref<number>(200)
const inspectLoading = ref(false)
const inspectError = ref<string | null>(null)
const inspectResult = ref<InspectResult | null>(null)

const inspectPoiVerdict = computed(() => {
  const result = inspectResult.value
  if (!result) return null

  const bestKey = inspectPoiPriority.find((key) => result.features[key].detected) ?? null
  const failed = inspectPoiPriority
    .filter((key) => !result.features[key].detected)
    .map((key) => `${inspectFeatureLabels[key]}: ${result.features[key].reason}`)

  if (!bestKey) {
    return {
      tone: 'no',
      icon: 'cancel',
      title: 'Not a strong POI',
      summary: 'No terrain feature detector passed at this coordinate and spacing.',
      supporting: [] as string[],
      limiting: failed.slice(0, 3),
    }
  }

  return {
    tone: 'yes',
    icon: 'check_circle',
    title: `Likely POI: ${inspectFeatureLabels[bestKey]}`,
    summary: `Best terrain match is ${inspectFeatureLabels[bestKey].toLowerCase()} at ${result.point.elevationFt.toLocaleString()} ft, ${result.point.slope.toFixed(1)}° slope, ${result.point.aspect} aspect.`,
    supporting: [`${inspectFeatureLabels[bestKey]}: ${result.features[bestKey].reason}`],
    limiting: failed.slice(0, 2),
  }
})

function inspectFeatureLabel(key: string): string {
  return inspectFeatureLabels[key as InspectFeatureKey] ?? key
}

/**
 * Parse "lat, lng" input. Tolerant of comma OR whitespace separators and
 * stray spacing — pasting "46.61943, -111.42553", "46.61943,-111.42553",
 * or "46.61943 -111.42553" all parse identically.
 */
function parseCoords(s: string): { lat: number; lng: number } | null {
  const parts = s.trim().split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

// Ephemeral Leaflet marker shown at the inspected coordinates. Not persisted —
// recreated each run, removed on unmount. Visually distinct from POI hexes
// and user-pin teardrops (cyan crosshair) so it can't be confused for either.
let inspectMarker: L.Marker | null = null

function placeInspectMarker(lat: number, lng: number) {
  const m = mapInstance.value
  if (!m) return
  if (inspectMarker) {
    inspectMarker.remove()
    inspectMarker = null
  }
  const icon = L.divIcon({
    className: 'inspect-marker-leaflet',
    html: `
      <div class="inspect-marker">
        <svg width="34" height="34" viewBox="0 0 34 34">
          <circle cx="17" cy="17" r="14" fill="rgba(74,222,222,0.12)" stroke="#4adede" stroke-width="2" />
          <line x1="17" y1="2" x2="17" y2="9" stroke="#4adede" stroke-width="2" />
          <line x1="17" y1="25" x2="17" y2="32" stroke="#4adede" stroke-width="2" />
          <line x1="2" y1="17" x2="9" y2="17" stroke="#4adede" stroke-width="2" />
          <line x1="25" y1="17" x2="32" y2="17" stroke="#4adede" stroke-width="2" />
          <circle cx="17" cy="17" r="2" fill="#4adede" />
        </svg>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
  inspectMarker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(m)
  // Pan but don't zoom — keep the user's current zoom level so the dev
  // can see the inspected point in the context they were already viewing.
  m.panTo([lat, lng], { animate: true })
}

async function runInspect() {
  const parsed = parseCoords(inspectCoords.value)
  if (!parsed) {
    inspectError.value = 'Could not parse coords. Use "lat, lng" e.g. 46.61943, -111.42553'
    return
  }
  const { lat, lng } = parsed
  inspectLoading.value = true
  inspectError.value = null
  inspectResult.value = null
  // Drop the marker immediately so the user gets visual feedback even
  // before the elevation fetch completes.
  placeInspectMarker(lat, lng)
  try {
    const idToken = await authStore.user?.getIdToken().catch(() => null)
    if (!idToken) throw new Error('Sign in required')
    const res = await fetch('/api/inspect-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ lat, lng, cellSpacingM: inspectSpacing.value }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `Inspection failed (${res.status})`)
    inspectResult.value = body as InspectResult
  } catch (err: unknown) {
    inspectError.value = err instanceof Error ? err.message : 'Inspection failed'
  } finally {
    inspectLoading.value = false
  }
}

onBeforeUnmount(() => {
  if (inspectMarker) {
    inspectMarker.remove()
    inspectMarker = null
  }
})
</script>

<template>
  <q-page v-if="mapStore.appMode === 'in-season'" class="inseason-page">
    <InSeasonPlanPage />
  </q-page>

  <q-page
    v-else
    class="map-page"
    :class="{
      'map-page--hunt-selecting': mapStore.huntLocationSelecting,
    }"
  >
    <MapContainer ref="mapContainerRef" />
    <div v-if="mapStore.huntLocationSelecting" class="hunt-location-prompt">
      <q-icon name="add_location_alt" size="17px" />
      Click the map to set hunt weather
    </div>
    <HoverTooltip v-if="hoverScores" :scores="hoverScores" />
    <InfoPanel />
    <PoiDetailPanel />
    <PoiHoverCard :map="mapInstance" />
    <UserPinPopup :map="mapInstance" />
    <LimitReachedModal v-model="limitReachedModalOpen" />

    <!-- Stepper panel -->
    <div
      class="stepper-card"
      :class="{
        'stepper-card--collapsed': stepperCollapsed,
        'stepper-card--inseason': mapStore.appMode === 'in-season',
      }"
    >
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
        <button
          class="stepper-collapse-btn"
          @click="toggleStepper"
          :title="stepperCollapsed ? 'Expand' : 'Collapse'"
          :aria-label="stepperCollapsed ? 'Expand stepper' : 'Collapse stepper'"
        >
          <q-icon :name="stepperCollapsed ? 'expand_more' : 'expand_less'" size="16px" />
        </button>
      </div>

      <div v-show="!stepperCollapsed" class="stepper-body">
        <template v-if="mode === 'idle'">
          <p class="step-caption">Pick a 2 × 2 mi area to analyze.</p>
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
          <template v-if="selectionOutsideElkRange">
            <p class="step-caption step-caption--warn">
              <q-icon name="block" size="14px" />
              Outside elk range.
            </p>
            <p class="step-caption-hint">
              Pick an area in the Rocky Mountains, Pacific Northwest, or a known reintroduction pocket (PA, KY, TN, MI, WI, AR, NC).
            </p>
          </template>
          <p v-else class="step-caption">Box placed. Ready to analyze.</p>
          <button
            class="map-btn map-btn--primary"
            :disabled="selectionOutsideElkRange"
            @click="analyzeArea"
          >
            <q-icon name="auto_awesome" size="18px" />
            <span>Analyze Area</span>
          </button>
        </template>

        <template v-else-if="mode === 'analyzing'">
          <div class="analysis-loader" role="status" aria-live="polite">
            <div class="analysis-loader__topline">
              <span class="analysis-loader__signal" aria-hidden="true">
                <q-spinner-dots color="amber" size="18px" />
              </span>
              <span class="analysis-loader__title">Analyzing elk scenarios</span>
              <span class="analysis-loader__time">{{ analysisElapsedLabel }}</span>
            </div>
            <div class="analysis-loader__phase">
              <q-icon :name="currentAnalysisPhase.icon" size="14px" />
              <span>{{ currentAnalysisPhase.label }}</span>
            </div>
            <div class="analysis-loader__meter" aria-hidden="true">
              <span></span>
            </div>
            <p class="analysis-loader__hint">{{ analysisPatienceLabel }}</p>
          </div>
        </template>

        <template v-else-if="mode === 'done'">
          <p class="step-caption">
            <q-icon name="auto_awesome" size="14px" color="amber" />
            <strong>{{ aiPoisCount }}</strong>&nbsp;visible POIs
            <span v-if="fromCache" class="cache-badge">
              <q-icon name="bookmark" size="10px" />Saved
            </span>
          </p>
          <p class="step-caption-hint">
            {{ fromCache
              ? 'Loaded from a previous analysis of this area.'
              : 'Counts reflect the current map view.' }}
          </p>
          <div class="scenario-matrix" aria-label="Visible POIs by time of day and hunting pressure">
            <div class="scenario-matrix__label">Visible by scenario</div>
            <div class="scenario-matrix__grid">
              <div class="scenario-matrix__corner" aria-hidden="true"></div>
              <div
                v-for="pressure in pressureOptions"
                :key="pressure.value"
                class="scenario-matrix__head"
              >
                {{ pressure.label }}
              </div>
              <template v-for="time in timeOptions" :key="time.value">
                <div class="scenario-matrix__row-label">{{ time.label }}</div>
                <button
                  v-for="pressure in pressureOptions"
                  :key="`${time.value}-${pressure.value}`"
                  type="button"
                  class="scenario-matrix__cell"
                  :class="{
                    'scenario-matrix__cell--active': scenarioIsActive(time.value, pressure.value),
                    'scenario-matrix__cell--empty': scenarioCount(time.value, pressure.value) === 0,
                  }"
                  :aria-label="`${time.label} ${pressure.label}: ${scenarioCount(time.value, pressure.value)} visible POIs`"
                  @click="selectScenario(time.value, pressure.value)"
                >
                  {{ scenarioCount(time.value, pressure.value) || '-' }}
                </button>
              </template>
            </div>
          </div>
          <p class="step-disclaimer">
            High-probability terrain for the selected season, time, and pressure.
          </p>
          <button class="map-btn map-btn--primary" @click="beginAreaSelection">
            <q-icon name="restart_alt" size="14px" />
            Select Area
          </button>
        </template>

        <!-- Dev reset — wipes active analysis, kept POIs, deleted list, and selection -->
        <div v-if="keptCount > 0 || hasResults || selectionLocked || selectionActive" class="kept-pois-row">
          <span class="kept-pois-label">
            <template v-if="keptCount > 0">{{ keptCount }} saved POI{{ keptCount === 1 ? '' : 's' }}</template>
            <template v-else>reset map state</template>
          </span>
          <button class="kept-pois-clear" @click="clearKept" title="Clear everything: analysis, selection, saved POIs, deleted POIs">
            Clear All
          </button>
        </div>

        <!-- GPX import: drop pins for waypoints + grade them through existing POI logic -->
        <div class="gpx-section">
          <div class="gpx-row">
            <button
              class="gpx-btn"
              type="button"
              :disabled="!authStore.isAuthenticated || scoutWaypointsStore.importing"
              @click="openGpxFilePicker"
            >
              <q-icon name="upload_file" size="14px" />
              <span v-if="scoutWaypointsStore.importing">
                Analyzing
                <template v-if="scoutWaypointsStore.importProgress">
                  ({{ scoutWaypointsStore.importProgress.done }} / {{ scoutWaypointsStore.importProgress.total }})
                </template>
                …
              </span>
              <span v-else>Import GPX</span>
            </button>
            <button
              v-if="scoutWaypointsStore.waypoints.length > 0"
              class="gpx-clear"
              type="button"
              :disabled="scoutWaypointsStore.importing"
              :title="`Delete all ${scoutWaypointsStore.waypoints.length} imported waypoints`"
              @click="scoutWaypointsStore.clearAll"
            >
              <q-icon name="delete_sweep" size="14px" />
            </button>
          </div>
          <p v-if="scoutWaypointsStore.importError" class="gpx-error">
            {{ scoutWaypointsStore.importError }}
          </p>
          <p v-else-if="scoutWaypointsStore.waypoints.length > 0" class="gpx-status">
            {{ scoutWaypointsStore.waypoints.length }} imported waypoint{{ scoutWaypointsStore.waypoints.length === 1 ? '' : 's' }} on the map
          </p>
          <input
            ref="gpxFileInput"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            style="display: none"
            @change="onGpxFileChosen"
          />
        </div>

        <!-- Dev: inspect a single coordinate's terrain classification -->
        <div v-if="isDevBuild" class="inspect-section">
          <button class="inspect-toggle" type="button" @click="inspectExpanded = !inspectExpanded">
            <q-icon :name="inspectExpanded ? 'expand_less' : 'expand_more'" size="14px" />
            <span>Inspect point (dev)</span>
          </button>
          <div v-show="inspectExpanded" class="inspect-body">
            <div class="inspect-row">
              <input
                v-model="inspectCoords"
                class="inspect-input"
                type="text"
                inputmode="decimal"
                placeholder="lat, lng (e.g. 46.61943, -111.42553)"
                @keydown.enter="runInspect"
              />
              <button
                class="inspect-go"
                type="button"
                :disabled="inspectLoading"
                @click="runInspect"
              >
                <q-spinner v-if="inspectLoading" size="14px" />
                <span v-else>Run</span>
              </button>
            </div>
            <div class="inspect-spacing-row">
              <label class="inspect-spacing-label">cell spacing</label>
              <select v-model.number="inspectSpacing" class="inspect-input">
                <option :value="100">100m (very fine)</option>
                <option :value="200">200m (default — captures sharp peaks)</option>
                <option :value="400">400m (matches typical user analysis)</option>
                <option :value="600">600m</option>
                <option :value="800">800m (coarse)</option>
              </select>
            </div>
            <p v-if="inspectError" class="inspect-error">{{ inspectError }}</p>
            <div v-if="inspectResult" class="inspect-result">
              <div
                v-if="inspectPoiVerdict"
                class="inspect-verdict"
                :class="`inspect-verdict--${inspectPoiVerdict.tone}`"
              >
                <div class="inspect-verdict-head">
                  <q-icon :name="inspectPoiVerdict.icon" size="15px" />
                  <span>{{ inspectPoiVerdict.title }}</span>
                </div>
                <p class="inspect-verdict-summary">{{ inspectPoiVerdict.summary }}</p>
                <ul class="inspect-verdict-reasons">
                  <li v-for="reason in inspectPoiVerdict.supporting" :key="`support-${reason}`">
                    <span class="inspect-reason-tag inspect-reason-tag--yes">why</span>
                    <span>{{ reason }}</span>
                  </li>
                  <li v-for="reason in inspectPoiVerdict.limiting" :key="`limit-${reason}`">
                    <span class="inspect-reason-tag inspect-reason-tag--no">why not</span>
                    <span>{{ reason }}</span>
                  </li>
                </ul>
              </div>
              <div class="inspect-pt">
                <span>{{ inspectResult.point.elevationFt.toLocaleString() }} ft</span>
                <span>·</span>
                <span>{{ inspectResult.point.slope.toFixed(1) }}°</span>
                <span>·</span>
                <span>{{ inspectResult.point.aspect }}</span>
              </div>
              <ul class="inspect-features">
                <li
                  v-for="(f, key) in inspectResult.features"
                  :key="key"
                  :class="['inspect-feat', f.detected ? 'inspect-feat--yes' : 'inspect-feat--no']"
                >
                  <q-icon :name="f.detected ? 'check_circle' : 'cancel'" size="12px" />
                  <span class="inspect-feat-name">{{ inspectFeatureLabel(key) }}</span>
                  <span class="inspect-feat-reason">{{ f.reason }}</span>
                </li>
              </ul>
              <details class="inspect-neighbors">
                <summary>neighbor elevations (m)</summary>
                <table>
                  <tr>
                    <td>{{ inspectResult.neighbors.NW.toFixed(0) }}</td>
                    <td>{{ inspectResult.neighbors.N.toFixed(0) }}</td>
                    <td>{{ inspectResult.neighbors.NE.toFixed(0) }}</td>
                  </tr>
                  <tr>
                    <td>{{ inspectResult.neighbors.W.toFixed(0) }}</td>
                    <td class="inspect-self">{{ inspectResult.point.elevation.toFixed(0) }}</td>
                    <td>{{ inspectResult.neighbors.E.toFixed(0) }}</td>
                  </tr>
                  <tr>
                    <td>{{ inspectResult.neighbors.SW.toFixed(0) }}</td>
                    <td>{{ inspectResult.neighbors.S.toFixed(0) }}</td>
                    <td>{{ inspectResult.neighbors.SE.toFixed(0) }}</td>
                  </tr>
                </table>
              </details>
            </div>
          </div>
        </div>
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
        @click="toggleMeasure"
      >
        <q-icon name="straighten" size="16px" />
        <span class="layer-label">Measure</span>
      </button>
      <button
        class="layer-btn"
        :class="{ 'layer-btn--active': dropPinActive, 'layer-btn--disabled': dropPinDisabled }"
        :disabled="dropPinDisabled"
        :title="dropPinDisabled ? 'Sign in to drop pins' : (dropPinActive ? 'Exit drop mode (Esc)' : 'Drop pin')"
        :aria-pressed="dropPinActive"
        @click="toggleDropPin"
      >
        <q-icon name="add_location_alt" size="16px" />
        <span class="layer-label">Drop pin</span>
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

.inseason-page {
  min-height: inherit;
  background: #060a0f;
}

.inseason-page :deep(.inseason-plan-page) {
  min-height: calc(100vh - 56px);
}

.map-page :deep(.map-container) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.map-page--hunt-selecting :deep(.leaflet-container) {
  cursor: crosshair;
}

.map-page--inseason :deep(.leaflet-top.leaflet-left) {
  top: 64px;
}

.map-page--inseason :deep(.hover-tooltip) {
  top: 76px;
}

.map-page--inseason :deep(.poi-detail-panel) {
  top: 76px;
  max-height: calc(100vh - 160px);
}

.hunt-location-prompt {
  position: absolute;
  top: 76px;
  left: 50%;
  z-index: 1003;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(232, 197, 71, 0.55);
  border-radius: 7px;
  background: rgba(10, 14, 20, 0.94);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  color: var(--amber, #e8c547);
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  pointer-events: none;
  text-transform: uppercase;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* ─── Stepper Card ─── */
.stepper-card {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  width: 320px;
  max-height: calc(100vh - 92px);
  background: rgba(15, 25, 35, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
}

.stepper-track {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 44px 12px 14px; /* extra right padding reserves space for the collapse button */
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

.stepper-collapse-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #6b7c8d;
  cursor: pointer;
  transition: all 0.15s;
}

.stepper-collapse-btn:hover {
  background: rgba(200, 214, 229, 0.08);
  color: #c8d6e5;
}

.stepper-card--collapsed .stepper-track {
  border-bottom: none;
}

.stepper-card--inseason {
  top: 76px;
  max-height: calc(100vh - 156px);
}

.stepper-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.stepper-body::-webkit-scrollbar {
  width: 8px;
}

.stepper-body::-webkit-scrollbar-track {
  background: transparent;
}

.stepper-body::-webkit-scrollbar-thumb {
  background: rgba(200, 214, 229, 0.16);
  border-radius: 4px;
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

.analysis-loader {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(232, 197, 71, 0.22);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(232, 197, 71, 0.09), rgba(12, 18, 25, 0.32));
}

.analysis-loader__topline {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.analysis-loader__signal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(232, 197, 71, 0.12);
}

.analysis-loader__title {
  min-width: 0;
  color: #f1d66b;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.analysis-loader__time {
  color: #9fb0c2;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.analysis-loader__phase {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
  color: #c8d6e5;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.analysis-loader__phase .q-icon {
  color: #e8c547;
  flex: 0 0 auto;
}

.analysis-loader__meter {
  position: relative;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(200, 214, 229, 0.1);
}

.analysis-loader__meter span {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -45%;
  width: 45%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, #e8c547, transparent);
  animation: analysis-scan 1.45s ease-in-out infinite;
}

.analysis-loader__hint {
  margin: 0;
  color: #75889b;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.35;
}

.step-caption--warn {
  color: #ef4444;
  font-weight: 600;
}

.map-btn--primary:disabled {
  background: rgba(232, 197, 71, 0.25);
  color: #0a0e14;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
  opacity: 0.5;
}

.step-caption-hint {
  margin: -4px 0 4px;
  font-size: 11px;
  font-weight: 500;
  color: #6b7c8d;
  line-height: 1.4;
}

.scenario-matrix {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 2px 0 4px;
  padding: 9px;
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  background: rgba(8, 13, 20, 0.42);
}

.scenario-matrix__label {
  color: #8293a5;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.scenario-matrix__grid {
  display: grid;
  grid-template-columns: 48px repeat(4, minmax(0, 1fr));
  gap: 5px;
  align-items: center;
}

.scenario-matrix__corner {
  height: 20px;
}

.scenario-matrix__head,
.scenario-matrix__row-label {
  color: #708295;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.scenario-matrix__head {
  text-align: center;
}

.scenario-matrix__row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scenario-matrix__cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(232, 197, 71, 0.18);
  border-radius: 6px;
  background: rgba(232, 197, 71, 0.08);
  color: #f1d66b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.scenario-matrix__cell:hover {
  background: rgba(232, 197, 71, 0.14);
  border-color: rgba(232, 197, 71, 0.42);
}

.scenario-matrix__cell--active {
  border-color: #e8c547;
  box-shadow: 0 0 0 2px rgba(232, 197, 71, 0.16);
}

.scenario-matrix__cell--empty {
  border-color: rgba(200, 214, 229, 0.08);
  background: rgba(200, 214, 229, 0.035);
  color: #4f6072;
}

.scenario-matrix__cell--empty:hover {
  background: rgba(200, 214, 229, 0.07);
  border-color: rgba(200, 214, 229, 0.16);
  color: #7a8da0;
}

.scenario-matrix__cell--active.scenario-matrix__cell--empty {
  border-color: rgba(232, 197, 71, 0.65);
  color: #e8c547;
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

/* ─── GPX import ─── */
.gpx-section {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #1e2d3d;
}

.gpx-row {
  display: flex;
  gap: 6px;
}

.gpx-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #c8d6e5;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #1e2d3d;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.gpx-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: #2c4055;
  color: #fff;
}
.gpx-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.gpx-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  border-radius: 6px;
  cursor: pointer;
}
.gpx-clear:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}
.gpx-clear:disabled { opacity: 0.5; cursor: not-allowed; }

.gpx-error {
  font-size: 11px;
  color: #ff8a8a;
  margin: 6px 0 0;
  line-height: 1.4;
}

.gpx-status {
  font-size: 10.5px;
  color: #6b7c8d;
  margin: 6px 0 0;
}

/* ─── Dev: Inspect-point panel ─── */
.inspect-section {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #1e2d3d;
}

.inspect-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: transparent;
  border: none;
  color: #6b7c8d;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  font-family: inherit;
}
.inspect-toggle:hover { color: #c8d6e5; }

.inspect-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
  min-width: 0;
}

.inspect-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px;
}

.inspect-spacing-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.inspect-spacing-label {
  font-size: 10px;
  color: #6b7c8d;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.inspect-spacing-row .inspect-input {
  flex: 1;
}

.inspect-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #1e2d3d;
  border-radius: 5px;
  color: #c8d6e5;
  outline: none;
  min-width: 0;
}
.inspect-input:focus { border-color: #4a90e2; }

.inspect-go {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
}
.inspect-go:hover:not(:disabled) { background: #3b7cc4; }
.inspect-go:disabled { opacity: 0.6; cursor: not-allowed; }

.inspect-error {
  font-size: 11px;
  color: #ff8a8a;
  margin: 0;
  line-height: 1.4;
}

.inspect-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.inspect-verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px;
  border: 1px solid #25384a;
  border-radius: 8px;
  background: rgba(7, 12, 18, 0.42);
  color: #9fb0c2;
  min-width: 0;
}

.inspect-verdict--yes {
  border-color: rgba(143, 218, 163, 0.28);
  background: rgba(34, 197, 94, 0.07);
}

.inspect-verdict--no {
  border-color: rgba(148, 163, 184, 0.24);
}

.inspect-verdict-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c8d6e5;
  font-weight: 800;
  font-size: 11.5px;
}

.inspect-verdict--yes .inspect-verdict-head {
  color: #9ff0b5;
}

.inspect-verdict-summary {
  margin: 0;
  color: #93a6b8;
  font-size: 10.5px;
  line-height: 1.45;
}

.inspect-verdict-reasons {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
}

.inspect-verdict-reasons li {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
  color: #8496a8;
  line-height: 1.35;
  min-width: 0;
}

.inspect-reason-tag {
  display: inline-flex;
  justify-content: center;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.inspect-reason-tag--yes {
  color: #9ff0b5;
  background: rgba(34, 197, 94, 0.12);
}

.inspect-reason-tag--no {
  color: #9fb0c2;
  background: rgba(148, 163, 184, 0.11);
}

.inspect-pt {
  display: flex;
  gap: 6px;
  color: #c8d6e5;
  font-weight: 600;
}

.inspect-features {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.inspect-feat {
  display: grid;
  grid-template-columns: 14px 78px minmax(0, 1fr);
  align-items: start;
  gap: 6px;
  font-size: 10.5px;
  line-height: 1.4;
  color: #8899aa;
  min-width: 0;
}

.inspect-feat--yes { color: #8fdaa3; }
.inspect-feat--no { color: #6b7c8d; }

.inspect-feat-name {
  font-weight: 700;
  text-transform: lowercase;
}
.inspect-feat-reason {
  font-family: inherit;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.inspect-neighbors {
  font-size: 10px;
  color: #7a8d9c;
}
.inspect-neighbors summary {
  cursor: pointer;
  user-select: none;
}
.inspect-neighbors table {
  margin: 4px 0 0;
  border-collapse: collapse;
}
.inspect-neighbors td {
  padding: 3px 8px;
  text-align: center;
  border: 1px solid #1e2d3d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.inspect-neighbors .inspect-self {
  background: rgba(74, 144, 226, 0.12);
  color: #c8d6e5;
  font-weight: 700;
}

.kept-pois-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #1e2d3d;
  font-size: 10.5px;
  font-weight: 500;
  color: #6b7c8d;
}

.kept-pois-label {
  letter-spacing: 0.02em;
}

.kept-pois-clear {
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.06);
  color: #ef4444;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}

.kept-pois-clear:hover {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.45);
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

@keyframes analysis-scan {
  0% { transform: translateX(0); }
  100% { transform: translateX(322%); }
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

.layer-btn--disabled,
.layer-btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.layer-btn--disabled:hover,
.layer-btn[disabled]:hover {
  background: transparent;
  color: #6b7c8d;
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

<!-- Unscoped: Leaflet divIcon HTML lives outside Vue's scope-id rewrites. -->
<style>
.inspect-marker-leaflet {
  background: transparent;
  border: none;
}
.hunt-location-marker-leaflet {
  background: transparent;
  border: none;
}
.hunt-location-marker {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #e8c547;
  border-radius: 50% 50% 50% 4px;
  background: rgba(10, 14, 20, 0.94);
  box-shadow: 0 0 0 3px rgba(232, 197, 71, 0.18), 0 6px 18px rgba(0, 0, 0, 0.5);
  color: #e8c547;
  pointer-events: none;
  transform: rotate(-45deg);
}
.hunt-location-marker .material-symbols-outlined {
  font-size: 18px;
  transform: rotate(45deg);
}
.inspect-marker {
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
  animation: inspect-marker-pulse 1.6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes inspect-marker-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}
</style>
