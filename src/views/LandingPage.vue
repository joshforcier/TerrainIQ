<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { watch } from 'vue'

const authStore = useAuthStore()
const router = useRouter()

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
    title: 'Real Elevation Data',
    desc: '400-point USGS elevation grid for every analysis. Real slope angles, aspect directions, and terrain feature detection — saddles, benches, ridgelines, drainages, finger ridges. Measured, not guessed.',
  },
  {
    icon: 'auto_awesome',
    title: 'AI-Powered POIs',
    desc: 'Points of interest placed on actual meadows, drainages, and saddles using verified satellite land cover. Every POI references real elevation, slope, and aspect with tactical hunting advice.',
  },
  {
    icon: 'calendar_month',
    title: 'Season + Time Intelligence',
    desc: 'Rut, Post-Rut, Late Season. Dawn, Midday, Dusk. Each combination recalculates every POI and overlay because elk on October 1st at dawn are not the same elk on November 15th at dusk.',
  },
  {
    icon: 'layers',
    title: '5 Behavior Layers',
    desc: 'Feeding, Water, Bedding, Wallows, Travel Corridors. Each scored by season and time, with color-coded zone overlays on the map. See the why, not just the where.',
  },
  {
    icon: 'block',
    title: 'Custom Road Buffer',
    desc: 'Every road and trail is mapped from OpenStreetMap. Set your own buffer distance — POIs too close are automatically filtered out. If it\'s near a road, it\'s not elk habitat.',
  },
  {
    icon: 'public',
    title: 'Works Anywhere',
    desc: 'Flat Tops. Frank Church. Gila. Your spot. Not locked to pre-built unit maps — analyze any 5-mile area in elk country on the fly.',
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
    detail: 'Bulls bugle from saddles. Bed on north-facing benches with 60-80% canopy within 400m of water. Wallows are critical — flat boggy areas at drainage heads.',
  },
  {
    season: 'Post-Rut',
    dates: 'Oct – Nov',
    color: '#a78bfa',
    drive: 'Recovery',
    aspect: 'North / NE facing',
    slope: '20–40°',
    key: 'Dark timber, blowdown, steep bowls',
    detail: 'Bulls go silent. Lost 15-20% body weight. Densest timber available — 80%+ canopy, deadfall. If you can see 50 yards, it\'s not thick enough.',
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
  { num: '1', title: 'Select Your Area', desc: 'Click the map to place a 5-mile analysis box on the terrain you\'re scouting.' },
  { num: '2', title: 'Choose Season & Time', desc: 'Rut, Post-Rut, or Late Season. Dawn, Midday, or Dusk.' },
  { num: '3', title: 'Hit Analyze', desc: 'Real elevation data is pulled, land cover is mapped, terrain features are detected, and AI places tactical POIs — all in seconds.' },
  { num: '4', title: 'Hunt Smarter', desc: 'Tap any POI for advice specific to that exact spot, season, and time of day. Toggle behavior layers to understand why elk use that terrain.' },
]

const pricingTiers = [
  {
    name: 'Free',
    price: '0',
    period: '',
    highlight: false,
    desc: 'Everything you need to see it in action.',
    features: [
      { text: '3 analyses per month', included: true },
      { text: 'All 5 behavior layers', included: true },
      { text: 'All 4 base maps', included: true },
      { text: 'Season & time controls', included: true },
      { text: 'Save analyzed areas', included: false },
      { text: 'Offline maps (mobile)', included: false },
    ],
    cta: 'Start Free',
  },
  {
    name: 'Pro',
    price: '9.99',
    period: '/mo',
    highlight: true,
    desc: 'For the hunter who scouts year-round.',
    features: [
      { text: '20 analyses per month', included: true },
      { text: 'All 5 behavior layers', included: true },
      { text: 'All 4 base maps', included: true },
      { text: 'Season & time controls', included: true },
      { text: 'Save & revisit areas', included: true },
      { text: 'Offline maps (mobile)', included: true },
    ],
    cta: 'Go Pro',
  },
  {
    name: 'Guide',
    price: '24.99',
    period: '/mo',
    highlight: false,
    desc: 'For outfitters, professional guides, and serious hunters.',
    features: [
      { text: 'Unlimited analyses', included: true },
      { text: 'All 5 behavior layers', included: true },
      { text: 'All 4 base maps', included: true },
      { text: 'Season & time controls', included: true },
      { text: 'Save & revisit areas', included: true },
      { text: 'Offline maps (mobile)', included: true },
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
          Stop Guessing.<br />
          Start Reading Terrain<br />
          <span class="text-amber">Like a 20-Year Guide.</span>
        </h1>
        <p class="hero-sub">
          Real USGS elevation data. Satellite land cover. AI-powered terrain analysis.
          See exactly where elk are feeding, bedding, and traveling — for your season, your time of day, your drainage.
        </p>
        <div class="hero-actions">
          <q-btn
            color="amber"
            text-color="dark"
            icon="login"
            label="Get Started with Google"
            no-caps
            unelevated
            size="lg"
            class="text-weight-bold cta-btn"
            @click="signIn"
          />
          <q-btn
            flat
            no-caps
            color="grey-5"
            label="See How It Works"
            icon="arrow_downward"
            size="md"
            @click="$el.querySelector('.how-it-works')?.scrollIntoView({ behavior: 'smooth' })"
          />
        </div>
        <p v-if="authStore.error" class="text-red-4 q-mt-sm text-caption">
          {{ authStore.error }}
        </p>
      </div>
    </section>

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
          with a 12-degree slope and a creek 300 meters below? During the rut at dawn,
          that's a cow herd transition zone with a herd bull bedded in the timber above it.
          In late November, it's where 150 elk are soaking up solar warmth between feeding sessions.
        </p>
        <p class="problem-text">
          You'd need 10 seasons of hunting that drainage to know that.
          <strong class="text-amber">Or you could open RidgeRead.</strong>
        </p>
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
            <div class="data-value">400</div>
            <div class="data-label">Elevation points per analysis</div>
            <div class="data-source">USGS Copernicus DEM — 90m resolution</div>
          </div>
          <div class="data-item">
            <div class="data-value">0.1–2 mi</div>
            <div class="data-label">Custom buffer from roads & trails</div>
            <div class="data-source">OpenStreetMap verified road network</div>
          </div>
          <div class="data-item">
            <div class="data-value">5</div>
            <div class="data-label">Terrain features auto-detected</div>
            <div class="data-source">Saddles, benches, ridges, drainages, finger ridges</div>
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
          Start free. Upgrade when you're hooked.
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
            <div class="pricing-price">
              <span class="pricing-dollar">$</span>
              <span class="pricing-amount">{{ tier.price }}</span>
              <span v-if="tier.period" class="pricing-period">{{ tier.period }}</span>
            </div>
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
          label="Start Analyzing Free"
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

.hero-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

.cta-btn {
  padding: 12px 32px;
  font-size: 16px;
  border-radius: 8px;
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

/* ─── Seasons ─── */
.seasons-section {
  padding: 100px 24px;
  background: #0f1923;
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
  background: #0a0e14;
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
  background: #0f1923;
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  align-items: start;
}

.pricing-card {
  position: relative;
  background: #111a24;
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  padding: 36px 28px 28px;
  display: flex;
  flex-direction: column;
}

.pricing-card--highlight {
  border-color: #e8c547;
  background: #131e2b;
  box-shadow: 0 0 40px rgba(232, 197, 71, 0.06);
  transform: scale(1.03);
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
  .features-grid { grid-template-columns: 1fr; }
  .season-cards { grid-template-columns: 1fr; }
  .steps-row { grid-template-columns: 1fr 1fr; }
  .data-grid { grid-template-columns: 1fr 1fr; }
  .pricing-grid { grid-template-columns: 1fr; }
  .pricing-card--highlight { transform: none; }
}
</style>
