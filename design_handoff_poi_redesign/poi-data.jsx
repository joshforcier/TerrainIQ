// Elk POI data — lifted from codebase, repositioned on a 1000x720 canvas

const behaviorColors = {
  feeding:  '#4ade80',
  water:    '#60a5fa',
  bedding:  '#a78bfa',
  wallows:  '#f97316',
  travel:   '#facc15',
  security: '#ef4444',
};

const behaviorLabels = {
  feeding:  'Feeding',
  water:    'Water',
  bedding:  'Bedding',
  wallows:  'Wallows',
  travel:   'Travel Corridors',
  security: 'Security',
};

// Minimal inline SVG glyphs — NEVER complex
const behaviorGlyphs = {
  feeding:  (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" fill="currentColor"/></svg>,
  water:    (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><path d="M5 1 L8.5 8 L1.5 8 Z" fill="currentColor" transform="rotate(180 5 5)"/></svg>,
  bedding:  (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="currentColor"/></svg>,
  wallows:  (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>,
  travel:   (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><path d="M1 5 L9 5 M6 2 L9 5 L6 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="square"/></svg>,
  security: (s=10) => <svg width={s} height={s} viewBox="0 0 10 10"><path d="M5 1 L9 3 L9 6 Q9 8 5 9 Q1 8 1 6 L1 3 Z" fill="currentColor"/></svg>,
};

// Positions in % of map canvas (x, y). Matches screenshot-ish spatial rhythm.
// 10 POIs with multiple behaviors + confidence scores (derived from season/time).
const POIS = [
  { id:'p1', name:'Upper Meadow Park',    x:52, y:18, type:'meadow',   behaviors:['feeding','water'],         conf:{feeding:90, water:30}, elev:'9,200 ft', aspect:'S',  slope:12, desc:'Large south-facing meadow. Primary evening feeding area with good grass year-round.' },
  { id:'p2', name:'East Fork Drainage',   x:71, y:36, type:'drainage', behaviors:['water','travel'],          conf:{water:70, travel:85}, elev:'8,400 ft', aspect:'NE', slope:24, desc:'Steep drainage running NE with perennial creek. Major travel corridor between high bedding and low feed.' },
  { id:'p3', name:'North Wallow Complex', x:28, y:24, type:'wallow',   behaviors:['wallows','water'],         conf:{wallows:100, water:40}, elev:'9,500 ft', aspect:'N',  slope:8,  desc:'Three interconnected wallows in dark timber. Heavily used during rut. Fresh sign year after year.' },
  { id:'p4', name:'Divide Saddle',        x:18, y:44, type:'saddle',   behaviors:['travel','bedding'],        conf:{travel:85, bedding:55}, elev:'10,400 ft', aspect:'E', slope:18, desc:'Low saddle on the main divide. Elk cross here between east and west drainages. Great ambush point.' },
  { id:'p5', name:'Hidden Spring',        x:36, y:72, type:'spring',   behaviors:['water','feeding'],         conf:{water:50, feeding:35}, elev:'8,900 ft', aspect:'SW', slope:10, desc:'Year-round spring in a small park. Surrounded by good browse. Pulls elk even in late season.' },
  { id:'p6', name:'South Bench Meadow',   x:22, y:82, type:'meadow',   behaviors:['feeding','water'],         conf:{feeding:35, water:50}, elev:'8,800 ft', aspect:'SE', slope:6,  desc:'Bench meadow near creek. Early/late season feed area. Elk stage here before dropping to lower elevation.' },
  { id:'p7', name:'Aspen Wallow',         x:86, y:60, type:'wallow',   behaviors:['wallows'],                 conf:{wallows:85}, elev:'9,100 ft', aspect:'NW', slope:14, desc:'Single large wallow in aspen stand. Less used than the north complex but closer to open parks.' },
  { id:'p8', name:'Rim Saddle',           x:44, y:10, type:'saddle',   behaviors:['travel','bedding'],        conf:{travel:75, bedding:60}, elev:'10,100 ft', aspect:'N', slope:22, desc:'Narrow saddle on the north rim. Escape route when elk get pressured from below. Bedding nearby in blowdown timber.' },
  { id:'p9', name:'Creek Confluence',     x:58, y:52, type:'drainage', behaviors:['water','travel','feeding'],conf:{water:65, travel:80, feeding:45}, elev:'8,100 ft', aspect:'S',  slope:4,  desc:'Two creeks meet in a brushy bottom. Small openings with good feed. All-day water. High-traffic crossing.' },
  { id:'p10', name:'Dark Timber Bowl',    x:62, y:78, type:'bedding',  behaviors:['bedding','security'],      conf:{bedding:90, security:70}, elev:'9,700 ft', aspect:'N',  slope:26, desc:'North-facing bowl with 80%+ canopy. Primary midday bedding through the rut. Thermal advantage both directions.' },
];

// Return the dominant behavior for a POI based on its own confidence scores,
// optionally filtered by which layers are enabled.
function dominantBehavior(poi, enabledLayers) {
  const behaviors = poi.behaviors.filter(b => !enabledLayers || enabledLayers[b]);
  if (!behaviors.length) return null;
  return behaviors.reduce((best, b) =>
    (poi.conf[b] ?? 0) > (poi.conf[best] ?? -1) ? b : best
  , behaviors[0]);
}

function topConfidence(poi, enabledLayers) {
  const d = dominantBehavior(poi, enabledLayers);
  return d ? (poi.conf[d] ?? 0) : 0;
}

// Composite grade score: rewards high-confidence POIs with multiple overlapping
// behaviors, penalizes thin single-signal POIs.
function gradePoi(poi, enabledLayers) {
  const behaviors = poi.behaviors.filter(b => !enabledLayers || enabledLayers[b]);
  if (!behaviors.length) return { grade: '—', score: 0, label: 'No signal' };
  const sorted = [...behaviors].sort((a,b) => (poi.conf[b] ?? 0) - (poi.conf[a] ?? 0));
  const top = poi.conf[sorted[0]] ?? 0;
  const avg = behaviors.reduce((s,b) => s + (poi.conf[b] ?? 0), 0) / behaviors.length;
  const overlapBonus = Math.min(15, (behaviors.length - 1) * 6);
  // Weighted: 60% top, 25% avg (rewards many-signal), 15% overlap
  let score = top * 0.60 + avg * 0.25 + overlapBonus;
  // Thin-signal penalty
  if (behaviors.length === 1 && top < 50) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let grade, label;
  if (score >= 92)      { grade = 'A+'; label = 'Prime';   }
  else if (score >= 82) { grade = 'A';  label = 'Strong';  }
  else if (score >= 73) { grade = 'B+'; label = 'Solid';   }
  else if (score >= 63) { grade = 'B';  label = 'Viable';  }
  else if (score >= 53) { grade = 'C+'; label = 'Marginal';}
  else if (score >= 43) { grade = 'C';  label = 'Weak';    }
  else                  { grade = 'D';  label = 'Skip';    }
  return { grade, score: Math.round(score), label };
}

function gradeColor(grade) {
  if (grade === 'A+' || grade === 'A') return '#4ade80';  // green
  if (grade === 'B+' || grade === 'B') return '#e8c547';  // amber
  if (grade === 'C+' || grade === 'C') return '#f97316';  // orange
  return '#ef4444';                                        // red
}

Object.assign(window, { POIS, behaviorColors, behaviorLabels, behaviorGlyphs, dominantBehavior, topConfidence, gradePoi, gradeColor });
