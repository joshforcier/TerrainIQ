import { ref, computed, watch, onUnmounted, type ShallowRef } from 'vue'
import type L from 'leaflet'
import type { PointOfInterest } from '@/data/pointsOfInterest'
import { useMapStore } from '@/stores/map'
import { useAuthStore } from '@/stores/auth'
import { useAnalysisStore } from '@/stores/analysis'
import type { SelectionBounds } from './useSelectionBox'
import type { Season, TimeOfDay } from '@/data/elkBehavior'
import type { HuntingPressure } from '@/stores/map'

export type AnalyzedArea = SelectionBounds

export type AnalysisUnitPolygon = {
  type: 'Polygon' | 'MultiPolygon' | 'Feature'
  coordinates?: unknown
  geometry?: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: unknown
  }
  properties?: Record<string, unknown>
}

type ComboKey = `${TimeOfDay}_${HuntingPressure}`

function comboKey(timeOfDay: TimeOfDay, pressure: HuntingPressure): ComboKey {
  return `${timeOfDay}_${pressure}`
}

function hasMaxPressureCombos(combos: Record<string, PointOfInterest[]>): boolean {
  return ['dawn_max', 'midday_max', 'dusk_max'].every((key) => Array.isArray(combos[key]))
}

function boundsFromMap(map: L.Map): SelectionBounds {
  const bounds = map.getBounds()
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  }
}

export function useAIPois(map: ShallowRef<L.Map | null>) {
  const mapStore = useMapStore()
  const authStore = useAuthStore()
  const analysisStore = useAnalysisStore()

  /** All 9 time×pressure POI sets, keyed like "dawn_low" */
  const allCombos = ref<Record<string, PointOfInterest[]>>({})

  const loading = ref(false)
  const error = ref<string | null>(null)
  const errorCode = ref<string | null>(null)
  const analyzedArea = ref<AnalyzedArea | null>(null)
  const analyzedSeason = ref<Season | null>(null)
  /** True when the current results came from cache (not a fresh API call) */
  const fromCache = ref(false)

  /** Whether we have analysis results loaded */
  const hasResults = computed(() => (
    analyzedSeason.value === mapStore.season && Object.keys(allCombos.value).length > 0
  ))

  /** The active POI set for the current time + pressure selection */
  const pois = computed<PointOfInterest[]>(() => {
    if (!hasResults.value) return []
    const key = comboKey(mapStore.timeOfDay, mapStore.huntingPressure)
    return allCombos.value[key] ?? []
  })

  function hydrateCombos(raw: Record<string, PointOfInterest[]>): Record<string, PointOfInterest[]> {
    const combos: Record<string, PointOfInterest[]> = {}
    for (const [key, rawPois] of Object.entries(raw || {})) {
      combos[key] = (rawPois as PointOfInterest[]).map((poi, i) => ({
        ...poi,
        id: poi.id ?? `ai-poi-${key}-${Date.now()}-${i}`,
      }))
    }
    return combos
  }

  function loadSavedAnalysisIntoMap(selectionBounds: SelectionBounds, options: { replaceActive?: boolean } = {}): boolean {
    if (loading.value && !options.replaceActive) return false
    if (hasResults.value && !options.replaceActive) return false
    const cached = analysisStore.findOverlapping(selectionBounds, mapStore.season)
    if (!cached || !hasMaxPressureCombos(cached.combos)) return false

    allCombos.value = hydrateCombos(cached.combos)
    analyzedArea.value = cached.bounds
    analyzedSeason.value = cached.season
    fromCache.value = true
    return true
  }

  function loadSavedAnalysisForCurrentMap() {
    if (!map.value) return
    loadSavedAnalysisIntoMap(boundsFromMap(map.value))
  }

  async function generatePOIs(selectionBounds: SelectionBounds, unitPolygon?: AnalysisUnitPolygon) {
    if (!map.value) return

    loading.value = true
    error.value = null
    errorCode.value = null
    fromCache.value = false

    try {
      // Cache hit: load from Firestore instead of calling the API.
      const cached = unitPolygon ? null : analysisStore.findOverlapping(selectionBounds, mapStore.season)
      if (cached && hasMaxPressureCombos(cached.combos)) {
        loadSavedAnalysisIntoMap(selectionBounds, { replaceActive: true })
        return
      }

      // The /api/generate-pois endpoint requires a Firebase ID token.
      const idToken = await authStore.user?.getIdToken().catch(() => null)
      if (!idToken) {
        throw new Error('Sign in required to run an analysis')
      }

      const res = await fetch('/api/generate-pois', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          bounds: selectionBounds,
          season: mapStore.season,
          bufferMiles: mapStore.bufferMiles,
          unitPolygon,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 402 && body.code === 'LIMIT_EXCEEDED') {
          // Decorate the Error so callers (MapView) can branch on it.
          const limitErr = new Error(
            body.error || 'Monthly analysis limit reached.',
          ) as Error & { code?: string }
          limitErr.code = 'LIMIT_EXCEEDED'
          throw limitErr
        }
        throw new Error(body.error || `Server error: ${res.status}`)
      }

      const data = await res.json()
      const combos = hydrateCombos(data.combos || {})

      allCombos.value = combos
      analyzedArea.value = selectionBounds
      analyzedSeason.value = mapStore.season
      fromCache.value = Boolean(data.fromCache)

      // Persist for future sessions (silent failure — don't block the user).
      if (authStore.user?.uid && !unitPolygon) {
        analysisStore.saveAnalysis({
          userId: authStore.user.uid,
          bounds: selectionBounds,
          season: mapStore.season,
          bufferMiles: mapStore.bufferMiles,
          combos,
        })
      }
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to generate POIs'
      errorCode.value = (err as { code?: string } | null)?.code ?? null
      console.error('AI POI generation failed:', err)
    } finally {
      loading.value = false
    }
  }

  function clearPOIs() {
    allCombos.value = {}
    analyzedArea.value = null
    analyzedSeason.value = null
    error.value = null
    errorCode.value = null
    fromCache.value = false
  }

  function clearError() {
    error.value = null
    errorCode.value = null
  }

  watch(
    () => [map.value, analysisStore.savedAnalyses.length, mapStore.season] as const,
    () => loadSavedAnalysisForCurrentMap(),
    { immediate: true },
  )

  watch(
    () => mapStore.season,
    () => {
      if (loading.value) return
      if (!hasResults.value) {
        allCombos.value = {}
        analyzedArea.value = null
        analyzedSeason.value = null
        fromCache.value = false
      }
      loadSavedAnalysisForCurrentMap()
    },
  )

  watch(
    () => map.value,
    (current, previous) => {
      if (previous) previous.off('moveend zoomend', loadSavedAnalysisForCurrentMap)
      if (current) current.on('moveend zoomend', loadSavedAnalysisForCurrentMap)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    map.value?.off('moveend zoomend', loadSavedAnalysisForCurrentMap)
  })

  return {
    pois,
    allCombos,
    hasResults,
    loading,
    error,
    errorCode,
    analyzedArea,
    fromCache,
    generatePOIs,
    clearPOIs,
    clearError,
  }
}
