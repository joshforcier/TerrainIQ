import { fetchElevationGrid, fetchElevationRaster, type ElevationGrid } from './elevation.js'
import {
  computeRasterMetrics,
  computeSlopeAspect,
  rasterToElevationGrid,
  type RasterMetrics,
  type TerrainAnalysis,
  type TerrainPoint,
} from './terrainAnalysis.js'
import type { RasterDataset } from './elevation3DEP.js'

type Bounds = { north: number; south: number; east: number; west: number }

export interface TerrainMetricPoint extends TerrainPoint {
  localRelief: number
  elevationBand: 'low' | 'mid' | 'high'
}

export interface TerrainCandidate {
  lat: number
  lng: number
  score: number
  elevation: number
  slope: number
  aspect: string
  localRelief: number
  reason: string
}

export interface HighResolutionTerrainMetrics {
  grid: ElevationGrid
  points: TerrainMetricPoint[]
  terrainNote: string
  stagingBenches: TerrainCandidate[]
  glassingPositions: TerrainCandidate[]
}

const HIGH_RES_TARGET_CELL_M = 90
const HIGH_RES_MIN_GRID = 60
const HIGH_RES_MAX_GRID = 96
const RELIEF_RADIUS_CELLS = 2
const NATIVE_RASTER_TARGET_M = 10
const NATIVE_RASTER_MAX_SIDE = 1400
const NATIVE_RASTER_MAX_PIXELS = 1_250_000
const METRIC_CACHE_TTL_MS = 30 * 60 * 1000
const METRIC_CACHE_MAX = 8

const metricCache = new Map<string, { value: HighResolutionTerrainMetrics; expiresAt: number }>()

export function computeHighResolutionGridSize(bounds: Bounds): number {
  const centerLat = (bounds.north + bounds.south) / 2
  const widthM = (bounds.east - bounds.west) * 111_000 * Math.cos((centerLat * Math.PI) / 180)
  const heightM = (bounds.north - bounds.south) * 111_000
  const maxSpan = Math.max(widthM, heightM)
  return Math.max(HIGH_RES_MIN_GRID, Math.min(HIGH_RES_MAX_GRID, Math.round(maxSpan / HIGH_RES_TARGET_CELL_M)))
}

export async function fetchHighResolutionTerrainMetrics(bounds: Bounds): Promise<HighResolutionTerrainMetrics> {
  const cacheKey = highResCacheKey(bounds)
  const cached = metricCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    console.log('High-resolution terrain metrics cache hit')
    return cached.value
  }

  try {
    const raster = await fetchElevationRaster(bounds, {
      targetPixelSizeMeters: NATIVE_RASTER_TARGET_M,
      maxSidePixels: NATIVE_RASTER_MAX_SIDE,
      maxPixels: NATIVE_RASTER_MAX_PIXELS,
    })
    const metrics = computeRasterMetrics(raster, { reliefRadiusMeters: 100 })
    const result = computeHighResolutionTerrainMetricsFromRaster(raster, metrics)
    rememberMetrics(cacheKey, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`Native 3DEP raster terrain failed, falling back to sampled grid: ${message}`)
    const grid = await fetchElevationGrid(bounds, computeHighResolutionGridSize(bounds))
    const result = computeHighResolutionTerrainMetrics(grid)
    rememberMetrics(cacheKey, result)
    return result
  }
}

export function computeHighResolutionTerrainMetricsFromRaster(
  raster: RasterDataset,
  metrics: RasterMetrics,
): HighResolutionTerrainMetrics {
  const grid = rasterToElevationGrid(raster, computeHighResolutionGridSize(raster.bounds), 'bilinear')
  const terrainPoints = computeSlopeAspect(grid)
  const points = terrainPoints.map((point) => ({
    ...point,
    localRelief: sampleMetricAtLatLng(raster, metrics.localRelief, point.lat, point.lng),
    elevationBand: bandToLabel(sampleBandAtLatLng(raster, metrics.elevationBands, point.lat, point.lng)),
  }))
  const stagingBenches = scoreRasterStagingBenches(raster, metrics).slice(0, 10)
  const glassingPositions = scoreRasterGlassingPositions(raster, metrics).slice(0, 10)
  const validRelief = Array.from(metrics.localRelief).filter((value) => value > 0)
  const avgRelief = validRelief.length
    ? validRelief.reduce((sum, value) => sum + value, 0) / validRelief.length
    : 0

  return {
    grid,
    points,
    stagingBenches,
    glassingPositions,
    terrainNote: [
      `Native 3DEP raster terrain pass: ${raster.width}x${raster.height} pixels at ~${raster.actualPixelSizeMeters.toFixed(1)}m/pixel.`,
      `Raster local relief avg ${avgRelief.toFixed(1)}m; elevation range ${Math.round(metrics.minElevation)}-${Math.round(metrics.maxElevation)}m.`,
      formatCandidateSummary('Top elk staging benches', stagingBenches),
      formatCandidateSummary('Top glassing positions', glassingPositions),
    ].join('\n'),
  }
}

export function computeHighResolutionTerrainMetrics(grid: ElevationGrid): HighResolutionTerrainMetrics {
  const terrainPoints = computeSlopeAspect(grid)
  const points = terrainPoints.map((point, index) => ({
    ...point,
    localRelief: computeLocalRelief(grid, index, RELIEF_RADIUS_CELLS),
    elevationBand: getElevationBand(point.elevation, grid),
  }))

  const stagingBenches = scoreStagingBenches(points, grid).slice(0, 10)
  const glassingPositions = scoreGlassingPositions(points, grid).slice(0, 10)
  const avgRelief = points.reduce((sum, point) => sum + point.localRelief, 0) / Math.max(points.length, 1)

  return {
    grid,
    points,
    stagingBenches,
    glassingPositions,
    terrainNote: [
      `High-resolution terrain pass: ${grid.rows}x${grid.cols} samples from elevation source.`,
      `Local relief avg ${avgRelief.toFixed(1)}m; elevation bands low/mid/high split across ${Math.round(grid.minElevation)}-${Math.round(grid.maxElevation)}m.`,
      formatCandidateSummary('Top elk staging benches', stagingBenches),
      formatCandidateSummary('Top glassing positions', glassingPositions),
    ].filter(Boolean).join('\n'),
  }
}

export function appendHighResolutionTerrainNote(
  terrain: TerrainAnalysis,
  metrics: HighResolutionTerrainMetrics | null,
): TerrainAnalysis {
  if (!metrics) return terrain
  return {
    ...terrain,
    elkHabitatNotes: `${terrain.elkHabitatNotes}\n\n${metrics.terrainNote}`,
  }
}

function computeLocalRelief(grid: ElevationGrid, index: number, radius: number): number {
  const row = Math.floor(index / grid.cols)
  const col = index % grid.cols
  let min = Infinity
  let max = -Infinity

  for (let r = Math.max(0, row - radius); r <= Math.min(grid.rows - 1, row + radius); r++) {
    for (let c = Math.max(0, col - radius); c <= Math.min(grid.cols - 1, col + radius); c++) {
      const elevation = grid.points[r * grid.cols + c].elevation
      if (!Number.isFinite(elevation)) continue
      min = Math.min(min, elevation)
      max = Math.max(max, elevation)
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? Math.max(0, max - min) : 0
}

function getElevationBand(elevation: number, grid: ElevationGrid): TerrainMetricPoint['elevationBand'] {
  const range = Math.max(1, grid.maxElevation - grid.minElevation)
  const normalized = (elevation - grid.minElevation) / range
  if (normalized < 0.33) return 'low'
  if (normalized < 0.66) return 'mid'
  return 'high'
}

function scoreStagingBenches(points: TerrainMetricPoint[], grid: ElevationGrid): TerrainCandidate[] {
  return points
    .map((point, index) => {
      const slopeScore = scoreRange(point.slope, 4, 14, 8)
      const reliefScore = scoreRange(point.localRelief, 12, 70, 35)
      const elevationBandScore = point.elevationBand === 'mid' ? 1 : 0.55
      const aspectScore = ['N', 'NE', 'E', 'SE', 'S', 'SW'].includes(point.aspectLabel) ? 1 : 0.75
      const edgePenalty = edgeFactor(index, grid)
      const score = 100 * slopeScore * reliefScore * elevationBandScore * aspectScore * edgePenalty
      return toCandidate(point, score, `mid-slope shelf signal: ${point.slope}° slope, ${point.localRelief.toFixed(0)}m local relief, ${point.elevationBand} elevation band`)
    })
    .filter((candidate) => candidate.score >= 35)
    .sort((a, b) => b.score - a.score)
}

function scoreGlassingPositions(points: TerrainMetricPoint[], grid: ElevationGrid): TerrainCandidate[] {
  return points
    .map((point, index) => {
      const prominenceScore = scoreRange(point.localRelief, 35, 140, 85)
      const slopeScore = scoreRange(point.slope, 8, 32, 18)
      const elevationScore = point.elevationBand === 'high' ? 1 : point.elevationBand === 'mid' ? 0.7 : 0.35
      const edgePenalty = edgeFactor(index, grid)
      const score = 100 * prominenceScore * slopeScore * elevationScore * edgePenalty
      return toCandidate(point, score, `visibility/prominence signal: ${point.localRelief.toFixed(0)}m local relief, ${point.elevationBand} elevation band, ${point.slope}° slope`)
    })
    .filter((candidate) => candidate.score >= 35)
    .sort((a, b) => b.score - a.score)
}

function scoreRange(value: number, min: number, max: number, ideal: number): number {
  if (value < min || value > max) return 0
  const width = Math.max(ideal - min, max - ideal)
  return Math.max(0, 1 - Math.abs(value - ideal) / Math.max(width, 1))
}

function edgeFactor(index: number, grid: ElevationGrid): number {
  const row = Math.floor(index / grid.cols)
  const col = index % grid.cols
  return row < 2 || col < 2 || row > grid.rows - 3 || col > grid.cols - 3 ? 0.5 : 1
}

function toCandidate(point: TerrainMetricPoint, score: number, reason: string): TerrainCandidate {
  return {
    lat: point.lat,
    lng: point.lng,
    score: Math.round(score),
    elevation: point.elevation,
    slope: point.slope,
    aspect: point.aspectLabel,
    localRelief: point.localRelief,
    reason,
  }
}

function formatCandidateSummary(label: string, candidates: TerrainCandidate[]): string {
  if (candidates.length === 0) return `${label}: none above scoring threshold.`
  const formatted = candidates.slice(0, 5).map((candidate) =>
    `${candidate.lat.toFixed(5)},${candidate.lng.toFixed(5)} score ${candidate.score} (${candidate.reason})`,
  )
  return `${label}: ${formatted.join('; ')}`
}

function scoreRasterStagingBenches(raster: RasterDataset, metrics: RasterMetrics): TerrainCandidate[] {
  const candidates: TerrainCandidate[] = []
  const stride = raster.actualPixelSizeMeters <= 15 ? 2 : 1

  for (let row = 2; row < raster.height - 2; row += stride) {
    for (let col = 2; col < raster.width - 2; col += stride) {
      const index = row * raster.width + col
      if (metrics.nodataMask[index]) continue
      const slope = metrics.slope[index]
      const localRelief = metrics.localRelief[index]
      const elevationBand = metrics.elevationBands[index]
      const aspect = metrics.aspect[index]
      const slopeScore = scoreRange(slope, 4, 14, 8)
      const reliefScore = scoreRange(localRelief, 10, 70, 32)
      const bandScore = elevationBand === 1 ? 1 : 0.55
      const aspectScore = isBenchAspect(aspect) ? 1 : 0.75
      const score = 100 * slopeScore * reliefScore * bandScore * aspectScore
      if (score < 35) continue
      candidates.push(toRasterCandidate(raster, row, col, score, slope, aspect, localRelief, `native raster shelf signal: ${slope.toFixed(1)}° slope, ${localRelief.toFixed(0)}m local relief, ${bandToLabel(elevationBand)} elevation band`))
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function scoreRasterGlassingPositions(raster: RasterDataset, metrics: RasterMetrics): TerrainCandidate[] {
  const candidates: TerrainCandidate[] = []
  const stride = raster.actualPixelSizeMeters <= 15 ? 3 : 1

  for (let row = 2; row < raster.height - 2; row += stride) {
    for (let col = 2; col < raster.width - 2; col += stride) {
      const index = row * raster.width + col
      if (metrics.nodataMask[index]) continue
      const slope = metrics.slope[index]
      const localRelief = metrics.localRelief[index]
      const elevationBand = metrics.elevationBands[index]
      const prominenceScore = scoreRange(localRelief, 30, 150, 80)
      const slopeScore = scoreRange(slope, 6, 34, 18)
      const bandScore = elevationBand === 2 ? 1 : elevationBand === 1 ? 0.7 : 0.35
      const score = 100 * prominenceScore * slopeScore * bandScore
      if (score < 35) continue
      candidates.push(toRasterCandidate(raster, row, col, score, slope, metrics.aspect[index], localRelief, `native raster prominence signal: ${localRelief.toFixed(0)}m local relief, ${bandToLabel(elevationBand)} elevation band, ${slope.toFixed(1)}° slope`))
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function toRasterCandidate(
  raster: RasterDataset,
  row: number,
  col: number,
  score: number,
  slope: number,
  aspect: number,
  localRelief: number,
  reason: string,
): TerrainCandidate {
  const lat = raster.bounds.north - (row / Math.max(raster.height - 1, 1)) * (raster.bounds.north - raster.bounds.south)
  const lng = raster.bounds.west + (col / Math.max(raster.width - 1, 1)) * (raster.bounds.east - raster.bounds.west)
  const index = row * raster.width + col
  return {
    lat,
    lng,
    score: Math.round(score),
    elevation: raster.data[index],
    slope: Math.round(slope * 10) / 10,
    aspect: aspectLabel(aspect),
    localRelief: Math.round(localRelief * 10) / 10,
    reason,
  }
}

function sampleMetricAtLatLng(raster: RasterDataset, values: Float32Array, lat: number, lng: number): number {
  const index = rasterIndexAtLatLng(raster, lat, lng)
  return index >= 0 ? values[index] : 0
}

function sampleBandAtLatLng(raster: RasterDataset, values: Uint8Array, lat: number, lng: number): number {
  const index = rasterIndexAtLatLng(raster, lat, lng)
  return index >= 0 ? values[index] : 0
}

function rasterIndexAtLatLng(raster: RasterDataset, lat: number, lng: number): number {
  if (lat < raster.bounds.south || lat > raster.bounds.north || lng < raster.bounds.west || lng > raster.bounds.east) return -1
  const col = Math.max(0, Math.min(raster.width - 1, Math.round(((lng - raster.bounds.west) / (raster.bounds.east - raster.bounds.west)) * (raster.width - 1))))
  const row = Math.max(0, Math.min(raster.height - 1, Math.round(((raster.bounds.north - lat) / (raster.bounds.north - raster.bounds.south)) * (raster.height - 1))))
  return row * raster.width + col
}

function bandToLabel(band: number): TerrainMetricPoint['elevationBand'] {
  if (band === 0) return 'low'
  if (band === 1) return 'mid'
  return 'high'
}

function isBenchAspect(aspect: number): boolean {
  const label = aspectLabel(aspect)
  return ['N', 'NE', 'E', 'SE', 'S', 'SW'].includes(label)
}

function aspectLabel(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return 'N'
  if (deg < 67.5) return 'NE'
  if (deg < 112.5) return 'E'
  if (deg < 157.5) return 'SE'
  if (deg < 202.5) return 'S'
  if (deg < 247.5) return 'SW'
  if (deg < 292.5) return 'W'
  return 'NW'
}

function highResCacheKey(bounds: Bounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => value.toFixed(5)).join(',')
}

function rememberMetrics(key: string, value: HighResolutionTerrainMetrics): void {
  if (metricCache.size >= METRIC_CACHE_MAX) {
    const oldest = metricCache.keys().next().value
    if (oldest) metricCache.delete(oldest)
  }
  metricCache.set(key, { value, expiresAt: Date.now() + METRIC_CACHE_TTL_MS })
}