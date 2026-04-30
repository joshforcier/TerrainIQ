/**
 * OSM Overpass API integration — fetches real land cover data for a given bounds.
 * Used to make AI POI placement land-aware.
 */

export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet'

export interface OSMFeature {
  type: 'road' | 'trail' | 'building' | 'water' | 'forest' | 'meadow' | 'regrowth' | 'ridge' | 'stream' | 'town'
  name?: string
  /** Only set when `type === 'town'`. Lets downstream code apply settlement-size-aware buffers. */
  placeKind?: PlaceKind
  geometry: Array<{ lat: number; lng: number }>
}

export interface OSMLandData {
  roads: OSMFeature[]
  trails: OSMFeature[]
  buildings: OSMFeature[]
  water: OSMFeature[]
  forests: OSMFeature[]
  meadows: OSMFeature[]
  regrowth: OSMFeature[]
  ridges: OSMFeature[]
  streams: OSMFeature[]
  towns: OSMFeature[]
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
  center?: { lat: number; lon: number }
}

interface GeoJsonLineFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry?: {
    type: 'LineString' | 'MultiLineString'
    coordinates: number[][] | number[][][]
  }
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features?: GeoJsonLineFeature[]
}

/**
 * Public Overpass mirrors. The main instance returns 406 / 504 under load,
 * so we try them in order. The first one that returns a 2xx wins.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const

// Overpass operators ask that callers identify themselves — requests
// without a User-Agent are increasingly rate-limited or 406'd.
const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'TerrainIQ/0.1 (+https://github.com/joshforcier/TerrainIQ)',
  Accept: 'application/json',
} as const

const USFS_ROADS_QUERY_URL =
  'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer/0/query'
const USFS_ROADS_PAGE_SIZE = 2000
const USFS_ROADS_MAX_FEATURES = 6000

async function postOverpass(body: string): Promise<unknown | null> {
  for (const url of OVERPASS_MIRRORS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: OVERPASS_HEADERS,
        body,
      })
      if (response.ok) {
        return await response.json()
      }
      console.warn(`Overpass ${new URL(url).host} returned ${response.status}`)
    } catch (err) {
      console.warn(`Overpass ${new URL(url).host} fetch error:`, err)
    }
  }
  return null
}

/**
 * Query the Overpass API for land cover features within bounds.
 * Returns categorized features for road avoidance and terrain-aware POI placement.
 */
export async function fetchLandData(bounds: {
  north: number
  south: number
  east: number
  west: number
}): Promise<OSMLandData> {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`

  // Wider bbox for towns (5 miles ≈ 0.072° lat, adjusted for lng)
  const townBuffer = 0.072
  const townBbox = `${bounds.south - townBuffer},${bounds.west - townBuffer * 1.4},${bounds.north + townBuffer},${bounds.east + townBuffer * 1.4}`

  // Query for: roads, trails/paths, buildings, water bodies, forests, meadows/regrowth, ridges, streams, towns
  const query = `
[out:json][timeout:60][maxsize:10485760];
(
  // ALL highway=* tags — covers roads, tracks, service roads, unclassified,
  // link ramps, living_street, pedestrian, busway, raceway, and the generic
  // "road" tag used for poorly-classified backcountry/forest service roads.
  // Trails (path|footway|bridleway|cycleway) are separated downstream in
  // categorizeElements().
  way["highway"](${bbox});
  // Buildings
  way["building"](${bbox});
  // Water bodies
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  // Streams/rivers
  way["waterway"~"^(stream|river|creek)$"](${bbox});
  // Forest/woodland
  way["landuse"="forest"](${bbox});
  way["natural"="wood"](${bbox});
  relation["landuse"="forest"](${bbox});
  relation["natural"="wood"](${bbox});
  // Meadows/grassland
  way["landuse"~"^(meadow|grass)$"](${bbox});
  way["natural"="grassland"](${bbox});
  way["landcover"~"^(grass|herbaceous)$"](${bbox});
  // Burn/clearcut/regrowth proxies. OSM fire history coverage is patchy, so
  // these are treated as open regrowth only when paired with nearby timber.
  way["natural"~"^(scrub|heath)$"](${bbox});
  relation["natural"~"^(scrub|heath)$"](${bbox});
  way["landuse"~"^(clearcut|logging)$"](${bbox});
  relation["landuse"~"^(clearcut|logging)$"](${bbox});
  way["landcover"~"^(scrub|shrubs|brush)$"](${bbox});
  relation["landcover"~"^(scrub|shrubs|brush)$"](${bbox});
  // Ridges/saddles
  node["natural"~"^(ridge|saddle|peak)$"](${bbox});
  way["natural"="ridge"](${bbox});
  // Towns/villages/cities (wider bbox — 5mi buffer for town avoidance)
  node["place"~"^(city|town|village|hamlet)$"](${townBbox});
);
out geom;
`

  const [data, usfsRoads] = await Promise.all([
    postOverpass(`data=${encodeURIComponent(query)}`) as Promise<{ elements: OverpassElement[] } | null>,
    fetchUSFSRoads(bounds),
  ])

  if (!data) {
    console.error('All Overpass mirrors failed — returning empty land data')
    return { ...emptyLandData(), roads: usfsRoads }
  }
  const landData = categorizeElements(data.elements)
  landData.roads.push(...usfsRoads)
  if (usfsRoads.length > 0) {
    console.log(`USFS roads: added ${usfsRoads.length} National Forest System road segments`)
  }
  return landData
}

async function fetchUSFSRoads(bounds: {
  north: number
  south: number
  east: number
  west: number
}): Promise<OSMFeature[]> {
  const roads: OSMFeature[] = []
  for (let offset = 0; offset < USFS_ROADS_MAX_FEATURES; offset += USFS_ROADS_PAGE_SIZE) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: 'ID,NAME,SYMBOL_NAME,SURFACE_TYPE,OPER_MAINT_LEVEL,OPENFORUSETO,ROUTE_STATUS',
      returnGeometry: 'true',
      geometryType: 'esriGeometryEnvelope',
      geometry: JSON.stringify({
        xmin: bounds.west,
        ymin: bounds.south,
        xmax: bounds.east,
        ymax: bounds.north,
        spatialReference: { wkid: 4326 },
      }),
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: String(USFS_ROADS_PAGE_SIZE),
      resultOffset: String(offset),
    })

    try {
      const response = await fetch(`${USFS_ROADS_QUERY_URL}?${params.toString()}`, {
        headers: { Accept: 'application/geo+json, application/json' },
      })
      if (!response.ok) {
        console.warn(`USFS roads returned ${response.status}`)
        break
      }
      const collection = (await response.json()) as GeoJsonFeatureCollection
      const features = collection.features ?? []
      roads.push(...features.flatMap(usfsRoadFeatureToOsmFeatures))
      if (features.length < USFS_ROADS_PAGE_SIZE) break
    } catch (err) {
      console.warn('USFS roads fetch error:', err)
      break
    }
  }
  return roads
}

function usfsRoadFeatureToOsmFeatures(feature: GeoJsonLineFeature): OSMFeature[] {
  if (!feature.geometry) return []
  const name = usfsRoadName(feature.properties)
  if (feature.geometry.type === 'LineString') {
    const geometry = lineCoordinatesToLatLng(feature.geometry.coordinates as number[][])
    return geometry.length >= 2 ? [{ type: 'road', name, geometry }] : []
  }

  return (feature.geometry.coordinates as number[][][])
    .map(lineCoordinatesToLatLng)
    .filter((geometry) => geometry.length >= 2)
    .map((geometry) => ({ type: 'road', name, geometry }))
}

function usfsRoadName(properties?: Record<string, unknown>): string | undefined {
  if (!properties) return 'USFS road'
  const name = stringProp(properties, 'NAME')
  const id = stringProp(properties, 'ID')
  const surface = stringProp(properties, 'SURFACE_TYPE') ?? stringProp(properties, 'SYMBOL_NAME')
  const base = name || (id ? `USFS ${id}` : 'USFS road')
  return surface ? `${base} (${surface})` : base
}

function stringProp(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key] ?? properties[key.toLowerCase()]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function lineCoordinatesToLatLng(coordinates: number[][]): Array<{ lat: number; lng: number }> {
  return coordinates
    .map((coord) => ({ lng: coord[0], lat: coord[1] }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
}

function emptyLandData(): OSMLandData {
  return {
    roads: [],
    trails: [],
    buildings: [],
    water: [],
    forests: [],
    meadows: [],
    regrowth: [],
    ridges: [],
    streams: [],
    towns: [],
  }
}

function categorizeElements(elements: OverpassElement[]): OSMLandData {
  const data = emptyLandData()

  for (const el of elements) {
    const tags = el.tags || {}
    const geom = extractGeometry(el)
    if (geom.length === 0) continue

    const name = tags.name || undefined
    const highway = tags.highway
    const natural = tags.natural
    const landuse = tags.landuse
    const landcover = tags.landcover
    const waterway = tags.waterway
    const building = tags.building

    if (highway) {
      const isTrail = ['path', 'footway', 'bridleway', 'cycleway'].includes(highway)
      if (isTrail) {
        data.trails.push({ type: 'trail', name, geometry: geom })
      } else {
        data.roads.push({ type: 'road', name, geometry: geom })
      }
    } else if (building) {
      data.buildings.push({ type: 'building', name, geometry: geom })
    } else if (natural === 'water') {
      data.water.push({ type: 'water', name, geometry: geom })
    } else if (waterway) {
      data.streams.push({ type: 'stream', name, geometry: geom })
    } else if (landuse === 'forest' || natural === 'wood') {
      data.forests.push({ type: 'forest', name, geometry: geom })
    } else if (landuse === 'meadow' || landuse === 'grass' || natural === 'grassland' || landcover === 'grass' || landcover === 'herbaceous') {
      data.meadows.push({ type: 'meadow', name, geometry: geom })
    } else if (
      natural === 'scrub' ||
      natural === 'heath' ||
      landuse === 'clearcut' ||
      landuse === 'logging' ||
      landcover === 'scrub' ||
      landcover === 'shrubs' ||
      landcover === 'brush'
    ) {
      data.regrowth.push({ type: 'regrowth', name, geometry: geom })
    } else if (natural === 'ridge' || natural === 'saddle' || natural === 'peak') {
      data.ridges.push({ type: 'ridge', name, geometry: geom })
    } else if (tags.place && ['city', 'town', 'village', 'hamlet'].includes(tags.place)) {
      data.towns.push({
        type: 'town',
        name,
        placeKind: tags.place as PlaceKind,
        geometry: geom,
      })
    }
  }

  return data
}

function extractGeometry(el: OverpassElement): Array<{ lat: number; lng: number }> {
  // Ways with full geometry
  if (el.geometry && el.geometry.length > 0) {
    return el.geometry.map(p => ({ lat: p.lat, lng: p.lon }))
  }
  // Nodes (points)
  if (el.lat != null && el.lon != null) {
    return [{ lat: el.lat, lng: el.lon }]
  }
  // Relations with center
  if (el.center) {
    return [{ lat: el.center.lat, lng: el.center.lon }]
  }
  return []
}

/**
 * Build a human-readable terrain summary for the GPT prompt.
 */
export function summarizeLandData(data: OSMLandData): string {
  const lines: string[] = []

  if (data.roads.length > 0) {
    const named = data.roads.filter(r => r.name).map(r => r.name)
    lines.push(`ROADS (${data.roads.length} segments): ${named.length > 0 ? named.slice(0, 8).join(', ') : 'unnamed roads present'}`)
  }

  if (data.trails.length > 0) {
    const named = data.trails.filter(r => r.name).map(r => r.name)
    lines.push(`TRAILS/PATHS (${data.trails.length} segments): ${named.length > 0 ? named.slice(0, 8).join(', ') : 'unnamed trails present'}`)
  }

  if (data.buildings.length > 0) {
    lines.push(`BUILDINGS: ${data.buildings.length} structures in area`)
  }

  if (data.water.length > 0) {
    const named = data.water.filter(w => w.name).map(w => w.name)
    lines.push(`WATER BODIES (${data.water.length}): ${named.length > 0 ? named.slice(0, 5).join(', ') : 'unnamed ponds/lakes'}`)
  }

  if (data.streams.length > 0) {
    const named = data.streams.filter(s => s.name).map(s => s.name)
    lines.push(`STREAMS/CREEKS (${data.streams.length}): ${named.length > 0 ? named.slice(0, 5).join(', ') : 'unnamed streams'}`)
  }

  if (data.forests.length > 0) {
    lines.push(`FOREST/WOODLAND: ${data.forests.length} areas`)
  }

  if (data.meadows.length > 0) {
    const named = data.meadows.filter(m => m.name).map(m => m.name)
    lines.push(`MEADOWS/GRASSLAND (${data.meadows.length}): ${named.length > 0 ? named.slice(0, 5).join(', ') : 'open grassy areas'}`)
  }

  if (data.regrowth.length > 0) {
    const named = data.regrowth.filter(r => r.name).map(r => r.name)
    lines.push(`REGROWTH / BURN-CLEARCUT PROXIES (${data.regrowth.length}): ${named.length > 0 ? named.slice(0, 5).join(', ') : 'scrub/heath/clearcut-style openings'}`)
  }

  if (data.ridges.length > 0) {
    const named = data.ridges.filter(r => r.name).map(r => r.name)
    lines.push(`RIDGES/SADDLES/PEAKS (${data.ridges.length}): ${named.length > 0 ? named.slice(0, 5).join(', ') : 'topographic features'}`)
  }

  if (lines.length === 0) {
    return 'No detailed land cover data available for this area.'
  }

  return lines.join('\n')
}

/**
 * Build a list of road/trail line segments for distance checking.
 * Returns consecutive point pairs — every segment of every road/trail.
 */
export interface LineSegment {
  a: { lat: number; lng: number }
  b: { lat: number; lng: number }
}

export function getRoadTrailSegments(data: OSMLandData): LineSegment[] {
  const segments: LineSegment[] = []

  for (const feature of [...data.roads, ...data.trails]) {
    for (let i = 0; i < feature.geometry.length - 1; i++) {
      segments.push({ a: feature.geometry[i], b: feature.geometry[i + 1] })
    }
  }

  return segments
}

/**
 * Haversine distance in meters between two lat/lng points.
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Minimum distance in meters from a point to a line segment (a→b).
 * Projects the point onto the segment and clamps to endpoints.
 */
export function distToSegmentMeters(
  lat: number, lng: number,
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  // Work in a flat approximation (good enough for <10km segments)
  const cosLat = Math.cos(lat * Math.PI / 180)
  const px = (lng - a.lng) * cosLat
  const py = lat - a.lat
  const dx = (b.lng - a.lng) * cosLat
  const dy = b.lat - a.lat

  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    // Segment is a single point
    return haversineMeters(lat, lng, a.lat, a.lng)
  }

  // Projection parameter clamped to [0, 1]
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq))

  // Closest point on segment in degree space
  const closestLng = a.lng + (t * (b.lng - a.lng))
  const closestLat = a.lat + (t * (b.lat - a.lat))

  return haversineMeters(lat, lng, closestLat, closestLng)
}

/**
 * Check if a point is within `bufferMeters` of any road/trail line segment.
 */
export function isNearRoadOrTrail(
  lat: number,
  lng: number,
  segments: LineSegment[],
  bufferMeters: number
): boolean {
  for (const seg of segments) {
    if (distToSegmentMeters(lat, lng, seg.a, seg.b) < bufferMeters) {
      return true
    }
  }
  return false
}
