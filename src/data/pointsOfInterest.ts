import type { BehaviorLayer } from './elkBehavior'

export interface PointOfInterest {
  id: string
  name: string
  lat: number
  lng: number
  type: 'meadow' | 'drainage' | 'wallow' | 'saddle' | 'spring'
  relatedBehaviors: BehaviorLayer[]
  description: string
  /** Verified from real elevation grid (server-side post-processing) */
  elevation?: number
  elevationFt?: string
  slope?: number
  aspect?: string
  /** AI explanation for why this exact location was selected. */
  reasoningWhyHere?: string
  /** AI explanation for why nearby alternatives were rejected. */
  reasoningWhyNotElsewhere?: string
}

export const poiTypeLabels: Record<PointOfInterest['type'], string> = {
  meadow: 'Meadow',
  drainage: 'Drainage',
  wallow: 'Wallow',
  saddle: 'Saddle',
  spring: 'Spring',
}

/**
 * Sample POIs placed in a realistic Colorado elk habitat area
 * centered around the Flat Tops Wilderness (~39.95, -107.15).
 */
export const pointsOfInterest: PointOfInterest[] = [
  {
    id: 'poi-1',
    name: 'Upper Meadow Park',
    lat: 39.975,
    lng: -107.12,
    type: 'meadow',
    relatedBehaviors: ['feeding'],
    description: 'Large south-facing meadow at 9,200ft. Primary evening feeding area with good grass year-round.',
  },
  {
    id: 'poi-2',
    name: 'East Fork Drainage',
    lat: 39.94,
    lng: -107.09,
    type: 'drainage',
    relatedBehaviors: ['water', 'travel'],
    description: 'Steep drainage running NE with perennial creek. Major travel corridor between high bedding and low feed.',
  },
  {
    id: 'poi-3',
    name: 'North Wallow Complex',
    lat: 39.98,
    lng: -107.17,
    type: 'wallow',
    relatedBehaviors: ['wallows', 'water'],
    description: 'Three interconnected wallows in dark timber. Heavily used during rut. Fresh sign year after year.',
  },
  {
    id: 'poi-4',
    name: 'Divide Saddle',
    lat: 39.96,
    lng: -107.20,
    type: 'saddle',
    relatedBehaviors: ['travel', 'bedding'],
    description: 'Low saddle on the main divide at 10,400ft. Elk cross here between east and west drainages. Great ambush point.',
  },
  {
    id: 'poi-5',
    name: 'Hidden Spring',
    lat: 39.935,
    lng: -107.14,
    type: 'spring',
    relatedBehaviors: ['water', 'feeding'],
    description: 'Year-round spring in a small park. Surrounded by good browse. Pulls elk even in late season.',
  },
  {
    id: 'poi-7',
    name: 'South Bench Meadow',
    lat: 39.925,
    lng: -107.18,
    type: 'meadow',
    relatedBehaviors: ['feeding', 'water'],
    description: 'Bench meadow at 8,800ft near creek. Early/late season feed area. Elk stage here before dropping to lower elevation.',
  },
  {
    id: 'poi-8',
    name: 'Aspen Wallow',
    lat: 39.965,
    lng: -107.08,
    type: 'wallow',
    relatedBehaviors: ['wallows'],
    description: 'Single large wallow in aspen stand. Less used than the north complex but closer to open parks.',
  },
  {
    id: 'poi-9',
    name: 'Rim Saddle',
    lat: 39.99,
    lng: -107.13,
    type: 'saddle',
    relatedBehaviors: ['travel', 'bedding'],
    description: 'Narrow saddle on the north rim. Escape route when elk get pressured from below. Bedding nearby in blowdown timber.',
  },
  {
    id: 'poi-10',
    name: 'Creek Confluence',
    lat: 39.945,
    lng: -107.16,
    type: 'drainage',
    relatedBehaviors: ['water', 'travel', 'feeding'],
    description: 'Two creeks meet in a brushy bottom. Small openings with good feed. All-day water. High-traffic crossing.',
  },
]
