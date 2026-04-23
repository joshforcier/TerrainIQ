// App shell — header, left sidebar (controls), right select/detail card,
// Elk Intel button, base-layer switcher, and the map canvas.

const { useState, useMemo, useEffect } = React;

// ─── Icons (simple inline SVGs, no complex shapes) ──────────────────────────
const Icon = {
  Menu: (s=16) => <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 4h12M2 8h12M2 12h12"/></svg>,
  Dashboard: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="4.5" height="5"/><rect x="8" y="1.5" width="4.5" height="3"/><rect x="1.5" y="8.5" width="4.5" height="4"/><rect x="8" y="6" width="4.5" height="6.5"/></svg>,
  Map: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 3 L5 1.5 L9 3 L13 1.5 V11 L9 12.5 L5 11 L1 12.5 Z"/><path d="M5 1.5 V11 M9 3 V12.5"/></svg>,
  Analysis: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11 L5 7 L8 9 L12 3"/><path d="M2 13 H13"/></svg>,
  Settings: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="2"/><path d="M7 1 V3 M7 11 V13 M1 7 H3 M11 7 H13 M2.5 2.5 L4 4 M10 10 L11.5 11.5 M2.5 11.5 L4 10 M10 4 L11.5 2.5"/></svg>,
  Select: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4 V1 H4 M10 1 H13 V4 M13 10 V13 H10 M4 13 H1 V10"/></svg>,
  Close: (s=12) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2 L10 10 M10 2 L2 10"/></svg>,
  Info: (s=12) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="5"/><path d="M6 5.5 V9 M6 3.5 V4"/></svg>,
  Warn: (s=12) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 1 L11 10 H1 Z"/><path d="M6 5 V7.5 M6 8.5 V8.8"/></svg>,
  Check: (s=10) => <svg width={s} height={s} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square"><path d="M2 5 L4 7 L8 3"/></svg>,
  Plus: (s=12) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2 V10 M2 6 H10"/></svg>,
  Minus: (s=12) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6 H10"/></svg>,
  Streets:   (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12 L6 2 M8 12 L13 2 M3 7 H11"/></svg>,
  Satellite: (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="3"/><path d="M2 2 L4 4 M10 10 L12 12"/></svg>,
  Outdoors:  (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12 L5 5 L8 9 L10 6 L13 12 Z"/></svg>,
  Hybrid:    (s=14) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="5" height="5"/><rect x="7.5" y="1.5" width="5" height="5"/><rect x="1.5" y="7.5" width="5" height="5"/><rect x="7.5" y="7.5" width="5" height="5"/></svg>,
};

// ─── Top header ─────────────────────────────────────────────────────────────
function Header({ activeNav, onNav }) {
  return (
    <div className="rr-header">
      <div className="rr-header-left">
        <button className="rr-icon-btn">{Icon.Menu()}</button>
        <div className="rr-logo-group">
          <span className="rr-logo">RidgeRead</span>
          <span className="rr-tagline">ELK TERRAIN INTELLIGENCE</span>
        </div>
      </div>
      <nav className="rr-nav">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Icon.Dashboard },
          { id: 'map',       label: 'Map',       icon: Icon.Map },
          { id: 'analysis',  label: 'Analysis',  icon: Icon.Analysis },
          { id: 'settings',  label: 'Settings',  icon: Icon.Settings },
        ].map(n => (
          <button key={n.id}
            className={`rr-nav-btn ${activeNav === n.id ? 'rr-nav-btn--active' : ''}`}
            onClick={() => onNav(n.id)}
          >
            <span className="rr-nav-ico">{n.icon()}</span>
            {n.label}
          </button>
        ))}
        <div className="rr-avatar">J</div>
      </nav>
    </div>
  );
}

// ─── Left sidebar — filters & controls ──────────────────────────────────────
function Sidebar({ state, set, enabledLayers, toggleLayer, opacities, setOpacity, rankedPois, pinnedId, onPoiSelect, onPoiHover }) {
  const [tab, setTab] = React.useState('controls');

  const poiCount = rankedPois.filter(p => {
    const g = gradePoi(p, enabledLayers);
    return g.grade !== '—';
  }).length;

  return (
    <div className="rr-sidebar">
      <div className="rr-tabs">
        <button
          className={`rr-tab ${tab === 'controls' ? 'rr-tab--on' : ''}`}
          onClick={() => setTab('controls')}
        >
          <span className="rr-tab-label">Controls</span>
        </button>
        <button
          className={`rr-tab ${tab === 'pois' ? 'rr-tab--on' : ''}`}
          onClick={() => setTab('pois')}
        >
          <span className="rr-tab-label">Ranked POIs</span>
          <span className="rr-tab-count">{poiCount}</span>
        </button>
      </div>

      <div className="rr-sidebar-body">
        {tab === 'controls' && (
          <>
            <Section label="Season Phase" number="01">
              <SegGroup value={state.season} set={v=>set('season', v)} options={[
                { v:'rut', l:'Rut' }, { v:'post', l:'Post-Rut' }, { v:'late', l:'Late Season' }
              ]}/>
            </Section>

            <Section label="Time of Day" number="02">
              <SegGroup value={state.time} set={v=>set('time', v)} options={[
                { v:'dawn', l:'Dawn' }, { v:'midday', l:'Midday' }, { v:'dusk', l:'Dusk' }
              ]}/>
            </Section>

            <Section label="Hunting Pressure" number="03" warn>
              <SegGroup value={state.pressure} set={v=>set('pressure', v)} options={[
                { v:'low', l:'Low' }, { v:'med', l:'Med' }, { v:'high', l:'High' }
              ]}/>
            </Section>

            <Section label="Behavior Layers" number="04">
              <div className="rr-layers">
                {Object.keys(behaviorLabels).map(b => (
                  <div key={b} className="rr-layer-row">
                    <button
                      className={`rr-layer-check ${enabledLayers[b] ? 'on' : ''}`}
                      style={{ '--c': behaviorColors[b] }}
                      onClick={() => toggleLayer(b)}
                      aria-label={behaviorLabels[b]}
                    >
                      {enabledLayers[b] && Icon.Check()}
                    </button>
                    <span className="rr-layer-dot" style={{ background: behaviorColors[b] }} />
                    <span className="rr-layer-name">{behaviorLabels[b]}</span>
                    <div className="rr-slider-wrap">
                      <input
                        type="range" min="0" max="100"
                        value={opacities[b]}
                        onChange={e => setOpacity(b, +e.target.value)}
                        className="rr-slider"
                        style={{ '--c': behaviorColors[b], '--v': `${opacities[b]}%` }}
                      />
                    </div>
                    <span className="rr-layer-val">{opacities[b]}%</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section label="Road & Building Buffer" number="05" icon={Icon.Info()}>
              <div className="rr-buffer">
                <div className="rr-buffer-val"><span className="rr-buffer-num">{state.buffer.toFixed(2)}</span><span className="rr-buffer-unit">mi</span></div>
                <input
                  type="range" min="0.1" max="2" step="0.05"
                  value={state.buffer}
                  onChange={e => set('buffer', +e.target.value)}
                  className="rr-slider rr-slider--amber"
                  style={{ '--v': `${((state.buffer - 0.1) / 1.9) * 100}%` }}
                />
                <div className="rr-buffer-ticks"><span>0.1</span><span>2.0 mi</span></div>
                <div className="rr-buffer-hint">POIs closer than this to any road or building are excluded</div>
              </div>
            </Section>
          </>
        )}

        {tab === 'pois' && (
          <RankedTabBody pois={rankedPois} enabledLayers={enabledLayers} pinnedId={pinnedId} onSelect={onPoiSelect} onHover={onPoiHover}/>
        )}
      </div>
    </div>
  );
}

// Body of the Ranked POIs tab — header summary + list
function RankedTabBody({ pois, enabledLayers, pinnedId, onSelect, onHover }) {
  const graded = React.useMemo(() => {
    return pois.map(p => ({ poi: p, grade: gradePoi(p, enabledLayers) }))
      .filter(x => x.grade.grade !== '—')
      .sort((a,b) => b.grade.score - a.grade.score);
  }, [pois, enabledLayers]);

  const buckets = React.useMemo(() => {
    const b = { top: [], good: [], fair: [], skip: [] };
    graded.forEach(g => {
      if (g.grade.grade === 'A+' || g.grade.grade === 'A') b.top.push(g);
      else if (g.grade.grade === 'B+' || g.grade.grade === 'B') b.good.push(g);
      else if (g.grade.grade === 'C+' || g.grade.grade === 'C') b.fair.push(g);
      else b.skip.push(g);
    });
    return b;
  }, [graded]);

  return (
    <div className="rr-ranked-tab">
      <div className="rr-ranked-summary">
        <div className="rr-ranked-stat"><span className="rr-ranked-stat-num" style={{ color: '#4ade80' }}>{buckets.top.length}</span><span className="rr-ranked-stat-label">Prime / Strong</span></div>
        <div className="rr-ranked-stat"><span className="rr-ranked-stat-num" style={{ color: '#e8c547' }}>{buckets.good.length}</span><span className="rr-ranked-stat-label">Solid / Viable</span></div>
        <div className="rr-ranked-stat"><span className="rr-ranked-stat-num" style={{ color: '#f97316' }}>{buckets.fair.length}</span><span className="rr-ranked-stat-label">Marginal</span></div>
      </div>
      <POIRankList pois={pois} enabledLayers={enabledLayers} pinnedId={pinnedId} onSelect={onSelect} onHover={onHover} fullHeight/>
    </div>
  );
}

function Section({ label, number, children, warn, icon }) {
  return (
    <div className="rr-section">
      <div className="rr-section-head">
        <span className="rr-section-num">{number}</span>
        <span className="rr-section-label">{label}</span>
        {warn && <span className="rr-section-warn">{Icon.Warn()}</span>}
        {icon && <span className="rr-section-warn">{icon}</span>}
      </div>
      {children}
    </div>
  );
}

function SegGroup({ value, set, options }) {
  return (
    <div className="rr-seg">
      {options.map(o => (
        <button key={o.v}
          className={`rr-seg-btn ${value === o.v ? 'rr-seg-btn--on' : ''}`}
          onClick={() => set(o.v)}
        >{o.l}</button>
      ))}
    </div>
  );
}

// ─── Ranked POI list (sidebar leaderboard) ──────────────────────────────────
function POIRankList({ pois, enabledLayers, pinnedId, onSelect, onHover }) {
  const ranked = React.useMemo(() => {
    return [...pois]
      .map(p => ({ poi: p, grade: gradePoi(p, enabledLayers) }))
      .filter(x => x.grade.grade !== '—')
      .sort((a, b) => b.grade.score - a.grade.score);
  }, [pois, enabledLayers]);

  if (!ranked.length) {
    return <div className="rr-rank-empty">No matching POIs. Enable more layers.</div>;
  }

  return (
    <div className="rr-rank-list">
      {ranked.map(({ poi, grade }, i) => {
        const dom = dominantBehavior(poi, enabledLayers);
        const gc = gradeColor(grade.grade);
        const pinned = pinnedId === poi.id;
        return (
          <button
            key={poi.id}
            className={`rr-rank-row ${pinned ? 'rr-rank-row--on' : ''}`}
            onMouseEnter={() => onHover?.(poi.id)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(poi.id)}
          >
            <span className="rr-rank-num">{String(i+1).padStart(2,'0')}</span>
            <span className="rr-rank-grade" style={{ '--gc': gc }}>{grade.grade}</span>
            <span className="rr-rank-body">
              <span className="rr-rank-name">{poi.name}</span>
              <span className="rr-rank-meta">
                <span className="rr-rank-dot" style={{ background: behaviorColors[dom] }}/>
                <span className="rr-rank-behavior">{behaviorLabels[dom]}</span>
                <span className="rr-rank-sep">·</span>
                <span className="rr-rank-score">{grade.score}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Right-side cards (select workflow + detail panel) ──────────────────────
function SelectCard({ step, onStart }) {
  return (
    <div className="rr-select-card">
      <div className="rr-select-steps">
        {[{n:1,l:'Select'},{n:2,l:'Analyze'},{n:3,l:'Done'}].map(s => {
          const active = s.n === step;
          const done = s.n < step;
          return (
            <React.Fragment key={s.n}>
              <div className={`rr-select-step ${active ? 'on' : ''} ${done ? 'done' : ''}`}>
                <span className="rr-select-step-num">{done ? Icon.Check() : s.n}</span>
                <span className="rr-select-step-label">{s.l}</span>
              </div>
              {s.n < 3 && <div className="rr-select-divider"/>}
            </React.Fragment>
          );
        })}
      </div>
      <div className="rr-select-body">
        <p className="rr-select-caption">Pick a 5 × 5 mi area to analyze.</p>
        <button className="rr-btn rr-btn--primary" onClick={onStart}>
          {Icon.Select()} Select Area
        </button>
      </div>
    </div>
  );
}

function DetailPanel({ poi, enabledLayers, onClose }) {
  if (!poi) return null;
  const behaviors = poi.behaviors.filter(b => enabledLayers[b]);
  const grade = gradePoi(poi, enabledLayers);
  const gc = gradeColor(grade.grade);
  return (
    <div className="rr-detail">
      <div className="rr-detail-head">
        <div>
          <div className="rr-detail-eyebrow">Point of interest</div>
          <h3 className="rr-detail-name">{poi.name}</h3>
        </div>
        <button className="rr-icon-btn" onClick={onClose}>{Icon.Close()}</button>
      </div>

      {/* Grade hero */}
      <div className="rr-detail-grade" style={{ '--gc': gc }}>
        <div className="rr-detail-grade-letter">{grade.grade}</div>
        <div className="rr-detail-grade-body">
          <div className="rr-detail-grade-label">{grade.label}</div>
          <div className="rr-detail-grade-score">
            <span className="rr-detail-grade-num">{grade.score}</span>
            <span className="rr-detail-grade-unit">/ 100</span>
          </div>
          <div className="rr-detail-grade-bar">
            <div className="rr-detail-grade-bar-fill" style={{ width: `${grade.score}%`, background: gc }} />
          </div>
        </div>
      </div>

      <div className="rr-detail-meta">
        <div className="rr-detail-meta-cell">
          <div className="rr-detail-meta-label">ELEV</div>
          <div className="rr-detail-meta-val">{poi.elev}</div>
        </div>
        <div className="rr-detail-meta-cell">
          <div className="rr-detail-meta-label">ASPECT</div>
          <div className="rr-detail-meta-val">{poi.aspect}</div>
        </div>
        <div className="rr-detail-meta-cell">
          <div className="rr-detail-meta-label">SLOPE</div>
          <div className="rr-detail-meta-val">{poi.slope}°</div>
        </div>
      </div>

      <div className="rr-detail-section">
        <div className="rr-detail-section-title">Behavior Confidence · {behaviors.length} signal{behaviors.length !== 1 && 's'}</div>
        <div className="rr-detail-bars">
          {behaviors.map(b => (
            <div key={b} className="rr-detail-bar-row">
              <div className="rr-detail-bar-label">
                <span className="rr-detail-bar-dot" style={{ background: behaviorColors[b] }} />
                {behaviorLabels[b]}
              </div>
              <div className="rr-detail-bar-track">
                <div className="rr-detail-bar-fill" style={{ width: `${poi.conf[b]}%`, background: behaviorColors[b] }}/>
              </div>
              <div className="rr-detail-bar-num" style={{ color: behaviorColors[b] }}>{poi.conf[b]}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rr-detail-section">
        <div className="rr-detail-section-title">Field Notes</div>
        <p className="rr-detail-desc">{poi.desc}</p>
      </div>

      <div className="rr-detail-actions">
        <button className="rr-btn rr-btn--ghost">Save Pin</button>
        <button className="rr-btn rr-btn--primary">Navigate</button>
      </div>
    </div>
  );
}

// ─── Map chrome: zoom, scale, base layer, elk intel, measure ────────────────
function BaseLayerSwitcher({ base, setBase }) {
  const opts = [
    { v:'streets',   l:'Streets',   ico: Icon.Streets },
    { v:'satellite', l:'Satellite', ico: Icon.Satellite },
    { v:'outdoors',  l:'Outdoors',  ico: Icon.Outdoors },
    { v:'hybrid',    l:'Hybrid',    ico: Icon.Hybrid },
  ];
  return (
    <div className="rr-base-switcher">
      {opts.map(o => (
        <button key={o.v} className={`rr-layer-btn ${base === o.v ? 'on' : ''}`} onClick={()=>setBase(o.v)}>
          {o.ico()}<span>{o.l}</span>
        </button>
      ))}
    </div>
  );
}

function ZoomControls({ zoom, setZoom }) {
  return (
    <div className="rr-zoom">
      <button onClick={()=>setZoom(z=>Math.min(z+1, 18))} aria-label="Zoom in">{Icon.Plus()}</button>
      <div className="rr-zoom-div"/>
      <button onClick={()=>setZoom(z=>Math.max(z-1, 8))} aria-label="Zoom out">{Icon.Minus()}</button>
    </div>
  );
}

Object.assign(window, { Header, Sidebar, SelectCard, DetailPanel, BaseLayerSwitcher, ZoomControls, Icon });
