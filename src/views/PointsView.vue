<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePointsTrackerStore, type PointTrackerRow } from '@/stores/pointsTracker'
import { useHuntCatalogStore } from '@/stores/huntCatalog'
import type {
  GoalUnit,
  GoalUnitSeasonType,
  GoalUnitSex,
  GoalUnitWeapon,
} from '@/types/hunting'

const pointsStore = usePointsTrackerStore()
const catalogStore = useHuntCatalogStore()

const currentYear = new Date().getFullYear()
const rows = ref<PointTrackerRow[]>([])
const activeState = ref('')
const newState = ref('')
const newSpecies = ref('')
const lastSavedSnapshot = ref('')
const justSaved = ref(false)
const hydrated = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null

const stateOptions = [
  'Arizona',
  'Colorado',
  'Idaho',
  'Montana',
  'Nevada',
  'New Mexico',
  'Oregon',
  'Utah',
  'Washington',
  'Wyoming',
]

const speciesOptions = [
  'Elk',
  'Mule Deer',
  'Antelope',
  'Bighorn Sheep',
  'Moose',
  'Mountain Goat',
  'Bear',
]

const sexOptions: Array<{ label: string; value: GoalUnitSex }> = [
  { label: 'Either-sex', value: 'either' },
  { label: 'Cow / Doe', value: 'cow' },
  { label: 'Bull / Buck', value: 'bull' },
]

const weaponOptions: Array<{ label: string; value: GoalUnitWeapon }> = [
  { label: 'Rifle', value: 'rifle' },
  { label: 'Archery', value: 'archery' },
  { label: 'Muzzleloader', value: 'muzzleloader' },
]

const seasonTypeOptions: Array<{ label: string; value: GoalUnitSeasonType }> = [
  { label: 'Regular', value: 'regular' },
  { label: 'Plains', value: 'plains' },
  { label: 'Late', value: 'late' },
  { label: 'Early', value: 'early' },
  { label: 'Private-land', value: 'private_land' },
  { label: 'Specialty', value: 'specialty' },
]

interface GoalForm {
  unit: string
  sex: GoalUnitSex | null
  weapon: GoalUnitWeapon | null
  seasonType: GoalUnitSeasonType | null
  seasonNumber: number | null
}

const goalForms = ref<Record<string, GoalForm>>({})

const trackedStates = computed(() => {
  return Array.from(new Set(rows.value.map((row) => row.state))).sort((a, b) => a.localeCompare(b))
})

const activeRows = computed(() => {
  if (!activeState.value) return rows.value
  return rows.value.filter((row) => row.state === activeState.value)
})

const totalPoints = computed(() => {
  return rows.value.reduce((sum, row) => sum + Number(row.bonus || 0) + Number(row.preference || 0), 0)
})

const bonusPoints = computed(() => rows.value.reduce((sum, row) => sum + Number(row.bonus || 0), 0))
const preferencePoints = computed(() => rows.value.reduce((sum, row) => sum + Number(row.preference || 0), 0))
const purchasedCount = computed(() => rows.value.filter((row) => row.pointPurchased).length)
const goalUnitCount = computed(() => rows.value.reduce((sum, row) => sum + row.goalUnits.length, 0))
const trackingLimit = 12

const saveStatus = computed(() => {
  if (pointsStore.saving) return 'Saving'
  if (justSaved.value) return 'Saved'
  return ''
})

function capitalizeEachWord(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stateAbbrev(name: string): string {
  const map: Record<string, string> = {
    Arizona: 'AZ',
    Colorado: 'CO',
    Idaho: 'ID',
    Montana: 'MT',
    Nevada: 'NV',
    'New Mexico': 'NM',
    Oregon: 'OR',
    Utah: 'UT',
    Washington: 'WA',
    Wyoming: 'WY',
  }
  return map[name] ?? name.slice(0, 2).toUpperCase()
}

function regionLabel(name: string): string {
  const west = new Set(['Arizona', 'Colorado', 'Idaho', 'Montana', 'Nevada', 'New Mexico', 'Oregon', 'Utah', 'Washington', 'Wyoming'])
  return west.has(name) ? 'Rocky Mtn' : 'Draw State'
}

function rowId(state: string, species: string): string {
  return `${state.toLowerCase()}_${species.toLowerCase().replace(/\s+/g, '_')}`
}

function pointDataToRows(): PointTrackerRow[] {
  return Object.entries(pointsStore.userPoints).flatMap(([stateKey, speciesMap]) => {
    const state = capitalizeEachWord(stateKey)
    return Object.entries(speciesMap).map(([speciesKey, values]) => {
      const species = capitalizeEachWord(speciesKey)
      return {
        id: rowId(state, species),
        state,
        species,
        bonus: values.bonus,
        preference: values.preference,
        pointPurchased: values.pointPurchased,
        goalUnits: values.goalUnits ?? [],
        goalsExpanded: false,
      }
    })
  })
}

function snapshotRows(): string {
  return JSON.stringify(
    rows.value.map((row) => ({
      state: row.state,
      species: row.species,
      bonus: Number(row.bonus) || 0,
      preference: Number(row.preference) || 0,
      pointPurchased: !!row.pointPurchased,
      goalUnits: row.goalUnits,
    })),
  )
}

function scheduleSave() {
  if (!hydrated.value) return
  const snapshot = snapshotRows()
  if (snapshot === lastSavedSnapshot.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await pointsStore.saveRows(rows.value)
    lastSavedSnapshot.value = snapshotRows()
    justSaved.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      justSaved.value = false
    }, 2200)
  }, 700)
}

function addRow() {
  const state = capitalizeEachWord(newState.value)
  const species = capitalizeEachWord(newSpecies.value)
  if (!state || !species) return
  const id = rowId(state, species)
  if (rows.value.some((row) => row.id === id)) {
    activeState.value = state
    newSpecies.value = ''
    return
  }

  rows.value.push({
    id,
    state,
    species,
    bonus: 0,
    preference: 0,
    pointPurchased: false,
    goalUnits: [],
    goalsExpanded: false,
  })
  activeState.value = state
  newSpecies.value = ''
}

function deleteRow(id: string) {
  rows.value = rows.value.filter((row) => row.id !== id)
  if (activeState.value && !rows.value.some((row) => row.state === activeState.value)) {
    activeState.value = trackedStates.value[0] ?? ''
  }
}

function clampPoints(row: PointTrackerRow, field: 'bonus' | 'preference') {
  const value = Number(row[field])
  row[field] = Math.min(40, Math.max(0, Number.isFinite(value) ? value : 0))
}

function adjustPoints(row: PointTrackerRow, field: 'bonus' | 'preference', delta: number) {
  row[field] = Math.min(40, Math.max(0, Number(row[field] || 0) + delta))
}

function emptyGoalForm(): GoalForm {
  return { unit: '', sex: null, weapon: null, seasonType: null, seasonNumber: null }
}

function getGoalForm(rowIdValue: string): GoalForm {
  if (!goalForms.value[rowIdValue]) {
    goalForms.value = { ...goalForms.value, [rowIdValue]: emptyGoalForm() }
  }
  return goalForms.value[rowIdValue]
}

function goalKey(goal: GoalUnit): string {
  return [
    goal.unit.toLowerCase(),
    goal.sex ?? '',
    goal.weapon ?? '',
    goal.seasonType ?? '',
    goal.seasonNumber ?? '',
  ].join('|')
}

function isColoradoElk(row: PointTrackerRow): boolean {
  return row.state.toLowerCase() === 'colorado' && row.species.toLowerCase() === 'elk'
}

function buildColoradoElkHuntCode(goal: GoalUnit): string | null {
  if (!goal.unit || !goal.sex || !goal.weapon || !goal.seasonType || !goal.seasonNumber) return null
  const sexLetter: Record<GoalUnitSex, string> = { either: 'E', cow: 'F', bull: 'M' }
  const weaponLetter: Record<GoalUnitWeapon, string> = { rifle: 'R', archery: 'A', muzzleloader: 'M' }
  const seasonLetter: Record<GoalUnitSeasonType, string> = {
    regular: 'O',
    plains: 'P',
    late: 'L',
    early: 'E',
    private_land: 'W',
    specialty: 'S',
  }
  const unit = goal.unit.replace(/\D/g, '').padStart(3, '0').slice(-3)
  return `E${sexLetter[goal.sex]}${unit}${seasonLetter[goal.seasonType]}${goal.seasonNumber}${weaponLetter[goal.weapon]}`
}

function resolveHuntCode(row: PointTrackerRow, goal: GoalUnit): string | null {
  if (goal.huntCode) return goal.huntCode
  if (isColoradoElk(row)) return buildColoradoElkHuntCode(goal)
  return null
}

function addGoal(row: PointTrackerRow) {
  const form = getGoalForm(row.id)
  const unit = form.unit.trim()
  if (!unit) return

  const goal: GoalUnit = { unit }
  if (form.sex) goal.sex = form.sex
  if (form.weapon) goal.weapon = form.weapon
  if (form.seasonType) goal.seasonType = form.seasonType
  if (form.seasonNumber) goal.seasonNumber = form.seasonNumber
  const code = resolveHuntCode(row, goal)
  if (code) goal.huntCode = code

  if (row.goalUnits.some((existing) => goalKey(existing) === goalKey(goal))) return
  row.goalUnits = [...row.goalUnits, goal]
  goalForms.value = { ...goalForms.value, [row.id]: emptyGoalForm() }
  if (code) void catalogStore.loadOdds(row.state, code)
}

function removeGoal(row: PointTrackerRow, index: number) {
  row.goalUnits = row.goalUnits.filter((_, entryIndex) => entryIndex !== index)
}

function unitOptions(row: PointTrackerRow): string[] {
  return catalogStore.getUnits(row.state, row.species)
}

function goalLabel(goal: GoalUnit): string {
  const parts = [`Unit ${goal.unit}`]
  if (goal.seasonNumber) parts.push(`S${goal.seasonNumber}`)
  if (goal.weapon) parts.push(capitalizeEachWord(goal.weapon))
  if (goal.sex) parts.push(goal.sex === 'either' ? 'Either-sex' : capitalizeEachWord(goal.sex))
  return parts.join(' · ')
}

function goalChipLabel(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return ''
  return capitalizeEachWord(String(value))
}

function goalCutoffLabel(row: PointTrackerRow, goal: GoalUnit): string {
  const code = resolveHuntCode(row, goal)
  if (!code) return ''
  const odds = catalogStore.getOdds(row.state, code)
  const cutoff = odds?.drawnOutAt?.adultNonRes
  if (!cutoff) return ''
  if (cutoff.kind === 'none_drawn') return `${odds?.sourceYear ?? ''} nonres: none drawn`
  if (cutoff.kind === 'na') return ''
  const gap = cutoff.points - (Number(row.preference) || 0)
  if (gap > 0) return `${odds?.sourceYear ?? ''} cutoff: ${cutoff.points} pts · ${gap} behind`
  if (gap === 0) return `${odds?.sourceYear ?? ''} cutoff: ${cutoff.points} pts · at line`
  return `${odds?.sourceYear ?? ''} cutoff: ${cutoff.points} pts · ${Math.abs(gap)} ahead`
}

function ensureOddsLoaded() {
  for (const row of rows.value) {
    for (const goal of row.goalUnits) {
      const code = resolveHuntCode(row, goal)
      if (code) void catalogStore.loadOdds(row.state, code)
    }
  }
}

onMounted(async () => {
  await Promise.all([pointsStore.loadPoints(), catalogStore.loadUnits()])
  rows.value = pointDataToRows()
  activeState.value = trackedStates.value[0] ?? ''
  lastSavedSnapshot.value = snapshotRows()
  hydrated.value = true
  ensureOddsLoaded()
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (savedTimer) clearTimeout(savedTimer)
})

watch(rows, () => {
  scheduleSave()
  ensureOddsLoaded()
}, { deep: true })
</script>

<template>
  <q-page class="points-page">
    <div class="account-shell">
      <header class="page-head">
        <div class="page-copy">
          <h1>Your Points</h1>
          <p>
            Every preference and bonus point you've banked, the units you're saving them for, and what's been purchased this cycle.
            Treat it like an investment account — you're spending years on each position.
          </p>
        </div>
      </header>

      <section class="statband">
        <div class="stat">
          <div class="stat-k">Saving for</div>
          <div class="stat-v">{{ rows.length }} <small>hunts</small></div>
          <div class="stat-trend">{{ trackedStates.map(stateAbbrev).join(' · ') || 'None yet' }}</div>
        </div>
        <div class="stat">
          <div class="stat-k">States In Play</div>
          <div class="stat-v">{{ trackedStates.length }}</div>
          <div class="stat-trend">+0 vs. {{ currentYear - 1 }}</div>
        </div>
        <div class="stat">
          <div class="stat-k">Total Points Banked</div>
          <div class="stat-v stat-v--amber">{{ totalPoints }}</div>
          <div class="stat-trend">{{ bonusPoints }} BONUS · {{ preferencePoints }} PREFERENCE</div>
        </div>
        <div class="stat">
          <div class="stat-k">{{ currentYear }} Status</div>
          <div class="stat-v stat-v--green">{{ purchasedCount }} <small>purchased</small></div>
          <div class="stat-trend">{{ purchasedCount ? rows.filter((row) => row.pointPurchased).map((row) => stateAbbrev(row.state)).join(' · ') : 'None confirmed' }}</div>
        </div>
      </section>

      <section class="positions-head">

        <div v-if="saveStatus" class="save-chip">
          <q-spinner-dots v-if="pointsStore.saving" size="13px" />
          <q-icon v-else name="check" size="13px" />
          {{ saveStatus }}
        </div>
      </section>
      
      <!-- <div class="page-eyebrow"><span />PORTFOLIO · POINT TRACKING</div> -->

      <section id="point-composer" class="composer">
        <div class="composer-plus">+</div>
        <q-select v-model="newState" :options="stateOptions" dark borderless dense label="State" class="composer-select" />
        <q-select v-model="newSpecies" :options="speciesOptions" dark borderless dense label="Species" class="composer-select" />
        <button class="rr-btn rr-btn--primary rr-btn--sm" type="button" :disabled="!newState || !newSpecies" @click="addRow">
          Add
        </button>
      </section>

      <div v-if="pointsStore.loading" class="empty-panel">
        <q-spinner color="amber" size="28px" />
      </div>

      <div v-else-if="rows.length === 0" class="empty-panel">
        <q-icon name="inventory_2" size="34px" />
        <h2>No holdings yet</h2>
        <p>Add a state and species to start tracking your draw portfolio.</p>
      </div>

      <section v-else class="holdings">
        <article v-for="row in rows" :key="row.id" class="holding">
          <header class="holding-head">
            <div class="holding-flag">{{ stateAbbrev(row.state) }}</div>
            <div class="holding-id">
              <div class="holding-loc">{{ row.state }} · {{ regionLabel(row.state) }}</div>
              <h3>{{ row.species }}</h3>
              <div class="tags">
                <span v-if="row.pointPurchased" class="tag tag--ok">{{ currentYear }} Purchased</span>
                <span class="tag">{{ row.goalUnits.length }} Goal Units</span>
              </div>
            </div>
            <div class="holding-metric point-stepper">
              <div class="metric-k">Preference</div>
              <div class="metric-v point-stepper-row">
                <button type="button" @click="adjustPoints(row, 'preference', -1)">−</button>
                <input v-model.number="row.preference" type="number" min="0" max="40" @blur="clampPoints(row, 'preference')" />
                <button type="button" @click="adjustPoints(row, 'preference', 1)">+</button>
              </div>
            </div>
            <div class="holding-metric point-stepper">
              <div class="metric-k">Bonus</div>
              <div class="metric-v point-stepper-row">
                <button type="button" @click="adjustPoints(row, 'bonus', -1)">−</button>
                <input v-model.number="row.bonus" type="number" min="0" max="40" @blur="clampPoints(row, 'bonus')" />
                <button type="button" @click="adjustPoints(row, 'bonus', 1)">+</button>
              </div>
            </div>
            <div class="holding-metric holding-metric--status">
              <div class="metric-k">Status</div>
              <div class="status-toggle">
                <span>{{ row.pointPurchased ? 'Purchased' : 'Not purchased' }}</span>
                <q-toggle v-model="row.pointPurchased" color="amber" dense />
              </div>
            </div>
            <div class="holding-actions">
              <button class="icon-btn" type="button" @click="row.goalsExpanded = !row.goalsExpanded" title="Add goal unit">
                <q-icon name="edit" size="15px" />
              </button>
              <button class="icon-btn" type="button" title="Goal units">
                <q-icon name="expand_more" size="18px" />
              </button>
              <button class="icon-btn icon-btn--danger" type="button" title="Delete holding" @click="deleteRow(row.id)">
                <q-icon name="delete_outline" size="15px" />
              </button>
            </div>
          </header>

          <div class="holding-body">
            <section class="goal-section">
              <div class="goal-section-head">
                <div>
                  <q-icon name="change_history" size="13px" />
                  Goal Units
                  <small>{{ row.goalUnits.length }} saved</small>
                </div>
                <button class="text-action" type="button" @click="row.goalsExpanded = !row.goalsExpanded">
                  + Add Unit
                </button>
              </div>

              <div v-if="row.goalUnits.length" class="goal-list">
                <div v-for="(goal, index) in row.goalUnits" :key="goalKey(goal)" class="goal-unit">
                  <div class="goal-num">
                    <strong>{{ goal.unit }}</strong>
                    <span>Unit</span>
                  </div>
                  <div class="goal-meta">
                    <span v-if="goal.sex" class="goal-chip">{{ goalChipLabel(goal.sex) }}</span>
                    <span v-if="goal.weapon" class="goal-chip goal-chip--weapon">{{ goalChipLabel(goal.weapon) }}</span>
                    <span v-if="goal.seasonType || goal.seasonNumber" class="goal-chip goal-chip--season">
                      {{ goal.seasonNumber ? `${goal.seasonNumber}${goal.seasonNumber === 1 ? 'st' : goal.seasonNumber === 2 ? 'nd' : goal.seasonNumber === 3 ? 'rd' : 'th'} Season` : goalChipLabel(goal.seasonType) }}
                    </span>
                    <span v-if="goal.huntCode" class="goal-chip">Hunt code: {{ goal.huntCode }}</span>
                    <span v-if="goalCutoffLabel(row, goal)" class="goal-cutoff">{{ goalCutoffLabel(row, goal) }}</span>
                  </div>
                  <button class="icon-btn icon-btn--sm" type="button" @click="removeGoal(row, index)">×</button>
                </div>
              </div>

              <div v-else class="goal-empty">No goal units saved yet.</div>

              <div v-if="row.goalsExpanded" class="goal-form">
                <q-select v-model="getGoalForm(row.id).unit" :options="unitOptions(row)" dark borderless dense use-input new-value-mode="add-unique" label="Unit" class="composer-select" />
                <q-select v-model="getGoalForm(row.id).sex" :options="sexOptions" dark borderless dense emit-value map-options label="Sex" class="composer-select" />
                <q-select v-model="getGoalForm(row.id).weapon" :options="weaponOptions" dark borderless dense emit-value map-options label="Weapon" class="composer-select" />
                <q-select v-model="getGoalForm(row.id).seasonType" :options="seasonTypeOptions" dark borderless dense emit-value map-options label="Season" class="composer-select" />
                <q-input v-model.number="getGoalForm(row.id).seasonNumber" type="number" min="1" max="9" dark borderless dense label="#" class="composer-select" />
                <button class="rr-btn rr-btn--primary rr-btn--sm" type="button" :disabled="!getGoalForm(row.id).unit" @click="addGoal(row)">Goal</button>
              </div>
            </section>
          </div>
        </article>
      </section>

      <a class="add-another" href="#point-composer">
        <span>+</span>
        Add another state · species combination — Wyoming, Montana, Idaho, Utah, New Mexico, Arizona, Nevada all supported.
      </a>
    </div>
  </q-page>
</template>

<style scoped>
.points-page {
  min-height: calc(100vh - 56px);
  background: #07090c;
  color: #e7eef5;
}

.account-shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 40px 32px 72px;
}

.page-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: end;
  padding-bottom: 24px;
  margin-bottom: 28px;
  border-bottom: 1px solid #1a2735;
}

.page-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 1020px;
  padding: 5px 10px;
  border: 1px solid rgba(232, 197, 71, 0.22);
  border-radius: 3px;
  background: rgba(232, 197, 71, 0.05);
  color: #e8c547;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
}

.page-eyebrow span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #e8c547;
}

.page-copy h1 {
  margin: 12px 0 10px;
  color: #fff;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.035em;
  line-height: 1;
}

.page-copy p {
  max-width: 58ch;
  margin: 0;
  color: #9bb0c8;
  font-size: 14px;
  line-height: 1.55;
}

.rr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 8px 13px;
  border: 1px solid #25374a;
  border-radius: 5px;
  background: #0f1922;
  color: #c8d6e5;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.rr-btn:hover {
  border-color: #556676;
  color: #fff;
}

.rr-btn--primary {
  border-color: #e8c547;
  background: #e8c547;
  color: #160f00;
}

.rr-btn--sm {
  min-height: 28px;
  padding: 5px 9px;
  font-size: 11px;
}

.rr-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.statband {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin-bottom: 28px;
  overflow: hidden;
  border: 1px solid #1a2735;
  border-radius: 4px;
  background: #1a2735;
}

.stat {
  min-width: 0;
  padding: 16px 20px;
  background: #0a0e14;
}

.stat-k,
.stat-trend,
.section-eyebrow,
.metric-k,
.goal-section-head,
.tag,
.goal-chip,
.goal-cutoff,
.goal-num span {
  font-family: var(--mono, 'JetBrains Mono', monospace);
  text-transform: uppercase;
}

.stat-k {
  color: #556676;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.stat-v {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
  color: #e7eef5;
  font-family: var(--mono, monospace);
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
}

.stat-v small {
  color: #556676;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.stat-v--amber { color: #e8c547; }
.stat-v--green { color: #4ade80; }

.stat-trend {
  margin-top: 7px;
  color: #6f8296;
  font-size: 10px;
  letter-spacing: 0.06em;
}

.positions-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.section-eyebrow {
  color: #556676;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
}

.positions-head h2 {
  margin: 4px 0 0;
  color: #fff;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.025em;
}

.save-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #4ade80;
  font-family: var(--mono, monospace);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.composer,
.add-another {
  display: grid;
  grid-template-columns: 32px 1fr 1fr auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px dashed #25374a;
  border-radius: 6px;
  background: #0a0e14;
}

.composer-plus,
.add-another span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(232, 197, 71, 0.28);
  border-radius: 4px;
  background: rgba(232, 197, 71, 0.08);
  color: #e8c547;
  font-family: var(--mono, monospace);
  font-weight: 900;
}

.composer-select {
  min-height: 32px;
  border: 1px solid #1a2735;
  border-radius: 4px;
  background: #0f1922;
}

.composer-select :deep(.q-field__control) {
  min-height: 32px;
  height: 32px;
  padding: 0 10px;
}

.composer-select :deep(.q-field__label),
.composer-select :deep(.q-field__native),
.composer-select :deep(.q-field__input) {
  color: #c8d6e5;
  font-size: 12px;
}

.empty-panel {
  display: grid;
  justify-items: center;
  gap: 9px;
  padding: 56px 24px;
  border: 1px solid #1a2735;
  border-radius: 6px;
  background: #0a0e14;
  color: #8a9cad;
  text-align: center;
}

.empty-panel h2 {
  margin: 0;
  color: #fff;
}

.empty-panel p {
  margin: 0;
}

.holdings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.holding {
  overflow: hidden;
  border: 1px solid #1a2735;
  border-radius: 6px;
  background: #0a0e14;
}

.holding-head {
  display: grid;
  grid-template-columns: 60px minmax(170px, 1.25fr) repeat(3, minmax(150px, 0.8fr)) auto;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
}

.holding-flag {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border: 1px solid rgba(232, 197, 71, 0.28);
  border-radius: 4px;
  background: linear-gradient(135deg, rgba(232, 197, 71, 0.14), rgba(232, 197, 71, 0.04));
  color: #e8c547;
  font-family: var(--mono, monospace);
  font-size: 18px;
  font-weight: 900;
}

.holding-loc {
  color: #556676;
  font-family: var(--mono, monospace);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.holding-id h3 {
  margin: 3px 0 0;
  color: #fff;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.tag,
.goal-chip {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 2px 6px;
  border: 1px solid #1a2735;
  border-radius: 3px;
  background: #0f1922;
  color: #8a9cad;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.tag--ok {
  border-color: rgba(74, 222, 128, 0.3);
  background: rgba(74, 222, 128, 0.06);
  color: #4ade80;
}

.holding-metric {
  min-width: 0;
  padding: 6px 10px;
  border-left: 1px solid #1a2735;
}

.metric-k {
  color: #556676;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.metric-v {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-top: 6px;
  color: #e7eef5;
  font-family: var(--mono, monospace);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
}

.metric-v small {
  color: #556676;
  font-size: 10px;
  letter-spacing: 0.04em;
}

.point-stepper-row,
.status-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
}

.point-stepper-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #556676;
  font-family: var(--mono, monospace);
  font-size: 13px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
}

.point-stepper-row button:hover {
  background: #0f1922;
  border-color: rgba(232, 197, 71, 0.45);
  color: #e8c547;
}

.point-stepper-row input {
  width: 34px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #e7eef5;
  font-family: var(--mono, monospace);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
  outline: none;
  text-align: left;
}

.point-stepper-row input::-webkit-outer-spin-button,
.point-stepper-row input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.status-toggle {
  justify-content: space-between;
}

.status-toggle span {
  color: #8a9cad;
  font-size: 12px;
  font-weight: 800;
}

.holding-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #556676;
  cursor: pointer;
}

.icon-btn:hover {
  border-color: #1a2735;
  background: #0f1922;
  color: #c8d6e5;
}

.icon-btn--danger:hover {
  border-color: rgba(239, 68, 68, 0.35);
  color: #ef4444;
}

.icon-btn--sm {
  width: 26px;
  height: 26px;
  font-size: 15px;
}

.holding-body {
  padding: 14px 18px 18px;
  border-top: 1px solid #1a2735;
  background: #0f1922;
}

.goal-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  color: #c8d6e5;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.18em;
}

.goal-section-head > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.goal-section-head .q-icon,
.text-action {
  color: #e8c547;
}

.goal-section-head small {
  color: #556676;
  font-size: 9px;
  letter-spacing: 0.08em;
}

.text-action {
  border: 0;
  background: transparent;
  font-family: var(--mono, monospace);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
}

.goal-list {
  display: grid;
  gap: 8px;
}

.goal-unit {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid #1a2735;
  background: #0a0e14;
}

.goal-num strong,
.goal-num span {
  display: block;
}

.goal-num strong {
  color: #fff;
  font-family: var(--mono, monospace);
  font-size: 17px;
  line-height: 1;
}

.goal-num span {
  margin-top: 3px;
  color: #556676;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.goal-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
}

.goal-chip--weapon {
  border-color: rgba(108, 179, 240, 0.35);
  background: rgba(108, 179, 240, 0.08);
  color: #6cb3f0;
}

.goal-chip--season {
  border-color: rgba(249, 115, 22, 0.35);
  background: rgba(249, 115, 22, 0.08);
  color: #f97316;
}

.goal-cutoff {
  display: inline-flex;
  align-items: center;
  color: #8a9cad;
  font-size: 9px;
  letter-spacing: 0.04em;
}

.goal-empty {
  padding: 12px;
  border: 1px solid #1a2735;
  color: #556676;
  font-size: 12px;
}

.goal-form {
  display: grid;
  grid-template-columns: 1.2fr repeat(4, minmax(86px, 1fr)) auto;
  gap: 8px;
  margin-top: 10px;
}

.add-another {
  grid-template-columns: 32px 1fr;
  margin-top: 14px;
  color: #9bb0c8;
  font-size: 12px;
  text-decoration: none;
}

@media (max-width: 980px) {
  .statband {
    grid-template-columns: repeat(2, 1fr);
  }

  .holding-head {
    grid-template-columns: 60px 1fr;
  }

  .holding-metric,
  .holding-actions {
    grid-column: span 1;
  }

  .goal-form,
  .composer {
    grid-template-columns: 32px 1fr;
  }

  .composer .rr-btn,
  .goal-form .rr-btn {
    grid-column: 2;
  }
}

@media (max-width: 640px) {
  .account-shell {
    padding: 28px 14px 56px;
  }

  .page-head,
  .statband {
    grid-template-columns: 1fr;
  }

  .page-head .rr-btn {
    justify-self: start;
  }

  .holding-head,
  .goal-unit {
    grid-template-columns: 1fr;
  }

  .holding-flag {
    width: 48px;
    height: 48px;
  }
}
</style>
