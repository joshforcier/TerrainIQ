import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  collection,
  doc,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/config/firebase'
import { useAuthStore } from './auth'
import type {
  AnalysisResult,
  AnalysisBounds,
  SavedAnalysis,
} from '@/types/analysis'
import type { Season } from '@/data/elkBehavior'
import type { PointOfInterest } from '@/data/pointsOfInterest'

const OVERLAP_THRESHOLD = 0.8
const CACHE_SCHEMA_VERSION = 8

function bboxIntersect(a: AnalysisBounds, b: AnalysisBounds): AnalysisBounds | null {
  const north = Math.min(a.north, b.north)
  const south = Math.max(a.south, b.south)
  const east = Math.min(a.east, b.east)
  const west = Math.max(a.west, b.west)
  if (north <= south || east <= west) return null
  return { north, south, east, west }
}

function approxArea(b: AnalysisBounds): number {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180)
  return (b.north - b.south) * (b.east - b.west) * Math.cos(midLat)
}

function overlapRatio(a: AnalysisBounds, b: AnalysisBounds): number {
  const inter = bboxIntersect(a, b)
  if (!inter) return 0
  const interArea = approxArea(inter)
  const minArea = Math.min(approxArea(a), approxArea(b))
  return minArea === 0 ? 0 : interArea / minArea
}

function poiCoordKey(poi: Pick<PointOfInterest, 'lat' | 'lng'>): string {
  return `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`
}

export const useAnalysisStore = defineStore('analysis', () => {
  // ── Legacy in-memory results (kept for AnalysisView compatibility) ──
  const results = ref<AnalysisResult[]>([])
  const isAnalyzing = ref(false)

  function addResult(result: AnalysisResult) {
    results.value.push(result)
  }

  function clearResults() {
    results.value = []
  }

  // ── Persisted analyses (Firestore-backed) ──
  const savedAnalyses = ref<SavedAnalysis[]>([])
  const savedLoading = ref(false)
  const savedError = ref<string | null>(null)

  async function loadSaved(userId: string) {
    savedLoading.value = true
    savedError.value = null
    try {
      const q = query(collection(db, 'analyses'), where('userId', '==', userId))
      const snap = await getDocs(q)
      savedAnalyses.value = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          userId: data.userId,
          bounds: data.bounds,
          season: data.season,
          bufferMiles: data.bufferMiles,
          combos: data.combos,
          cacheVersion: data.cacheVersion ?? 1,
          createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
        } as SavedAnalysis
      })
    } catch (err: unknown) {
      savedError.value = err instanceof Error ? err.message : 'Failed to load analyses'
      console.error('loadSaved error:', err)
    } finally {
      savedLoading.value = false
    }
  }

  function clearSaved() {
    savedAnalyses.value = []
    savedError.value = null
  }

  async function saveAnalysis(params: {
    userId: string
    bounds: AnalysisBounds
    season: Season
    bufferMiles: number
    combos: Record<string, PointOfInterest[]>
  }): Promise<SavedAnalysis | null> {
    try {
      const ref = await addDoc(collection(db, 'analyses'), {
        userId: params.userId,
        bounds: params.bounds,
        season: params.season,
        bufferMiles: params.bufferMiles,
        combos: params.combos,
        cacheVersion: CACHE_SCHEMA_VERSION,
        createdAt: serverTimestamp(),
      })
      const saved: SavedAnalysis = {
        id: ref.id,
        userId: params.userId,
        bounds: params.bounds,
        season: params.season,
        bufferMiles: params.bufferMiles,
        combos: params.combos,
        cacheVersion: CACHE_SCHEMA_VERSION,
        createdAt: Date.now(),
      }
      savedAnalyses.value.push(saved)
      return saved
    } catch (err: unknown) {
      savedError.value = err instanceof Error ? err.message : 'Failed to save analysis'
      console.error('saveAnalysis error:', err)
      return null
    }
  }

  async function deleteSavedPoi(poi: PointOfInterest): Promise<void> {
    const authStore = useAuthStore()
    const uid = authStore.user?.uid
    if (!uid) return

    const targetCoord = poiCoordKey(poi)
    const updates: Promise<void>[] = []
    const nextSavedAnalyses = savedAnalyses.value.map((analysis) => {
      if (analysis.userId !== uid) return analysis

      let changed = false
      const combos: Record<string, PointOfInterest[]> = {}
      for (const [key, pois] of Object.entries(analysis.combos || {})) {
        const filtered = pois.filter((candidate) => {
          const samePoi = candidate.id === poi.id || poiCoordKey(candidate) === targetCoord
          if (samePoi) changed = true
          return !samePoi
        })
        combos[key] = filtered
      }

      if (!changed) return analysis
      updates.push(updateDoc(doc(db, 'analyses', analysis.id), { combos }))
      return { ...analysis, combos }
    })

    if (updates.length === 0) return
    savedAnalyses.value = nextSavedAnalyses
    try {
      await Promise.all(updates)
    } catch (err: unknown) {
      savedError.value = err instanceof Error ? err.message : 'Failed to delete saved POI'
      console.error('deleteSavedPoi error:', err)
      await loadSaved(uid)
      throw err
    }
  }

  function findOverlapping(bounds: AnalysisBounds, season: Season): SavedAnalysis | null {
    let best: SavedAnalysis | null = null
    let bestRatio = OVERLAP_THRESHOLD
    for (const a of savedAnalyses.value) {
      if ((a.cacheVersion ?? 1) !== CACHE_SCHEMA_VERSION) continue
      if (a.season !== season) continue
      const ratio = overlapRatio(a.bounds, bounds)
      if (ratio >= bestRatio) {
        best = a
        bestRatio = ratio
      }
    }
    return best
  }

  // ── Sync with auth state ──
  const authStore = useAuthStore()
  watch(
    () => authStore.user?.uid ?? null,
    (uid) => {
      if (uid) {
        loadSaved(uid)
      } else {
        clearSaved()
      }
    },
    { immediate: true },
  )

  return {
    // Legacy
    results,
    isAnalyzing,
    addResult,
    clearResults,
    // Persisted
    savedAnalyses,
    savedLoading,
    savedError,
    saveAnalysis,
    deleteSavedPoi,
    findOverlapping,
    loadSaved,
  }
})
