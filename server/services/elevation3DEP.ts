/**
 * Elevation grid from USGS 3DEP via the National Map's ArcGIS ImageServer.
 *
 * Compared to Mapbox Terrain-RGB, this gives us:
 *   - LiDAR-derived data over most of CONUS (sub-meter vertical accuracy)
 *   - 32-bit float values (no RGB-encoding loss)
 *   - Sub-canopy terrain — critical for elk hunting in timber
 *
 * Endpoint:
 *   https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage
 * Docs:
 *   https://www.usgs.gov/3d-elevation-program
 */

import { fromArrayBuffer } from 'geotiff'
import type { ElevationGrid, ElevationPoint } from './elevation.js'
import { rasterToElevationGrid } from './terrainAnalysis.js'

const EXPORT_URL =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'

/**
 * Raster size requested from the ImageServer. 1024×1024 over a typical
 * hunting-area bbox (~10–15 km square) yields ~10–15 m/pixel — matching the
 * 1/3 arc-second 3DEP product's native resolution. Higher buys little until
 * we also bump the analysis grid above 20×20.
 */
const RASTER_SIZE = 1024
const DEFAULT_TARGET_PIXEL_METERS = 10
const MAX_RASTER_SIDE_PIXELS = 2048
const MAX_RASTER_PIXELS = 4_000_000
const TRANSIENT_EXPORT_STATUSES = new Set([502, 503, 504])

type Bounds = { north: number; south: number; east: number; west: number }

export interface RasterDataset {
  data: Float32Array
  nodataMask: Uint8Array
  width: number
  height: number
  bounds: Bounds
  noData: number
  source: 'USGS_3DEP'
  pixelSizeDegreesX: number
  pixelSizeDegreesY: number
  pixelSizeMetersX: number
  pixelSizeMetersY: number
  requestedPixelSizeMeters: number
  actualPixelSizeMeters: number
  nodataRatio: number
}

export interface RasterFetchOptions {
  targetPixelSizeMeters?: number
  maxSidePixels?: number
  maxPixels?: number
}

export interface RasterExportSize {
  width: number
  height: number
  requestedPixelSizeMeters: number
  actualPixelSizeMeters: number
  degraded: boolean
}

/**
 * Conservative US-coverage bbox tests. 3DEP technically also covers Hawaii
 * and territories, but coverage there is patchier so we don't claim it.
 * We require the bbox CENTER to fall in CONUS or Alaska — both extremes
 * being inside is too strict and rejects legitimate edge-of-CONUS bboxes.
 */
const CONUS = { minLat: 24.4, maxLat: 49.5, minLng: -125.0, maxLng: -66.9 }
const ALASKA = { minLat: 51.0, maxLat: 71.5, minLng: -180.0, maxLng: -129.0 }

export function isInUSCoverage(bounds: {
  north: number
  south: number
  east: number
  west: number
}): boolean {
  const cLat = (bounds.north + bounds.south) / 2
  const cLng = (bounds.east + bounds.west) / 2
  const inConus =
    cLat >= CONUS.minLat &&
    cLat <= CONUS.maxLat &&
    cLng >= CONUS.minLng &&
    cLng <= CONUS.maxLng
  const inAlaska =
    cLat >= ALASKA.minLat &&
    cLat <= ALASKA.maxLat &&
    cLng >= ALASKA.minLng &&
    cLng <= ALASKA.maxLng
  return inConus || inAlaska
}

/**
 * 3DEP nodata sentinel — appears over water, outside coverage, or where
 * source LiDAR was rejected for QC reasons. Plus very-large-negative floats
 * (the GDAL-style sentinel ~-3.4e38).
 */
export function isElevationNodata(v: number): boolean {
  return Number.isNaN(v) || v < -1000 || !Number.isFinite(v)
}

export function compute3DEPExportSize(
  bounds: Bounds,
  targetPixelSizeMeters = DEFAULT_TARGET_PIXEL_METERS,
  caps: { maxSidePixels?: number; maxPixels?: number } = {},
): RasterExportSize {
  const maxSidePixels = caps.maxSidePixels ?? MAX_RASTER_SIDE_PIXELS
  const maxPixels = caps.maxPixels ?? MAX_RASTER_PIXELS
  const centerLat = (bounds.north + bounds.south) / 2
  const widthM = Math.max(1, (bounds.east - bounds.west) * 111_320 * Math.cos((centerLat * Math.PI) / 180))
  const heightM = Math.max(1, (bounds.north - bounds.south) * 111_320)

  let width = Math.max(2, Math.ceil(widthM / targetPixelSizeMeters))
  let height = Math.max(2, Math.ceil(heightM / targetPixelSizeMeters))
  let degraded = false

  const sideScale = Math.max(width / maxSidePixels, height / maxSidePixels, 1)
  if (sideScale > 1) {
    width = Math.max(2, Math.floor(width / sideScale))
    height = Math.max(2, Math.floor(height / sideScale))
    degraded = true
  }

  const pixelScale = Math.sqrt((width * height) / maxPixels)
  if (pixelScale > 1) {
    width = Math.max(2, Math.floor(width / pixelScale))
    height = Math.max(2, Math.floor(height / pixelScale))
    degraded = true
  }

  const actualPixelSizeMeters = Math.max(widthM / width, heightM / height)
  return {
    width,
    height,
    requestedPixelSizeMeters: targetPixelSizeMeters,
    actualPixelSizeMeters,
    degraded,
  }
}

export async function fetch3DEPRaster(
  bounds: Bounds,
  options: RasterFetchOptions = {},
): Promise<RasterDataset> {
  const exportSize = compute3DEPExportSize(bounds, options.targetPixelSizeMeters, {
    maxSidePixels: options.maxSidePixels,
    maxPixels: options.maxPixels,
  })
  const url =
    `${EXPORT_URL}?` +
    new URLSearchParams({
      bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
      bboxSR: '4326',
      imageSR: '4326',
      size: `${exportSize.width},${exportSize.height}`,
      format: 'tiff',
      pixelType: 'F32',
      interpolation: 'RSP_BilinearInterpolation',
      noData: '-9999',
      f: 'image',
    }).toString()

  const res = await fetch3DEPExport(url)
  if (!res.ok) {
    throw new Error(`USGS 3DEP exportImage returned ${res.status}`)
  }

  const buf = await res.arrayBuffer()
  assertTiffResponse(buf)

  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const rawRaster = await image.readRasters({ interleave: true })
  const data = rawRaster instanceof Float32Array
    ? rawRaster
    : Float32Array.from(rawRaster as ArrayLike<number>)
  const nodataMask = new Uint8Array(data.length)
  let nodataCount = 0
  for (let index = 0; index < data.length; index++) {
    if (isElevationNodata(data[index])) {
      nodataMask[index] = 1
      nodataCount++
    }
  }

  const centerLat = (bounds.north + bounds.south) / 2
  const pixelSizeDegreesX = (bounds.east - bounds.west) / width
  const pixelSizeDegreesY = (bounds.north - bounds.south) / height
  const pixelSizeMetersX = Math.abs(pixelSizeDegreesX) * 111_320 * Math.cos((centerLat * Math.PI) / 180)
  const pixelSizeMetersY = Math.abs(pixelSizeDegreesY) * 111_320
  const nodataRatio = nodataCount / Math.max(data.length, 1)

  if (nodataRatio > 0.1) {
    throw new Error(
      `USGS 3DEP returned ${nodataCount} nodata pixels out of ${data.length} (>10%) — coverage too thin`,
    )
  }

  if (exportSize.degraded) {
    console.log(
      `USGS 3DEP raster request degraded: requested ${exportSize.requestedPixelSizeMeters}m, actual ~${exportSize.actualPixelSizeMeters.toFixed(1)}m (${width}x${height})`,
    )
  }

  return {
    data,
    nodataMask,
    width,
    height,
    bounds,
    noData: -9999,
    source: 'USGS_3DEP',
    pixelSizeDegreesX,
    pixelSizeDegreesY,
    pixelSizeMetersX,
    pixelSizeMetersY,
    requestedPixelSizeMeters: exportSize.requestedPixelSizeMeters,
    actualPixelSizeMeters: Math.max(pixelSizeMetersX, pixelSizeMetersY),
    nodataRatio,
  }
}

async function fetch3DEPExport(url: string): Promise<Response> {
  let lastResponse: Response | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TerrainIQ/0.1 (+https://github.com/joshforcier/TerrainIQ)' },
    })
    if (!TRANSIENT_EXPORT_STATUSES.has(response.status) || attempt === 2) {
      return response
    }
    lastResponse = response
    console.warn(`USGS 3DEP exportImage returned ${response.status}; retrying once`)
  }
  return lastResponse as Response
}

function assertTiffResponse(buf: ArrayBuffer): void {
  const sig = new Uint8Array(buf.slice(0, 4))
  const isLittleEndianTiff = sig[0] === 0x49 && sig[1] === 0x49 && sig[2] === 0x2a && sig[3] === 0x00
  const isBigEndianTiff = sig[0] === 0x4d && sig[1] === 0x4d && sig[2] === 0x00 && sig[3] === 0x2a
  if (!isLittleEndianTiff && !isBigEndianTiff) {
    const head = new TextDecoder().decode(buf.slice(0, 200))
    throw new Error(`USGS 3DEP returned non-TIFF response: ${head.slice(0, 120)}`)
  }
}

export async function fetchElevationGrid3DEP(
  bounds: { north: number; south: number; east: number; west: number },
  gridSize = 20,
): Promise<ElevationGrid> {
  const raster = await fetch3DEPRaster(bounds, { targetPixelSizeMeters: DEFAULT_TARGET_PIXEL_METERS })
  return rasterToElevationGrid(raster, gridSize, 'bilinear')
}
