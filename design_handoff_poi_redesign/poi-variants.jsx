// 5 POI marker variations. Each renders a list of POIs at absolute % coords
// on the map layer. Each accepts: { pois, enabledLayers, hoveredId, onHover, onClick, pinnedId }

// ─── Shared tooltip card (used by hover in variants 1, 2, 4, 5) ─────────────
function POIHoverCard({ poi, x, y, enabledLayers }) {
  const top = dominantBehavior(poi, enabledLayers);
  if (!top) return null;
  const grade = gradePoi(poi, enabledLayers);
  // Position card above the marker, clamped
  const left = x > 70 ? 'auto' : 'calc(100% + 12px)';
  const right = x > 70 ? 'calc(100% + 12px)' : 'auto';
  return (
    <div className="poi-hover-card" style={{ left, right, top: '50%', transform: 'translateY(-50%)' }}>
      <div className="poi-hover-head">
        <div className="poi-hover-name">{poi.name}</div>
        <div className="poi-hover-grade" style={{ '--gc': gradeColor(grade.grade) }}>
          <span className="poi-hover-grade-letter">{grade.grade}</span>
          <span className="poi-hover-grade-label">{grade.label}</span>
        </div>
      </div>
      <div className="poi-hover-behaviors">
        {poi.behaviors.filter(b => !enabledLayers || enabledLayers[b]).map(b => (
          <div key={b} className="poi-hover-row">
            <span className="poi-hover-swatch" style={{ background: behaviorColors[b] }} />
            <span className="poi-hover-label">{behaviorLabels[b]}</span>
            <span className="poi-hover-score" style={{ color: behaviorColors[b] }}>{poi.conf[b]}%</span>
          </div>
        ))}
      </div>
      <div className="poi-hover-meta">
        <span>{poi.elev}</span><span className="poi-meta-dot">•</span>
        <span>{poi.aspect}-facing</span><span className="poi-meta-dot">•</span>
        <span>{poi.slope}° slope</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIANT 1: CONFIDENCE DOTS — size ∝ top-confidence, color = behavior
// ═══════════════════════════════════════════════════════════════════════════
function MarkersConfidenceDots({ pois, enabledLayers, hoveredId, pinnedId, onHover, onClick }) {
  return (
    <>
      {pois.map(poi => {
        const top = dominantBehavior(poi, enabledLayers);
        if (!top) return null;
        const conf = poi.conf[top];
        const size = 12 + (conf / 100) * 22; // 12–34px
        const color = behaviorColors[top];
        const active = hoveredId === poi.id || pinnedId === poi.id;
        return (
          <div key={poi.id} className="poi-abs" style={{ left: `${poi.x}%`, top: `${poi.y}%` }}>
            {/* Pulse ring for highest-confidence */}
            {conf >= 80 && <div className="poi-pulse" style={{ '--c': color, '--s': `${size}px` }} />}
            <button
              className={`poi-dot ${active ? 'poi-dot--active' : ''}`}
              style={{ width: size, height: size, background: color, boxShadow: active ? `0 0 0 3px rgba(255,255,255,0.25), 0 0 16px ${color}` : `0 0 8px ${color}88` }}
              onMouseEnter={() => onHover(poi.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(poi.id)}
              aria-label={poi.name}
            />
            {hoveredId === poi.id && <POIHoverCard poi={poi} x={poi.x} y={poi.y} enabledLayers={enabledLayers} />}
          </div>
        );
      })}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIANT 2: MINIMAL GLYPH PINS — small shaped pin, icon per type
// Smart labels: top 3 by confidence get a tiny name tag
// ═══════════════════════════════════════════════════════════════════════════
function MarkersGlyphPins({ pois, enabledLayers, hoveredId, pinnedId, onHover, onClick }) {
  const visible = pois.filter(p => dominantBehavior(p, enabledLayers));
  const topIds = new Set(
    [...visible].sort((a,b) => topConfidence(b, enabledLayers) - topConfidence(a, enabledLayers))
      .slice(0, 3).map(p => p.id)
  );
  return (
    <>
      {visible.map(poi => {
        const top = dominantBehavior(poi, enabledLayers);
        const color = behaviorColors[top];
        const active = hoveredId === poi.id || pinnedId === poi.id;
        const showLabel = topIds.has(poi.id) || active;
        return (
          <div key={poi.id} className="poi-abs" style={{ left: `${poi.x}%`, top: `${poi.y}%` }}>
            <button
              className={`poi-glyph ${active ? 'poi-glyph--active' : ''}`}
              style={{ '--c': color }}
              onMouseEnter={() => onHover(poi.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(poi.id)}
              aria-label={poi.name}
            >
              <span className="poi-glyph-icon">{behaviorGlyphs[top](12)}</span>
            </button>
            {showLabel && (
              <div className="poi-glyph-label" style={{ color }}>
                {poi.name}
                <span className="poi-glyph-conf">{poi.conf[top]}</span>
              </div>
            )}
            {hoveredId === poi.id && <POIHoverCard poi={poi} x={poi.x} y={poi.y} enabledLayers={enabledLayers} />}
          </div>
        );
      })}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIANT 3: RANKED NUMBERED PINS — sorted 1–10 by score, no other on-map text
// ═══════════════════════════════════════════════════════════════════════════
function MarkersNumbered({ pois, enabledLayers, hoveredId, pinnedId, onHover, onClick }) {
  const ranked = [...pois.filter(p => dominantBehavior(p, enabledLayers))]
    .sort((a,b) => topConfidence(b, enabledLayers) - topConfidence(a, enabledLayers));
  return (
    <>
      {ranked.map((poi, i) => {
        const top = dominantBehavior(poi, enabledLayers);
        const color = behaviorColors[top];
        const rank = i + 1;
        const active = hoveredId === poi.id || pinnedId === poi.id;
        const isTopThree = rank <= 3;
        return (
          <div key={poi.id} className="poi-abs" style={{ left: `${poi.x}%`, top: `${poi.y}%` }}>
            <button
              className={`poi-rank ${active ? 'poi-rank--active' : ''} ${isTopThree ? 'poi-rank--top' : ''}`}
              style={{ '--c': color }}
              onMouseEnter={() => onHover(poi.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(poi.id)}
              aria-label={`${rank}. ${poi.name}`}
            >
              {rank}
            </button>
            {hoveredId === poi.id && <POIHoverCard poi={poi} x={poi.x} y={poi.y} enabledLayers={enabledLayers} />}
          </div>
        );
      })}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIANT 4: TACTICAL HEX BADGES — hex with icon + confidence bar underneath
// Monospace data readouts
// ═══════════════════════════════════════════════════════════════════════════
function MarkersTacticalHex({ pois, enabledLayers, hoveredId, pinnedId, onHover, onClick }) {
  // Rank by confidence so top POIs get an ID tag
  const ranked = [...pois.filter(p => dominantBehavior(p, enabledLayers))]
    .sort((a,b) => topConfidence(b, enabledLayers) - topConfidence(a, enabledLayers));
  const rankById = new Map(ranked.map((p, i) => [p.id, i + 1]));
  return (
    <>
      {pois.map(poi => {
        const top = dominantBehavior(poi, enabledLayers);
        if (!top) return null;
        const conf = poi.conf[top];
        const color = behaviorColors[top];
        const active = hoveredId === poi.id || pinnedId === poi.id;
        const rank = rankById.get(poi.id);
        const isTop = rank <= 3;
        const grade = gradePoi(poi, enabledLayers);
        // Grid-coord style ID from the POI position (fake but consistent)
        const gridId = `${String.fromCharCode(64 + Math.round(poi.x/12))}${String(Math.round(poi.y/7)).padStart(2,'0')}`;
        return (
          <div key={poi.id} className="poi-abs poi-hex-wrap" style={{ left: `${poi.x}%`, top: `${poi.y}%` }}>
            {active && (
              <svg className="poi-hex-crosshair" width="72" height="72" viewBox="0 0 72 72" style={{ '--c': color }}>
                <circle cx="36" cy="36" r="26" fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.45" strokeDasharray="2 3"/>
                <path d="M36 4 V14 M36 58 V68 M4 36 H14 M58 36 H68" stroke={color} strokeWidth="1" strokeOpacity="0.6"/>
              </svg>
            )}
            <button
              className={`poi-hex ${active ? 'poi-hex--active' : ''} ${isTop ? 'poi-hex--top' : ''}`}
              style={{ '--c': color }}
              onMouseEnter={() => onHover(poi.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(poi.id)}
              aria-label={poi.name}
            >
              <svg className="poi-hex-shape" width="34" height="38" viewBox="0 0 34 38">
                <polygon points="17,2 32,10.5 32,27.5 17,36 2,27.5 2,10.5"
                  fill={isTop ? color : 'rgba(10,14,20,0.92)'}
                  fillOpacity={isTop ? 0.18 : 1}
                  stroke={color} strokeWidth="1.5" />
                {/* Inner ring for top POIs */}
                {isTop && <polygon points="17,5 29,12 29,26 17,33 5,26 5,12" fill="none" stroke={color} strokeWidth="0.8" strokeOpacity="0.5"/>}
              </svg>
              <span className="poi-hex-icon" style={{ color }}>{behaviorGlyphs[top](13)}</span>
              {/* Grade badge — top-right corner */}
              <span className="poi-hex-grade" style={{ '--gc': gradeColor(grade.grade) }}>
                {grade.grade}
              </span>
            </button>

            {/* Confidence bar below hex */}
            <div className="poi-hex-bar" style={{ '--c': color }}>
              <div className="poi-hex-bar-fill" style={{ width: `${conf}%`, background: color }} />
            </div>

            {/* Data tag: grid-id + conf% */}
            <div className={`poi-hex-tag ${isTop ? 'poi-hex-tag--top' : ''}`} style={{ '--c': color }}>
              <span className="poi-hex-tag-id">{gridId}</span>
              <span className="poi-hex-tag-sep">·</span>
              <span className="poi-hex-tag-conf" style={{ color }}>{conf}</span>
            </div>

            {hoveredId === poi.id && <POIHoverCard poi={poi} x={poi.x} y={poi.y} enabledLayers={enabledLayers} />}
          </div>
        );
      })}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VARIANT 5: CLUSTERED — nearby POIs merge into a grouped badge
// Simple proximity clustering on the % grid; expand on hover
// ═══════════════════════════════════════════════════════════════════════════
function clusterPois(pois, enabledLayers, radius = 9) {
  const visible = pois.filter(p => dominantBehavior(p, enabledLayers));
  const clusters = [];
  const used = new Set();
  for (const p of visible) {
    if (used.has(p.id)) continue;
    const group = [p];
    used.add(p.id);
    for (const q of visible) {
      if (used.has(q.id)) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < radius) { group.push(q); used.add(q.id); }
    }
    // Centroid
    const cx = group.reduce((s,g) => s+g.x, 0) / group.length;
    const cy = group.reduce((s,g) => s+g.y, 0) / group.length;
    clusters.push({ id: `c-${p.id}`, x: cx, y: cy, members: group });
  }
  return clusters;
}

function MarkersClustered({ pois, enabledLayers, hoveredId, pinnedId, onHover, onClick }) {
  const clusters = React.useMemo(() => clusterPois(pois, enabledLayers), [pois, enabledLayers]);
  return (
    <>
      {clusters.map(cl => {
        if (cl.members.length === 1) {
          const poi = cl.members[0];
          const top = dominantBehavior(poi, enabledLayers);
          const color = behaviorColors[top];
          const active = hoveredId === poi.id || pinnedId === poi.id;
          return (
            <div key={cl.id} className="poi-abs" style={{ left: `${cl.x}%`, top: `${cl.y}%` }}>
              <button
                className={`poi-glyph ${active ? 'poi-glyph--active' : ''}`}
                style={{ '--c': color }}
                onMouseEnter={() => onHover(poi.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onClick(poi.id)}
                aria-label={poi.name}
              >
                <span className="poi-glyph-icon">{behaviorGlyphs[top](12)}</span>
              </button>
              {hoveredId === poi.id && <POIHoverCard poi={poi} x={poi.x} y={poi.y} enabledLayers={enabledLayers} />}
            </div>
          );
        }
        // Multi-POI cluster
        const behaviorSet = new Set();
        cl.members.forEach(m => m.behaviors.forEach(b => enabledLayers[b] && behaviorSet.add(b)));
        const expanded = cl.members.some(m => m.id === hoveredId || m.id === pinnedId);
        return (
          <ClusterBadge
            key={cl.id}
            cluster={cl}
            behaviorSet={behaviorSet}
            enabledLayers={enabledLayers}
            expanded={expanded}
            hoveredId={hoveredId}
            pinnedId={pinnedId}
            onHover={onHover}
            onClick={onClick}
          />
        );
      })}
    </>
  );
}

function ClusterBadge({ cluster, behaviorSet, enabledLayers, expanded, hoveredId, pinnedId, onHover, onClick }) {
  const [isHover, setIsHover] = React.useState(false);
  const show = expanded || isHover;
  const cx = cluster.x, cy = cluster.y;
  return (
    <div
      className="poi-abs"
      style={{ left: `${cx}%`, top: `${cy}%`, zIndex: show ? 50 : 10 }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      {!show && (
        <button
          className="poi-cluster"
          onClick={() => setIsHover(true)}
          aria-label={`${cluster.members.length} points of interest`}
        >
          <div className="poi-cluster-swatches">
            {[...behaviorSet].slice(0,3).map(b => (
              <span key={b} className="poi-cluster-swatch" style={{ background: behaviorColors[b] }} />
            ))}
          </div>
          <span className="poi-cluster-count">{cluster.members.length}</span>
        </button>
      )}
      {show && cluster.members.map((poi, i) => {
        const top = dominantBehavior(poi, enabledLayers);
        const color = behaviorColors[top];
        const angle = (i / cluster.members.length) * Math.PI * 2 - Math.PI / 2;
        const R = 42;
        const dx = Math.cos(angle) * R;
        const dy = Math.sin(angle) * R;
        const active = hoveredId === poi.id || pinnedId === poi.id;
        return (
          <div key={poi.id} className="poi-cluster-member" style={{ transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)` }}>
            <button
              className={`poi-glyph ${active ? 'poi-glyph--active' : ''}`}
              style={{ '--c': color }}
              onMouseEnter={() => onHover(poi.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(poi.id)}
              aria-label={poi.name}
            >
              <span className="poi-glyph-icon">{behaviorGlyphs[top](12)}</span>
            </button>
            <div className="poi-cluster-name" style={{ color }}>{poi.name}</div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  MarkersConfidenceDots,
  MarkersGlyphPins,
  MarkersNumbered,
  MarkersTacticalHex,
  MarkersClustered,
  POIHoverCard,
});
