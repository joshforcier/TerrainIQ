import { fetchElevationGrid } from './elevation.js'
import {
  computeSlopeAspect,
  inspectTerrainAt,
  type PointInspection,
} from './terrainAnalysis.js'

export type { PointInspection } from './terrainAnalysis.js'

export type TerrainFeatureName = keyof PointInspection['features']

export const DEFAULT_INSPECTION_CELL_SPACING_M = 200
export const DEFAULT_INSPECTION_GRID_SIZE = 31

export interface TerrainInspectionOptions {
  cellSpacingM?: number
  gridSize?: number
}

export interface TerrainInspectionResult {
  inspection: PointInspection
  meta: {
    gridSize: number
    cellSpacingM: number
    bounds: { south: number; north: number; west: number; east: number }
  }
}

export function validateInspectionGridSize(gridSize: number): void {
  if (gridSize < 31 || gridSize > 71) {
    throw new Error('gridSize must be between 31 and 71')
  }
}

export function validateInspectionCoordinate(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Missing lat/lng (numbers required)')
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('lat/lng out of valid range')
  }
}

export async function inspectTerrainCoordinate(
  lat: number,
  lng: number,
  options: TerrainInspectionOptions = {},
): Promise<TerrainInspectionResult> {
  validateInspectionCoordinate(lat, lng)
  const cellSpacingM = options.cellSpacingM ?? DEFAULT_INSPECTION_CELL_SPACING_M
  const gridSize = options.gridSize ?? DEFAULT_INSPECTION_GRID_SIZE
  validateInspectionGridSize(gridSize)

  const halfExtent = (gridSize - 1) / 2
  const latStep = cellSpacingM / 111_000
  const lngStep = cellSpacingM / (111_000 * Math.cos((lat * Math.PI) / 180))
  const bounds = {
    south: lat - halfExtent * latStep,
    north: lat + halfExtent * latStep,
    west: lng - halfExtent * lngStep,
    east: lng + halfExtent * lngStep,
  }

  const elevGrid = await fetchElevationGrid(bounds, gridSize)
  const terrainPoints = computeSlopeAspect(elevGrid)
  const inspection = inspectTerrainAt(terrainPoints, elevGrid, halfExtent, halfExtent)
  if (!inspection) throw new Error('center cell out of grid bounds')

  return {
    inspection,
    meta: { gridSize, cellSpacingM, bounds },
  }
}