/**
 * Elevation data from Mapbox Terrain-RGB raster tiles.
 *
 * Each pixel in a Terrain-RGB tile encodes elevation in meters:
 *   elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
 *
 * A handful of CDN-cached tile fetches replaces hundreds of point queries
 * to Open-Meteo and gives ~30m/pixel resolution at typical hunting-area zooms.
 *
 * Docs: https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
 */

import { PNG } from 'pngjs'

export interface ElevationPoint {
  lat: number
  lng: number
  elevation: number // meters above sea level
}

export interface ElevationGrid {
  points: ElevationPoint[]
  rows: number
  cols: number
  minElevation: number
  maxElevation: number
  avgElevation: number
}

export type ElevationBounds = { north: number; south: number; east: number; west: number }

const TILE_SIZE = 256
const MIN_ZOOM = 10
const MAX_ZOOM = 14
const MAX_TILES = 36 // hard safety cap to avoid runaway fetches on huge bboxes

function lngLatToTile(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = Math.pow(2, z)
  const x = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/**
 * Pick a zoom level that yields ~2-4 tiles across the bbox: enough pixel
 * resolution to beat the old 90m Copernicus DEM without firing dozens of
 * tile fetches. Clamped to MIN/MAX_ZOOM.
 */
function chooseZoom(bounds: {
  north: number
  south: number
  east: number
  west: number
}): number {
  const latSpan = Math.abs(bounds.north - bounds.south)
  const lngSpan = Math.abs(bounds.east - bounds.west)
  const maxSpan = Math.max(latSpan, lngSpan) || 0.01
  const z = Math.floor(Math.log2(360 / maxSpan)) + 1
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

async function fetchTile(
  x: number,
  y: number,
  z: number,
  token: string,
): Promise<PNG> {
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Mapbox Terrain-RGB ${z}/${x}/${y} returned ${res.status}`,
    )
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return new Promise((resolve, reject) => {
    new PNG().parse(buf, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function decodeElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

/**
 * Mapbox Terrain-RGB implementation. Used directly for non-US bboxes, and
 * as the fallback when USGS 3DEP fails (network error, nodata-heavy grid,
 * or coverage gap).
 */
export async function fetchElevationGridMapbox(
  bounds: { north: number; south: number; east: number; west: number },
  gridSize = 20,
): Promise<ElevationGrid> {
  const token = process.env.VITE_MAPBOX_TOKEN
  if (!token) {
    throw new Error(
      'VITE_MAPBOX_TOKEN is not set — required for Mapbox Terrain-RGB elevation data.',
    )
  }

  const z = chooseZoom(bounds)

  const nw = lngLatToTile(bounds.west, bounds.north, z)
  const se = lngLatToTile(bounds.east, bounds.south, z)
  const xMin = Math.floor(Math.min(nw.x, se.x))
  const xMax = Math.floor(Math.max(nw.x, se.x))
  const yMin = Math.floor(Math.min(nw.y, se.y))
  const yMax = Math.floor(Math.max(nw.y, se.y))

  const numTiles = (xMax - xMin + 1) * (yMax - yMin + 1)
  if (numTiles > MAX_TILES) {
    throw new Error(
      `Elevation bbox too large: would require ${numTiles} tiles at zoom ${z} (max ${MAX_TILES}).`,
    )
  }

  console.log(
    `Mapbox Terrain-RGB: fetching ${numTiles} tile(s) at zoom ${z}`,
  )

  const tilePromises: Array<Promise<{ x: number; y: number; png: PNG }>> = []
  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      tilePromises.push(
        fetchTile(tx, ty, z, token).then(png => ({ x: tx, y: ty, png })),
      )
    }
  }
  const tiles = await Promise.all(tilePromises)
  const tileMap = new Map<string, PNG>()
  for (const t of tiles) tileMap.set(`${t.x}/${t.y}`, t.png)

  const points: ElevationPoint[] = []
  const latStep = (bounds.north - bounds.south) / (gridSize - 1)
  const lngStep = (bounds.east - bounds.west) / (gridSize - 1)

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const lat = bounds.south + row * latStep
      const lng = bounds.west + col * lngStep
      const { x: xf, y: yf } = lngLatToTile(lng, lat, z)
      const tileX = Math.min(xMax, Math.max(xMin, Math.floor(xf)))
      const tileY = Math.min(yMax, Math.max(yMin, Math.floor(yf)))
      const png = tileMap.get(`${tileX}/${tileY}`)
      let elevation = 0
      if (png) {
        const px = Math.min(
          TILE_SIZE - 1,
          Math.max(0, Math.floor((xf - tileX) * TILE_SIZE)),
        )
        const py = Math.min(
          TILE_SIZE - 1,
          Math.max(0, Math.floor((yf - tileY) * TILE_SIZE)),
        )
        const idx = (py * png.width + px) * 4
        elevation = decodeElevation(
          png.data[idx],
          png.data[idx + 1],
          png.data[idx + 2],
        )
      }
      points.push({ lat, lng, elevation })
    }
  }

  const validElev = points
    .map(p => p.elevation)
    .filter(e => e > -500 && e < 9000)
  const minElevation = validElev.length ? Math.min(...validElev) : 0
  const maxElevation = validElev.length ? Math.max(...validElev) : 0
  const avgElevation = validElev.length
    ? validElev.reduce((a, b) => a + b, 0) / validElev.length
    : 0

  return {
    points,
    rows: gridSize,
    cols: gridSize,
    minElevation,
    maxElevation,
    avgElevation,
  }
}

/**
 * Public entry point. Routes to USGS 3DEP for US bboxes (LiDAR-derived,
 * sub-meter vertical accuracy in most of CONUS), falls back to Mapbox
 * Terrain-RGB on any 3DEP failure or for non-US areas.
 *
 * The signature and return type are unchanged from the previous
 * Mapbox-only implementation, so callers don't need to know which source
 * answered.
 */
export async function fetchElevationGrid(
  bounds: ElevationBounds,
  gridSize = 20,
): Promise<ElevationGrid> {
  // Lazy imports keep the Mapbox path free of `geotiff` overhead when
  // analyses are outside US coverage.
  const { isInUSCoverage, fetchElevationGrid3DEP } = await import('./elevation3DEP.js')
  let usgsFailureMessage: string | null = null

  if (isInUSCoverage(bounds)) {
    try {
      const grid = await fetchElevationGrid3DEP(bounds, gridSize)
      console.log(
        `Elevation source: USGS 3DEP (${grid.minElevation.toFixed(0)}–${grid.maxElevation.toFixed(0)} m)`,
      )
      return grid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      usgsFailureMessage = msg
      console.warn(`USGS 3DEP failed, falling back to Mapbox: ${msg}`)
    }
  }

  if (usgsFailureMessage && !process.env.VITE_MAPBOX_TOKEN) {
    throw new Error(
      `USGS 3DEP unavailable (${usgsFailureMessage}); VITE_MAPBOX_TOKEN is not set — required for Mapbox Terrain-RGB fallback elevation data.`,
    )
  }

  const grid = await fetchElevationGridMapbox(bounds, gridSize)
  console.log(
    `Elevation source: Mapbox Terrain-RGB (${grid.minElevation.toFixed(0)}–${grid.maxElevation.toFixed(0)} m)`,
  )
  return grid
}

export async function fetchElevationRaster(
  bounds: ElevationBounds,
  options: { targetPixelSizeMeters?: number; maxSidePixels?: number; maxPixels?: number } = {},
) {
  const { isInUSCoverage, fetch3DEPRaster } = await import('./elevation3DEP.js')
  if (!isInUSCoverage(bounds)) {
    throw new Error('Native USGS 3DEP raster is only available inside US coverage')
  }

  const raster = await fetch3DEPRaster(bounds, options)
  console.log(
    `Elevation source: USGS 3DEP native raster (${raster.width}x${raster.height}, ~${raster.actualPixelSizeMeters.toFixed(1)}m/pixel, ${(raster.nodataRatio * 100).toFixed(1)}% nodata)`,
  )
  return raster
}
