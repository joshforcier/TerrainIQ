import type { Response } from 'express'
import type { AuthedRequest } from '../middleware/auth.js'
import {
  DEFAULT_INSPECTION_CELL_SPACING_M,
  DEFAULT_INSPECTION_GRID_SIZE,
  inspectTerrainCoordinate,
  validateInspectionCoordinate,
  validateInspectionGridSize,
} from '../services/terrainInspection.js'

/**
 * Dev-only diagnostic: given a single lat/lng, fetch a small elevation
 * grid centered on the point and run the terrain feature detection on
 * the center cell. Returns structured pass/fail reasons for each feature
 * type so we can debug "why isn't this saddle being labeled?" questions.
 *
 * Auth-protected to avoid casual abuse of the underlying elevation
 * services, but no usage quota — this is a read-only diagnostic.
 */
export async function inspectPoint(req: AuthedRequest, res: Response) {
  const { lat, lng, cellSpacingM, gridSize } = req.body as {
    lat?: number
    lng?: number
    cellSpacingM?: number
    gridSize?: number
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    res.status(400).json({ error: 'Missing lat/lng (numbers required)' })
    return
  }
  try {
    validateInspectionCoordinate(lat, lng)
  } catch (err) {
    res.status(400).json({ error: 'lat/lng out of valid range' })
    return
  }

  // Defaults: 200m cell spacing × 31×31 grid → 6km square bbox with a 3km
  // saddle search radius (15 cells). 200m sampling captures sharp peaks
  // that 400m would smooth over via bilinear interpolation; 3km reach is
  // local-enough to avoid catching regional cross-valley topology.
  const spacing = cellSpacingM ?? DEFAULT_INSPECTION_CELL_SPACING_M
  const size = gridSize ?? DEFAULT_INSPECTION_GRID_SIZE
  try {
    validateInspectionGridSize(size)
  } catch (err) {
    res.status(400).json({ error: 'gridSize must be between 31 and 71' })
    return
  }

  try {
    const result = await inspectTerrainCoordinate(lat, lng, { cellSpacingM: spacing, gridSize: size })
    res.json({ ...result.inspection, meta: result.meta })
  } catch (err: unknown) {
    console.error('inspectPoint error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Inspection failed' })
  }
}
