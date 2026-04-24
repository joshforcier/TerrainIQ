/**
 * Server-side copy of elk range bounding boxes. Kept in sync with
 * src/utils/elkRange.ts — if you change one, change the other.
 */

interface BBox {
  south: number
  north: number
  west: number
  east: number
}

const ELK_RANGE_BOXES: BBox[] = [
  { south: 37.0, north: 41.0, west: -109.1, east: -102.0 }, // Colorado
  { south: 41.0, north: 45.0, west: -111.1, east: -104.0 }, // Wyoming
  { south: 44.4, north: 49.0, west: -116.1, east: -104.0 }, // Montana
  { south: 42.0, north: 49.0, west: -117.3, east: -111.0 }, // Idaho
  { south: 37.0, north: 42.0, west: -114.1, east: -109.0 }, // Utah
  { south: 31.3, north: 37.0, west: -109.1, east: -103.0 }, // New Mexico
  { south: 34.0, north: 37.0, west: -114.1, east: -109.0 }, // N Arizona
  { south: 42.0, north: 46.3, west: -124.7, east: -117.0 }, // Oregon
  { south: 45.5, north: 49.1, west: -124.8, east: -117.0 }, // Washington
  { south: 39.5, north: 42.0, west: -124.4, east: -120.0 }, // N California
  { south: 38.0, north: 42.0, west: -120.0, east: -114.0 }, // N Nevada
  { south: 43.5, north: 44.7, west: -104.1, east: -103.0 }, // Black Hills SD
  { south: 42.2, north: 43.0, west: -104.0, east: -101.5 }, // Pine Ridge NE
  { south: 41.0, north: 42.0, west: -79.0, east: -77.0 },   // Central PA
  { south: 36.8, north: 38.3, west: -84.0, east: -82.0 },   // E Kentucky
  { south: 35.9, north: 36.8, west: -84.7, east: -82.5 },   // NC / TN plateau
  { south: 44.5, north: 45.5, west: -85.5, east: -84.0 },   // N Lower Michigan
  { south: 45.5, north: 46.5, west: -91.0, east: -89.0 },   // N Wisconsin
  { south: 35.3, north: 36.3, west: -93.6, east: -92.4 },   // Buffalo NR AR
  { south: 49.0, north: 60.0, west: -139.1, east: -114.0 }, // BC
  { south: 49.0, north: 60.0, west: -120.1, east: -110.0 }, // Alberta
  { south: 49.0, north: 56.0, west: -110.0, east: -101.5 }, // Sask
  { south: 49.0, north: 54.0, west: -102.0, east: -95.0 },  // W Manitoba
]

export function isInElkRange(bounds: BBox): boolean {
  for (const box of ELK_RANGE_BOXES) {
    const noOverlap =
      bounds.south > box.north ||
      bounds.north < box.south ||
      bounds.west > box.east ||
      bounds.east < box.west
    if (!noOverlap) return true
  }
  return false
}
