import type { Response } from 'express'
import OpenAI from 'openai'
import {
  fetchLandData,
  summarizeLandData,
  getRoadTrailSegments,
  isNearRoadOrTrail,
  haversineMeters,
} from './overpass.js'
import { fetchElevationGrid, fetchElevationRaster } from '../services/elevation.js'
import {
  analyzeTerrainForPrompt,
  formatFeaturesForPrompt,
  computeSlopeAspect,
  inspectTerrainAt,
  rasterToElevationGrid,
  type TerrainAnalysis,
  type PointInspection,
  type TerrainPoint,
} from '../services/terrainAnalysis.js'
import { isInElkRange } from '../services/elkRange.js'
import { fetchFireHistory, summarizeFireHistory } from '../services/fireHistory.js'
import {
  clipFireHistoryToPolygon,
  clipLandDataToPolygon,
  normalizeUnitPolygon,
  summarizeClipStats,
  type UnitPolygon,
} from '../services/geoClip.js'
import {
  appendHighResolutionTerrainNote,
  fetchHighResolutionTerrainMetrics,
  type HighResolutionTerrainMetrics,
} from '../services/highResTerrain.js'
import {
  checkAndIncrementUsage,
  estimateOpenAICostUsd,
  recordOpenAITokenUsage,
  type OpenAITokenUsageEntry,
} from '../services/usage.js'
import type { AuthedRequest } from '../middleware/auth.js'

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
  unitPolygon?: UnitPolygon
}

const METERS_PER_MILE = 1609.34
const DEFAULT_BUFFER_MILES = 0.5
const MAX_PRESSURE_BUFFER_MILES = 1
const MAX_PRESSURE_POI_LIMIT = 3

const TIMES = ['dawn', 'midday', 'dusk'] as const
const STANDARD_PRESSURES = ['low', 'medium', 'high'] as const
const PRESSURES = ['low', 'medium', 'high', 'max'] as const
const OPENAI_MODEL = 'gpt-5.4-mini'

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
    case 'meadow':       return slope <= 15            // flat to gentle open ground
    case 'wallow':       return slope <= 12            // flat boggy spots
    case 'bench':        return slope >= 4 && slope < 20 // a real shelf, not a sidehill
    case 'drainage':     return slope >= 4             // drainages run downhill
    case 'saddle':       return slope <= 12            // low point between highs (matches detector slope cap)
    case 'spring':       return slope <= 25            // spring sources
    case 'ridge':        return slope <= 25            // along the spine of a ridgeline
    case 'finger-ridge': return slope >= 4 && slope <= 28 // sub-ridge tongue off a main ridge
    case 'transition-zone': return slope >= 4 && slope <= 22 // meadow/timber staging band
    default:             return true                    // unknown types — don't block
  }
}

/**
 * Reject POIs that look like valley-bottom road corridors OSM forgot:
 * very low slope AND within 50m of the area's minimum elevation.
 */
function looksLikeHiddenRoad(slope: number, elevation: number, minElevation: number): boolean {
  return slope < 3 && (elevation - minElevation) < 50
}

function maxPressurePoiScore(poi: {
  type?: string
  slope?: number
  description?: string
  reasoningWhyHere?: string
  reasoningWhyNotElsewhere?: string
}): number {
  const typeScore: Record<string, number> = {
    drainage: 30,
    'finger-ridge': 28,
    bench: 26,
    saddle: 22,
    ridge: 18,
  }
  const normalizedType = (poi.type ?? '').toLowerCase()
  const slope = Number.isFinite(poi.slope) ? Number(poi.slope) : 0
  const idealSlope = normalizedType === 'bench' || normalizedType === 'saddle' ? 10 : 32
  const slopeWindow = normalizedType === 'bench' || normalizedType === 'saddle' ? 14 : 28
  const slopeScore = Math.max(0, 1 - Math.abs(slope - idealSlope) / slopeWindow) * 25
  const text = [poi.description, poi.reasoningWhyHere, poi.reasoningWhyNotElsewhere]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const securityTerms = [
    'remote', 'steep', 'thick', 'timber', 'cover', 'blowdown', 'deadfall',
    'sidehill', 'drainage', 'escape', 'security', 'access', 'road', 'trail', 'mile',
  ]
  const textScore = securityTerms.reduce((score, term) => score + (text.includes(term) ? 2 : 0), 0)
  return (typeScore[normalizedType] ?? 10) + slopeScore + textScore
}

function rankMaxPressurePois<T extends {
  type?: string
  slope?: number
  description?: string
  reasoningWhyHere?: string
  reasoningWhyNotElsewhere?: string
}>(pois: T[]): T[] {
  return pois
    .map((poi, index) => ({ poi, index, score: maxPressurePoiScore(poi) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.poi)
}

/**
 * Fresh point-centered feature inspection for a single POI. Used to verify
 * topographic POIs at their exact coordinate — the bbox-wide grid quantizes
 * to ~168m cells, which can make ordinary sidehills look like benches,
 * saddles, or finger ridges.
 *
 * 200m cell spacing matches the dev inspector's default so verification
 * agrees with what the user sees when manually inspecting a coord. Slope
 * is computed via finite difference over 400m baseline at this spacing —
 * narrow terrain breaks <200m wide get characterized by their surrounding
 * slope context rather than by one coarse selection-grid cell.
 */
async function inspectPoiTerrainPrecisely(
  lat: number,
  lng: number,
): Promise<PointInspection | null> {
  const cellSpacingM = 200
  const gridSize = 31
  const halfExtent = (gridSize - 1) / 2
  const latStep = cellSpacingM / 111_000
  const lngStep = cellSpacingM / (111_000 * Math.cos((lat * Math.PI) / 180))
  const bounds = {
    south: lat - halfExtent * latStep,
    north: lat + halfExtent * latStep,
    west: lng - halfExtent * lngStep,
    east: lng + halfExtent * lngStep,
  }
  try {
    const raster = await fetchElevationRaster(bounds, {
      targetPixelSizeMeters: 10,
      maxSidePixels: 768,
      maxPixels: 500_000,
    })
    const grid = rasterToElevationGrid(raster, gridSize, 'bilinear')
    const points = computeSlopeAspect(grid)
    return inspectTerrainAt(points, grid, halfExtent, halfExtent)
  } catch (err) {
    const debug = process.env.DEBUG_POI_REJECTIONS === '1'
    if (debug) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[precise] native raster inspection fallback at ${lat.toFixed(5)},${lng.toFixed(5)}: ${message}`)
    }
  }
  try {
    const grid = await fetchElevationGrid(bounds, gridSize)
    const points = computeSlopeAspect(grid)
    return inspectTerrainAt(points, grid, halfExtent, halfExtent)
  } catch {
    return null
  }
}

/**
 * Pick an elevation-grid size targeting ~175m cell spacing across the bbox.
 * Sub-200m sampling is required for the saddle detector to reliably catch
 * peaks that fall between cells (bilinear interpolation over 400m smooths
 * sharp peaks below the detection threshold). Capped 20..60 to keep the
 * elevation fetch and downstream feature scan bounded.
 */
function computeGridSize(bounds: {
  north: number; south: number; east: number; west: number
}): number {
  const TARGET_CELL_M = 175
  const centerLat = (bounds.north + bounds.south) / 2
  const widthM = (bounds.east - bounds.west) * 111_000 * Math.cos((centerLat * Math.PI) / 180)
  const heightM = (bounds.north - bounds.south) * 111_000
  const maxSpan = Math.max(widthM, heightM)
  return Math.max(20, Math.min(60, Math.round(maxSpan / TARGET_CELL_M)))
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

type DetectedTerrainFeature = TerrainAnalysis['detectedFeatures'][number]
type AnchorablePoiType = Extract<DetectedTerrainFeature['type'], 'bench' | 'ridge' | 'finger-ridge' | 'saddle' | 'transition-zone'>

function normalizeAnchorablePoiType(type: string | undefined): AnchorablePoiType | null {
  switch ((type ?? '').toLowerCase()) {
    case 'bench': return 'bench'
    case 'ridge': return 'ridge'
    case 'finger-ridge': return 'finger-ridge'
    case 'saddle': return 'saddle'
    case 'transition-zone': return 'transition-zone'
    default: return null
  }
}

function nearestDetectedFeature(
  lat: number,
  lng: number,
  features: DetectedTerrainFeature[],
  maxMeters: number,
): { feature: DetectedTerrainFeature; distanceMeters: number } | null {
  let nearest: { feature: DetectedTerrainFeature; distanceMeters: number } | null = null

  for (const feature of features) {
    const distanceMeters = haversineMeters(lat, lng, feature.lat, feature.lng)
    if (distanceMeters > maxMeters) continue
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { feature, distanceMeters }
    }
  }

  return nearest
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
- The transition zone (100-400m band where timber thins to meadow or burn/regrowth) is the highest-probability encounter zone.

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
- Historical burns, clearcuts, and scrubby regrowth can be excellent post-rut feed if grass/forbs are back, but daylight setups should stay near the adjacent timber line.
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
- South-facing burns/regrowth with grass returning can be premium late-season feed; prioritize the timber edge above or beside the opening over the center of the burn.
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

  max: `HUNTING PRESSURE: MAX
- Ignore time of day. Ignore feeding, water, wallow, travel, and normal bedding behavior layers. This mode is only about where elk retreat when hunting pressure is extreme.
- Find the nastiest, least inviting terrain in the analysis area: steep sidehills, dark timber, drainage heads, brushy bowls, blowdown/deadfall, cliffy or sidehill approaches, and places where every route in is slow, noisy, and physically punishing.
- Enforce a hard 1 mile minimum from roads, trails, buildings, and easy access points. Prefer terrain that is more than 1 mile from access when the data supports it.
- Favor rugged security cover over convenience: 25-45° slopes, high local relief, headwater drainages, finger ridges dropping into timbered bowls, benches surrounded by steep ground, and terrain with poor glassing angles.
- Reject attractive but easy terrain: open meadows, obvious saddles near roads, valley bottoms, gentle road-adjacent benches, visible parks, and clean timber that a hunter can quietly walk through.
- Related behavior should be security only. These are pressure sanctuaries, not feeding or travel setups.`,
}

const maxPressureBehaviorRules = `MAX PRESSURE MODE — SECURITY SANCTUARIES ONLY
- Time of day is intentionally disregarded. Do not balance dawn/midday/dusk behavior weights.
- Behavior layers are intentionally disregarded except security. Do not generate feeding, water, wallow, or normal travel POIs.
- Select terrain because it is hard to reach, hard to move through, hard to glass, and far from access.
- Best candidates are remote drainage heads, steep timbered bowls, sidehill benches boxed in by steep terrain, finger ridges with nasty approaches, and dense cover above or below terrain breaks.
- Every description should explain the access difficulty: distance from road/trail, steepness, timber/cover, noisy approach, escape routes, and why most hunters will avoid it.`

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
  fireHistorySummary: string,
  roadAvoidanceSection: string,
  terrainFeaturesSection: string,
  bufferMiles: number,
  bufferMeters: number,
): string {
  const isMaxPressure = pressure === 'max'
  const rules = isMaxPressure ? maxPressureBehaviorRules : seasonBehaviorRules[season] || seasonBehaviorRules['rut']
  const pressureRules = pressureContext[pressure] || pressureContext['medium']
  const timeLine = isMaxPressure ? 'Time of day: disregarded for MAX pressure' : `Time of day: ${timeOfDay}`
  const focusRule = isMaxPressure
    ? 'For MAX pressure specifically: ignore time-of-day behavior weights and generate only security sanctuaries that are hard to reach and hard to hunt.'
    : `For "${timeOfDay}" specifically: focus POIs on the behaviors with the highest weights for this time window.`
  const poiTypes = isMaxPressure
    ? 'POI types: drainage, saddle, bench, ridge, finger-ridge'
    : 'POI types: meadow, transition-zone, drainage, wallow, saddle, spring, bench, ridge, finger-ridge'
  const behaviorTypes = isMaxPressure
    ? 'Behaviors: security only'
    : 'Behaviors: feeding, water, bedding, wallows, travel, security'
  const poiQualityRule = isMaxPressure
    ? `Generate at most ${MAX_PRESSURE_POI_LIMIT} points of interest. Return only the best security sanctuary options; in a small grid, one or two excellent options is better than three marginal ones.`
    : 'Generate up to 10 high-quality points of interest.'

  return `You are an expert elk hunting guide placing points of interest using REAL terrain data. You have actual elevation measurements, computed slope/aspect, and verified land cover from OpenStreetMap. Every POI must be grounded in the data below.

MAP BOUNDS:
- North: ${bounds.north.toFixed(5)}, South: ${bounds.south.toFixed(5)}
- East: ${bounds.east.toFixed(5)}, West: ${bounds.west.toFixed(5)}
- Center: ${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}
- ${timeLine}

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

FIRE HISTORY:
${fireHistorySummary}
${roadAvoidanceSection}
${terrainFeaturesSection}
${featuresList}
UNIVERSAL PRINCIPLES:
- Thermals: Morning thermals flow UPHILL, evening thermals flow DOWNHILL. Elk bed where thermals create predictable scent detection (points, ridge noses, bench edges).
- Escape routes: Elk always bed with 2+ escape routes (downhill into drainage + lateral along bench/contour). Single-exit bedding = unused.
- Pressure response: Pressured elk shift to thicker, steeper, more remote terrain. Best areas are >1 mile from roads with no ATV access.
- Transition zone: The 100-400m band where timber thins to meadow, grass, or burn/regrowth is the #1 encounter zone across all seasons. Hunt it at first/last 90 min of daylight.

PLACEMENT RULES:
1. ALL POIs must be >${bufferMiles.toFixed(2)} miles (${Math.round(bufferMeters)}m) from ANY road, trail, or building listed above.
2. ALL POIs must be >5 miles from any town, village, hamlet, or settlement.
3. Use REAL coordinates from detected terrain features and OSM data — do not invent locations.
4. NEVER place near buildings or developed areas.
5. Match POI type to real terrain: "meadow" ONLY on mapped meadows, "transition-zone" ONLY on detected 100-400m meadow/regrowth-to-timber staging bands, "drainage" ONLY at real drainage points, "saddle" ONLY at detected saddles, "spring" ONLY near confirmed water, "bench" ONLY for true sidehill shelves (gentle slope with terrain rising above AND dropping below — NOT drainage floors or finger-ridge spines), "finger-ridge" for sub-ridges spurring off a main ridgeline into a drainage, "ridge" for the spine of a main ridgeline.
6. Descriptions MUST reference actual elevation, slope angle, aspect, and specific tactical advice for the current analysis mode.
7. ${focusRule}
8. NEVER place POIs in a straight line, evenly-spaced row, or regular grid pattern. Real elk terrain is irregular — POIs should follow the natural shape of drainages, ridgelines, and meadow edges, never share the same latitude or longitude, and never be uniformly spaced. If two POIs would land within ~150m of each other, drop one. If you cannot find enough genuinely distinct terrain features, return FEWER POIs rather than fabricating positions to fill the area.

${poiQualityRule} Only generate POIs where the terrain genuinely supports the behavior — if the area lacks suitable terrain for a behavior, generate fewer or zero POIs for it. Quality over quantity. Coordinates STRICTLY WITHIN bounds. Empty arrays are acceptable when terrain doesn't support a behavior — DO NOT pad with grid-pattern POIs.

${poiTypes}
${behaviorTypes}

Respond with ONLY valid JSON:
{
  "pois": [
    {
      "name": "string - descriptive name referencing the actual terrain feature",
      "lat": number,
      "lng": number,
      "type": "meadow|transition-zone|drainage|wallow|saddle|spring|bench|ridge|finger-ridge",
      "relatedBehaviors": ["feeding", "water", etc - only behaviors relevant to this season],
      "description": "string - 2-3 sentences: what the terrain is, why elk use it this season/time, and specific tactical hunting advice (where to set up, wind direction, approach)",
      "reasoningWhyHere": "string - 1-2 sentences explaining why this exact coordinate/feature was chosen over nearby terrain",
      "reasoningWhyNotElsewhere": "string - 1 sentence explaining what nearby terrain looked tempting but was rejected and why"
    }
  ]
}`
}

export async function generatePOIs(req: AuthedRequest, res: Response) {
  const uid = req.uid
  if (!uid) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const { bounds, bufferMiles: rawBuffer, unitPolygon: rawUnitPolygon } = req.body as GeneratePOIRequest

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

  const unitPolygon = rawUnitPolygon ? normalizeUnitPolygon(rawUnitPolygon) : null
  if (rawUnitPolygon && !unitPolygon) {
    res.status(400).json({ error: 'Invalid unitPolygon: expected GeoJSON Polygon or MultiPolygon' })
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

  // ── Plan check + atomic usage increment ──
  // Done BEFORE the AI call so two concurrent requests can't both slip past
  // the limit. A failed AI call still consumes a slot (acceptable for v1 —
  // prevents users from gaming the limit by triggering errors).
  let usage
  try {
    usage = await checkAndIncrementUsage(uid)
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'LIMIT_EXCEEDED') {
      const msg = err instanceof Error ? err.message : 'Monthly limit reached'
      console.warn(`[usage] limit reached for ${uid}: ${msg}`)
      res.status(402).json({
        error: msg,
        code: 'LIMIT_EXCEEDED',
      })
      return
    }
    console.error('[usage] check failed:', err)
    res.status(500).json({ error: 'Failed to check usage limits' })
    return
  }

  const centerLat = (bounds.north + bounds.south) / 2
  const centerLng = (bounds.east + bounds.west) / 2

  try {
    // ── Step 1: Fetch real data in parallel (shared across all 9 combos) ──
    console.log('Fetching OSM land data + elevation grid + MTBS fire history...')
    const [rawLandData, terrainData, rawFireHistory] = await Promise.all([
      fetchLandData(bounds),
      // Adaptive grid: target ~175m cell spacing regardless of bbox size.
      // 200m was the resolution at which the dev inspector reliably caught
      // sharp peaks (confirmed against a real saddle at 46.53732,-111.38111).
      // 175m gives a small margin to dodge bilinear smoothing without
      // bloating the prompt with features from <100m noise.
      // 2mi bbox -> ~20x20, 3mi -> ~28x28, 5mi -> ~46x46, capped 20..60.
      unitPolygon
        ? fetchHighResolutionTerrainMetrics(bounds)
        : fetchElevationGrid(bounds, computeGridSize(bounds)),
      fetchFireHistory(bounds),
    ])

    const highResMetrics = unitPolygon ? terrainData as HighResolutionTerrainMetrics : null
    const elevGrid = highResMetrics ? highResMetrics.grid : terrainData as Awaited<ReturnType<typeof fetchElevationGrid>>

    const { landData, fireHistory } = unitPolygon
      ? (() => {
          const clippedLand = clipLandDataToPolygon(rawLandData, unitPolygon)
          const clippedFire = clipFireHistoryToPolygon(rawFireHistory, unitPolygon)
          console.log(`Unit clipping applied: ${summarizeClipStats(clippedLand.stats, clippedFire.stats)}`)
          return { landData: clippedLand.landData, fireHistory: clippedFire.fires }
        })()
      : { landData: rawLandData, fireHistory: rawFireHistory }

    const terrainSummary = summarizeLandData(landData)
    const fireHistorySummary = summarizeFireHistory(fireHistory)
    const roadTrailSegments = getRoadTrailSegments(landData)

    const totalRoadPts = landData.roads.reduce((n, r) => n + r.geometry.length, 0)
    const totalTrailPts = landData.trails.reduce((n, r) => n + r.geometry.length, 0)
    // Tag each town point with its OSM place kind + name so the buffer check
    // downstream can apply size-appropriate distances and explain rejections.
    // Hamlets are dropped entirely — OSM tags them on tiny roadside clusters
    // (sometimes just 3 buildings) and they routinely poison entire bboxes
    // with a 5-mile blanket reject. Real settlements (city/town/village) stay.
    const townPoints = landData.towns.flatMap((t) =>
      (t.placeKind === 'hamlet' ? [] : t.geometry).map((g) => ({
        ...g,
        kind: t.placeKind ?? 'town',
        name: t.name,
      })),
    )
    console.log(`OSM: ${landData.roads.length} roads (${totalRoadPts} pts), ${landData.trails.length} trails (${totalTrailPts} pts), ${landData.forests.length} forests, ${landData.meadows.length} meadows, ${landData.regrowth.length} regrowth, ${landData.water.length} water, ${landData.streams.length} streams, ${landData.towns.length} towns`)
    console.log(`MTBS: ${fireHistory.length} burn perimeter${fireHistory.length === 1 ? '' : 's'}`)
    console.log(`Road/trail segments for buffer check: ${roadTrailSegments.length}`)
    console.log(`Elevation: ${elevGrid.minElevation.toFixed(0)}m – ${elevGrid.maxElevation.toFixed(0)}m (${elevGrid.points.length} points)`)

    // ── Step 2: Analyze terrain from real elevation data ──
    const terrain = appendHighResolutionTerrainNote(
      analyzeTerrainForPrompt(elevGrid, landData, fireHistory),
      highResMetrics,
    )
    const featuresList = formatFeaturesForPrompt(terrain.detectedFeatures)

    {
      const byType = terrain.detectedFeatures.reduce<Record<string, number>>((acc, f) => {
        acc[f.type] = (acc[f.type] || 0) + 1
        return acc
      }, {})
      const breakdown = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')
      console.log(
        `Terrain: ${terrain.detectedFeatures.length} features detected${breakdown ? ` (${breakdown})` : ''}`,
      )
    }

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
    ROADS AND TRAILS TO AVOID:
${roadSamples.join('\n')}
`
    }

    // ── Step 4: Build terrain features for prompt ──
    let terrainFeaturesSection = ''
    if (landData.meadows.length > 0 || landData.regrowth.length > 0 || landData.water.length > 0 || landData.streams.length > 0 || landData.forests.length > 0) {
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
      for (const regrowth of landData.regrowth.slice(0, 8)) {
        const center = regrowth.geometry[Math.floor(regrowth.geometry.length / 2)]
        if (center) {
          features.push(`  - Regrowth/burn-clearcut proxy${regrowth.name ? ` "${regrowth.name}"` : ''}: ~${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`)
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

    // ── Step 6: Build and run all standard time×pressure GPT calls plus MAX ──
    const openai = getClient()
    const buildingPoints = landData.buildings.flatMap(b => b.geometry)

    type ComboKey = `${typeof TIMES[number]}_${typeof PRESSURES[number]}`
    type Pressure = typeof PRESSURES[number]
    const comboResults: Record<string, unknown[]> = {}
    const openaiUsageEntries: OpenAITokenUsageEntry[] = []

    // Season is fixed from the request body
    const season = (req.body as GeneratePOIRequest).season || 'rut'
    const comboPlans: Array<{
      timeOfDay: typeof TIMES[number] | 'any'
      pressure: Pressure
      key: string
      resultKeys: ComboKey[]
    }> = [
      ...TIMES.flatMap(timeOfDay =>
        STANDARD_PRESSURES.map((pressure) => ({
          timeOfDay,
          pressure,
          key: `${timeOfDay}_${pressure}`,
          resultKeys: [`${timeOfDay}_${pressure}` as ComboKey],
        })),
      ),
      {
        timeOfDay: 'any',
        pressure: 'max',
        key: 'max',
        resultKeys: TIMES.map(timeOfDay => `${timeOfDay}_max` as ComboKey),
      },
    ]
    console.log(`Launching ${comboPlans.length} parallel GPT calls (9 standard + MAX pressure) for season: ${season}...`)

    const comboPromises = comboPlans.map(async ({ timeOfDay, pressure, key, resultKeys }) => {
        const comboBufferMiles = pressure === 'max' ? MAX_PRESSURE_BUFFER_MILES : bufferMiles
        const comboBufferMeters = comboBufferMiles * METERS_PER_MILE

        try {
          const prompt = buildPrompt(
            season, timeOfDay, pressure, bounds, centerLat, centerLng,
            terrain, featuresList, terrainSummary, fireHistorySummary,
            roadAvoidanceSection, terrainFeaturesSection,
            comboBufferMiles, comboBufferMeters,
          )

          const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_completion_tokens: 8000,
            response_format: { type: 'json_object' },
          })

          const tokenUsage = completion.usage as
            | {
                prompt_tokens?: number
                completion_tokens?: number
                total_tokens?: number
                prompt_tokens_details?: { cached_tokens?: number }
              }
            | undefined
          const promptTokens = tokenUsage?.prompt_tokens ?? 0
          const completionTokens = tokenUsage?.completion_tokens ?? 0
          const totalTokens = tokenUsage?.total_tokens ?? promptTokens + completionTokens
          const cachedPromptTokens = tokenUsage?.prompt_tokens_details?.cached_tokens ?? 0
          const estimatedCostUsd = estimateOpenAICostUsd({
            model: OPENAI_MODEL,
            promptTokens,
            completionTokens,
            cachedPromptTokens,
          })

          if (totalTokens > 0) {
            openaiUsageEntries.push({
              model: OPENAI_MODEL,
              comboKey: key,
              promptTokens,
              completionTokens,
              totalTokens,
              cachedPromptTokens,
              estimatedCostUsd,
            })
            console.log(
              `  ${key}: OpenAI usage ${promptTokens} in (${cachedPromptTokens} cached), ` +
              `${completionTokens} out, est $${estimatedCostUsd.toFixed(4)}`,
            )
          }

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
          // Buffer radius scaled to settlement size. Cities/towns push elk
          // hard with traffic, infrastructure, and consistent human presence;
          // villages are mostly clusters of homes with a fraction of that
          // pressure, so a 2-mile ring is more honest than the same 5.
          // Hamlets never reach this code (filtered out above).
          function townBufferFor(kind: 'city' | 'town' | 'village' | 'hamlet'): number {
            switch (kind) {
              case 'city':    return 5 * METERS_PER_MILE
              case 'town':    return 5 * METERS_PER_MILE
              case 'village': return 2 * METERS_PER_MILE
              default:        return 0
            }
          }
          // Minimum effective road buffer regardless of user slider setting.
          // OSM coverage is incomplete (forest roads often missing), so we need
          // a safety margin even when the user picks a small value.
          const MIN_ROAD_BUFFER_METERS = 0.25 * METERS_PER_MILE // 400m
          const effectiveRoadBuffer = Math.max(comboBufferMeters, MIN_ROAD_BUFFER_METERS)
          const bufRejects = { outOfBounds: 0, nearRoad: 0, nearBuilding: 0, nearTown: 0 }
          type RejectDetail = { lat: number; lng: number; name?: string; type?: string; reason: string; note?: string }
          const debug = process.env.DEBUG_POI_REJECTIONS === '1'
          const bufRejectDetails: RejectDetail[] = []

          const filteredPois = rawPois.filter((poi: { lat: number; lng: number; name?: string; type?: string }) => {
            // Bounds check — reject POIs the AI placed outside the analysis box
            if (
              poi.lat < bounds.south || poi.lat > bounds.north ||
              poi.lng < bounds.west  || poi.lng > bounds.east
            ) {
              bufRejects.outOfBounds++
              if (debug) bufRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'outOfBounds' })
              return false
            }
            // Road/trail buffer
            if (roadTrailSegments.length > 0) {
              if (isNearRoadOrTrail(poi.lat, poi.lng, roadTrailSegments, effectiveRoadBuffer)) {
                bufRejects.nearRoad++
                if (debug) bufRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'nearRoad', note: `< ${(effectiveRoadBuffer / METERS_PER_MILE).toFixed(2)}mi to road/trail` })
                return false
              }
            }
            // Building buffer
            for (const bPt of buildingPoints) {
              if (haversineMeters(poi.lat, poi.lng, bPt.lat, bPt.lng) < comboBufferMeters) {
                bufRejects.nearBuilding++
                if (debug) bufRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'nearBuilding' })
                return false
              }
            }
            // Town buffer — kind-aware (city/town: 5mi, village: 2mi, hamlet: skipped).
            for (const tPt of townPoints) {
              const buffer = townBufferFor(tPt.kind)
              if (buffer <= 0) continue
              const dist = haversineMeters(poi.lat, poi.lng, tPt.lat, tPt.lng)
              if (dist < buffer) {
                bufRejects.nearTown++
                if (debug) {
                  const distMi = (dist / METERS_PER_MILE).toFixed(2)
                  const bufMi = (buffer / METERS_PER_MILE).toFixed(2)
                  const settlement = tPt.name ? `"${tPt.name}" (${tPt.kind})` : `unnamed ${tPt.kind}`
                  bufRejectDetails.push({
                    lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type,
                    reason: 'nearTown',
                    note: `${distMi}mi to ${settlement}, buffer ${bufMi}mi`,
                  })
                }
                return false
              }
            }
            return true
          })

          const detectedBenches = terrain.detectedFeatures.filter((f) => f.type === 'bench')
          const detectedRidges = terrain.detectedFeatures.filter((f) => f.type === 'ridge')
          const detectedFingerRidges = terrain.detectedFeatures.filter((f) => f.type === 'finger-ridge')
          const detectedSaddles = terrain.detectedFeatures.filter((f) => f.type === 'saddle')
          const detectedTransitionZones = terrain.detectedFeatures.filter((f) => f.type === 'transition-zone')
          const BENCH_PROXIMITY_M = 250
          const RIDGE_PROXIMITY_M = 300       // ridges are linear so allow slightly more slack
          const FINGER_RIDGE_PROXIMITY_M = 300
          const TRANSITION_ZONE_PROXIMITY_M = 300
          // Saddles are POINT features — the col itself is a single low spot
          // and that's where the elk-tactical value lives. A 300m proximity
          // (fine for linear ridges and area benches) lets the AI place a
          // "saddle" POI a couple hundred meters off the actual crossing,
          // landing on the steep hillside next to it. 150m forces the POI
          // to be on or immediately adjacent to the detected saddle cell.
          const SADDLE_PROXIMITY_M = 150
          const detectedByType: Record<AnchorablePoiType, DetectedTerrainFeature[]> = {
            bench: detectedBenches,
            ridge: detectedRidges,
            'finger-ridge': detectedFingerRidges,
            saddle: detectedSaddles,
            'transition-zone': detectedTransitionZones,
          }
          const anchorProximityM: Record<AnchorablePoiType, number> = {
            bench: BENCH_PROXIMITY_M,
            ridge: RIDGE_PROXIMITY_M,
            'finger-ridge': FINGER_RIDGE_PROXIMITY_M,
            saddle: SADDLE_PROXIMITY_M,
            'transition-zone': TRANSITION_ZONE_PROXIMITY_M,
          }

          // Return the detected feature coordinate that passed validation,
          // not GPT's nearby approximate coordinate. This keeps marker
          // placement, panel coordinates, and inspect-point diagnostics aligned.
          const anchoredPois = filteredPois.map((poi: {
            lat: number
            lng: number
            name?: string
            type?: string
            relatedBehaviors?: string[]
            description?: string
          }) => {
            const anchorType = normalizeAnchorablePoiType(poi.type)
            if (!anchorType) return poi

            const nearest = nearestDetectedFeature(
              poi.lat,
              poi.lng,
              detectedByType[anchorType],
              anchorProximityM[anchorType],
            )
            if (!nearest) return poi

            if (debug && nearest.distanceMeters > 25) {
              console.log(
                `  [anchor] ${anchorType} ${poi.lat.toFixed(5)},${poi.lng.toFixed(5)} ` +
                `→ ${nearest.feature.lat.toFixed(5)},${nearest.feature.lng.toFixed(5)} ` +
                `(${nearest.distanceMeters.toFixed(0)}m)`,
              )
            }
            return {
              ...poi,
              type: anchorType,
              lat: nearest.feature.lat,
              lng: nearest.feature.lng,
            }
          })

          // ── Terrain verification: attach real elevation/slope/aspect ──
          const verifiedPois = anchoredPois.map((poi: {
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

          // ── Precision pass for topographic POIs ──
          // The bbox-wide grid can quantize ordinary sidehills into benches,
          // saddles, or finger ridges. Run the same point-centered inspector
          // used by the dev panel and keep the POI only if that precise check
          // agrees with the label.
          const precisePois = await Promise.all(
            verifiedPois.map(async (poi: (typeof verifiedPois)[number]) => {
              const anchorType = normalizeAnchorablePoiType(poi.type)
              if (!anchorType) return poi
              const inspection = await inspectPoiTerrainPrecisely(poi.lat, poi.lng)
              if (!inspection) return poi
              if (debug && Math.abs(inspection.point.slope - poi.slope) > 5) {
                console.log(
                  `  [precise] ${anchorType} ${poi.lat.toFixed(5)},${poi.lng.toFixed(5)} ` +
                  `grid=${poi.slope}° → precise=${inspection.point.slope}°`,
                )
              }
              return {
                ...poi,
                elevation: inspection.point.elevation,
                elevationFt: mToFt(inspection.point.elevation),
                slope: inspection.point.slope,
                aspect: inspection.point.aspect,
                preciseFeatures: inspection.features,
              }
            }),
          )

          // AI-labeled benches must sit near a real detected bench feature
          // — the slope-only validator can't tell a true sidehill bench from
          // a drainage floor at the same slope range, but the detector can
          // (it requires actual mid-slope position via above/below relief).
          // Same belt-and-suspenders treatment for ridge / finger-ridge:
          // GPT will otherwise scatter "ridge" labels across drainage spurs
          // that happen to fall in the right slope band.
          const terrRejects = {
            slopeMismatch: 0,
            hiddenRoad: 0,
            benchUnsupported: 0,
            ridgeUnsupported: 0,
            fingerRidgeUnsupported: 0,
            saddleUnsupported: 0,
            transitionZoneUnsupported: 0,
          }
          const terrRejectDetails: RejectDetail[] = []

          // ── Type-vs-terrain + hidden-road sanity checks ──
          const terrainSanePois = precisePois.filter((poi) => {
            if (!terrainMatchesType(poi.type, poi.slope)) {
              terrRejects.slopeMismatch++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'slopeMismatch', note: `${poi.slope}° doesn't fit type ${poi.type}` })
              return false
            }
            if (looksLikeHiddenRoad(poi.slope, poi.elevation, elevGrid.minElevation)) {
              terrRejects.hiddenRoad++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'hiddenRoad', note: `slope=${poi.slope}°, elev=${poi.elevationFt}ft (near min)` })
              return false
            }
            if (
              poi.type === 'bench' &&
              (!poi.preciseFeatures?.bench.detected ||
                !detectedBenches.some(
                  (b) => haversineMeters(poi.lat, poi.lng, b.lat, b.lng) < BENCH_PROXIMITY_M,
                ))
            ) {
              terrRejects.benchUnsupported++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'benchUnsupported', note: poi.preciseFeatures?.bench.reason ?? `no detected bench within ${BENCH_PROXIMITY_M}m` })
              return false
            }
            if (
              poi.type === 'ridge' &&
              (!poi.preciseFeatures?.ridge.detected ||
                !detectedRidges.some(
                  (r) => haversineMeters(poi.lat, poi.lng, r.lat, r.lng) < RIDGE_PROXIMITY_M,
                ))
            ) {
              terrRejects.ridgeUnsupported++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'ridgeUnsupported', note: poi.preciseFeatures?.ridge.reason ?? `no detected ridge within ${RIDGE_PROXIMITY_M}m` })
              return false
            }
            if (
              poi.type === 'finger-ridge' &&
              (!poi.preciseFeatures?.fingerRidge.detected ||
                !detectedFingerRidges.some(
                  (r) => haversineMeters(poi.lat, poi.lng, r.lat, r.lng) < FINGER_RIDGE_PROXIMITY_M,
                ))
            ) {
              terrRejects.fingerRidgeUnsupported++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'fingerRidgeUnsupported', note: poi.preciseFeatures?.fingerRidge.reason ?? `no detected finger-ridge within ${FINGER_RIDGE_PROXIMITY_M}m` })
              return false
            }
            if (
              poi.type === 'saddle' &&
              (!poi.preciseFeatures?.saddle.detected ||
                !detectedSaddles.some(
                  (s) => haversineMeters(poi.lat, poi.lng, s.lat, s.lng) < SADDLE_PROXIMITY_M,
                ))
            ) {
              terrRejects.saddleUnsupported++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'saddleUnsupported', note: poi.preciseFeatures?.saddle.reason ?? `no detected saddle within ${SADDLE_PROXIMITY_M}m` })
              return false
            }
            if (
              poi.type === 'transition-zone' &&
              !detectedTransitionZones.some(
                (z) => haversineMeters(poi.lat, poi.lng, z.lat, z.lng) < TRANSITION_ZONE_PROXIMITY_M,
              )
            ) {
              terrRejects.transitionZoneUnsupported++
              if (debug) terrRejectDetails.push({ lat: poi.lat, lng: poi.lng, name: poi.name, type: poi.type, reason: 'transitionZoneUnsupported', note: `no detected transition-zone within ${TRANSITION_ZONE_PROXIMITY_M}m` })
              return false
            }
            return true
          })

          // ── Grid/line-pattern detection: drop colinear clusters ──
          const gridOutliers = findGridOutliers(terrainSanePois)
          const nonGridPois = terrainSanePois.filter((_, i) => !gridOutliers.has(i))

          // ── Fix up AI-written descriptions so their numbers match reality ──
          const correctedPois = nonGridPois.map((poi) => {
            const { preciseFeatures: _preciseFeatures, ...publicPoi } = poi
            return {
              ...publicPoi,
              relatedBehaviors: pressure === 'max' ? ['security'] : publicPoi.relatedBehaviors,
              description: correctDescriptionText(poi.description, {
                elevationFt: poi.elevationFt,
                slope: poi.slope,
              }),
              reasoningWhyHere: typeof poi.reasoningWhyHere === 'string' ? poi.reasoningWhyHere.trim() : '',
              reasoningWhyNotElsewhere: typeof poi.reasoningWhyNotElsewhere === 'string' ? poi.reasoningWhyNotElsewhere.trim() : '',
            }
          })
          const finalPois = pressure === 'max'
            ? rankMaxPressurePois(correctedPois).slice(0, MAX_PRESSURE_POI_LIMIT)
            : correctedPois

          const rejGrid = terrainSanePois.length - nonGridPois.length

          const bufBreakdown = Object.entries(bufRejects)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join(',')
          const terrBreakdown = Object.entries(terrRejects)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join(',')

          console.log(
            `  ${key}: ${rawPois.length} gen → ${filteredPois.length} buf → ${terrainSanePois.length} terr → ${finalPois.length} final` +
            (bufBreakdown ? `  [buf: ${bufBreakdown}]` : '') +
            (terrBreakdown ? `  [terr: ${terrBreakdown}]` : '') +
            (rejGrid > 0 ? `  [grid: -${rejGrid}]` : '') +
            (pressure === 'max' && nonGridPois.length > finalPois.length ? `  [max-cap: ${nonGridPois.length}→${finalPois.length}]` : '')
          )

          if (debug && (bufRejectDetails.length > 0 || terrRejectDetails.length > 0)) {
            for (const r of bufRejectDetails) {
              console.log(`    × ${key} buf:${r.reason}  ${r.lat.toFixed(5)},${r.lng.toFixed(5)}  ${r.type ?? ''}  "${r.name ?? ''}"${r.note ? '  — ' + r.note : ''}`)
            }
            for (const r of terrRejectDetails) {
              console.log(`    × ${key} terr:${r.reason}  ${r.lat.toFixed(5)},${r.lng.toFixed(5)}  ${r.type ?? ''}  "${r.name ?? ''}"${r.note ? '  — ' + r.note : ''}`)
            }
          }

          return { key, resultKeys, pois: finalPois }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`Combo ${key} failed: ${message}`)
          return { key, resultKeys, pois: [] }
        }
    })

    const results = await Promise.all(comboPromises)

    for (const result of results) {
      for (const resultKey of result.resultKeys ?? []) {
        comboResults[resultKey] = result.pois
      }
    }

    const totalPois = Object.values(comboResults).reduce((sum, arr) => sum + arr.length, 0)
    console.log(`All ${comboPlans.length} GPT calls complete — ${totalPois} total POIs across all displayed combinations`)

    if (openaiUsageEntries.length > 0) {
      const totals = openaiUsageEntries.reduce(
        (acc, entry) => {
          acc.promptTokens += entry.promptTokens
          acc.completionTokens += entry.completionTokens
          acc.totalTokens += entry.totalTokens
          acc.cachedPromptTokens += entry.cachedPromptTokens
          acc.estimatedCostUsd += entry.estimatedCostUsd
          return acc
        },
        { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, estimatedCostUsd: 0 },
      )
      console.log(
        `OpenAI analysis usage: ${openaiUsageEntries.length} calls, ` +
        `${totals.promptTokens} input (${totals.cachedPromptTokens} cached), ` +
        `${totals.completionTokens} output, ${totals.totalTokens} total, ` +
        `est $${totals.estimatedCostUsd.toFixed(4)}`,
      )
      try {
        await recordOpenAITokenUsage(uid, usage.monthKey, openaiUsageEntries)
      } catch (err) {
        console.error('[usage] failed to record OpenAI token usage:', err)
      }
    }

    res.json({ combos: comboResults, season, usage })
  } catch (err: unknown) {
    console.error('POI generation error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
}
