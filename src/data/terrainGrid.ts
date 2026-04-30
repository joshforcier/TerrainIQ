import type { BehaviorLayer } from './elkBehavior'

export interface TerrainCell {
  lat: number
  lng: number
  scores: Record<BehaviorLayer, number>
}

/**
 * Seeded pseudo-random number generator for deterministic terrain.
 */
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Simplex-like noise approximation using layered sine waves.
 * Produces smooth, terrain-like variation across the grid.
 */
function terrainNoise(lat: number, lng: number, seed: number, scale: number): number {
  const x = lng * scale
  const y = lat * scale
  const s = seed
  let val =
    Math.sin(x * 1.7 + s) * Math.cos(y * 2.3 + s * 0.7) * 0.35 +
    Math.sin(x * 4.1 + y * 3.2 + s * 1.3) * 0.25 +
    Math.cos(x * 7.9 - y * 5.1 + s * 2.1) * 0.2 +
    Math.sin(x * 13.0 + y * 11.0 + s * 3.7) * 0.12 +
    Math.cos(x * 19.0 - y * 17.0 + s * 5.3) * 0.08
  // Normalize to 0–1
  val = (val + 1) / 2
  return Math.max(0, Math.min(1, val))
}

/**
 * Generates a grid of terrain cells with per-behavior scores.
 * Each behavior gets a unique noise pattern so the heatmap
 * looks distinct when switching layers.
 *
 * Center: Flat Tops Wilderness area, Colorado (~39.95, -107.15)
 */
export function generateTerrainGrid(
  centerLat = 39.955,
  centerLng = -107.14,
  gridSize = 40,
  cellSpacing = 0.002
): TerrainCell[] {
  const cells: TerrainCell[] = []
  const rand = seededRandom(42)
  const halfGrid = gridSize / 2

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const lat = centerLat + (row - halfGrid) * cellSpacing
      const lng = centerLng + (col - halfGrid) * cellSpacing

      // Each behavior has a unique noise seed and scale for distinct patterns
      const feeding = terrainNoise(lat, lng, 1.0, 800) * (0.7 + rand() * 0.3)
      const water = terrainNoise(lat, lng, 2.5, 1200) * (0.6 + rand() * 0.4)
      const bedding = terrainNoise(lat, lng, 4.0, 600) * (0.65 + rand() * 0.35)
      const wallows = terrainNoise(lat, lng, 6.5, 1500) * (0.5 + rand() * 0.5)
      const travel = terrainNoise(lat, lng, 8.0, 900) * (0.6 + rand() * 0.4)
      const security = terrainNoise(lat, lng, 10.5, 700) * (0.7 + rand() * 0.3)

      cells.push({
        lat,
        lng,
        scores: {
          feeding: Math.max(0, Math.min(1, feeding)),
          water: Math.max(0, Math.min(1, water)),
          bedding: Math.max(0, Math.min(1, bedding)),
          wallows: Math.max(0, Math.min(1, wallows)),
          travel: Math.max(0, Math.min(1, travel)),
          security: Math.max(0, Math.min(1, security)),
        },
      })
    }
  }

  return cells
}

/**
 * Compute the composite score for a cell given active behaviors and their weights.
 */
export function computeCellScore(
  cell: TerrainCell,
  activeBehaviors: BehaviorLayer[],
  weights: Record<BehaviorLayer, number>
): number {
  if (activeBehaviors.length === 0) return 0
  let total = 0
  let weightSum = 0
  for (const behavior of activeBehaviors) {
    const w = weights[behavior]
    total += cell.scores[behavior] * w
    weightSum += w
  }
  return weightSum > 0 ? total / weightSum : 0
}
