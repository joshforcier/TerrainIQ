/**
 * Terrain analysis — combines real elevation data with OSM land cover
 * to produce a detailed terrain profile for AI POI placement.
 *
 * Computes: slope, aspect, elevation bands, ridgelines, drainages,
 * saddle candidates, and terrain classifications.
 *
 * Elk habitat logic derived from:
 *   - Bedding slope/aspect preferences per season
 *   - Feeding-to-bedding transition zone identification (100-400m band)
 *   - Thermal wind patterns (morning uphill, evening downhill)
 *   - Water proximity requirements by season (rut: <400m, post-rut: less critical, late: snow replaces)
 *   - Escape route viability (2+ exit routes from bedding)
 */

import type { ElevationGrid, ElevationPoint } from './elevation'
import type { RasterDataset } from './elevation3DEP.js'
import type { OSMLandData } from '../routes/overpass'
import type { FireHistoryFeature } from './fireHistory'

// ─── Slope & Aspect ──────────────────────────────────────────

export interface TerrainPoint extends ElevationPoint {
  slope: number        // degrees 0-90
  aspect: number       // degrees 0-360 (0=N, 90=E, 180=S, 270=W)
  aspectLabel: string  // 'N', 'NE', 'E', etc.
}

export interface RasterMetrics {
  slope: Float32Array
  aspect: Float32Array
  localRelief: Float32Array
  elevationBands: Uint8Array
  nodataMask: Uint8Array
  minElevation: number
  maxElevation: number
}

export function computeRasterMetrics(
  raster: RasterDataset,
  options: { reliefRadiusMeters?: number } = {},
): RasterMetrics {
  const reliefRadiusMeters = options.reliefRadiusMeters ?? 120
  const { slope, aspect, nodataMask } = computeRasterSlopeAspect(raster)
  const localRelief = computeRasterLocalRelief(raster, reliefRadiusMeters)
  const { bands: elevationBands, minElevation, maxElevation } = computeElevationBandsFromRaster(raster)
  return { slope, aspect, localRelief, elevationBands, nodataMask, minElevation, maxElevation }
}

export function computeRasterSlopeAspect(raster: RasterDataset): Pick<RasterMetrics, 'slope' | 'aspect' | 'nodataMask'> {
  const { width, height, data } = raster
  const slope = new Float32Array(data.length)
  const aspect = new Float32Array(data.length)
  const nodataMask = new Uint8Array(raster.nodataMask)

  for (let row = 0; row < height; row++) {
    const lat = raster.bounds.north - (row + 0.5) * raster.pixelSizeDegreesY
    const cellSizeX = Math.max(1, Math.abs(raster.pixelSizeDegreesX) * 111_320 * Math.cos((lat * Math.PI) / 180))
    const cellSizeY = Math.max(1, raster.pixelSizeMetersY)

    for (let col = 0; col < width; col++) {
      const index = row * width + col
      const leftIndex = row * width + Math.max(0, col - 1)
      const rightIndex = row * width + Math.min(width - 1, col + 1)
      const upIndex = Math.max(0, row - 1) * width + col
      const downIndex = Math.min(height - 1, row + 1) * width + col

      if (nodataMask[index] || nodataMask[leftIndex] || nodataMask[rightIndex] || nodataMask[upIndex] || nodataMask[downIndex]) {
        nodataMask[index] = 1
        slope[index] = 0
        aspect[index] = 0
        continue
      }

      const dzdx = (data[rightIndex] - data[leftIndex]) / (2 * cellSizeX)
      const dzdy = (data[upIndex] - data[downIndex]) / (2 * cellSizeY)
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI)
      let aspectDeg = Math.atan2(-dzdx, -dzdy) * (180 / Math.PI)
      if (aspectDeg < 0) aspectDeg += 360
      slope[index] = slopeDeg
      aspect[index] = aspectDeg
    }
  }

  return { slope, aspect, nodataMask }
}

export function computeRasterLocalRelief(raster: RasterDataset, radiusMeters: number): Float32Array {
  const { width, height, data, nodataMask } = raster
  const relief = new Float32Array(data.length)
  const radiusX = Math.max(1, Math.round(radiusMeters / Math.max(1, raster.pixelSizeMetersX)))
  const radiusY = Math.max(1, Math.round(radiusMeters / Math.max(1, raster.pixelSizeMetersY)))

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col
      if (nodataMask[index]) continue
      let min = Infinity
      let max = -Infinity
      for (let sampleRow = Math.max(0, row - radiusY); sampleRow <= Math.min(height - 1, row + radiusY); sampleRow++) {
        for (let sampleCol = Math.max(0, col - radiusX); sampleCol <= Math.min(width - 1, col + radiusX); sampleCol++) {
          const sampleIndex = sampleRow * width + sampleCol
          if (nodataMask[sampleIndex]) continue
          const elevation = data[sampleIndex]
          min = Math.min(min, elevation)
          max = Math.max(max, elevation)
        }
      }
      relief[index] = Number.isFinite(min) && Number.isFinite(max) ? Math.max(0, max - min) : 0
    }
  }

  return relief
}

export function computeElevationBandsFromRaster(raster: RasterDataset): { bands: Uint8Array; minElevation: number; maxElevation: number } {
  const bands = new Uint8Array(raster.data.length)
  let minElevation = Infinity
  let maxElevation = -Infinity
  for (let index = 0; index < raster.data.length; index++) {
    if (raster.nodataMask[index]) continue
    minElevation = Math.min(minElevation, raster.data[index])
    maxElevation = Math.max(maxElevation, raster.data[index])
  }
  if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) {
    return { bands, minElevation: 0, maxElevation: 0 }
  }

  const range = Math.max(1, maxElevation - minElevation)
  for (let index = 0; index < raster.data.length; index++) {
    if (raster.nodataMask[index]) continue
    const normalized = (raster.data[index] - minElevation) / range
    bands[index] = normalized < 0.33 ? 0 : normalized < 0.66 ? 1 : 2
  }
  return { bands, minElevation, maxElevation }
}

export function rasterToElevationGrid(
  raster: RasterDataset,
  gridSize: number,
  method: 'nearest' | 'bilinear' = 'bilinear',
): ElevationGrid {
  const points: ElevationPoint[] = []
  const rows = gridSize
  const cols = gridSize
  const latStep = (raster.bounds.north - raster.bounds.south) / (rows - 1)
  const lngStep = (raster.bounds.east - raster.bounds.west) / (cols - 1)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lat = raster.bounds.south + row * latStep
      const lng = raster.bounds.west + col * lngStep
      points.push({ lat, lng, elevation: sampleRaster(raster, lat, lng, method) })
    }
  }

  const valid = points.map((point) => point.elevation).filter((elevation) => elevation > -500 && elevation < 9000)
  const minElevation = valid.length ? Math.min(...valid) : 0
  const maxElevation = valid.length ? Math.max(...valid) : 0
  const avgElevation = valid.length ? valid.reduce((sum, elevation) => sum + elevation, 0) / valid.length : 0

  return { points, rows, cols, minElevation, maxElevation, avgElevation }
}

function sampleRaster(raster: RasterDataset, lat: number, lng: number, method: 'nearest' | 'bilinear'): number {
  const x = ((lng - raster.bounds.west) / (raster.bounds.east - raster.bounds.west)) * (raster.width - 1)
  const y = ((raster.bounds.north - lat) / (raster.bounds.north - raster.bounds.south)) * (raster.height - 1)
  if (method === 'nearest') {
    return sampleRasterNearest(raster, x, y)
  }

  const x0 = Math.max(0, Math.min(raster.width - 1, Math.floor(x)))
  const x1 = Math.max(0, Math.min(raster.width - 1, x0 + 1))
  const y0 = Math.max(0, Math.min(raster.height - 1, Math.floor(y)))
  const y1 = Math.max(0, Math.min(raster.height - 1, y0 + 1))
  const wx = x - x0
  const wy = y - y0
  const samples = [
    { index: y0 * raster.width + x0, weight: (1 - wx) * (1 - wy) },
    { index: y0 * raster.width + x1, weight: wx * (1 - wy) },
    { index: y1 * raster.width + x0, weight: (1 - wx) * wy },
    { index: y1 * raster.width + x1, weight: wx * wy },
  ]
  let weighted = 0
  let totalWeight = 0
  for (const sample of samples) {
    if (raster.nodataMask[sample.index]) continue
    weighted += raster.data[sample.index] * sample.weight
    totalWeight += sample.weight
  }
  return totalWeight > 0 ? weighted / totalWeight : sampleRasterNearest(raster, x, y)
}

function sampleRasterNearest(raster: RasterDataset, x: number, y: number): number {
  const col = Math.max(0, Math.min(raster.width - 1, Math.round(x)))
  const row = Math.max(0, Math.min(raster.height - 1, Math.round(y)))
  const index = row * raster.width + col
  return raster.nodataMask[index] ? 0 : raster.data[index]
}

export function computeSlopeAspect(
  grid: ElevationGrid
): TerrainPoint[] {
  const { points, rows, cols } = grid
  const results: TerrainPoint[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const pt = points[idx]

      const left = c > 0 ? points[idx - 1].elevation : pt.elevation
      const right = c < cols - 1 ? points[idx + 1].elevation : pt.elevation
      const up = r < rows - 1 ? points[idx + cols].elevation : pt.elevation
      const down = r > 0 ? points[idx - cols].elevation : pt.elevation

      const cellSizeLat = r < rows - 1
        ? haversineDist(pt.lat, pt.lng, points[idx + cols].lat, points[idx + cols].lng)
        : r > 0
          ? haversineDist(pt.lat, pt.lng, points[idx - cols].lat, points[idx - cols].lng)
          : 200

      const cellSizeLng = c < cols - 1
        ? haversineDist(pt.lat, pt.lng, points[idx + 1].lat, points[idx + 1].lng)
        : c > 0
          ? haversineDist(pt.lat, pt.lng, points[idx - 1].lat, points[idx - 1].lng)
          : 200

      const dzdx = (right - left) / (2 * cellSizeLng)
      const dzdy = (up - down) / (2 * cellSizeLat)

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
      const slopeDeg = slopeRad * (180 / Math.PI)

      // Aspect = compass bearing of the downhill direction. Uphill vector
      // in (east, north) coords is (dzdx, dzdy); downhill is (-dzdx, -dzdy);
      // compass bearing of (E, N) = atan2(E, N).
      let aspectDeg = Math.atan2(-dzdx, -dzdy) * (180 / Math.PI)
      if (aspectDeg < 0) aspectDeg += 360

      results.push({
        ...pt,
        slope: Math.round(slopeDeg * 10) / 10,
        aspect: Math.round(aspectDeg),
        aspectLabel: getAspectLabel(aspectDeg),
      })
    }
  }

  return results
}

function getAspectLabel(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return 'N'
  if (deg < 67.5) return 'NE'
  if (deg < 112.5) return 'E'
  if (deg < 157.5) return 'SE'
  if (deg < 202.5) return 'S'
  if (deg < 247.5) return 'SW'
  if (deg < 292.5) return 'W'
  return 'NW'
}

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function pointToSegmentMeters(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const originLatRad = (p.lat * Math.PI) / 180
  const metersPerLng = 111_320 * Math.cos(originLatRad)
  const px = 0
  const py = 0
  const ax = (a.lng - p.lng) * metersPerLng
  const ay = (a.lat - p.lat) * 111_320
  const bx = (b.lng - p.lng) * metersPerLng
  const by = (b.lat - p.lat) * 111_320
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt(ax * ax + ay * ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const x = ax + t * dx
  const y = ay + t * dy
  return Math.sqrt(x * x + y * y)
}

function distanceToGeometryMeters(
  pt: { lat: number; lng: number },
  geometry: Array<{ lat: number; lng: number }>,
): number {
  if (geometry.length === 0) return Infinity
  if (geometry.length === 1) return haversineDist(pt.lat, pt.lng, geometry[0].lat, geometry[0].lng)

  let best = Infinity
  for (let i = 0; i < geometry.length - 1; i++) {
    best = Math.min(best, pointToSegmentMeters(pt, geometry[i], geometry[i + 1]))
  }
  const first = geometry[0]
  const last = geometry[geometry.length - 1]
  if (first.lat !== last.lat || first.lng !== last.lng) {
    best = Math.min(best, pointToSegmentMeters(pt, last, first))
  }
  return best
}

function nearestDistanceToFeaturesMeters(
  pt: { lat: number; lng: number },
  features: Array<{ geometry: Array<{ lat: number; lng: number }> }>,
): number {
  let best = Infinity
  for (const feature of features) {
    best = Math.min(best, distanceToGeometryMeters(pt, feature.geometry))
  }
  return best
}

// ─── Feature Detection ──────────────────────────────────────

interface TerrainFeature {
  type: 'saddle' | 'ridge' | 'drainage' | 'bench' | 'finger-ridge' | 'transition-zone'
  lat: number
  lng: number
  elevation: number
  slope: number
  aspect: string
  description: string
}

type SaddleWedgeTrend = 'up' | 'down' | 'mixed' | 'flat'

interface SaddleWedgeProfile {
  hi: number
  lo: number
  upRelief: number
  downRelief: number
  nearestUpDistSq: number
  nearestDownDistSq: number
  trend: SaddleWedgeTrend
}

function buildSaddleWedgeProfiles(
  wedgeHi: number[],
  wedgeLo: number[],
  wedgeNearestUpDistSq: number[],
  wedgeNearestDownDistSq: number[],
  centerElevation: number,
): SaddleWedgeProfile[] {
  return wedgeHi.map((hi, index) => {
    const lo = wedgeLo[index]
    const upRelief = Number.isFinite(hi) ? hi - centerElevation : -Infinity
    const downRelief = Number.isFinite(lo) ? centerElevation - lo : -Infinity
    const nearestUpDistSq = wedgeNearestUpDistSq[index]
    const nearestDownDistSq = wedgeNearestDownDistSq[index]
    const hasUp = Number.isFinite(nearestUpDistSq)
    const hasDown = Number.isFinite(nearestDownDistSq)
    const trend: SaddleWedgeTrend = hasUp && hasDown
      ? nearestUpDistSq < nearestDownDistSq
        ? 'up'
        : nearestDownDistSq < nearestUpDistSq
          ? 'down'
          : 'mixed'
      : hasUp
        ? 'up'
        : hasDown
          ? 'down'
          : 'flat'
    return { hi, lo, upRelief, downRelief, nearestUpDistSq, nearestDownDistSq, trend }
  })
}

function checkCoherentSaddleAxis(
  profiles: SaddleWedgeProfile[],
  highIdxA: number,
  highIdxB: number,
  lowIdxA: number,
  lowIdxB: number,
): { detected: boolean; aboveRelief: number; belowRelief: number } {
  const highA = profiles[highIdxA]
  const highB = profiles[highIdxB]
  const lowA = profiles[lowIdxA]
  const lowB = profiles[lowIdxB]
  const aboveRelief = Math.min(highA.upRelief, highB.upRelief)
  const belowRelief = Math.min(lowA.downRelief, lowB.downRelief)
  return {
    detected:
      highA.trend === 'up' &&
      highB.trend === 'up' &&
      lowA.trend === 'down' &&
      lowB.trend === 'down',
    aboveRelief,
    belowRelief,
  }
}

function detectFeatures(
  terrainPoints: TerrainPoint[],
  grid: ElevationGrid
): TerrainFeature[] {
  const features: TerrainFeature[] = []
  const { rows, cols } = grid

  /**
   * Saddle candidates are collected during the main loop and pruned at the
   * end. Without pruning, a broad col produces a saddle feature at every grid
   * cell that satisfies the topology — we'd emit half a dozen "saddles" for a
   * single real one. Non-max suppression keeps only the lowest cell in each
   * cluster (the natural crossing point), one feature per actual col.
   */
  const saddleCandidates: Array<{ r: number; c: number; pt: TerrainPoint }> = []

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c
      const pt = terrainPoints[idx]

      const above = terrainPoints[(r + 1) * cols + c]
      const below = terrainPoints[(r - 1) * cols + c]
      const left = terrainPoints[r * cols + (c - 1)]
      const right = terrainPoints[r * cols + (c + 1)]

      const neighbors = [above, below, left, right]
      const nElev = neighbors.map(n => n.elevation)

      // Saddle search: scan all cells within radius and bin them into 8 compass
      // wedges (N, NE, E, SE, S, SW, W, NW). Track max + min elevation per
      // wedge. This catches peaks at any azimuth — a single-ray search would
      // miss a peak just a few degrees off the ray.
      const SADDLE_RELIEF_M = 8
      const SADDLE_SEARCH_RADIUS = 15 // cells; ~2.6 km at 175m production spacing
      // Tactical elk saddles bracket peaks 1-3 km apart. Beyond ~3 km the
      // wedge pattern starts catching regional topology (cross-valley
      // mountains coincidentally satisfying the saddle topology) which
      // isn't the kind of crossing elk actually use.
      const wedgeHi = new Array(8).fill(-Infinity)
      const wedgeLo = new Array(8).fill(Infinity)
      const wedgeNearestUpDistSq = new Array(8).fill(Infinity)
      const wedgeNearestDownDistSq = new Array(8).fill(Infinity)
      for (let ddr = -SADDLE_SEARCH_RADIUS; ddr <= SADDLE_SEARCH_RADIUS; ddr++) {
        for (let ddc = -SADDLE_SEARCH_RADIUS; ddc <= SADDLE_SEARCH_RADIUS; ddc++) {
          if (ddr === 0 && ddc === 0) continue
          const distSq = ddr * ddr + ddc * ddc
          if (distSq > SADDLE_SEARCH_RADIUS * SADDLE_SEARCH_RADIUS) continue
          const nr = r + ddr
          const nc = c + ddc
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
          // Compass azimuth: 0=N, 90=E, 180=S, 270=W. dr+ = N, dc+ = E.
          let az = (Math.atan2(ddc, ddr) * 180) / Math.PI
          if (az < 0) az += 360
          // Bin: N is 337.5°-22.5°, so shift by 22.5° before dividing by 45°.
          const w = Math.floor(((az + 22.5) % 360) / 45)
          const elev = terrainPoints[nr * cols + nc].elevation
          if (elev > wedgeHi[w]) wedgeHi[w] = elev
          if (elev < wedgeLo[w]) wedgeLo[w] = elev
          if (elev - pt.elevation >= SADDLE_RELIEF_M && distSq < wedgeNearestUpDistSq[w]) {
            wedgeNearestUpDistSq[w] = distSq
          }
          if (pt.elevation - elev >= SADDLE_RELIEF_M && distSq < wedgeNearestDownDistSq[w]) {
            wedgeNearestDownDistSq[w] = distSq
          }
        }
      }

      // Saddle: a col on a ridgeline. Test 4 axis pairs (every 45°) so we
      // catch ridges at any orientation, not just N-S/E-W. Each axis pair
      // names two "high" neighbors (the ridge spine) and two "low" neighbors
      // (the drainage axis perpendicular to it).
      //
      // Magnitude check: BOTH highs must be ≥ SADDLE_RELIEF_M above the point
      // AND both lows must be ≥ SADDLE_RELIEF_M below — otherwise a millimeter
      // of noise on a flat ridgetop satisfies the topology test alone.
      // 8m is calibrated for USGS 3DEP (sub-meter vertical accuracy).
      // "Low points on ridgelines where elk cross between drainages.
      //  Bulls frequently bugle from saddles because sound carries both directions."
      // Wedge indices: 0=N, 1=NE, 2=E, ... A wedge must be directionally
      // coherent by first meaningful terrain break from the point. A ridge
      // wedge can drop beyond the ridge, and a drainage wedge can climb beyond
      // the draw, but the first material break must match the expected trend.
      const saddleProfiles = buildSaddleWedgeProfiles(
        wedgeHi,
        wedgeLo,
        wedgeNearestUpDistSq,
        wedgeNearestDownDistSq,
        pt.elevation,
      )

      // Slope cap: real elk-tactical saddles are gentle at the col point.
      // Broad sidehills can satisfy the far-field wedge topology (higher
      // uphill, lower downhill) without being a crossing. A 12° cap keeps
      // saddles to actual low-gradient cols instead of ordinary slope cells.
      const isSaddle =
        pt.slope <= 12 &&
        (checkCoherentSaddleAxis(saddleProfiles, 0, 4, 2, 6).detected ||  // N-S ridge / E-W drainage
         checkCoherentSaddleAxis(saddleProfiles, 2, 6, 0, 4).detected ||  // E-W ridge / N-S drainage
         checkCoherentSaddleAxis(saddleProfiles, 1, 5, 3, 7).detected ||  // NE-SW ridge / NW-SE drainage
         checkCoherentSaddleAxis(saddleProfiles, 3, 7, 1, 5).detected)    // NW-SE ridge / NE-SW drainage

      if (isSaddle) {
        saddleCandidates.push({ r, c, pt })
      }

      // Ridge: higher than all 4 cardinal neighbors
      // "Bulls often travel along finger ridges using the wind advantage."
      if (nElev.every(e => pt.elevation > e + 5)) {
        features.push({
          type: 'ridge',
          lat: pt.lat,
          lng: pt.lng,
          elevation: pt.elevation,
          slope: pt.slope,
          aspect: pt.aspectLabel,
          description: `Ridgeline at ${mToFt(pt.elevation)}ft — elk travel corridors. Bulls use ridges for wind advantage. Bedded elk on ridge points with crosswind monitor scent from three directions.`,
        })
      }

      // Drainage bottom: lower than all 4 cardinal neighbors
      // "Drainage heads: uppermost ends of creek drainages where ridges converge.
      //  Thickest timber, least human traffic."
      if (nElev.every(e => pt.elevation < e - 5)) {
        features.push({
          type: 'drainage',
          lat: pt.lat,
          lng: pt.lng,
          elevation: pt.elevation,
          slope: pt.slope,
          aspect: pt.aspectLabel,
          description: `Drainage bottom at ${mToFt(pt.elevation)}ft — water collects here. During rut: wallow potential near springs/seeps. Post-rut: drainage heads hold thickest timber and least human traffic.`,
        })
      }

      // Bench: gentle slope on otherwise steep terrain, sitting MID-slope
      // (terrain rises meaningfully above AND drops meaningfully below).
      // A bare slope-asymmetry test would also match drainage bottoms (gentle
      // floor, steep walls — but everything around is HIGHER) and hilltops
      // (gentle summit, steeper flanks — but everything around is LOWER).
      // Both produce false benches, hence the explicit relief bounds below.
      //
      // Relief threshold of 8m is calibrated for USGS 3DEP (sub-meter
      // vertical accuracy). The previous 15m was conservative around the
      // ~3m noise floor of Mapbox Terrain-RGB; with 3DEP, 8m cleanly
      // separates real benches from flat-ish noise while catching legitimate
      // small mid-slope shelves the old threshold rejected.
      // "Benches and flats located 1/3 to 2/3 up a slope — high enough for thermal advantage,
      //  low enough for water/feed access. Steep sidehill benches are nearly unapproachable
      //  without detection."
      const avgNeighborSlope = neighbors.reduce((a, n) => a + n.slope, 0) / 4
      const maxN = Math.max(...nElev)
      const minN = Math.min(...nElev)
      const aboveRelief = maxN - pt.elevation // m of terrain rising above
      const belowRelief = pt.elevation - minN // m of terrain dropping below
      const isMidSlope = aboveRelief >= 8 && belowRelief >= 8
      if (pt.slope < 20 && avgNeighborSlope > 15 && isMidSlope) {
        // Classify the bench by aspect for seasonal relevance
        const isNorthFacing = ['N', 'NE', 'NW'].includes(pt.aspectLabel)
        const isSouthFacing = ['S', 'SE', 'SW'].includes(pt.aspectLabel)

        let benchDesc = `Bench at ${mToFt(pt.elevation)}ft (${pt.slope}° on ${avgNeighborSlope.toFixed(0)}° terrain), ${pt.aspectLabel}-facing.`
        if (isNorthFacing) {
          benchDesc += ` North-facing bench: rut/post-rut bedding (60-80%+ canopy). Steep approach = security. Thermal advantage: morning thermals rise, evening thermals sink.`
        } else if (isSouthFacing) {
          benchDesc += ` South-facing bench: late-season bedding (15-25°F warmer than north). Solar exposure, reduced snow. Prime Nov-Dec.`
        }

        features.push({
          type: 'bench',
          lat: pt.lat,
          lng: pt.lng,
          elevation: pt.elevation,
          slope: pt.slope,
          aspect: pt.aspectLabel,
          description: benchDesc,
        })
      }

      // Finger ridge: locally convex spur, not just a normal sidehill.
      // "Small ridges extending off main ridgelines into drainages.
      //  Satellite bulls bed on these. Bulls travel along the tops."
      const higherCount = nElev.filter(e => pt.elevation > e + 3).length
      const uphillCount = nElev.filter(e => e > pt.elevation + 3).length
      if ((higherCount === 2 || higherCount === 3) && uphillCount <= 1) {
        if (pt.slope >= 8 && pt.slope <= 25) {
          features.push({
            type: 'finger-ridge',
            lat: pt.lat,
            lng: pt.lng,
            elevation: pt.elevation,
            slope: pt.slope,
            aspect: pt.aspectLabel,
            description: `Finger ridge at ${mToFt(pt.elevation)}ft — small ridge extending into drainage. Satellite bulls bed here during rut (100-300m from herd bull). Travel route with wind advantage.`,
          })
        }
      }
    }
  }

  // Non-max suppression on saddle candidates: a wide col can satisfy the
  // saddle pattern at every cell across its width, producing redundant
  // features. Keep only candidates that are the lowest among their close
  // neighbors (within 2 cells). The lowest cell in a col is also the
  // natural crossing point — the spot elk actually use as the funnel.
  const NMS_RADIUS = 2
  for (const cand of saddleCandidates) {
    const isLocalMin = saddleCandidates.every((other) => {
      if (other === cand) return true
      const dr = Math.abs(other.r - cand.r)
      const dc = Math.abs(other.c - cand.c)
      if (dr > NMS_RADIUS || dc > NMS_RADIUS) return true
      return other.pt.elevation >= cand.pt.elevation
    })
    if (isLocalMin) {
      const { pt } = cand
      features.push({
        type: 'saddle',
        lat: pt.lat,
        lng: pt.lng,
        elevation: pt.elevation,
        slope: pt.slope,
        aspect: pt.aspectLabel,
        description: `Saddle at ${mToFt(pt.elevation)}ft — natural crossing between drainages. Sound carries both directions; key travel funnel and ambush point for rut bugling and late-season migration.`,
      })
    }
  }

  return features
}

function detectTransitionZones(
  terrainPoints: TerrainPoint[],
  landData: OSMLandData,
  fireHistory: FireHistoryFeature[] = [],
): TerrainFeature[] {
  const openingSources = [
    ...landData.meadows.map((feature) => ({ geometry: feature.geometry, kind: 'meadow' as const })),
    ...landData.regrowth.map((feature) => ({ geometry: feature.geometry, kind: 'regrowth' as const })),
    ...fireHistory.map((feature) => ({ geometry: feature.geometry, kind: 'burn' as const, fire: feature })),
  ]
  if (openingSources.length === 0) return []

  const candidates: Array<{ feature: TerrainFeature; score: number }> = []
  const hasForestData = landData.forests.length > 0

  for (const pt of terrainPoints) {
    let openingDist = Infinity
    let openingSource: 'meadow' | 'regrowth' | 'burn' = 'meadow'
    let openingFire: FireHistoryFeature | null = null
    for (const opening of openingSources) {
      const dist = distanceToGeometryMeters(pt, opening.geometry)
      if (dist < openingDist) {
        openingDist = dist
        openingSource = opening.kind
        openingFire = opening.kind === 'burn' ? opening.fire : null
      }
    }
    if (openingDist < 100 || openingDist > 400) continue
    if (pt.slope < 4 || pt.slope > 22) continue

    const forestDist = hasForestData
      ? nearestDistanceToFeaturesMeters(pt, landData.forests)
      : Infinity
    if (hasForestData && forestDist > 500) continue

    const southAspect = ['S', 'SE', 'SW'].includes(pt.aspectLabel)
    const northAspect = ['N', 'NE', 'NW'].includes(pt.aspectLabel)
    const idealSlope = pt.slope >= 6 && pt.slope <= 16
    const openingScore = 1 - Math.abs(openingDist - 225) / 225
    const coverScore = hasForestData ? Math.max(0, 1 - forestDist / 500) : 0.4
    const score =
      openingScore * 35 +
      coverScore * 25 +
      (idealSlope ? 20 : 8) +
      (southAspect ? 15 : northAspect ? 10 : 5) +
      (openingSource === 'regrowth' ? 8 : 0) +
      (openingSource === 'burn' ? burnValueBonus(openingFire) : 0)

    const aspectNote = southAspect
      ? 'south-facing edge: late-season feed-to-bed transition and solar bedding nearby'
      : northAspect
        ? 'north-facing edge: rut/post-rut cover transition with cooler bedding nearby'
        : 'cross-slope edge: hunt by wind and thermal timing'
    const coverNote = Number.isFinite(forestDist)
      ? `${Math.round(forestDist)}m from mapped timber`
      : 'timber proximity not mapped here'

    const openingLabel = openingSource === 'burn'
      ? fireLabel(openingFire)
      : openingSource === 'regrowth'
        ? 'Burn/regrowth proxy'
        : 'Meadow'
    const edgeBehavior = openingSource === 'burn'
      ? burnBehaviorNote(openingFire)
      : openingSource === 'regrowth'
        ? 'new grass/brush regrowth draws elk, but daylight use clusters along the timber edge'
        : 'elk feed in the opening but often stage in cover before fully committing'

    candidates.push({
      score,
      feature: {
        type: 'transition-zone',
        lat: pt.lat,
        lng: pt.lng,
        elevation: pt.elevation,
        slope: pt.slope,
        aspect: pt.aspectLabel,
        description:
          `${openingLabel} transition zone ${Math.round(openingDist)}m off mapped opening, ${coverNote}. ` +
          `${aspectNote}. ${edgeBehavior}; staging/ambush band for first and last light.`,
      },
    })
  }

  const selected: TerrainFeature[] = []
  for (const cand of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.some((f) => haversineDist(f.lat, f.lng, cand.feature.lat, cand.feature.lng) < 350)) {
      continue
    }
    selected.push(cand.feature)
    if (selected.length >= 12) break
  }
  return selected
}

function burnValueBonus(fire: FireHistoryFeature | null): number {
  if (!fire?.year) return 6
  const age = new Date().getFullYear() - fire.year
  if (age >= 3 && age <= 18) return 18
  if (age >= 1 && age <= 25) return 12
  return 4
}

function fireLabel(fire: FireHistoryFeature | null): string {
  if (!fire) return 'MTBS burn'
  const parts = ['MTBS burn']
  if (fire.name) parts.push(fire.name)
  if (fire.year) parts.push(String(fire.year))
  if (fire.severity && fire.severity !== 'unknown') parts.push(`${fire.severity} severity`)
  return parts.join(' / ')
}

function burnBehaviorNote(fire: FireHistoryFeature | null): string {
  if (!fire?.year) {
    return 'mapped burn perimeter: verify current regrowth, then prioritize elk use along nearby timber edge'
  }
  const age = new Date().getFullYear() - fire.year
  if (age < 3) {
    return 'recent burn: forage response may still be developing, but elk may stage along unburned timber edges'
  }
  if (age <= 18) {
    return 'prime-age burn/regrowth: grass, forbs, and brush can draw elk, with daylight use concentrated near timber lines'
  }
  if (age <= 25) {
    return 'maturing burn/regrowth: still useful if feed remains open, with timber-edge security becoming more important'
  }
  return 'older burn perimeter: treat as context only unless imagery confirms open feed or brush regrowth remains'
}

function mToFt(m: number): string {
  return Math.round(m * 3.28084).toLocaleString()
}

// ─── Single-point diagnostic ────────────────────────────────
// Used by the dev /api/inspect-point endpoint. Mirrors the per-cell logic
// in detectFeatures() but emits structured pass/fail reasons for each
// feature type so we can debug "why isn't this spot a saddle?" questions
// against specific lat/lng inputs.

export interface PointInspection {
  point: {
    lat: number
    lng: number
    elevation: number
    elevationFt: number
    slope: number
    aspect: string
  }
  neighbors: Record<'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW', number>
  features: Record<
    'saddle' | 'ridge' | 'drainage' | 'bench' | 'fingerRidge',
    { detected: boolean; reason: string }
  >
}

export function inspectTerrainAt(
  terrainPoints: TerrainPoint[],
  grid: ElevationGrid,
  centerR: number,
  centerC: number,
): PointInspection | null {
  const { rows, cols } = grid
  // 15-cell radius at 200m default spacing = 3km coverage. Tactical elk
  // saddles bracket peaks 1-3 km apart; beyond that the wedge pattern
  // starts catching regional topology that isn't the kind of crossing
  // elk actually use.
  const SADDLE_SEARCH_RADIUS = 15
  if (
    centerR < SADDLE_SEARCH_RADIUS ||
    centerR > rows - 1 - SADDLE_SEARCH_RADIUS ||
    centerC < SADDLE_SEARCH_RADIUS ||
    centerC > cols - 1 - SADDLE_SEARCH_RADIUS
  ) {
    return null
  }
  const pt = terrainPoints[centerR * cols + centerC]
  if (!pt) return null

  const above = terrainPoints[(centerR + 1) * cols + centerC]
  const below = terrainPoints[(centerR - 1) * cols + centerC]
  const left = terrainPoints[centerR * cols + (centerC - 1)]
  const right = terrainPoints[centerR * cols + (centerC + 1)]
  const ne = terrainPoints[(centerR + 1) * cols + (centerC + 1)]
  const nw = terrainPoints[(centerR + 1) * cols + (centerC - 1)]
  const se = terrainPoints[(centerR - 1) * cols + (centerC + 1)]
  const sw = terrainPoints[(centerR - 1) * cols + (centerC - 1)]

  const SADDLE_RELIEF_M = 8
  const BENCH_RELIEF_M = 8

  // ── Saddle: bin all cells in the 5km circle into 8 compass wedges, track
  // max + min elevation per wedge. This avoids the off-axis miss that a
  // single-ray search has when peaks aren't perfectly axis-aligned.
  const wedgeHi = new Array(8).fill(-Infinity)
  const wedgeLo = new Array(8).fill(Infinity)
  const wedgeNearestUpDistSq = new Array(8).fill(Infinity)
  const wedgeNearestDownDistSq = new Array(8).fill(Infinity)
  for (let ddr = -SADDLE_SEARCH_RADIUS; ddr <= SADDLE_SEARCH_RADIUS; ddr++) {
    for (let ddc = -SADDLE_SEARCH_RADIUS; ddc <= SADDLE_SEARCH_RADIUS; ddc++) {
      if (ddr === 0 && ddc === 0) continue
      const distSq = ddr * ddr + ddc * ddc
      if (distSq > SADDLE_SEARCH_RADIUS * SADDLE_SEARCH_RADIUS) continue
      const nr = centerR + ddr
      const nc = centerC + ddc
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      let az = (Math.atan2(ddc, ddr) * 180) / Math.PI
      if (az < 0) az += 360
      const w = Math.floor(((az + 22.5) % 360) / 45)
      const elev = terrainPoints[nr * cols + nc].elevation
      if (elev > wedgeHi[w]) wedgeHi[w] = elev
      if (elev < wedgeLo[w]) wedgeLo[w] = elev
      if (elev - pt.elevation >= SADDLE_RELIEF_M && distSq < wedgeNearestUpDistSq[w]) {
        wedgeNearestUpDistSq[w] = distSq
      }
      if (pt.elevation - elev >= SADDLE_RELIEF_M && distSq < wedgeNearestDownDistSq[w]) {
        wedgeNearestDownDistSq[w] = distSq
      }
    }
  }

  const wedgeNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const axes = [
    { name: 'N-S ridge / E-W drainage',     hA: 0, hB: 4, lA: 2, lB: 6 },
    { name: 'E-W ridge / N-S drainage',     hA: 2, hB: 6, lA: 0, lB: 4 },
    { name: 'NE-SW ridge / NW-SE drainage', hA: 1, hB: 5, lA: 3, lB: 7 },
    { name: 'NW-SE ridge / NE-SW drainage', hA: 7, hB: 3, lA: 1, lB: 5 },
  ]

  let saddleResult = { detected: false, reason: '' }
  let bestSaddleAxis: { name: string; aboveRelief: number; belowRelief: number; coherence: string } | null = null
  const saddleProfiles = buildSaddleWedgeProfiles(
    wedgeHi,
    wedgeLo,
    wedgeNearestUpDistSq,
    wedgeNearestDownDistSq,
    pt.elevation,
  )
  // Slope cap: a real elk-tactical saddle is gentle at the col point.
  // 12° filters ordinary sidehills whose far-field relief happens to look
  // like a saddle axis across several kilometers.
  const SADDLE_MAX_SLOPE = 12
  if (pt.slope > SADDLE_MAX_SLOPE) {
    saddleResult.reason = `slope ${pt.slope.toFixed(1)}° (need ≤${SADDLE_MAX_SLOPE}° for a crossable col)`
  } else {
    for (const axis of axes) {
      const axisCheck = checkCoherentSaddleAxis(saddleProfiles, axis.hA, axis.hB, axis.lA, axis.lB)
      const coherence = [axis.hA, axis.hB, axis.lA, axis.lB]
        .map((index) => `${wedgeNames[index]}:${saddleProfiles[index].trend}`)
        .join(' ')
      if (axisCheck.detected) {
        saddleResult = {
          detected: true,
          reason: `${axis.name}: ${axisCheck.aboveRelief.toFixed(1)}m above, ${axisCheck.belowRelief.toFixed(1)}m below; coherent ${coherence}`,
        }
        break
      }
      if (
        !bestSaddleAxis ||
        axisCheck.aboveRelief + axisCheck.belowRelief > bestSaddleAxis.aboveRelief + bestSaddleAxis.belowRelief
      ) {
        bestSaddleAxis = { name: axis.name, aboveRelief: axisCheck.aboveRelief, belowRelief: axisCheck.belowRelief, coherence }
      }
    }
  }
  if (!saddleResult.detected && bestSaddleAxis) {
    // Show wedge max/min elevation in each of the 8 wedges (m vs pt).
    const fmt = (n: number) => {
      if (!Number.isFinite(n)) return '·'
      const d = n - pt.elevation
      return (d > 0 ? '+' : '') + d.toFixed(0)
    }
    const fmtCells = (n: number) => Number.isFinite(n) ? Math.sqrt(n).toFixed(1) : '·'
    const directional = wedgeNames
      .map((name, i) => {
        const profile = saddleProfiles[i]
        return `${name}=${profile.trend} hi/lo ${fmt(profile.hi)}/${fmt(profile.lo)} first +${fmtCells(profile.nearestUpDistSq)}c -${fmtCells(profile.nearestDownDistSq)}c`
      })
      .join(', ')
    saddleResult.reason =
      `closest axis "${bestSaddleAxis.name}": only ` +
      `${bestSaddleAxis.aboveRelief.toFixed(1)}m above / ` +
      `${bestSaddleAxis.belowRelief.toFixed(1)}m below with first-break opposite directions ` +
      `(need ≥${SADDLE_RELIEF_M}m each and high wedges first-up / low wedges first-down). ` +
      `trends: ${bestSaddleAxis.coherence}. ` +
      `wedges: ${directional}`
  }

  const neighbors = [above, below, left, right]
  const nElev = neighbors.map((n) => n.elevation)
  const maxNeighbor = Math.max(...nElev)
  const minNeighbor = Math.min(...nElev)
  const ptAboveHighest = pt.elevation - maxNeighbor // +ve = pt above highest neighbor (ridge condition)
  const ptBelowLowest = minNeighbor - pt.elevation  // +ve = pt below lowest neighbor (drainage condition)

  // ── Ridge: pt higher than all 4 cardinal neighbors by ≥5m ──
  // (i.e., pt is above its HIGHEST neighbor by ≥5m → above all of them)
  const ridgeResult =
    ptAboveHighest > 5
      ? { detected: true, reason: `${ptAboveHighest.toFixed(1)}m above highest neighbor (need >5m)` }
      : ptAboveHighest >= 0
        ? { detected: false, reason: `only ${ptAboveHighest.toFixed(1)}m above highest neighbor (need >5m)` }
        : { detected: false, reason: `highest neighbor is ${(-ptAboveHighest).toFixed(1)}m above pt` }

  // ── Drainage: pt lower than all 4 cardinal neighbors by ≥5m ──
  // (i.e., pt is below its LOWEST neighbor by ≥5m → below all of them)
  const drainageResult =
    ptBelowLowest > 5
      ? { detected: true, reason: `${ptBelowLowest.toFixed(1)}m below lowest neighbor (need >5m)` }
      : ptBelowLowest >= 0
        ? { detected: false, reason: `only ${ptBelowLowest.toFixed(1)}m below lowest neighbor (need >5m)` }
        : { detected: false, reason: `lowest neighbor is ${(-ptBelowLowest).toFixed(1)}m below pt` }

  // ── Bench: gentle slope, steeper around, mid-slope position ──
  const avgNeighborSlope = neighbors.reduce((a, n) => a + n.slope, 0) / 4
  const maxN = Math.max(...nElev)
  const minN = Math.min(...nElev)
  const aboveRelief = maxN - pt.elevation
  const belowRelief = pt.elevation - minN
  const benchPasses =
    pt.slope < 20 &&
    avgNeighborSlope > 15 &&
    aboveRelief >= BENCH_RELIEF_M &&
    belowRelief >= BENCH_RELIEF_M
  let benchReason: string
  if (benchPasses) {
    benchReason =
      `slope ${pt.slope}° on ${avgNeighborSlope.toFixed(0)}° terrain, ` +
      `${aboveRelief.toFixed(1)}m above / ${belowRelief.toFixed(1)}m below`
  } else {
    const fails: string[] = []
    if (pt.slope >= 20) fails.push(`slope ${pt.slope}° (need <20°)`)
    if (avgNeighborSlope <= 15) fails.push(`neighbors avg ${avgNeighborSlope.toFixed(0)}° (need >15°)`)
    if (aboveRelief < BENCH_RELIEF_M) fails.push(`above relief ${aboveRelief.toFixed(1)}m (need ≥${BENCH_RELIEF_M}m)`)
    if (belowRelief < BENCH_RELIEF_M) fails.push(`below relief ${belowRelief.toFixed(1)}m (need ≥${BENCH_RELIEF_M}m)`)
    benchReason = fails.join('; ')
  }
  const benchResult = { detected: benchPasses, reason: benchReason }

  // ── Finger ridge: locally convex spur, not ordinary sidehill ──
  const higherCount = nElev.filter((e) => pt.elevation > e + 3).length
  const uphillCount = nElev.filter((e) => e > pt.elevation + 3).length
  const fingerRidgePasses =
    (higherCount === 2 || higherCount === 3) && uphillCount <= 1 && pt.slope >= 8 && pt.slope <= 25
  let fingerReason: string
  if (fingerRidgePasses) {
    fingerReason = `${higherCount}/4 neighbors lower, ${uphillCount}/4 uphill, slope ${pt.slope}°`
  } else {
    const fails: string[] = []
    if (higherCount !== 2 && higherCount !== 3) {
      fails.push(`${higherCount}/4 neighbors lower (need 2 or 3)`)
    }
    if (uphillCount > 1) {
      fails.push(`${uphillCount}/4 neighbors uphill (need ≤1; otherwise this is a sidehill/saddle axis)`)
    }
    if (pt.slope < 8 || pt.slope > 25) {
      fails.push(`slope ${pt.slope}° (need 8-25°)`)
    }
    fingerReason = fails.join('; ')
  }
  const fingerRidgeResult = { detected: fingerRidgePasses, reason: fingerReason }

  return {
    point: {
      lat: pt.lat,
      lng: pt.lng,
      elevation: pt.elevation,
      elevationFt: Math.round(pt.elevation * 3.28084),
      slope: pt.slope,
      aspect: pt.aspectLabel,
    },
    neighbors: {
      N: above.elevation,
      S: below.elevation,
      E: right.elevation,
      W: left.elevation,
      NE: ne.elevation,
      NW: nw.elevation,
      SE: se.elevation,
      SW: sw.elevation,
    },
    features: {
      saddle: saddleResult,
      ridge: ridgeResult,
      drainage: drainageResult,
      bench: benchResult,
      fingerRidge: fingerRidgeResult,
    },
  }
}

// ─── Terrain Summary Builder ────────────────────────────────

export interface TerrainAnalysis {
  elevationProfile: string
  slopeAnalysis: string
  aspectBreakdown: string
  detectedFeatures: TerrainFeature[]
  featureSummary: string
  elkHabitatNotes: string
}

export function analyzeTerrainForPrompt(
  elevGrid: ElevationGrid,
  landData: OSMLandData,
  fireHistory: FireHistoryFeature[] = [],
): TerrainAnalysis {
  const terrainPoints = computeSlopeAspect(elevGrid)
  const features = [
    ...detectFeatures(terrainPoints, elevGrid),
    ...detectTransitionZones(terrainPoints, landData, fireHistory),
  ]

  // ── Elevation profile ──
  const elevFt = {
    min: mToFt(elevGrid.minElevation),
    max: mToFt(elevGrid.maxElevation),
    avg: mToFt(elevGrid.avgElevation),
    range: mToFt(elevGrid.maxElevation - elevGrid.minElevation),
  }
  const elevationProfile = `Elevation range: ${elevFt.min}ft to ${elevFt.max}ft (${elevFt.range}ft of relief). Average: ${elevFt.avg}ft.`

  // ── Slope analysis with elk-relevant classifications ──
  const slopes = terrainPoints.map(p => p.slope)
  const total = slopes.length

  // Elk-specific slope bands from the habitat guide
  const lateSeasonBed = slopes.filter(s => s >= 5 && s <= 20).length  // late-season bedding
  const rutBed = slopes.filter(s => s >= 10 && s <= 30).length        // rut bedding
  const postRutBed = slopes.filter(s => s >= 20 && s <= 40).length    // post-rut bedding (security)
  const gentleCount = slopes.filter(s => s < 10).length               // feeding/meadow terrain
  const steepCount = slopes.filter(s => s >= 30).length               // security terrain

  const slopeAnalysis = [
    `Slope breakdown: ${pct(gentleCount, total)} gentle (<10° — feeding/meadow terrain), `,
    `${pct(rutBed, total)} in rut bedding range (10-30°), `,
    `${pct(postRutBed, total)} in post-rut security range (20-40°), `,
    `${pct(steepCount, total)} steep (>30°). `,
    `Average: ${(slopes.reduce((a, b) => a + b, 0) / total).toFixed(1)}°. `,
    `Late-season bedding terrain (5-20°): ${pct(lateSeasonBed, total)}.`,
  ].join('')

  // ── Aspect breakdown with seasonal relevance ──
  const aspectCounts: Record<string, number> = { N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0 }
  for (const pt of terrainPoints) {
    aspectCounts[pt.aspectLabel]++
  }

  const northPct = (aspectCounts.N + aspectCounts.NE + aspectCounts.NW) / total
  const southPct = (aspectCounts.S + aspectCounts.SE + aspectCounts.SW) / total

  const dominant = Object.entries(aspectCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const aspectBreakdown = [
    `Dominant aspects: ${dominant.map(([dir, count]) => `${dir}-facing (${pct(count, total)})`).join(', ')}. `,
    `North-facing (N/NE/NW): ${pct(Math.round(northPct * total), total)} — rut & post-rut bedding (thermal cover, 60-80%+ canopy). `,
    `South-facing (S/SE/SW): ${pct(Math.round(southPct * total), total)} — late-season bedding (solar warmth, 15-25°F warmer), feeding areas. `,
  ].join('')

  // ── Feature summary ──
  const saddleCount = features.filter(f => f.type === 'saddle').length
  const ridgeCount = features.filter(f => f.type === 'ridge').length
  const drainageCount = features.filter(f => f.type === 'drainage').length
  const benchCount = features.filter(f => f.type === 'bench').length
  const fingerCount = features.filter(f => f.type === 'finger-ridge').length
  const transitionCount = features.filter(f => f.type === 'transition-zone').length

  const featureParts: string[] = []
  if (saddleCount > 0) featureParts.push(`${saddleCount} saddle points (travel funnels, bugling stations)`)
  if (ridgeCount > 0) featureParts.push(`${ridgeCount} ridgeline sections (travel corridors, wind advantage)`)
  if (drainageCount > 0) featureParts.push(`${drainageCount} drainage bottoms (water, wallows, thick timber at heads)`)
  if (benchCount > 0) featureParts.push(`${benchCount} benches (prime bedding — flat on steep terrain)`)
  if (fingerCount > 0) featureParts.push(`${fingerCount} finger ridges (satellite bull bedding, travel)`)
  if (transitionCount > 0) featureParts.push(`${transitionCount} meadow/regrowth transition zones (feed-to-bed staging bands)`)

  const featureSummary = featureParts.length > 0
    ? `Detected terrain features: ${featureParts.join(', ')}.`
    : 'No prominent terrain features detected in this area.'

  // ── Elk habitat notes based on real data ──
  const elkNotes: string[] = []
  const elevAvgM = elevGrid.avgElevation
  const elevMinM = elevGrid.minElevation
  const elevMaxM = elevGrid.maxElevation
  const reliefM = elevMaxM - elevMinM

  // Elevation band assessment
  if (elevAvgM >= 2400 && elevAvgM <= 3200) {
    elkNotes.push(`PRIME ELK ELEVATION (${mToFt(elevAvgM)}ft avg). Rut and post-rut core habitat. Expect resident herds Sep-Nov. Bulls descend from bachelor summer range above to find cow herds in this band.`)
  } else if (elevAvgM >= 2000 && elevAvgM < 2400) {
    elkNotes.push(`TRANSITION/WINTER RANGE ELEVATION (${mToFt(elevAvgM)}ft avg). Late-season concentration zone. As snowpack builds above, elk migrate down to this band. Expect large herds Nov-Dec. Check for south-facing feeding meadows and wind-sheltered bedding.`)
  } else if (elevAvgM >= 1600 && elevAvgM < 2000) {
    elkNotes.push(`LOW ELEVATION WINTER RANGE (${mToFt(elevAvgM)}ft avg). Deep-winter elk concentration. May see ponderosa pine, juniper, oak brush, or sagebrush with scattered timber. Elk adapt to available cover. Best Dec-Jan.`)
  } else if (elevAvgM > 3200) {
    elkNotes.push(`HIGH ELEVATION (${mToFt(elevAvgM)}ft avg). Alpine/subalpine zone. Bachelor bulls summer here but descend for rut. Limited bedding value. Check for saddles and migration corridors connecting to lower elk zones.`)
  }

  // Relief assessment
  if (reliefM > 300) {
    elkNotes.push(`Strong vertical relief (${mToFt(reliefM)}ft). Multiple elevation bands available — elk can adjust bedding and feeding elevation based on conditions without long horizontal travel. Look for benches at 1/3 to 2/3 up slopes.`)
  }

  // Aspect-based seasonal assessment
  if (northPct > 0.30) {
    elkNotes.push(`Significant north-facing terrain (${pct(Math.round(northPct * total), total)}). Rut bedding: N/NE slopes with 60-80% canopy, 10-30° slope, mid-slope benches within 400m of water. Post-rut: darkest N/NE timber, 80%+ canopy, 20-40° slopes, deadfall and thick understory. Bulls go silent, bed in timber you can't see 40 yards into.`)
  }

  if (southPct > 0.30) {
    elkNotes.push(`Significant south-facing terrain (${pct(Math.round(southPct * total), total)}). Late-season bedding: S/SW slopes at 5-20°, south-facing timber edges are THE critical feature (elk feed below, bed above). Solar advantage: 15-25°F warmer than north-facing. Wind-sheltered south slopes with a ridge blocking NW wind are highest-value late-season habitat.`)
  }

  // Feature-based notes
  if (saddleCount > 0) {
    elkNotes.push(`${saddleCount} SADDLE(S) DETECTED. Natural funnels where elk cross between drainages. During rut: bulls bugle from saddles (sound carries both directions). Late season: migration corridor pinch points. Highest-priority ambush terrain across all seasons.`)
  }

  if (benchCount > 0) {
    const nBenches = features.filter(f => f.type === 'bench' && ['N', 'NE', 'NW'].includes(f.aspect)).length
    const sBenches = features.filter(f => f.type === 'bench' && ['S', 'SE', 'SW'].includes(f.aspect)).length
    let benchNote = `${benchCount} BENCH(ES) DETECTED.`
    if (nBenches > 0) benchNote += ` ${nBenches} north-facing (rut/post-rut bedding: thermal cover, steep approach = security).`
    if (sBenches > 0) benchNote += ` ${sBenches} south-facing (late-season bedding: solar warmth, reduced snow).`
    elkNotes.push(benchNote)
  }

  if (drainageCount > 0) {
    elkNotes.push(`${drainageCount} DRAINAGE BOTTOM(S). Water collection points. Rut: wallow potential at drainage heads (flat boggy areas near springs/seeps in timber). Post-rut: drainage heads where ridges converge hold thickest timber and least human pressure. Elk escape route: downhill into drainage bottoms with thick cover.`)
  }

  if (fingerCount > 0) {
    elkNotes.push(`${fingerCount} FINGER RIDGE(S). Small ridges extending off main ridgelines. Satellite bulls bed on these during rut (100-300m from herd bull, monitoring through scent/sound). Bulls travel along tops for wind advantage.`)
  }

  if (transitionCount > 0) {
    elkNotes.push(`${transitionCount} MEADOW/REGROWTH TRANSITION ZONE(S). These are measured 100-400m bands off mapped meadow, grass, scrub/heath, or clearcut-style openings on usable slope. High-value first/last-light staging terrain: elk feed in openings and burns/regrowth, but often stage along nearby timber before fully committing, especially under hunting pressure.`)
  }

  // OSM land cover notes
  if (landData.meadows.length > 0) {
    elkNotes.push(`${landData.meadows.length} MAPPED MEADOW/GRASSLAND AREAS. Primary feeding zones. Elk rarely venture >100-200m from timber edge during daylight. The transition zone (100-400m band where timber thins to meadow) is the highest-probability encounter zone across all seasons. Hunt this band during first and last 90 minutes of daylight.`)
  }

  if (landData.regrowth.length > 0) {
    elkNotes.push(`${landData.regrowth.length} MAPPED REGROWTH / BURN-CLEARCUT PROXY AREAS. Treat as potential early-successional feed only when paired with nearby timber. Fresh grass, forbs, and brush regrowth can be excellent elk feed; the stronger hunting setup is usually the timber line 100-400m off the opening, not the middle of the opening.`)
  }

  if (fireHistory.length > 0) {
    const recent = fireHistory.filter((fire) => fire.year && fire.year >= new Date().getFullYear() - 20).length
    elkNotes.push(`${fireHistory.length} MTBS BURN PERIMETER(S), ${recent} from the last 20 years. Burns are strongest when grass/forbs/brush have regenerated and unburned timber remains nearby. Prioritize 3-18 year burns and hunt the timber line 100-400m off the opening; older burns need imagery confirmation before treating them as active feed.`)
  }

  if (landData.forests.length > 0) {
    elkNotes.push(`${landData.forests.length} MAPPED FOREST/WOODLAND AREAS. Bedding and security cover. Rut: 60-80% canopy with open understory (bulls need to see satellite bulls). Post-rut: 80%+ canopy, deadfall, dog-hair timber — physically difficult to move through quietly. Late season: variable canopy 40-70%, favoring south-facing stands.`)
  }

  if (landData.streams.length > 0) {
    elkNotes.push(`${landData.streams.length} MAPPED STREAM(S). Rut: critical — elk stay within 400m of water, wallows form near springs/seeps at stream heads. Post-rut: bulls water every 24-48 hours, often at night. Late season: snow replaces open water — stream proximity less important.`)
  }

  if (landData.buildings.length > 0) {
    elkNotes.push(`WARNING: ${landData.buildings.length} buildings in area. Elk learn road systems and trails within days of hunting season opening. Flight distance increases from 100m to 400m+ near human activity. Best habitat is >1 mile from roads with no ATV access.`)
  }

  const elkHabitatNotes = elkNotes.length > 0
    ? elkNotes.join('\n\n')
    : 'No specific elk habitat notes for this elevation/terrain profile.'

  return {
    elevationProfile,
    slopeAnalysis,
    aspectBreakdown,
    detectedFeatures: features,
    featureSummary,
    elkHabitatNotes,
  }
}

/**
 * Build a detailed feature list with coordinates for the GPT prompt.
 */
export function formatFeaturesForPrompt(features: TerrainFeature[], limit = 25): string {
  if (features.length === 0) return ''

  // Prioritize: saddles > transition zones > benches > finger ridges > ridges > drainages
  const priority: Record<string, number> = {
    saddle: 0, 'transition-zone': 1, bench: 2, 'finger-ridge': 3, ridge: 4, drainage: 5,
  }
  const sorted = [...features].sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9))
  const selected = sorted.slice(0, limit)

  const lines = selected.map(f =>
    `  - ${f.type.toUpperCase()} at ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} (${mToFt(f.elevation)}ft, ${f.slope}° slope, ${f.aspect}-facing): ${f.description}`
  )

  return `\nDETECTED TERRAIN FEATURES (from real elevation data — use these for precise POI placement):\n${lines.join('\n')}\n`
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'
}
