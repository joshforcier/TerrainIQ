import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.js'

export interface AnalysisCacheBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface CachedPointOfInterest {
  id?: string
  name?: string
  lat: number
  lng: number
  type?: string
  relatedBehaviors?: string[]
  description?: string
  elevation?: number
  elevationFt?: string
  slope?: number
  aspect?: string
  reasoningWhyHere?: string
  reasoningWhyNotElsewhere?: string
}

export type CachedCombos = Record<string, CachedPointOfInterest[]>

export const ANALYSIS_CACHE_VERSION = 9
export const ANALYSIS_CACHE_TTL_DAYS = 30

const METERS_PER_MILE = 1609.34
const OVERLAP_THRESHOLD = 0.8
const CACHE_COLLECTION = 'analysisCache'

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

function milesWide(bounds: AnalysisCacheBounds): number {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180)
  return ((bounds.east - bounds.west) * 111320 * Math.cos(midLat)) / METERS_PER_MILE
}

function milesHigh(bounds: AnalysisCacheBounds): number {
  return ((bounds.north - bounds.south) * 111320) / METERS_PER_MILE
}

function bboxIntersect(a: AnalysisCacheBounds, b: AnalysisCacheBounds): AnalysisCacheBounds | null {
  const north = Math.min(a.north, b.north)
  const south = Math.max(a.south, b.south)
  const east = Math.min(a.east, b.east)
  const west = Math.max(a.west, b.west)
  if (north <= south || east <= west) return null
  return { north, south, east, west }
}

function approxArea(bounds: AnalysisCacheBounds): number {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180)
  return (bounds.north - bounds.south) * (bounds.east - bounds.west) * Math.cos(midLat)
}

function overlapRatio(a: AnalysisCacheBounds, b: AnalysisCacheBounds): number {
  const intersection = bboxIntersect(a, b)
  if (!intersection) return 0
  const minArea = Math.min(approxArea(a), approxArea(b))
  return minArea === 0 ? 0 : approxArea(intersection) / minArea
}

function createdAtMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const maybeTimestamp = value as { toMillis?: () => number }
  return typeof maybeTimestamp.toMillis === 'function' ? maybeTimestamp.toMillis() : null
}

function isFresh(createdAt: unknown): boolean {
  const millis = createdAtMillis(createdAt)
  if (!millis) return false
  const maxAgeMs = ANALYSIS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  return Date.now() - millis <= maxAgeMs
}

export function analysisCacheKey(params: {
  bounds: AnalysisCacheBounds
  season: string
  bufferMiles: number
}): string {
  const centerLat = (params.bounds.north + params.bounds.south) / 2
  const centerLng = (params.bounds.east + params.bounds.west) / 2
  const parts = [
    `v${ANALYSIS_CACHE_VERSION}`,
    params.season,
    `buf${params.bufferMiles.toFixed(2)}`,
    `lat${roundToStep(centerLat, 0.005).toFixed(3)}`,
    `lng${roundToStep(centerLng, 0.005).toFixed(3)}`,
    `w${roundToStep(milesWide(params.bounds), 0.25).toFixed(2)}`,
    `h${roundToStep(milesHigh(params.bounds), 0.25).toFixed(2)}`,
  ]
  return parts.join('_').replace(/[^a-zA-Z0-9_.-]/g, '_')
}

export async function getAnalysisCache(params: {
  bounds: AnalysisCacheBounds
  season: string
  bufferMiles: number
}): Promise<CachedCombos | null> {
  const key = analysisCacheKey(params)
  const snap = await adminDb.collection(CACHE_COLLECTION).doc(key).get()
  if (!snap.exists) return null

  const data = snap.data() as {
    cacheVersion?: number
    bounds?: AnalysisCacheBounds
    combos?: CachedCombos
    createdAt?: unknown
  } | undefined

  if (!data) return null
  if (data.cacheVersion !== ANALYSIS_CACHE_VERSION) return null
  if (!data.bounds || overlapRatio(data.bounds, params.bounds) < OVERLAP_THRESHOLD) return null
  if (!isFresh(data.createdAt)) return null
  if (!data.combos || Object.keys(data.combos).length === 0) return null

  return data.combos
}

export async function saveAnalysisCache(params: {
  bounds: AnalysisCacheBounds
  season: string
  bufferMiles: number
  combos: CachedCombos
}): Promise<void> {
  const key = analysisCacheKey(params)
  await adminDb.collection(CACHE_COLLECTION).doc(key).set({
    cacheVersion: ANALYSIS_CACHE_VERSION,
    ttlDays: ANALYSIS_CACHE_TTL_DAYS,
    season: params.season,
    bufferMiles: params.bufferMiles,
    bounds: params.bounds,
    combos: params.combos,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })
}
