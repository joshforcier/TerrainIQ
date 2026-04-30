import {
  booleanIntersects,
  booleanPointInPolygon,
  lineIntersect,
  lineString,
  point,
  polygonToLine,
} from '@turf/turf'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { OSMLandData, OSMFeature } from '../routes/overpass.js'
import type { FireHistoryFeature } from './fireHistory.js'

export type UnitPolygon = Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon

export interface ClipStats {
  before: number
  after: number
}

export interface ClippedLandDataResult {
  landData: OSMLandData
  stats: Record<keyof OSMLandData, ClipStats>
}

export interface ClippedFireHistoryResult {
  fires: FireHistoryFeature[]
  stats: ClipStats
}

type LatLng = { lat: number; lng: number }

const MIN_FEATURE_POINTS = 1

export function normalizeUnitPolygon(input: unknown): Feature<Polygon | MultiPolygon> | null {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<Feature<Polygon | MultiPolygon>> & Partial<Polygon | MultiPolygon>
  const geometry = candidate.type === 'Feature' ? candidate.geometry : candidate

  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null

  return {
    type: 'Feature',
    properties: {},
    geometry: geometry as Polygon | MultiPolygon,
  }
}

export function clipLandDataToPolygon(
  landData: OSMLandData,
  unitPolygon: Feature<Polygon | MultiPolygon>,
): ClippedLandDataResult {
  const clipped = {} as OSMLandData
  const stats = {} as Record<keyof OSMLandData, ClipStats>

  for (const key of Object.keys(landData) as Array<keyof OSMLandData>) {
    const features = landData[key]
    const clippedFeatures = features
      .map((feature) => clipOsmFeatureToPolygon(feature, unitPolygon))
      .filter((feature): feature is OSMFeature => feature !== null)

    clipped[key] = clippedFeatures as OSMLandData[typeof key]
    stats[key] = { before: features.length, after: clippedFeatures.length }
  }

  return { landData: clipped, stats }
}

export function clipFireHistoryToPolygon(
  fires: FireHistoryFeature[],
  unitPolygon: Feature<Polygon | MultiPolygon>,
): ClippedFireHistoryResult {
  const clipped = fires
    .map((fire) => {
      const geometry = clipGeometryToPolygon(fire.geometry, unitPolygon)
      if (geometry.length < MIN_FEATURE_POINTS) return null
      return { ...fire, geometry }
    })
    .filter((fire): fire is FireHistoryFeature => fire !== null)

  return {
    fires: clipped,
    stats: { before: fires.length, after: clipped.length },
  }
}

export function summarizeClipStats(
  landStats: Record<keyof OSMLandData, ClipStats>,
  fireStats?: ClipStats,
): string {
  const parts = (Object.entries(landStats) as Array<[keyof OSMLandData, ClipStats]>)
    .filter(([, stat]) => stat.before !== stat.after)
    .map(([key, stat]) => `${key} ${stat.before}->${stat.after}`)

  if (fireStats && fireStats.before !== fireStats.after) {
    parts.push(`fires ${fireStats.before}->${fireStats.after}`)
  }

  return parts.length > 0 ? parts.join(', ') : 'no vector counts changed'
}

function clipOsmFeatureToPolygon(
  feature: OSMFeature,
  unitPolygon: Feature<Polygon | MultiPolygon>,
): OSMFeature | null {
  const geometry = clipGeometryToPolygon(feature.geometry, unitPolygon)
  if (geometry.length < MIN_FEATURE_POINTS) return null
  return { ...feature, geometry }
}

function clipGeometryToPolygon(
  geometry: LatLng[],
  unitPolygon: Feature<Polygon | MultiPolygon>,
): LatLng[] {
  const validGeometry = geometry.filter(isFiniteLatLng)
  if (validGeometry.length === 0) return []

  if (validGeometry.length === 1) {
    return booleanPointInPolygon(point(toPosition(validGeometry[0])), unitPolygon)
      ? validGeometry
      : []
  }

  const line = lineString(validGeometry.map(toPosition))
  if (!booleanIntersects(line, unitPolygon)) return []

  const kept: LatLng[] = []
  const boundary = polygonToLine(unitPolygon)

  for (let index = 0; index < validGeometry.length - 1; index++) {
    const start = validGeometry[index]
    const end = validGeometry[index + 1]
    const startInside = booleanPointInPolygon(point(toPosition(start)), unitPolygon, { ignoreBoundary: false })
    const endInside = booleanPointInPolygon(point(toPosition(end)), unitPolygon, { ignoreBoundary: false })
    const segmentIntersections = lineIntersect(lineString([toPosition(start), toPosition(end)]), boundary)
      .features
      .map((feature) => fromPosition(feature.geometry.coordinates))

    if (startInside) kept.push(start)
    for (const intersection of segmentIntersections) kept.push(intersection)
    if (endInside) kept.push(end)
  }

  return dedupeConsecutivePoints(kept)
}

function isFiniteLatLng(pointLike: LatLng): boolean {
  return Number.isFinite(pointLike.lat) && Number.isFinite(pointLike.lng)
}

function toPosition(pointLike: LatLng): Position {
  return [pointLike.lng, pointLike.lat]
}

function fromPosition(position: Position): LatLng {
  return { lng: position[0], lat: position[1] }
}

function dedupeConsecutivePoints(points: LatLng[]): LatLng[] {
  const deduped: LatLng[] = []
  for (const pointLike of points) {
    const previous = deduped[deduped.length - 1]
    if (!previous || previous.lat !== pointLike.lat || previous.lng !== pointLike.lng) {
      deduped.push(pointLike)
    }
  }
  return deduped
}