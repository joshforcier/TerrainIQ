import type { Request, Response } from 'express'
import OpenAI from 'openai'
import {
  fetchLandData,
  summarizeLandData,
  getRoadTrailSegments,
  isNearRoadOrTrail,
  haversineMeters,
} from './overpass.js'
import { fetchElevationGrid } from '../services/elevation.js'
import {
  analyzeTerrainForPrompt,
  formatFeaturesForPrompt,
  computeSlopeAspect,
  type TerrainPoint,
} from '../services/terrainAnalysis.js'
import { isInElkRange } from '../services/elkRange.js'

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Create a .env file with your key.')
  }
  return new OpenAI({ apiKey })
}

interface GeneratePOIRequest {
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  season: string
  timeOfDay: string
  zoom: number
  bufferMiles?: number
}

const METERS_PER_MILE = 1609.34
const DEFAULT_BUFFER_MILES = 0.5

const TIMES = ['dawn', 'midday', 'dusk'] as const
const PRESSURES = ['low', 'medium', 'high'] as const

/**
 * Find the nearest terrain grid point to a given lat/lng and return
 * verified elevation, slope, and aspect.
 */
function lookupTerrain(
  lat: number,
  lng: number,
  terrainPoints: TerrainPoint[]
): { elevation: number; slope: number; aspect: string; distMeters: number } {
  let nearest = terrainPoints[0]
  let minDist = Infinity

  for (const pt of terrainPoints) {
    const dLat = pt.lat - lat
    const dLng = pt.lng - lng
    // Approximate squared distance (fine for nearest-neighbor on small areas)
    const d = dLat * dLat + dLng * dLng
    if (d < minDist) {
      minDist = d
      nearest = pt
    }
  }

  const distMeters = haversineMeters(lat, lng, nearest.lat, nearest.lng)
  return {
    elevation: nearest.elevation,
    slope: nearest.slope,
    aspect: nearest.aspectLabel,
    distMeters,
  }
}

function mToFt(m: number): string {
  return Math.round(m * 3.28084).toLocaleString()
}

/**
 * Slope/aspect bounds each POI type must respect to be plausible.
 * A POI whose verified slope falls outside these bounds is almost certainly
 * the AI making up terrain that doesn't exist at the coordinates it picked.
 */
function terrainMatchesType(type: string | undefined, slope: number): boolean {
  switch ((type ?? '').toLowerCase()) {
    case 'meadow':   return slope <= 15            // flat to gentle open ground
    case 'wallow':   return slope <= 12            // flat boggy spots
    case 'bench':    return slope >= 4 && slope <= 28 // a step on a slope
    case 'drainage': return slope >= 4             // drainages run downhill
    case 'saddle':   return slope <= 25            // low point between highs
    case 'spring':   return slope <= 25            // spring sources
    default:         return true                    // unknown types — don't block
  }
}

/**
 * Reject POIs that look like valley-bottom road corridors OSM forgot:
 * very low slope AND within 50m of the area's minimum elevation.
 */
function looksLikeHiddenRoad(slope: number, elevation: number, minElevation: number): boolean {
  return slope < 3 && (elevation - minElevation) < 50
}

/**
 * Detect POIs that are part of a grid/line cluster — 4+ POIs sharing
 * (approximately) the same latitude or longitude. Returns the indices to drop.
 */
function findGridOutliers(
  pois: Array<{ lat: number; lng: number }>,
  toleranceMeters = 40,
  minCluster = 4,
): Set<number> {
  const outliers = new Set<number>()
  if (pois.length < minCluster) return outliers

  const sharedLat = new Array(pois.length).fill(0)
  const sharedLng = new Array(pois.length).fill(0)

  for (let i = 0; i < pois.length; i++) {
    const p = pois[i]
    const cosLat = Math.cos((p.lat * Math.PI) / 180)
    for (let j = i + 1; j < pois.length; j++) {
      const q = pois[j]
      const dLatM = Math.abs(p.lat - q.lat) * 111320
      const dLngM = Math.abs(p.lng - q.lng) * 111320 * cosLat
      if (dLatM < toleranceMeters) { sharedLat[i]++; sharedLat[j]++ }
      if (dLngM < toleranceMeters) { sharedLng[i]++; sharedLng[j]++ }
    }
  }

  for (let i = 0; i < pois.length; i++) {
    if (sharedLat[i] >= minCluster - 1 || sharedLng[i] >= minCluster - 1) {
      outliers.add(i)
    }
  }
  return outliers
}

/**
 * Replace elevation / slope numbers in an AI-written description with the
 * real values from the terrain grid. Keeps the AI's prose voice but cleans
 * up the obvious lies (e.g. "6,959 ft bench" on flat ground near a road).
 */
function correctDescriptionText(
  desc: string | undefined,
  real: { elevationFt: string; slope: number },
): string {
  if (!desc) return ''
  let out = desc

  // Elevation: "9,500 ft" / "9500ft" / "6,959 feet" / "10400 feet"
  const elevPattern = /\b\d{1,2}[,.]?\d{3}\s*(?:ft|feet)\b/gi
  out = out.replace(elevPattern, `${real.elevationFt} ft`)

  // Slope: "18° slope" / "25-degree slope" / "30° sidehill" / "10°" when near "slope"
  const slopeAnnotated = /\b\d{1,2}\s*(?:°|deg(?:rees?)?)\s*(?:slope|sidehill|grade|pitch)?\b/gi
  out = out.replace(slopeAnnotated, `${Math.round(real.slope)}°`)

  return out
}

/**
 * Season-specific behavior rules used in the GPT prompt.
 */
const seasonBehaviorRules: Record<string, string> = {
  rut: `SEASON: RUT (Mid-Sep to Mid-Oct) — Breeding overrides energy economics.

FEEDING (weight: dawn 35%, dusk 40%):
- Elk feed in meadows and parks during predawn/dusk. Cows maintain feeding patterns but are herded by bulls.
- Place feeding POIs on mapped meadows/grasslands WITHIN 100-200m of timber edge (elk never venture farther during daylight).
- The transition zone (100-400m band where timber thins to meadow) is the highest-probability encounter zone.

WATER (weight: dawn 50%, dusk 55%):
- HIGH importance during rut. Elk stay within 400m of water. Cows need daily water, bulls won't let them wander far.
- Place water POIs near confirmed streams, springs, and drainage confluences within 400m of bedding timber.

BEDDING (weight: midday 80%):
- North/northeast-facing slopes, 10-30° slope, 60-80% canopy cover with relatively open understory.
- Benches and flats at 1/3 to 2/3 up a slope — high enough for thermal advantage, low enough for water/feed access.
- Place on detected BENCH features on N/NE aspects. Herd bulls bed near cow herds.
- Satellite bulls bed on adjacent finger ridges, 100-300m uphill from herd bull.

WALLOWS (weight: dawn 75%, midday 70%, dusk 80%):
- CRITICAL rut feature. Flat boggy areas near springs or seeps WITHIN timber, at the heads of small drainages.
- Place on detected DRAINAGE features near confirmed streams. Look for low-slope areas (<10°) near water in timber.
- Fresh wallows have torn-up ground, rubbed trees, strong urine smell. Bulls revisit multiple times per day.

TRAVEL (weight: dawn 85%, dusk 90%):
- Peak movement at dawn and dusk. Bulls herd cows along ridgelines, saddles, and timber edges.
- Travel follows terrain funnels: saddles between drainages, benches connecting meadows to timber, creek bottom edges, finger ridge tops.
- Place at detected SADDLE points and on ridgeline/finger-ridge features connecting bedding to feeding areas.

SECURITY (weight: dawn 40%, midday 60%, dusk 35%):
- Where elk flee when pressured by hunters. Steep terrain (25-40°+), dense timber (80%+ canopy), >1 mile from roads/trails, >5 miles from any town or settlement.
- Drainage heads where multiple ridges converge — thickest timber, least human traffic, multiple escape routes.
- North-facing dark timber bowls with blowdown and deadfall. If you can see 50 yards, it's not thick enough.
- NEVER place security POIs within 5 miles of a town, village, or developed area. True elk security terrain is remote and far from human activity.
- Place on the steepest, most remote terrain in the analysis area — detected drainage heads, steep N/NE benches, and finger ridges deep in timber.
- During rut, pressured bulls abandon bugling and retreat to security cover. Mid-day security is critical — bedded elk in security terrain are nearly unapproachable.`,

  'post-rut': `SEASON: POST-RUT (Mid-Oct to Mid-Nov) — Recovery phase. Most difficult to pattern.

FEEDING (weight: dawn 65%, dusk 75%):
- Feeding becomes primary driver. Bulls are depleted (lost 15-20% body weight) and need calories.
- Bulls often DON'T LEAVE TIMBER — they feed in small openings and shaded parks within canopy. Do NOT place bull feeding POIs in open meadows.
- Cow herds return to predictable feed-to-bed patterns on south/southeast-facing slopes.
- Place feeding POIs at timber edges and small clearings WITHIN forest, not in large open meadows.

WATER (weight: dawn 30%, dusk 35%):
- Moderate importance. Bulls water every 24-48 hours, often at night. Less critical than rut.
- Place water POIs near streams but expect nighttime-only visits.

BEDDING (weight: midday 95%):
- Densest available timber on north/northeast-facing slopes. 80%+ canopy closure, deadfall, limited visibility (<40-50 yards).
- Slope increases to 20-40° — steeper terrain provides security. Approaching hunters must make noise on steep faces.
- Thermal advantage critical: morning thermals rise (scent from below), evening thermals sink (scent from above).
- Place on detected BENCH features on N/NE aspects with steep surrounding terrain. Also: dark timber bowls, drainage heads where ridges converge, blowdown areas.
- Distance to water DECREASES in importance — bulls drink at night.

WALLOWS (weight: ~5%):
- Nearly irrelevant post-rut. Bulls have stopped breeding behavior. Do not prioritize.

TRAVEL (weight: dawn 35%, dusk 40%):
- Minimal movement. Bulls emerge late and cautiously at dusk, if at all.
- Place travel POIs ONLY on the most sheltered corridors — drainage bottoms and timber-to-timber connections. NOT exposed ridgelines.

SECURITY (weight: dawn 70%, midday 90%, dusk 65%):
- PEAK SECURITY SEASON. Depleted bulls are maximally pressure-sensitive. Flight distance increases to 400m+.
- Bulls retreat to the most impenetrable terrain available: steep N/NE faces (25-40°), 80%+ canopy, deadfall, dog-hair timber.
- Drainage heads where 2-3 ridges converge — multiple escape routes, thickest cover, farthest from roads.
- Blowdown areas and steep sidehill benches where approach noise is unavoidable. If a hunter can get within 200 yards without being detected, it's not security cover.
- NEVER place security POIs within 5 miles of a town, village, or developed area. True elk security terrain is remote and far from human activity.
- Place on the steepest, darkest, most remote N/NE terrain. These are the spots pressured bulls will not leave for days.`,

  'late-season': `SEASON: LATE SEASON (Late Nov through Dec) — Energy conservation. Cold + snow dominate.

FEEDING (weight: dawn 90%, dusk 90%):
- Survival mode. Elk need calories desperately. Large herds (50-200+ animals) on limited winter range.
- Elk feed in open SOUTH-FACING meadows and slopes. Most visible and predictable elk of the year.
- Same feeding areas on the same schedule daily until disrupted.
- Place feeding POIs on south-facing mapped meadows. The south-facing transition zone (timber edge above meadow) is THE most important late-season terrain feature.

WATER (weight: ~10%):
- Nearly irrelevant. Snow provides hydration. Elk may not visit open water at all. Do not prioritize.

BEDDING (weight: midday 85%):
- ASPECT FLIPS from earlier seasons. Elk bed on SOUTH/SOUTHWEST-facing slopes (15-25°F warmer than north-facing).
- Slope decreases to 5-20° — elk conserve energy on gentler terrain. Rely on herd vigilance, not steep escape terrain.
- Wind protection critical: leeward side of ridges, sheltered from prevailing NW wind.
- Avoid areas with >18-24 inches soft snow. Seek windblown ridges, south-facing openings, under dense canopy.
- Place on detected BENCH features on S/SW aspects near south-facing meadows.

WALLOWS (weight: 0%):
- Dormant. Zero relevance. Do not generate wallow POIs for late season.

TRAVEL (weight: dawn 45%, dusk 50%):
- Elk move between a few core feeding and bedding areas on a tight daily pattern.
- Migration corridors: narrow valleys, saddles, ridgelines funneling elk from summer to winter range. Storms trigger active migration.
- Place at saddles and along ridgelines connecting south-facing feeding to south-facing bedding timber.

SECURITY (weight: dawn 30%, midday 55%, dusk 25%):
- Late-season elk rely more on herd vigilance (50-200+ animals) than terrain for security.
- When pressured, herds shift to the most remote south-facing timber with wind shelter — leeward side of ridges blocking NW wind.
- Deep drainage bottoms with thick willows/brush, steep south-facing bowls with timber, and areas >1 mile from any road or trail.
- Snow makes approach noise unavoidable — security terrain in late season is anywhere deep snow or crust makes silent stalking impossible.
- NEVER place security POIs within 5 miles of a town, village, or developed area. True elk security terrain is remote and far from human activity.
- Place on remote S/SW timbered terrain with steep surrounding approaches and limited access.`,
}

/**
 * Hunting pressure context injected into the prompt.
 */
const pressureContext: Record<string, string> = {
  low: `HUNTING PRESSURE: LOW
- Minimal human activity in the area. Elk behave naturally with short flight distances (~100m).
- Elk use open meadows, exposed ridgelines, and terrain close to roads/trails more freely.
- Security terrain is less important — elk don't need to hide. Favor feeding, water, and travel POIs in accessible terrain.
- Bulls bugle openly (rut), feed in open parks (post-rut), and use large open meadows (late season).
- POIs can be placed in more visible, open terrain. Elk are patternable and predictable.`,

  medium: `HUNTING PRESSURE: MODERATE
- Typical hunting season pressure. Elk have been bumped a few times and are adjusting patterns.
- Flight distance increases to 200-300m. Elk shift feeding times earlier/later (more crepuscular).
- Some displacement from easy-access areas. Elk move 0.5-1 mile deeper from roads and trails.
- Balance POIs between accessible terrain and moderate security cover. Transition zones remain productive.
- Bulls reduce bugling frequency (rut), become more nocturnal (post-rut), and tighten herd grouping (late season).`,

  high: `HUNTING PRESSURE: HIGH
- Heavy hunting activity. Elk have been pushed hard and are in full survival mode.
- Flight distance 400m+. Elk become largely nocturnal — feeding happens in darkness, daylight movement minimal.
- Elk abandon all terrain within 1 mile of roads, trails, and access points. They shift to the steepest, thickest, most remote terrain available.
- HEAVILY favor security POIs. Place feeding/water POIs only in remote, heavily timbered areas far from access.
- During daylight, elk are in the nastiest terrain: 25-40° north-facing slopes with 80%+ canopy, blowdown, deadfall, drainage heads where ridges converge.
- Travel corridors shift to drainage bottoms and timber-to-timber connections only — no exposed ridgelines.
- POIs should be placed in terrain that is physically difficult for hunters to reach. If it's easy to get to, elk aren't there.`,
}

/**
 * Build the GPT prompt for a specific season + time + pressure combo, reusing shared terrain context.
 */
function buildPrompt(
  season: string,
  timeOfDay: string,
  pressure: string,
  bounds: GeneratePOIRequest['bounds'],
  centerLat: number,
  centerLng: number,
  terrain: { elevationProfile: string; slopeAnalysis: string; aspectBreakdown: string; elkHabitatNotes: string },
  featuresList: string,
  terrainSummary: string,
  roadAvoidanceSection: string,
  terrainFeaturesSection: string,
  bufferMiles: number,
  bufferMeters: number,
): string {
  const rules = seasonBehaviorRules[season] || seasonBehaviorRules['rut']
  const pressureRules = pressureContext[pressure] || pressureContext['medium']

  return `You are an expert elk hunting guide placing points of interest using REAL terrain data. You have actual elevation measurements, computed slope/aspect, and verified land cover from OpenStreetMap. Every POI must be grounded in the data below.

MAP BOUNDS:
- North: ${bounds.north.toFixed(5)}, South: ${bounds.south.toFixed(5)}
- East: ${bounds.east.toFixed(5)}, West: ${bounds.west.toFixed(5)}
- Center: ${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}
- Time of day: ${timeOfDay}

REAL ELEVATION DATA:
${terrain.elevationProfile}
${terrain.slopeAnalysis}
${terrain.aspectBreakdown}

${rules}

${pressureRules}

ELK HABITAT ASSESSMENT:
${terrain.elkHabitatNotes}

LAND COVER (OpenStreetMap):
${terrainSummary}
${roadAvoidanceSection}
${terrainFeaturesSection}
${featuresList}
UNIVERSAL PRINCIPLES:
- Thermals: Morning thermals flow UPHILL, evening thermals flow DOWNHILL. Elk bed where thermals create predictable scent detection (points, ridge noses, bench edges).
- Escape routes: Elk always bed with 2+ escape routes (downhill into drainage + lateral along bench/contour). Single-exit bedding = unused.
- Pressure response: Pressured elk shift to thicker, steeper, more remote terrain. Best areas are >1 mile from roads with no ATV access.
- Transition zone: The 100-400m band where timber thins to meadow is the #1 encounter zone across all seasons. Hunt it at first/last 90 min of daylight.

PLACEMENT RULES:
1. ALL POIs must be >${bufferMiles.toFixed(2)} miles (${Math.round(bufferMeters)}m) from ANY road, trail, or building listed above.
2. ALL POIs must be >5 miles from any town, village, hamlet, or settlement.
3. Use REAL coordinates from detected terrain features and OSM data — do not invent locations.
4. NEVER place near buildings or developed areas.
5. Match POI type to real terrain: "meadow" ONLY on mapped meadows, "drainage" ONLY at real drainage points, "saddle" ONLY at detected saddles, "spring" ONLY near confirmed water.
6. Descriptions MUST reference actual elevation, slope angle, aspect, and specific tactical advice for the current season + time of day.
7. For "${timeOfDay}" specifically: focus POIs on the behaviors with the highest weights for this time window.
8. NEVER place POIs in a straight line, evenly-spaced row, or regular grid pattern. Real elk terrain is irregular — POIs should follow the natural shape of drainages, ridgelines, and meadow edges, never share the same latitude or longitude, and never be uniformly spaced. If two POIs would land within ~150m of each other, drop one. If you cannot find enough genuinely distinct terrain features, return FEWER POIs rather than fabricating positions to fill the area.

Generate up to 20 points of interest. Only generate POIs where the terrain genuinely supports the behavior — if the area lacks suitable terrain for a behavior, generate fewer or zero POIs for it. Quality over quantity. Coordinates STRICTLY WITHIN bounds. Empty arrays are acceptable when terrain doesn't support a behavior — DO NOT pad with grid-pattern POIs.

POI types: meadow, drainage, wallow, saddle, spring, bench
Behaviors: feeding, water, bedding, wallows, travel, security

Respond with ONLY valid JSON:
{
  "pois": [
    {
      "name": "string - descriptive name referencing the actual terrain feature",
      "lat": number,
      "lng": number,
      "type": "meadow|drainage|wallow|saddle|spring|bench",
      "relatedBehaviors": ["feeding", "water", etc - only behaviors relevant to this season],
      "description": "string - 2-3 sentences: what the terrain is, why elk use it this season/time, and specific tactical hunting advice (where to set up, wind direction, approach)"
    }
  ]
}`
}

export async function generatePOIs(req: Request, res: Response) {
  const { bounds, bufferMiles: rawBuffer } = req.body as GeneratePOIRequest

  // Clamp buffer to 0.1–2.0 miles
  const bufferMiles = Math.max(0.1, Math.min(2.0, rawBuffer ?? DEFAULT_BUFFER_MILES))
  const bufferMeters = bufferMiles * METERS_PER_MILE

  if (!bounds || bounds.north == null || bounds.south == null || bounds.east == null || bounds.west == null) {
    res.status(400).json({ error: 'Missing map bounds' })
    return
  }

  if (bounds.north <= bounds.south || bounds.east <= bounds.west) {
    res.status(400).json({ error: 'Invalid bounds: north must be > south, east must be > west' })
    return
  }

  const midLatRad = (((bounds.north + bounds.south) / 2) * Math.PI) / 180
  const heightM = (bounds.north - bounds.south) * 111320
  const widthM = (bounds.east - bounds.west) * 111320 * Math.cos(midLatRad)
  const MAX_SIDE_METERS = 1609.34 * 5.5

  if (heightM > MAX_SIDE_METERS || widthM > MAX_SIDE_METERS) {
    res.status(400).json({
      error: `Area too large (${(widthM / 1609.34).toFixed(2)} mi × ${(heightM / 1609.34).toFixed(2)} mi). Zoom in to 5 mi × 5 mi or smaller.`
    })
    return
  }

  if (!isInElkRange(bounds)) {
    res.status(400).json({
      error: 'Selected area is outside known elk range. Pick an area in the Rocky Mountains, Pacific Northwest, or a known reintroduction pocket.'
    })
    return
  }

  const centerLat = (bounds.north + bounds.south) / 2
  const centerLng = (bounds.east + bounds.west) / 2

  try {
    // ── Step 1: Fetch real data in parallel (shared across all 9 combos) ──
    console.log('Fetching OSM land data + elevation grid...')
    const [landData, elevGrid] = await Promise.all([
      fetchLandData(bounds),
      fetchElevationGrid(bounds, 20), // 20×20 = 400 points, 4 API calls
    ])

    const terrainSummary = summarizeLandData(landData)
    const roadTrailSegments = getRoadTrailSegments(landData)

    const totalRoadPts = landData.roads.reduce((n, r) => n + r.geometry.length, 0)
    const totalTrailPts = landData.trails.reduce((n, r) => n + r.geometry.length, 0)
    const townPoints = landData.towns.flatMap(t => t.geometry)
    console.log(`OSM: ${landData.roads.length} roads (${totalRoadPts} pts), ${landData.trails.length} trails (${totalTrailPts} pts), ${landData.forests.length} forests, ${landData.meadows.length} meadows, ${landData.water.length} water, ${landData.streams.length} streams, ${landData.towns.length} towns`)
    console.log(`Road/trail segments for buffer check: ${roadTrailSegments.length}`)
    console.log(`Elevation: ${elevGrid.minElevation.toFixed(0)}m – ${elevGrid.maxElevation.toFixed(0)}m (${elevGrid.points.length} points)`)

    // ── Step 2: Analyze terrain from real elevation data ──
    const terrain = analyzeTerrainForPrompt(elevGrid, landData)
    const featuresList = formatFeaturesForPrompt(terrain.detectedFeatures)

    console.log(`Terrain: ${terrain.detectedFeatures.length} features detected`)

    // ── Step 3: Build road avoidance section ──
    let roadAvoidanceSection = ''
    if (landData.roads.length > 0 || landData.trails.length > 0) {
      const roadSamples: string[] = []
      for (const road of landData.roads.slice(0, 15)) {
        const mid = road.geometry[Math.floor(road.geometry.length / 2)]
        if (mid) {
          roadSamples.push(`  - ${road.name || 'Unnamed road'}: ~${mid.lat.toFixed(5)}, ${mid.lng.toFixed(5)}`)
        }
      }
      for (const trail of landData.trails.slice(0, 10)) {
        const mid = trail.geometry[Math.floor(trail.geometry.length / 2)]
        if (mid) {
          roadSamples.push(`  - ${trail.name || 'Unnamed trail'}: ~${mid.lat.toFixed(5)}, ${mid.lng.toFixed(5)}`)
        }
      }
      roadAvoidanceSection = `
ROADS AND TRAILS TO AVOID (maintain ${bufferMiles.toFixed(2)} mile / ${Math.round(bufferMeters)}m buffer from ALL of these):
${roadSamples.join('\n')}
`
    }

    // ── Step 4: Build terrain features for prompt ──
    let terrainFeaturesSection = ''
    if (landData.meadows.length > 0 || landData.water.length > 0 || landData.streams.length > 0 || landData.forests.length > 0) {
      const features: string[] = []
      for (const meadow of landData.meadows.slice(0, 8)) {
        const center = meadow.geometry[Math.floor(meadow.geometry.length / 2)]
        if (center) {
          features.push(`  - Meadow${meadow.name ? ` "${meadow.name}"` : ''}: ~${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`)
        }
      }
      for (const water of landData.water.slice(0, 5)) {
        const center = water.geometry[Math.floor(water.geometry.length / 2)]
        if (center) {
          features.push(`  - Water body${water.name ? ` "${water.name}"` : ''}: ~${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`)
        }
      }
      for (const stream of landData.streams.slice(0, 8)) {
        const mid = stream.geometry[Math.floor(stream.geometry.length / 2)]
        if (mid) {
          features.push(`  - Stream${stream.name ? ` "${stream.name}"` : ''}: ~${mid.lat.toFixed(5)}, ${mid.lng.toFixed(5)}`)
        }
      }
      for (const forest of landData.forests.slice(0, 5)) {
        const center = forest.geometry[Math.floor(forest.geometry.length / 2)]
        if (center) {
          features.push(`  - Forest${forest.name ? ` "${forest.name}"` : ''}: ~${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`)
        }
      }
      for (const ridge of landData.ridges.slice(0, 5)) {
        const center = ridge.geometry[0]
        if (center) {
          features.push(`  - ${ridge.name || 'Ridge/Saddle'}: ~${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`)
        }
      }
      terrainFeaturesSection = `
OSM LAND COVER FEATURES:
${features.join('\n')}
`
    }

    // ── Step 5: Compute terrain grid for verification (shared across all combos) ──
    const terrainPoints = computeSlopeAspect(elevGrid)

    // ── Step 6: Build and run all 9 time×pressure GPT calls in parallel ──
    const openai = getClient()
    const buildingPoints = landData.buildings.flatMap(b => b.geometry)

    type ComboKey = `${typeof TIMES[number]}_${typeof PRESSURES[number]}`
    const comboResults: Record<string, unknown[]> = {}

    // Season is fixed from the request body
    const season = (req.body as GeneratePOIRequest).season || 'rut'
    console.log(`Launching 9 parallel GPT calls (3 times × 3 pressures) for season: ${season}...`)

    const comboPromises = TIMES.flatMap(timeOfDay =>
      PRESSURES.map(async (pressure) => {
        const key: ComboKey = `${timeOfDay}_${pressure}`

        try {
          const prompt = buildPrompt(
            season, timeOfDay, pressure, bounds, centerLat, centerLng,
            terrain, featuresList, terrainSummary,
            roadAvoidanceSection, terrainFeaturesSection,
            bufferMiles, bufferMeters,
          )

          const completion = await openai.chat.completions.create({
            model: 'gpt-5.4-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_completion_tokens: 8000,
            response_format: { type: 'json_object' },
          })

          const choice = completion.choices[0]
          const content = choice?.message?.content
          if (!content) {
            console.warn(`Empty response for ${key} (finish_reason: ${choice?.finish_reason})`)
            return { key, pois: [] }
          }
          if (choice?.finish_reason === 'length') {
            console.warn(`Truncated response for ${key} (hit max_completion_tokens) — skipping`)
            return { key, pois: [] }
          }

          const parsed = JSON.parse(content)
          const rawPois = parsed.pois || []

          // Server-side buffer enforcement
          const townBufferMeters = 5 * METERS_PER_MILE // 5 miles from any town
          // Minimum effective road buffer regardless of user slider setting.
          // OSM coverage is incomplete (forest roads often missing), so we need
          // a safety margin even when the user picks a small value.
          const MIN_ROAD_BUFFER_METERS = 0.25 * METERS_PER_MILE // 400m
          const effectiveRoadBuffer = Math.max(bufferMeters, MIN_ROAD_BUFFER_METERS)
          const filteredPois = rawPois.filter((poi: { lat: number; lng: number; name?: string }) => {
            // Bounds check — reject POIs the AI placed outside the analysis box
            if (
              poi.lat < bounds.south || poi.lat > bounds.north ||
              poi.lng < bounds.west  || poi.lng > bounds.east
            ) {
              return false
            }
            // Road/trail buffer
            if (roadTrailSegments.length > 0) {
              if (isNearRoadOrTrail(poi.lat, poi.lng, roadTrailSegments, effectiveRoadBuffer)) {
                return false
              }
            }
            // Building buffer
            for (const bPt of buildingPoints) {
              if (haversineMeters(poi.lat, poi.lng, bPt.lat, bPt.lng) < bufferMeters) {
                return false
              }
            }
            // Town buffer (5 miles)
            for (const tPt of townPoints) {
              if (haversineMeters(poi.lat, poi.lng, tPt.lat, tPt.lng) < townBufferMeters) {
                return false
              }
            }
            return true
          })

          // ── Terrain verification: attach real elevation/slope/aspect ──
          const verifiedPois = filteredPois.map((poi: {
            lat: number
            lng: number
            name?: string
            type?: string
            relatedBehaviors?: string[]
            description?: string
          }) => {
            const real = lookupTerrain(poi.lat, poi.lng, terrainPoints)
            return {
              ...poi,
              elevation: real.elevation,
              elevationFt: mToFt(real.elevation),
              slope: real.slope,
              aspect: real.aspect,
            }
          })

          // ── Type-vs-terrain + hidden-road sanity checks ──
          const terrainSanePois = verifiedPois.filter((poi) => {
            if (!terrainMatchesType(poi.type, poi.slope)) return false
            if (looksLikeHiddenRoad(poi.slope, poi.elevation, elevGrid.minElevation)) return false
            return true
          })

          // ── Grid/line-pattern detection: drop colinear clusters ──
          const gridOutliers = findGridOutliers(terrainSanePois)
          const nonGridPois = terrainSanePois.filter((_, i) => !gridOutliers.has(i))

          // ── Fix up AI-written descriptions so their numbers match reality ──
          const correctedPois = nonGridPois.map((poi) => ({
            ...poi,
            description: correctDescriptionText(poi.description, {
              elevationFt: poi.elevationFt,
              slope: poi.slope,
            }),
          }))

          const rejTerrain = verifiedPois.length - terrainSanePois.length
          const rejGrid = terrainSanePois.length - nonGridPois.length
          console.log(
            `  ${key}: ${rawPois.length} gen → ${filteredPois.length} buf → ${terrainSanePois.length} terr → ${nonGridPois.length} final` +
            (rejTerrain > 0 || rejGrid > 0 ? ` (-${rejTerrain} terrain, -${rejGrid} grid)` : '')
          )
          return { key, pois: correctedPois }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`Combo ${key} failed: ${message}`)
          return { key, pois: [] }
        }
      })
    )

    const results = await Promise.all(comboPromises)

    for (const { key, pois } of results) {
      comboResults[key] = pois
    }

    const totalPois = Object.values(comboResults).reduce((sum, arr) => sum + arr.length, 0)
    console.log(`All 9 combos complete — ${totalPois} total POIs across all combinations`)

    res.json({ combos: comboResults, season })
  } catch (err: unknown) {
    console.error('POI generation error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
}
