<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ref, watch } from 'vue'
import sampleAnalysisImage from '@/assets/sample-analysis.jpg'
import sampleAnalysisMobileImage from '@/assets/sample-analysis-mobile.jpg'

const authStore = useAuthStore()
const router = useRouter()
const sampleOpen = ref(false)

// If already logged in, redirect to map
watch(
  () => authStore.isAuthenticated,
  (authed) => {
    if (authed) router.push('/map')
  },
  { immediate: true }
)

function signIn() {
  authStore.signInWithGoogle()
}

const features = [
  {
    icon: 'terrain',
    title: 'Measured Terrain, Not Heatmap Guessing',
    desc: 'Adaptive USGS elevation analysis computes real slope, aspect, and relief across your selected area, then detects saddles, benches, ridgelines, drainages, and finger ridges at real coordinates.',
  },
  {
    icon: 'auto_awesome',
    title: 'AI POIs Anchored To Real Features',
    desc: 'Generated POIs are checked against measured terrain and land cover before they hit your map. Bench, saddle, ridge, and transition-zone labels have to match the ground under the pin.',
  },
  {
    icon: 'local_fire_department',
    title: 'MTBS Burn History',
    desc: 'Historical burn perimeters are pulled into the scouting model. Prime-age burns and regrowth near timber lines can surface as high-value feed-to-cover transition zones.',
  },
  {
    icon: 'upload_file',
    title: 'Import Your Waypoints',
    desc: 'Bring in onX-style GPX waypoints, run terrain inspection on each one, and grade them through the same POI logic. Turn old sign, glassing, water, and bedding pins into structured scouting intel.',
  },
  {
    icon: 'forest',
    title: 'Transition-Zone Detection',
    desc: 'RidgeRead looks for the 100-400m band where meadow, grass, burn, or regrowth openings meet security cover. That staging band is often more huntable than the middle of the opening.',
  },
  {
    icon: 'block',
    title: 'Pressure-Aware Filtering',
    desc: 'Roads, trails, buildings, and settlements are mapped before POIs are accepted. You control the road buffer, and the server filters out spots that are too exposed to pressure.',
  },
]

const intelCards = [
  {
    label: 'FIELD HISTORY',
    icon: 'pin_drop',
    title: 'Grade the pins you already trust',
    body: 'Import GPX waypoints from past hunts and RidgeRead inspects each coordinate for slope, aspect, elevation, and terrain feature matches. A waypoint becomes more than a dot: it becomes a bedding shelf, subtle saddle, drainage bottom, or low-confidence sidehill with an honest explanation.',
  },
  {
    label: 'FIRE + REGROWTH',
    icon: 'local_fire_department',
    title: 'Find burn edges elk can actually use',
    body: 'MTBS burn history is blended with OSM meadow and regrowth signals to identify likely feed-to-cover bands. The model favors burns old enough to have grass, forbs, and brush returning, while keeping daylight setups close to adjacent timber.',
  },
  {
    label: 'GROUND TRUTH',
    icon: 'gps_fixed',
    title: 'Inspect the exact coordinate',
    body: 'The point inspector uses a centered elevation grid to explain why a location is or is not a bench, saddle, ridge, drainage, or finger ridge. It keeps the map, POI panel, and manual terrain check speaking the same language.',
  },
]

const seasonCards = [
  {
    season: 'Rut',
    dates: 'Sep – Oct',
    color: '#f97316',
    drive: 'Breeding',
    aspect: 'North / NE facing',
    slope: '10–30°',
    key: 'Saddles, wallows, meadow edges',
    detail: 'Bulls bugle from saddles. Bed on north-facing benches with 60-80% canopy within 400m of water. Wallows are critical, flat boggy areas at drainage heads.',
  },
  {
    season: 'Post-Rut',
    dates: 'Oct – Nov',
    color: '#a78bfa',
    drive: 'Recovery',
    aspect: 'North / NE facing',
    slope: '20–40°',
    key: 'Dark timber, blowdown, steep bowls',
    detail: 'Bulls go silent. Lost 15-20% body weight. Densest timber available, 80%+ canopy, deadfall. If you can see 50 yards, it\'s not thick enough.',
  },
  {
    season: 'Late Season',
    dates: 'Nov – Dec',
    color: '#60a5fa',
    drive: 'Energy conservation',
    aspect: 'South / SW facing',
    slope: '5–20°',
    key: 'South-facing transitions, wind shelter',
    detail: 'Aspect flips. South-facing slopes are 15-25°F warmer. Large herds, most predictable daily patterns. The south-facing timber edge is the #1 feature.',
  },
]

const steps = [
  { num: '1', title: 'Select Your Area', desc: 'Draw a box over the drainage, ridge system, or burn edge you\'re scouting.' },
  { num: '2', title: 'Choose Season & Time', desc: 'Rut, Post-Rut, or Late Season. Dawn, Midday, or Dusk.' },
  { num: '3', title: 'Add Your Intel', desc: 'Import GPX waypoints or start clean. RidgeRead can inspect your existing pins alongside new AI-generated POIs.' },
  { num: '4', title: 'Run Analysis', desc: 'Elevation, land cover, roads, towns, MTBS burn history, and transition zones are processed together.' },
  { num: '5', title: 'Hunt Smarter', desc: 'Open any POI or imported waypoint for grade, terrain proof, coordinates, and advice tied to that exact spot.' },
]

interface PricingTier {
  name: string
  price: string
  period: string
  highlight: boolean
  trial?: string
  desc: string
  features: Array<{ text: string; included: boolean }>
  cta: string
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Pro',
    price: '10',
    period: '/mo',
    highlight: true,
    trial: '30-day free trial',
    desc: 'For the hunter who scouts year-round.',
    features: [
      { text: '20 analyses per month', included: true },
      { text: 'GPX waypoint import + terrain inspection', included: true },
      { text: 'MTBS burn history context', included: true },
      { text: 'All 5 behavior layers', included: true },
      { text: 'All 4 base maps', included: true },
      { text: 'Season & time controls', included: true },
    ],
    cta: 'Start Free Trial',
  },
  {
    name: 'Guide',
    price: '25',
    period: '/mo',
    highlight: false,
    desc: 'For outfitters, professional guides, and serious hunters.',
    features: [
      { text: 'Unlimited analyses', included: true },
      { text: 'GPX waypoint import + terrain inspection', included: true },
      { text: 'MTBS burn history context', included: true },
      { text: 'All 5 behavior layers', included: true },
      { text: 'All 4 base maps', included: true },
      { text: 'Season & time controls', included: true },
    ],
    cta: 'Start Guiding',
  },
]
</script>

<template>
  <div class="landing">

    <!-- ═══ HERO ═══ -->
    <section class="hero">
      <div class="hero-bg" />
      <div class="hero-content">
        <div class="hero-badge">ELK TERRAIN INTELLIGENCE</div>
        <h1 class="hero-title">
          Find Better Elk Spots <br />
          <span class="text-amber">Before You Ever Step on the Mountain</span>
        </h1>
        <p class="hero-sub">
          RidgeRead analyzes terrain, cover, road pressure, burn history, weather, moon phase, and your waypoints — then ranks elk spots and builds a hunt plan for the season and time of day you're hunting.        </p>
        <div class="hero-cta-cluster">
          <div class="hero-actions">
            <q-btn
              color="amber"
              text-color="dark"
              label="Build My Hunt Plan"
              no-caps
              unelevated
              size="lg"
              class="text-weight-bold pricing-cta hero-primary-cta"
              @click="signIn"
            />
            <q-btn
              flat
              no-caps
              color="grey-5"
              label="See How It Works"
              icon="arrow_downward"
              size="md"
              class="hero-secondary-cta"
              @click="sampleOpen = true"
            />
          </div>
          <div class="hero-proof">
            <span>No credit card required</span>
            <span>One free terrain analysis</span>            
          </div>
        </div>
        <p v-if="authStore.error" class="text-red-4 q-mt-sm text-caption">
          {{ authStore.error }}
        </p>
      </div>
    </section>

    <q-dialog v-model="sampleOpen" class="sample-dialog">
      <div class="sample-analysis">
        <button class="sample-close" type="button" aria-label="Close sample analysis" @click="sampleOpen = false">
          <q-icon name="close" size="18px" />
        </button>

        <div class="sample-shot-wrap">
          <picture>
            <source :srcset="sampleAnalysisMobileImage" media="(max-width: 700px)">
            <img :src="sampleAnalysisImage" alt="Sample RidgeRead terrain analysis with ranked point of interest" class="sample-shot">
          </picture>
        </div>

        <div class="sample-caption">
          <div>
            <span>Sample Terrain Analysis</span>
            <strong>Late Season · Dawn · Low Pressure · B+ POI</strong>
          </div>
          <button type="button" @click="signIn">Build My Hunt Plan</button>
        </div>
      </div>
    </q-dialog>

    <!-- ═══ PROBLEM ═══ -->
    <section class="problem-section">
      <div class="section-inner">
        <h2 class="section-heading">
          You've got topo maps. You've got satellite imagery.<br />
          <span class="text-amber">You still walked past the elk.</span>
        </h2>
        <p class="problem-text">
          Mapping tools show you what the mountain looks like.
          They don't tell you what it <em>means</em>. That south-facing bench at 9,200 feet
          with a 12-degree slope, a creek 300 meters below, and a 2021 burn edge feeding into timber? During the rut at dawn,
          that's a cow herd transition zone with a herd bull bedded in the timber above it.
          In late November, it's where 150 elk are soaking up solar warmth between feeding sessions.
        </p>
        <p class="problem-text">
          You'd need 10 seasons of hunting that drainage to know that.
          <strong class="text-amber">Or you could open RidgeRead.</strong>
        </p>
      </div>
    </section>

    <!-- ═══ NEW INTEL ═══ -->
    <section class="intel-section">
      <div class="section-inner">
        <h2 class="section-heading">Built For Real Scouting Workflows</h2>
        <p class="section-sub">
          RidgeRead now connects your field history, burn-regrowth context, and point-level terrain inspection into one scouting loop.
        </p>
        <div class="intel-grid">
          <article v-for="item in intelCards" :key="item.title" class="intel-card">
            <div class="intel-label">
              <q-icon :name="item.icon" size="15px" />
              <span>{{ item.label }}</span>
            </div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- ═══ FEATURES ═══ -->
    <section class="features-section">
      <div class="section-inner">
        <h2 class="section-heading">What Makes It Different</h2>
        <div class="features-grid">
          <div v-for="f in features" :key="f.title" class="feature-card">
            <q-icon :name="f.icon" size="36px" color="amber" />
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SEASONS ═══ -->
    <section class="seasons-section">
      <div class="section-inner">
        <h2 class="section-heading">
          Three Seasons. Three Different Animals.
        </h2>
        <p class="section-sub">
          Elk behavior shifts dramatically across the fall. RidgeRead models each phase
          with specific slope angles, aspect preferences, canopy requirements, and water proximity rules.
        </p>
        <div class="season-cards">
          <div
            v-for="s in seasonCards"
            :key="s.season"
            class="season-card"
            :style="{ borderColor: s.color }"
          >
            <div class="season-header" :style="{ color: s.color }">
              <span class="season-name">{{ s.season }}</span>
              <span class="season-dates">{{ s.dates }}</span>
            </div>
            <div class="season-meta">
              <div><strong>Drive:</strong> {{ s.drive }}</div>
              <div><strong>Bed Aspect:</strong> {{ s.aspect }}</div>
              <div><strong>Bed Slope:</strong> {{ s.slope }}</div>
              <div><strong>Key Terrain:</strong> {{ s.key }}</div>
            </div>
            <p class="season-detail">{{ s.detail }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ HOW IT WORKS ═══ -->
    <section class="how-it-works">
      <div class="section-inner">
        <h2 class="section-heading">How It Works</h2>
        <div class="steps-row">
          <div v-for="s in steps" :key="s.num" class="step-card">
            <div class="step-num">{{ s.num }}</div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ DATA SECTION ═══ -->
    <section class="data-section">
      <div class="section-inner">
        <h2 class="section-heading">Real Data. Not Guesswork.</h2>
        <div class="data-grid">
          <div class="data-item">
            <div class="data-value">20-60</div>
            <div class="data-label">Adaptive elevation grid</div>
            <div class="data-source">USGS 3DEP first, Mapbox Terrain-RGB fallback</div>
          </div>
          <div class="data-item">
            <div class="data-value">MTBS</div>
            <div class="data-label">Burn-history context</div>
            <div class="data-source">Burn name, year, acres, and perimeter extent</div>
          </div>
          <div class="data-item">
            <div class="data-value">GPX</div>
            <div class="data-label">Waypoint terrain inspection</div>
            <div class="data-source">Imported pins graded through the POI model</div>
          </div>
          <div class="data-item">
            <div class="data-value">9</div>
            <div class="data-label">Season + time combinations</div>
            <div class="data-source">Each with unique behavior weights & terrain rules</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ PRICING ═══ -->
    <section class="pricing-section">
      <div class="section-inner">
        <h2 class="section-heading">Simple Pricing</h2>
        <p class="section-sub">
          Try Pro free for 30 days. Cancel anytime.
        </p>
        <div class="pricing-grid">
          <div
            v-for="tier in pricingTiers"
            :key="tier.name"
            class="pricing-card"
            :class="{ 'pricing-card--highlight': tier.highlight }"
          >
            <div v-if="tier.highlight" class="pricing-badge">MOST POPULAR</div>
            <h3 class="pricing-name">{{ tier.name }}</h3>
            <div v-if="tier.trial" class="pricing-trial">{{ tier.trial }}</div>
            <div class="pricing-price">
              <span class="pricing-dollar">$</span>
              <span class="pricing-amount">{{ tier.price }}</span>
              <span v-if="tier.period" class="pricing-period">{{ tier.period }}</span>
            </div>
            <p v-if="tier.trial" class="pricing-trial-note">then {{ '$' + tier.price + tier.period }} after the trial</p>
            <p class="pricing-desc">{{ tier.desc }}</p>
            <ul class="pricing-features">
              <li
                v-for="f in tier.features"
                :key="f.text"
                :class="{ 'feature-excluded': !f.included }"
              >
                <q-icon
                  :name="f.included ? 'check_circle' : 'remove_circle_outline'"
                  :color="f.included ? 'amber' : 'grey-8'"
                  size="16px"
                />
                <span>{{ f.text }}</span>
              </li>
            </ul>
            <q-btn
              :color="tier.highlight ? 'amber' : 'dark'"
              :text-color="tier.highlight ? 'dark' : 'grey-4'"
              :outline="!tier.highlight"
              :label="tier.cta"
              no-caps
              unelevated
              class="full-width text-weight-bold pricing-cta"
              @click="signIn"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ FINAL CTA ═══ -->
    <section class="final-cta">
      <div class="section-inner">
        <h2 class="cta-headline">
          The elk aren't random.<br />
          <span class="text-amber">The terrain tells you everything.</span>
        </h2>
        <p class="cta-sub">You just need something that reads it for you.</p>
        <q-btn
          color="amber"
          text-color="dark"
          icon="login"
          label="Start Your 30-Day Free Trial"
          no-caps
          unelevated
          size="lg"
          class="text-weight-bold cta-btn"
          @click="signIn"
        />
      </div>
    </section>

    <!-- ═══ FOOTER ═══ -->
    <footer class="landing-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="text-white text-weight-bold">Ridge</span><span class="text-amber">Read</span>
          <span class="footer-tagline">Built by elk hunters who got tired of guessing.</span>
        </div>
        <div class="footer-links">
          <span>Web</span>
          <span>iOS</span>
          <span>Android</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: #0a0e14;
  color: #c8d6e5;
  overflow-x: hidden;
}

/* ─── Hero ─── */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 24px 60px;
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(232, 197, 71, 0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 70% 80%, rgba(96, 165, 250, 0.04) 0%, transparent 50%),
    linear-gradient(180deg, #0a0e14 0%, #0f1923 100%);
}

.hero-content {
  position: relative;
  max-width: 720px;
  text-align: center;
}

.hero-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #e8c547;
  background: rgba(232, 197, 71, 0.1);
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid rgba(232, 197, 71, 0.2);
  margin-bottom: 28px;
}

.hero-title {
  font-size: clamp(32px, 5vw, 56px);
  font-weight: 800;
  line-height: 1.15;
  color: #fff;
  margin: 0 0 24px;
  letter-spacing: -1px;
}

.hero-sub {
  font-size: 18px;
  line-height: 1.7;
  color: #8899aa;
  max-width: 580px;
  margin: 0 auto 36px;
}

.hero-cta-cluster {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
  padding: 10px;
  border: 1px solid rgba(141, 166, 194, 0.1);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.01)),
    rgba(6, 10, 15, 0.3);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.22);
}

.hero-actions {
  display: flex;
  align-items: stretch;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.cta-btn {
  padding: 12px 32px;
  font-size: 16px;
  border-radius: 8px;
}

.hero-primary-cta {
  min-width: 244px;
  min-height: 54px;
  padding: 13px 30px;
  border-radius: 11px;
  font-size: 17px;
  letter-spacing: -0.01em;
  box-shadow:
    0 13px 30px rgba(232, 197, 71, 0.2),
    inset 0 -2px 0 rgba(0, 0, 0, 0.16);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.hero-primary-cta:hover {
  transform: translateY(-1px);
  box-shadow:
    0 18px 38px rgba(232, 197, 71, 0.26),
    inset 0 -2px 0 rgba(0, 0, 0, 0.16);
}

.hero-secondary-cta {
  min-height: 54px;
  padding: 0 18px;
  border: 1px solid rgba(141, 166, 194, 0.14);
  border-radius: 11px;
  background: rgba(17, 26, 36, 0.58);
  color: #c8d6e5 !important;
  font-weight: 800;
}

.hero-secondary-cta:hover {
  border-color: rgba(232, 197, 71, 0.22);
  background: rgba(232, 197, 71, 0.06);
}

.hero-proof {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  color: #a8b7c6;
  font-size: 13px;
  font-weight: 700;
}

.hero-proof span {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.hero-proof span + span::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #e8c547;
  box-shadow: 0 0 12px rgba(232, 197, 71, 0.55);
}

.sample-dialog :deep(.q-dialog__inner) {
  padding: 18px;
}

.sample-analysis {
  position: relative;
  width: calc(100vw - 16px);
  max-width: 1909px;
  max-height: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(232, 197, 71, 0.22);
  border-radius: 14px;
  background: #071017;
  color: #d9e4ef;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.62);
}

.sample-close {
  position: absolute;
  top: 13px;
  right: 13px;
  z-index: 6;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(141, 166, 194, 0.22);
  border-radius: 8px;
  background: rgba(8, 13, 19, 0.84);
  color: #8a9cad;
  cursor: pointer;
}

.sample-shot-wrap {
  display: flex;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  background: #05090d;
}

.sample-shot-wrap picture {
  display: flex;
  justify-content: center;
  min-width: 0;
}

.sample-shot {
  display: block;
  width: 100%;
  height: auto;
  max-height: calc(100vh - 112px);
  object-fit: contain;
}

.sample-caption {
  display: flex;
  align-items: center;
  gap: 18px;
  justify-content: space-between;
  padding: 15px 18px;
  border-top: 1px solid #1a2735;
  background: rgba(8, 13, 19, 0.98);
}

.sample-caption div {
  min-width: 0;
}

.sample-caption span,
.sample-caption strong {
  display: block;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
}

.sample-caption span {
  color: #e8c547;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.sample-caption strong {
  overflow: hidden;
  margin-top: 4px;
  color: #d9e4ef;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sample-caption button {
  min-height: 40px;
  flex: 0 0 auto;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  background: #e8c547;
  color: #071017;
  font-weight: 900;
  cursor: pointer;
}

.sample-map {
  position: relative;
  min-height: 650px;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(232, 197, 71, 0.12) 1px, transparent 1px),
    linear-gradient(0deg, rgba(232, 197, 71, 0.09) 1px, transparent 1px),
    radial-gradient(circle at 50% 42%, rgba(232, 197, 71, 0.3), transparent 2px),
    radial-gradient(circle at 54% 34%, rgba(232, 197, 71, 0.22), transparent 3px),
    radial-gradient(circle at 43% 56%, rgba(232, 197, 71, 0.22), transparent 3px),
    linear-gradient(135deg, #173626 0%, #294b28 34%, #425126 62%, #14251d 100%);
  background-size:
    76px 76px,
    76px 76px,
    auto,
    auto,
    auto,
    auto;
}

.sample-map::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(118deg, rgba(232, 197, 71, 0.17) 0 1px, transparent 1px 8px),
    repeating-linear-gradient(48deg, rgba(12, 19, 24, 0.34) 0 1px, transparent 1px 10px),
    radial-gradient(ellipse at 52% 35%, transparent 0 13%, rgba(5, 10, 12, 0.28) 36%, transparent 58%);
  mix-blend-mode: overlay;
}

.sample-map::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(6, 10, 15, 0.28), transparent 24%, transparent 76%, rgba(6, 10, 15, 0.22));
  pointer-events: none;
}

.sample-contours {
  position: absolute;
  inset: -10%;
  opacity: 0.76;
  background:
    repeating-radial-gradient(ellipse at 48% 45%, transparent 0 19px, rgba(232, 197, 71, 0.45) 20px 21px, transparent 22px 37px),
    repeating-radial-gradient(ellipse at 62% 28%, transparent 0 14px, rgba(232, 197, 71, 0.32) 15px 16px, transparent 17px 30px),
    repeating-radial-gradient(ellipse at 35% 68%, transparent 0 17px, rgba(232, 197, 71, 0.24) 18px 19px, transparent 20px 33px);
  filter: blur(0.1px);
  transform: rotate(-8deg) scale(1.08);
}

.sample-sidebar,
.sample-card,
.sample-right-panel {
  position: absolute;
  z-index: 2;
  border: 1px solid #223244;
  background: rgba(10, 18, 26, 0.94);
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.42);
}

.sample-sidebar {
  left: 0;
  top: 0;
  bottom: 0;
  width: 270px;
  padding: 16px;
}

.sample-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: #f5f1e7;
}

.sample-mark {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(232, 197, 71, 0.4);
  border-radius: 9px;
  color: #e8c547;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 900;
}

.sample-control,
.sample-layers {
  padding: 14px;
  margin-bottom: 10px;
  border: 1px solid #25374a;
  border-radius: 8px;
  background: #0f1922;
}

.sample-control > span,
.sample-layers > span,
.sample-card-eyebrow,
.sample-metrics span,
.sample-confidence > span,
.sample-notes span {
  display: block;
  color: #7f93a8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.sample-segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 10px;
  padding: 4px;
  border: 1px solid #1a2735;
  border-radius: 7px;
  background: #071017;
}

.sample-segments b {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: #8a9cad;
  font-size: 12px;
}

.sample-segments .is-active {
  border: 1px solid rgba(232, 197, 71, 0.38);
  background: rgba(232, 197, 71, 0.13);
  color: #e8c547;
}

.sample-layers div {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: 13px;
  color: #d9e4ef;
  font-size: 13px;
}

.sample-layers i,
.sample-confidence i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c);
}

.sample-layers em {
  color: #8a9cad;
  font-style: normal;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}

.sample-poi-pin {
  position: absolute;
  left: 48%;
  top: 52%;
  z-index: 3;
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border: 2px solid #e8c547;
  border-radius: 8px;
  background: rgba(13, 19, 18, 0.72);
  color: #e8c547;
  box-shadow: 0 0 0 3px rgba(232, 197, 71, 0.2), 0 0 24px rgba(232, 197, 71, 0.38);
}

.sample-poi-pin span {
  position: absolute;
  top: -13px;
  right: -13px;
  padding: 2px 5px;
  border-radius: 4px;
  background: #e8c547;
  color: #071017;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 900;
}

.sample-card {
  top: 44px;
  left: 50%;
  width: min(430px, 42vw);
  max-height: calc(100% - 88px);
  overflow: auto;
  border-radius: 10px;
}

.sample-card-eyebrow {
  padding: 18px 20px 0;
  color: #e8c547;
}

.sample-card h3 {
  margin: 8px 20px 18px;
  color: #f5f1e7;
  font-size: 22px;
  line-height: 1.12;
}

.sample-grade-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 22px;
  padding: 20px;
  border-top: 1px solid #1a2735;
}

.sample-grade-row > strong {
  color: #e8c547;
  font-size: 78px;
  line-height: 0.9;
}

.sample-grade-row span {
  color: #e8c547;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.sample-grade-row b {
  display: block;
  margin-top: 8px;
  color: #f5f1e7;
  font-size: 30px;
}

.sample-grade-row small {
  color: #6f8091;
  font-size: 14px;
}

.sample-grade-bar {
  height: 4px;
  margin: 0 20px 20px;
  overflow: hidden;
  border-radius: 5px;
  background: #1a2735;
}

.sample-grade-bar i {
  display: block;
  width: 75%;
  height: 100%;
  background: #e8c547;
}

.sample-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 18px;
  padding: 8px 10px;
  border: 1px solid #25374a;
  border-radius: 6px;
  background: #152232;
  color: #c8d6e5;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.sample-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid #1a2735;
  border-bottom: 1px solid #1a2735;
}

.sample-metrics div {
  padding: 18px 20px;
  border-right: 1px solid #1a2735;
}

.sample-metrics div:last-child {
  border-right: 0;
}

.sample-metrics strong {
  display: block;
  margin-top: 10px;
  color: #f5f1e7;
  font-size: 22px;
}

.sample-metrics small {
  color: #8a9cad;
  font-size: 13px;
}

.sample-confidence,
.sample-notes {
  padding: 18px 20px;
  border-bottom: 1px solid #1a2735;
}

.sample-confidence div {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-top: 14px;
  color: #d9e4ef;
}

.sample-confidence b {
  color: #e8c547;
}

.sample-notes p {
  margin: 14px 0 0;
  color: #c8d6e5;
  font-size: 15px;
  line-height: 1.62;
}

.sample-right-panel {
  right: 18px;
  top: 44px;
  width: 260px;
  padding: 16px;
  border-radius: 10px;
}

.sample-stepper {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  color: #8a9cad;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.sample-stepper b {
  flex: 1;
  padding-bottom: 10px;
  border-bottom: 2px solid #25374a;
}

.sample-stepper .is-done {
  color: #e8c547;
  border-color: #e8c547;
}

.sample-right-panel > strong {
  color: #f5f1e7;
  font-size: 17px;
}

.sample-right-panel p {
  color: #8a9cad;
  font-size: 13px;
  line-height: 1.5;
}

.sample-right-panel button {
  width: 100%;
  min-height: 42px;
  border: 0;
  border-radius: 7px;
  background: #e8c547;
  color: #071017;
  font-weight: 900;
  cursor: pointer;
}

@media (max-width: 1120px) {
  .sample-analysis {
    width: calc(100vw - 16px);
    max-width: none;
    max-height: calc(100vh - 16px);
    overflow: hidden;
  }

  .sample-map {
    min-height: auto;
    display: grid;
    grid-template-columns: minmax(260px, 0.8fr) minmax(380px, 1fr);
    gap: 14px;
    padding: 20px;
  }

  .sample-sidebar,
  .sample-card,
  .sample-right-panel {
    position: relative;
    inset: auto;
    width: 100%;
    max-height: none;
  }

  .sample-sidebar {
    grid-row: 1 / span 2;
    padding: 18px;
  }

  .sample-right-panel {
    grid-column: 2;
    grid-row: 1;
    padding-right: 58px;
  }

  .sample-card {
    grid-column: 2;
    grid-row: 2;
  }

  .sample-poi-pin {
    display: none;
  }

  .sample-close {
    top: 28px;
    right: 28px;
  }
}

@media (max-width: 820px) {
  .sample-map {
    grid-template-columns: 1fr;
  }

  .sample-sidebar,
  .sample-card,
  .sample-right-panel {
    grid-column: 1;
    grid-row: auto;
  }

  .sample-right-panel {
    padding-right: 58px;
  }
}

/* ─── Problem ─── */
.problem-section {
  padding: 100px 24px;
  background: #0f1923;
}

.section-inner {
  max-width: 800px;
  margin: 0 auto;
}

.section-heading {
  font-size: clamp(24px, 3.5vw, 38px);
  font-weight: 800;
  color: #fff;
  line-height: 1.25;
  margin: 0 0 28px;
  text-align: center;
}

.section-sub {
  font-size: 17px;
  color: #8899aa;
  text-align: center;
  max-width: 600px;
  margin: 0 auto 48px;
  line-height: 1.7;
}

.problem-text {
  font-size: 17px;
  line-height: 1.8;
  color: #9aabb8;
  margin-bottom: 20px;
  text-align: center;
}

/* ─── Features ─── */
.features-section {
  padding: 100px 24px;
  background: #0a0e14;
}

.features-section .section-inner {
  max-width: 1100px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 32px;
  margin-top: 48px;
}

.feature-card {
  background: #111a24;
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  padding: 32px 28px;
  transition: border-color 0.2s;
}

.feature-card:hover {
  border-color: rgba(232, 197, 71, 0.3);
}

.feature-card h3 {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 16px 0 10px;
}

.feature-card p {
  font-size: 14px;
  line-height: 1.7;
  color: #8899aa;
  margin: 0;
}

/* ─── Intel Section ─── */
.intel-section {
  padding: 100px 24px;
  background: #0f1923;
}

.intel-section .section-inner {
  max-width: 1100px;
}

.intel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.intel-card {
  background:
    linear-gradient(180deg, rgba(232, 197, 71, 0.06), rgba(17, 26, 36, 0) 42%),
    #111a24;
  border: 1px solid #26384a;
  border-radius: 12px;
  padding: 26px 24px;
}

.intel-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #e8c547;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.3px;
  margin-bottom: 18px;
}

.intel-card h3 {
  color: #fff;
  font-size: 19px;
  font-weight: 800;
  line-height: 1.3;
  margin: 0 0 12px;
}

.intel-card p {
  color: #8fa0ad;
  font-size: 14px;
  line-height: 1.75;
  margin: 0;
}

/* ─── Seasons ─── */
.seasons-section {
  padding: 100px 24px;
  background: #0a0e14;
}

.seasons-section .section-inner {
  max-width: 1100px;
}

.season-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.season-card {
  background: #111a24;
  border: 1px solid;
  border-radius: 12px;
  padding: 28px 24px;
}

.season-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 20px;
}

.season-name {
  font-size: 22px;
  font-weight: 800;
}

.season-dates {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.7;
}

.season-meta {
  font-size: 13px;
  color: #8899aa;
  line-height: 2;
  margin-bottom: 16px;
}

.season-meta strong {
  color: #b0bec5;
}

.season-detail {
  font-size: 14px;
  line-height: 1.7;
  color: #7a8d9c;
  margin: 0;
  border-top: 1px solid #1e2d3d;
  padding-top: 16px;
}

/* ─── How It Works ─── */
.how-it-works {
  padding: 100px 24px;
  background: #0f1923;
}

.how-it-works .section-inner {
  max-width: 1000px;
}

.steps-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 32px;
  margin-top: 48px;
}

.step-card {
  text-align: center;
}

.step-num {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(232, 197, 71, 0.12);
  color: #e8c547;
  font-size: 20px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  border: 2px solid rgba(232, 197, 71, 0.25);
}

.step-card h3 {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}

.step-card p {
  font-size: 14px;
  line-height: 1.6;
  color: #8899aa;
  margin: 0;
}

/* ─── Data Section ─── */
.data-section {
  padding: 100px 24px;
  background: #0a0e14;
}

.data-section .section-inner {
  max-width: 900px;
}

.data-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 32px;
  margin-top: 48px;
}

.data-item {
  text-align: center;
}

.data-value {
  font-size: 42px;
  font-weight: 800;
  color: #e8c547;
  line-height: 1;
  margin-bottom: 8px;
}

.data-label {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 6px;
}

.data-source {
  font-size: 12px;
  color: #6b7c8d;
}

/* ─── Pricing ─── */
.pricing-section {
  padding: 100px 24px;
  background: #0a0e14;
}

.pricing-section .section-inner {
  max-width: 1100px;
}

.pricing-grid {
  display: flex;
  justify-content: center;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 28px;
}

.pricing-card {
  position: relative;
  background: #111a24;
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  padding: 36px 28px 28px;
  display: flex;
  flex-direction: column;
  flex: 0 1 360px;
  max-width: 380px;
}

.pricing-card--highlight {
  border-color: #e8c547;
  background: #131e2b;
  box-shadow: 0 0 40px rgba(232, 197, 71, 0.08);
}

.pricing-badge {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #0a0e14;
  background: #e8c547;
  padding: 4px 16px;
  border-radius: 12px;
  white-space: nowrap;
}

.pricing-name {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 12px;
}

.pricing-price {
  display: flex;
  align-items: baseline;
  gap: 2px;
  margin-bottom: 8px;
}

.pricing-dollar {
  font-size: 20px;
  font-weight: 600;
  color: #8899aa;
  align-self: flex-start;
  margin-top: 6px;
}

.pricing-amount {
  font-size: 48px;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}

.pricing-period {
  font-size: 15px;
  color: #6b7c8d;
  font-weight: 500;
}

.pricing-trial {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #e8c547;
  background: rgba(232, 197, 71, 0.1);
  border: 1px solid rgba(232, 197, 71, 0.25);
  padding: 4px 10px;
  border-radius: 12px;
  margin-bottom: 12px;
}

.pricing-trial-note {
  font-size: 12px;
  color: #6b7c8d;
  margin: 4px 0 16px;
}

.pricing-desc {
  font-size: 14px;
  color: #7a8d9c;
  margin: 0 0 24px;
  line-height: 1.5;
}

.pricing-features {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pricing-features li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #b0bec5;
  line-height: 1.4;
}

.pricing-features li.feature-excluded {
  color: #4a5568;
}

.pricing-cta {
  padding: 10px 0;
  font-size: 14px;
  border-radius: 8px;
}

.pricing-card--highlight .pricing-cta {
  font-size: 15px;
  padding: 12px 0;
}

/* ─── Final CTA ─── */
.final-cta {
  padding: 120px 24px;
  background: #0a0e14;
  text-align: center;
}

.cta-headline {
  font-size: clamp(26px, 4vw, 44px);
  font-weight: 800;
  color: #fff;
  line-height: 1.25;
  margin: 0 0 16px;
}

.cta-sub {
  font-size: 18px;
  color: #8899aa;
  margin: 0 0 36px;
}

/* ─── Footer ─── */
.landing-footer {
  padding: 40px 24px;
  background: #080b10;
  border-top: 1px solid #1e2d3d;
}

.footer-inner {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.footer-brand {
  font-size: 18px;
}

.footer-tagline {
  display: block;
  font-size: 12px;
  color: #5a6a78;
  margin-top: 4px;
}

.footer-links {
  display: flex;
  gap: 24px;
  font-size: 13px;
  color: #6b7c8d;
  font-weight: 500;
}

/* ─── Mobile ─── */
@media (max-width: 599px) {
  .hero { padding: 60px 16px 40px; }
  .hero-sub { font-size: 15px; }
  .hero-cta-cluster,
  .hero-actions,
  .hero-primary-cta,
  .hero-secondary-cta {
    width: 100%;
  }

  .hero-cta-cluster {
    padding: 8px;
  }

  .hero-actions {
    flex-direction: column;
  }

  .hero-proof {
    gap: 5px;
    font-size: 12px;
  }

  .hero-proof span {
    width: 100%;
    justify-content: center;
  }

  .hero-proof span + span::before {
    display: none;
  }

  .sample-dialog :deep(.q-dialog__inner) {
    padding: 8px;
  }

  .sample-analysis {
    width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow: hidden;
  }

  .sample-shot {
    width: auto;
    max-width: 100%;
    max-height: 76vh;
  }

  .sample-caption {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .sample-caption button {
    width: 100%;
  }

  .sample-map {
    min-height: auto;
    padding: 66px 10px 10px;
  }

  .sample-sidebar,
  .sample-card,
  .sample-right-panel {
    position: relative;
    inset: auto;
    width: 100%;
    max-height: none;
    margin-bottom: 10px;
  }

  .sample-poi-pin {
    display: none;
  }

  .sample-card h3 {
    font-size: 20px;
  }

  .sample-grade-row > strong {
    font-size: 62px;
  }

  .sample-metrics {
    grid-template-columns: 1fr;
  }

  .sample-metrics div {
    border-right: 0;
    border-bottom: 1px solid #1a2735;
  }

  .sample-metrics div:last-child {
    border-bottom: 0;
  }

  .features-grid { grid-template-columns: 1fr; }
  .intel-grid { grid-template-columns: 1fr; }
  .season-cards { grid-template-columns: 1fr; }
  .steps-row { grid-template-columns: 1fr 1fr; }
  .data-grid { grid-template-columns: 1fr 1fr; }
  .pricing-grid { gap: 16px; }
}
</style>
