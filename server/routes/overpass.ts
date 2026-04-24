/**
 * OSM Overpass API integration — fetches real land cover data for a given bounds.
 * Used to make AI POI placement land-aware.
 */

export interface OSMFeature {
  type: 'road' | 'trail' | 'building' | 'water' | 'forest' | 'meadow' | 'ridge' | 'stream' | 'town'
  name?: string
  geometry: Array<{ lat: number; lng: number }>
}

export interface OSMLandData {
  roads: OSMFeature[]
  trails: OSMFeature[]
  buildings: OSMFeature[]
  water: OSMFeature[]
  forests: OSMFeature[]
  meadows: OSMFeature[]
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

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

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

  // Query for: roads, trails/paths, buildings, water bodies, forests, meadows, ridges, streams, towns
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
  // Ridges/saddles
  node["natural"~"^(ridge|saddle|peak)$"](${bbox});
  way["natural"="ridge"](${bbox});
  // Towns/villages/cities (wider bbox — 5mi buffer for town avoidance)
  node["place"~"^(city|town|village|hamlet)$"](${townBbox});
);
out geom;
`

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })

    if (!response.ok) {
      console.error(`Overpass API returned ${response.status}`)
      return emptyLandData()
    }

    const data = await response.json() as { elements: OverpassElement[] }
    return categorizeElements(data.elements)
  } catch (err) {
    console.error('Overpass API error:', err)
    // Return empty data — don't block POI generation if Overpass is down
    return emptyLandData()
  }
}

function emptyLandData(): OSMLandData {
  return {
    roads: [],
    trails: [],
    buildings: [],
    water: [],
    forests: [],
    meadows: [],
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
    } else if (landuse === 'meadow' || landuse === 'grass' || natural === 'grassland') {
      data.meadows.push({ type: 'meadow', name, geometry: geom })
    } else if (natural === 'ridge' || natural === 'saddle' || natural === 'peak') {
      data.ridges.push({ type: 'ridge', name, geometry: geom })
    } else if (tags.place && ['city', 'town', 'village', 'hamlet'].includes(tags.place)) {
      data.towns.push({ type: 'town', name, geometry: geom })
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
