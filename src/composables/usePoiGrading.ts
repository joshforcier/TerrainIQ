import type { PointOfInterest } from '@/data/pointsOfInterest'
import type { BehaviorLayer, BehaviorWeights } from '@/data/elkBehavior'

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | '—'

export interface GradeResult {
  grade: Grade
  score: number
  label: 'Prime' | 'Strong' | 'Solid' | 'Viable' | 'Marginal' | 'Weak' | 'Skip' | 'No signal'
}

export type EnabledLayers = Record<BehaviorLayer, boolean>
export type ConfidenceMap = Partial<Record<BehaviorLayer, number>>

/**
 * Per-POI per-behavior confidence (0–100). Combines the current season ×
 * time × pressure weights with a per-POI position bias: the AI lists
 * behaviors in order of relevance to that POI's terrain, so the first
 * listed gets a strong boost (becomes the dominant behavior most of the
 * time), the second a mild boost, and the rest are dampened. This gives
 * each POI a stable "primary color" regardless of time-of-day, while
 * letting weights still scale the magnitude.
 */
const POSITION_MULTIPLIERS = [1.6, 0.95, 0.7, 0.55, 0.45, 0.4] as const

export function deriveConfidence(
  poi: PointOfInterest,
  currentWeights: BehaviorWeights,
): ConfidenceMap {
  const conf: ConfidenceMap = {}
  poi.relatedBehaviors.forEach((b, i) => {
    const mult = POSITION_MULTIPLIERS[i] ?? 0.4
    const value = (currentWeights[b] ?? 0) * 100 * mult
    conf[b] = Math.min(100, Math.max(0, Math.round(value)))
  })
  return conf
}

export function dominantBehavior(
  poi: PointOfInterest,
  conf: ConfidenceMap,
  enabledLayers: EnabledLayers,
): BehaviorLayer | null {
  const candidates = poi.relatedBehaviors.filter((b) => enabledLayers[b])
  if (candidates.length === 0) return null
  return candidates.reduce<BehaviorLayer>(
    (best, b) => ((conf[b] ?? 0) > (conf[best] ?? -1) ? b : best),
    candidates[0],
  )
}

export function topConfidence(
  poi: PointOfInterest,
  conf: ConfidenceMap,
  enabledLayers: EnabledLayers,
): number {
  const d = dominantBehavior(poi, conf, enabledLayers)
  return d ? conf[d] ?? 0 : 0
}

/**
 * Composite 0–100 grade. Rewards high-confidence overlap, penalises
 * thin single-signal POIs.
 */
export function gradePoi(
  poi: PointOfInterest,
  conf: ConfidenceMap,
  enabledLayers: EnabledLayers,
): GradeResult {
  const behaviors = poi.relatedBehaviors.filter((b) => enabledLayers[b])
  if (behaviors.length === 0) {
    return { grade: '—', score: 0, label: 'No signal' }
  }

  const sorted = [...behaviors].sort((a, b) => (conf[b] ?? 0) - (conf[a] ?? 0))
  const top = conf[sorted[0]] ?? 0
  const avg =
    behaviors.reduce((s, b) => s + (conf[b] ?? 0), 0) / behaviors.length
  const overlapBonus = Math.min(15, (behaviors.length - 1) * 6)

  let score = top * 0.6 + avg * 0.25 + overlapBonus
  if (behaviors.length === 1 && top < 50) score -= 10
  score = Math.max(0, Math.min(100, score))
  const rounded = Math.round(score)

  if (rounded >= 92) return { grade: 'A+', score: rounded, label: 'Prime' }
  if (rounded >= 82) return { grade: 'A', score: rounded, label: 'Strong' }
  if (rounded >= 73) return { grade: 'B+', score: rounded, label: 'Solid' }
  if (rounded >= 63) return { grade: 'B', score: rounded, label: 'Viable' }
  if (rounded >= 53) return { grade: 'C+', score: rounded, label: 'Marginal' }
  if (rounded >= 43) return { grade: 'C', score: rounded, label: 'Weak' }
  return { grade: 'D', score: rounded, label: 'Skip' }
}

export function gradeColor(grade: Grade): string {
  if (grade === 'A+' || grade === 'A') return '#4ade80'
  if (grade === 'B+' || grade === 'B') return '#e8c547'
  if (grade === 'C+' || grade === 'C') return '#f97316'
  return '#ef4444'
}
