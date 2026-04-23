import type { PointOfInterest } from '@/data/pointsOfInterest'
import type { Season, TimeOfDay } from '@/data/elkBehavior'
import type { HuntingPressure } from '@/stores/map'

export interface GpxMetadata {
  season: Season
  timeOfDay: TimeOfDay
  pressure: HuntingPressure
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildWaypoint(poi: PointOfInterest, meta: GpxMetadata): string {
  const lines = [`  <wpt lat="${poi.lat}" lon="${poi.lng}">`]
  lines.push(`    <name>${escapeXml(poi.name)}</name>`)

  if (poi.elevation != null) {
    lines.push(`    <ele>${poi.elevation.toFixed(1)}</ele>`)
  }

  const descParts = [
    poi.description,
    '',
    `Season: ${meta.season} · Time: ${meta.timeOfDay} · Pressure: ${meta.pressure}`,
    `Type: ${poi.type}`,
    `Behaviors: ${poi.relatedBehaviors.join(', ')}`,
  ]
  if (poi.elevationFt) descParts.push(`Elevation: ${poi.elevationFt} ft`)
  if (poi.slope != null) descParts.push(`Slope: ${poi.slope.toFixed(0)}°`)
  if (poi.aspect) descParts.push(`Aspect: ${poi.aspect}`)

  lines.push(`    <desc>${escapeXml(descParts.join('\n'))}</desc>`)
  lines.push(`    <type>${escapeXml(poi.type)}</type>`)
  lines.push('  </wpt>')
  return lines.join('\n')
}

export function buildGpx(pois: PointOfInterest[], meta: GpxMetadata): string {
  const created = new Date().toISOString()
  const waypoints = pois.map((p) => buildWaypoint(p, meta)).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RidgeRead" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>RidgeRead Elk POIs — ${meta.season} / ${meta.timeOfDay} / ${meta.pressure} pressure</name>
    <time>${created}</time>
  </metadata>
${waypoints}
</gpx>
`
}

export function downloadGpx(pois: PointOfInterest[], meta: GpxMetadata): void {
  const content = buildGpx(pois, meta)
  const blob = new Blob([content], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)

  const date = new Date().toISOString().slice(0, 10)
  const filename = `ridgeread-elk-${meta.season}-${meta.timeOfDay}-${meta.pressure}-${date}.gpx`

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
