import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DEFAULT_INSPECTION_CELL_SPACING_M,
  DEFAULT_INSPECTION_GRID_SIZE,
  inspectTerrainCoordinate,
  type TerrainFeatureName,
} from '../services/terrainInspection.js'

function isElevationProviderUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes('VITE_MAPBOX_TOKEN is not set') ||
    message.includes('USGS 3DEP exportImage returned 5') ||
    message.includes('USGS 3DEP returned non-TIFF response')
  )
}

interface TerrainFeatureFixture {
  id: string
  lat: number
  lng: number
  expectedFeatures: TerrainFeatureName[]
  absentFeatures?: TerrainFeatureName[]
  cellSpacingM?: number
  gridSize?: number
  requiresMapboxFallback?: boolean
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'terrain-feature-coordinates.json',
)

async function loadFixtures(): Promise<TerrainFeatureFixture[]> {
  const raw = await readFile(fixturePath, 'utf8')
  return JSON.parse(raw) as TerrainFeatureFixture[]
}

test('terrain feature coordinate fixtures classify as expected', async (t) => {
  const fixtures = await loadFixtures()
  if (fixtures.length === 0) {
    t.skip('No terrain feature coordinate fixtures configured yet')
    return
  }

  for (const fixture of fixtures) {
    await t.test(fixture.id, async (subtest) => {
      if (fixture.requiresMapboxFallback && !process.env.VITE_MAPBOX_TOKEN) {
        subtest.skip('Fixture requires Mapbox Terrain-RGB fallback; VITE_MAPBOX_TOKEN is not set')
        return
      }

      const result = await inspectTerrainCoordinate(fixture.lat, fixture.lng, {
        cellSpacingM: fixture.cellSpacingM ?? DEFAULT_INSPECTION_CELL_SPACING_M,
        gridSize: fixture.gridSize ?? DEFAULT_INSPECTION_GRID_SIZE,
      }).catch((err: unknown) => {
        if (isElevationProviderUnavailable(err)) {
          subtest.skip(`Elevation provider unavailable: ${err instanceof Error ? err.message : String(err)}`)
          return null
        }
        throw err
      })
      if (!result) return

      for (const feature of fixture.expectedFeatures) {
        assert.equal(
          result.inspection.features[feature].detected,
          true,
          `${fixture.id} expected ${feature}; reason: ${result.inspection.features[feature].reason}`,
        )
      }

      const absentFeatures = fixture.absentFeatures ?? (
        fixture.expectedFeatures.length === 0
          ? Object.keys(result.inspection.features) as TerrainFeatureName[]
          : []
      )

      for (const feature of absentFeatures) {
        assert.equal(
          result.inspection.features[feature].detected,
          false,
          `${fixture.id} expected not ${feature}; reason: ${result.inspection.features[feature].reason}`,
        )
      }
    })
  }
})
