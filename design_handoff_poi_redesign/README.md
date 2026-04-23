# Handoff: RidgeRead POI Map Redesign

## Overview

This handoff covers a redesign of the RidgeRead map view — specifically the **point-of-interest (POI) presentation** on the map, the **left sidebar** (split into Controls + Ranked POIs tabs), and the **POI grading system** (A+ through D letter grades with composite score 0–100).

The goals were:
1. POIs no longer overlap, collide, or clutter the map.
2. Users can tell behavior type at a glance (color + glyph, no text on the map by default).
3. Strong vs weak POIs are visually obvious (letter grade + score).
4. Filters and a ranked POI list share the sidebar without competing for attention.

The design keeps the existing dark + amber aesthetic (`#0a0e14` / `#e8c547`), just cleaner and more tactical.

## About the Design Files

The files in this bundle are **design references created as an HTML prototype** — they show the intended look, behavior, and interactions, not production code to copy. Your task is to **recreate these designs in the existing Vue 3 + TypeScript + Quasar + Leaflet codebase** (see `TerrainIQ/src/...`) using its established patterns (Pinia stores, composables in `src/composables/`, components in `src/components/map/`).

## Fidelity

**High fidelity.** All colors, typography, spacing, and interactions are final. The tokens listed below should be adopted verbatim. The grading formula and thresholds are final. The tab structure is final.

---

## Screens / Views

There is one primary view: **`MapView.vue`** (replacing the current `src/views/MapView.vue`).

### Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header (48px)  — logo · nav · avatar                       │
├────────────┬───────────────────────────────────────────────┤
│            │                                               │
│  Sidebar   │            Map area (Leaflet)                 │
│  (280px)   │            · POI hex markers                  │
│            │            · Hover tooltip                    │
│            │            · Right-side detail panel (pinned) │
│            │            · Stepper card (top-right)         │
│            │            · Base-layer switcher (bottom-rt)  │
│            │            · Elk Intel button (bottom-lt)     │
└────────────┴───────────────────────────────────────────────┘
```

Grid: `grid-template-columns: 280px 1fr` / `grid-template-rows: 48px 1fr`.

### Sidebar (280px wide)

The sidebar is now split into **two tabs**:

**Tab bar** (pinned at top, 40px tall):
- Two tabs, full-width split 50/50: **Controls** · **Ranked POIs**
- Active tab: amber text (`#e8c547`), 2px amber bottom border, `rgba(232,197,71,0.04)` bg
- Inactive tab: `#556676` text
- Font: JetBrains Mono, 10px, weight 700, letter-spacing 0.1em, uppercase
- `Ranked POIs` tab has a count badge (pill) showing visible-POI count

**Controls tab body** (scroll area below tab bar). Sections in order:
1. `01 SEASON PHASE` — segmented: Rut · Post-Rut · Late Season
2. `02 TIME OF DAY` — segmented: Dawn · Midday · Dusk
3. `03 HUNTING PRESSURE` — segmented: Low · Med · High (with small amber warning icon)
4. `04 BEHAVIOR LAYERS` — 6 rows (feeding, water, bedding, wallows, travel, security). Each row:
   - Amber-bordered checkbox (fills amber with dark check when on)
   - Color dot (the behavior color)
   - Behavior name
   - Per-behavior opacity slider (0–100%, thumb matches behavior color)
   - Percent value (mono font)
5. `05 ROAD & BUILDING BUFFER` — large amber mono number (e.g. `0.25 mi`), amber slider (0.1–2.0), tick labels, hint text

**Ranked POIs tab body**:
- Summary header: 3 stat tiles in a row (Prime/Strong count in green, Solid/Viable in amber, Marginal in orange) — big mono numbers, tiny uppercase labels
- Ranked list (sorted by score desc). Each row: `NN | GRADE | Name / dominant-behavior · score`
- Click pins the POI (opens right detail panel, highlights marker)
- Hover highlights the marker on the map

### POI markers on the map

Currently rendered as **hex badges**. Each hex:
- ~34×30px, amber-bordered hexagon with dark inner fill (`#0a0e14`)
- Centered icon/glyph in the dominant behavior's color
- **Grade badge** in the top-right corner: small pill (~16×10px) with the letter grade (A+, A, B+, etc.) in the grade color, mono font 8.5px weight 800
- Soft behavior-colored shadow beneath
- Hover: scale 1.08, brighter border, tooltip appears above with name + top-behavior name + confidence %
- Click: opens the right-side detail panel and "pins" this marker (amber ring)

Overlapping POIs automatically cluster above a threshold (current prototype uses screen-distance; production can use Leaflet's `leaflet.markercluster` or equivalent).

### POI detail panel (right side, pinned on click)

- Width 340px, slides in from the right of the map area
- `background: rgba(15,25,35,0.92); backdrop-filter: blur(12px); border: 1px solid var(--bd-0); border-radius: 12px`
- Close (X) button top-right
- **Grade hero block** at top:
  - Large letter grade (~64px mono, weight 800) in grade color, with `0 0 32px` glow of same color at 30% opacity
  - Label ("Prime" / "Strong" / "Solid" / "Viable" / "Marginal" / "Weak" / "Skip")
  - Score `NN / 100` (mono, 20px for NN, 12px for `/ 100`)
  - Horizontal progress bar — fill width = score%, fill color = grade color
- POI name (20px, weight 700)
- Meta row: type · elevation · aspect · slope
- Behavior chips (one per enabled behavior): color dot + label + confidence %
- Description (body text, 12.5px, `#c8d6e5`, line-height 1.55)

---

## Grading system (core logic)

Composite 0–100 score → letter grade.

```ts
function gradePoi(poi: POI, enabledLayers: Record<Behavior, boolean>): {
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | '—',
  score: number,  // 0–100, rounded
  label: string,  // 'Prime' | 'Strong' | 'Solid' | 'Viable' | 'Marginal' | 'Weak' | 'Skip' | 'No signal'
} {
  const behaviors = poi.behaviors.filter(b => enabledLayers[b]);
  if (!behaviors.length) return { grade: '—', score: 0, label: 'No signal' };

  const sorted = [...behaviors].sort((a,b) => poi.conf[b]! - poi.conf[a]!);
  const top = poi.conf[sorted[0]] ?? 0;
  const avg = behaviors.reduce((s,b) => s + (poi.conf[b] ?? 0), 0) / behaviors.length;
  const overlapBonus = Math.min(15, (behaviors.length - 1) * 6);

  // Weighted: 60% top-signal, 25% avg across enabled, +overlap bonus up to 15
  let score = top * 0.60 + avg * 0.25 + overlapBonus;

  // Thin single-signal penalty
  if (behaviors.length === 1 && top < 50) score -= 10;
  score = Math.max(0, Math.min(100, score));

  // Thresholds
  if (score >= 92) return { grade: 'A+', score: Math.round(score), label: 'Prime'    };
  if (score >= 82) return { grade: 'A',  score: Math.round(score), label: 'Strong'   };
  if (score >= 73) return { grade: 'B+', score: Math.round(score), label: 'Solid'    };
  if (score >= 63) return { grade: 'B',  score: Math.round(score), label: 'Viable'   };
  if (score >= 53) return { grade: 'C+', score: Math.round(score), label: 'Marginal' };
  if (score >= 43) return { grade: 'C',  score: Math.round(score), label: 'Weak'     };
  return                  { grade: 'D',  score: Math.round(score), label: 'Skip'     };
}

// Grade color
function gradeColor(grade: string): string {
  if (grade === 'A+' || grade === 'A') return '#4ade80'; // green
  if (grade === 'B+' || grade === 'B') return '#e8c547'; // amber
  if (grade === 'C+' || grade === 'C') return '#f97316'; // orange
  return '#ef4444';                                       // red
}
```

Grade **recomputes reactively** whenever behavior layers are toggled (the overlap bonus changes).

`poi.conf` is the per-behavior confidence map (0–100) from the existing `useAIPois` composable or, for static POIs, derived from season × time via `behaviorWeights` in `src/data/elkBehavior.ts`. Recommend adding a getter in the Pinia map store.

---

## Interactions & Behavior

- **POI hover** → tooltip appears above hex; hex scales to 1.08; no panel change
- **POI click** → pins that POI (amber ring on hex), opens right detail panel; clicking another POI switches; clicking X in panel unpins
- **Sidebar ranked list hover** → highlights same marker on map (same visual as POI hover)
- **Sidebar ranked list click** → pins POI (same as clicking hex)
- **Behavior layer toggle** → hides/shows POIs whose dominant behavior is only that layer; recomputes all grades; updates ranked list + count badge
- **Season / time change** → recomputes confidence and grades

### Animations
- Panel slide-in: `transform: translateX(0)` from `translateX(8px)`, 180ms `ease-out`
- Hex hover scale: 120ms `ease-out`
- Tab switch: no animation (instant)
- Grade progress bar fill: 300ms `ease-out` on mount / score change

---

## State Management

Extend the existing Pinia `map` store (`src/stores/map.ts`):

```ts
// New state
pinnedPoiId: string | null
sidebarTab: 'controls' | 'pois'
hoveredPoiId: string | null  // for sidebar↔map hover sync

// New getters
rankedPois: POI[]            // sorted by gradePoi().score desc, filters out '—'
poiCountVisible: number       // same length
poiBuckets: { top: POI[], good: POI[], fair: POI[], skip: POI[] }  // for summary tiles

// New actions
pinPoi(id: string | null)
setSidebarTab(tab: 'controls' | 'pois')
setHoveredPoi(id: string | null)
```

The existing `enabledLayers`, `opacities`, `season`, `time`, `pressure`, and `buffer` state stay where they are.

---

## Design Tokens

```css
:root {
  /* Backgrounds */
  --bg-0: #07090c;        /* page background */
  --bg-1: #0a0e14;        /* sidebar, cards */
  --bg-2: #0f1922;        /* segmented-control background */
  --bg-3: #131d29;

  /* Borders */
  --bd-0: #1a2735;
  --bd-1: #25374a;

  /* Foreground */
  --fg-0: #e7eef5;        /* headings */
  --fg-1: #c8d6e5;        /* body */
  --fg-2: #8a9cad;        /* secondary */
  --fg-3: #556676;        /* tertiary / hints */

  /* Accent */
  --amber:      #e8c547;
  --amber-glow: rgba(232, 197, 71, 0.18);

  /* Type */
  --font: 'Inter', -apple-system, system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}

/* Behavior colors (match src/data/elkBehavior.ts) */
feeding:  #4ade80
water:    #60a5fa
bedding:  #a78bfa
wallows:  #f97316
travel:   #facc15
security: #ef4444

/* Grade colors */
A+ / A  → #4ade80 (green)
B+ / B  → #e8c547 (amber)
C+ / C  → #f97316 (orange)
D       → #ef4444 (red)
```

### Spacing scale
4 · 6 · 8 · 12 · 14 · 16 · 20 · 24 (px)

### Border radius
3 · 4 · 6 · 7 · 8 · 10 · 12 (px)

### Typography

| Use | Family | Size | Weight | Letter-spacing |
|---|---|---|---|---|
| Logo | Inter | 16 | 800 | -0.01em |
| Section label | Inter | 10 | 700 | 0.14em uppercase |
| Tab label | Mono | 10 | 700 | 0.1em uppercase |
| Nav button | Inter | 12 | 600 | — |
| Body | Inter | 12.5–13 | 500 | — |
| Segmented button | Inter | 12 | 600 | — |
| Mono numbers | Mono | 9.5–28 | 600–800 | -0.02em at large sizes |
| Tagline | Mono | 9 | 600 | 0.18em uppercase |

---

## Assets

- **Icons** — all inline SVG, simple 1-2 path shapes. See `app-shell.jsx` `Icon.*` map and `poi-data.jsx` `behaviorGlyphs.*` map. Recreate as Vue SFC or a shared `<Icon name="…" />` component.
- **Fonts** — Inter (Google Fonts) + JetBrains Mono (Google Fonts). Already used elsewhere in the project? If not, add to `index.html` or import in `main.ts`.

No raster images are used.

---

## Files in this bundle

| File | What it is |
|---|---|
| `RidgeRead Map Redesign.html` | Full interactive prototype — open in a browser |
| `app-shell.jsx` | Header, sidebar (with tabs), detail panel, segmented controls, ranked list |
| `poi-data.jsx` | POI sample data, behavior colors/labels/glyphs, `gradePoi()`, `gradeColor()`, `dominantBehavior()` — **grading logic is authoritative** |
| `poi-variants.jsx` | All 5 marker style variants (hex is the chosen one; others are reference) |
| `tweaks-panel.jsx` | Helper; not needed in production |
| `screenshots/` | Static PNGs of key states (if included) |

---

## Implementation checklist

- [ ] Add `gradePoi()` + `gradeColor()` to a new `src/composables/usePoiGrading.ts`
- [ ] Extend `useMapStore` with `pinnedPoiId`, `sidebarTab`, `hoveredPoiId`, ranked getter, bucket getter
- [ ] Build hex marker as a Leaflet `divIcon` — keep grade badge in top-right corner
- [ ] Replace current `MapView.vue` sidebar with the two-tab structure; keep all existing Controls sections
- [ ] Build `PoiDetailPanel.vue` (grade hero + meta + chips + description)
- [ ] Wire sidebar hover → map marker highlight (and vice versa) via store
- [ ] Port the design tokens into a shared `_tokens.scss` or `:root` block
- [ ] Keep the existing Elk Intel button, base-layer switcher, and stepper card unchanged — they already match the token system

---

## Out of scope

- Dashboard, Analysis, Settings views — not touched
- Landing page — not touched
- AI POI generation pipeline (`api/generate-pois.ts`, `server/routes`) — no changes; grading consumes whatever `conf` values it returns
- Authentication — no changes
