import { defineStore } from 'pinia'
import { ref } from 'vue'
import { onAuthStateChanged } from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import { auth, db } from '@/config/firebase'
import type {
  GoalUnit,
  GoalUnitSeasonType,
  GoalUnitSex,
  GoalUnitWeapon,
  StatePointData,
} from '@/types/hunting'

const CURRENT_YEAR = new Date().getFullYear()
const SEX_VALUES: GoalUnitSex[] = ['either', 'cow', 'bull']
const WEAPON_VALUES: GoalUnitWeapon[] = ['rifle', 'archery', 'muzzleloader']
const SEASON_TYPE_VALUES: GoalUnitSeasonType[] = [
  'regular',
  'plains',
  'late',
  'early',
  'private_land',
  'specialty',
]

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeGoalUnit(raw: unknown): GoalUnit | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const unit = typeof record.unit === 'string' ? record.unit.trim() : ''
  if (!unit) return null

  const result: GoalUnit = { unit }
  if (typeof record.sex === 'string' && SEX_VALUES.includes(record.sex as GoalUnitSex)) {
    result.sex = record.sex as GoalUnitSex
  }
  if (typeof record.weapon === 'string' && WEAPON_VALUES.includes(record.weapon as GoalUnitWeapon)) {
    result.weapon = record.weapon as GoalUnitWeapon
  }
  if (
    typeof record.seasonType === 'string' &&
    SEASON_TYPE_VALUES.includes(record.seasonType as GoalUnitSeasonType)
  ) {
    result.seasonType = record.seasonType as GoalUnitSeasonType
  }
  const seasonNumber = Number(record.seasonNumber)
  if (Number.isFinite(seasonNumber) && seasonNumber > 0 && seasonNumber < 10) {
    result.seasonNumber = seasonNumber
  }
  if (typeof record.huntCode === 'string' && record.huntCode.trim()) {
    result.huntCode = record.huntCode.trim().toUpperCase()
  }
  return result
}

function normalizeGoalUnits(raw: unknown): GoalUnit[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: GoalUnit[] = []
  for (const entry of raw) {
    const unit = normalizeGoalUnit(entry)
    if (!unit) continue
    const key = [
      unit.unit.toLowerCase(),
      unit.sex ?? '',
      unit.weapon ?? '',
      unit.seasonType ?? '',
      unit.seasonNumber ?? '',
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(unit)
  }
  return result
}

function assignPoint(
  pointsByState: StatePointData,
  state: string,
  species: string,
  bonus: unknown,
  preference: unknown,
  pointPurchased?: unknown,
  statusYear?: unknown,
  goalUnits?: unknown,
) {
  const stateKey = normalizeKey(state)
  const speciesKey = normalizeKey(species)
  if (!stateKey || !speciesKey) return

  const normalizedYear = Number(statusYear)
  const units = normalizeGoalUnits(goalUnits)
  pointsByState[stateKey] ??= {}
  pointsByState[stateKey][speciesKey] = {
    bonus: toNumber(bonus),
    preference: toNumber(preference),
    pointPurchased: normalizedYear === CURRENT_YEAR && toBoolean(pointPurchased),
    statusYear: CURRENT_YEAR,
    ...(units.length > 0 ? { goalUnits: units } : {}),
  }
}

async function resolveCurrentUid(): Promise<string | null> {
  if (auth.currentUser?.uid) return auth.currentUser.uid
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      resolve(user?.uid ?? null)
    })
  })
}

export interface PointTrackerRow {
  id: string
  state: string
  species: string
  bonus: number
  preference: number
  pointPurchased: boolean
  goalUnits: GoalUnit[]
  goalsExpanded?: boolean
}

export const usePointsTrackerStore = defineStore('pointsTracker', () => {
  const userPoints = ref<StatePointData>({})
  const loading = ref(false)
  const saving = ref(false)

  async function loadPoints() {
    const uid = await resolveCurrentUid()
    if (!uid) {
      userPoints.value = {}
      return
    }

    loading.value = true
    try {
      const pointsByState: StatePointData = {}
      const snapshot = await getDocs(collection(db, 'users', uid, 'points'))

      snapshot.forEach((pointDoc) => {
        const data = pointDoc.data() as Record<string, unknown>
        Object.entries(data).forEach(([species, value]) => {
          if (!value || typeof value !== 'object') return
          const record = value as Record<string, unknown>
          assignPoint(
            pointsByState,
            pointDoc.id,
            species,
            record.bonus ?? record.bonusPoints,
            record.preference ?? record.preferencePoints,
            record.pointPurchased ?? record.trackerUpdated,
            record.statusYear,
            record.goalUnits,
          )
        })
      })

      if (Object.keys(pointsByState).length === 0) {
        const userSnap = await getDoc(doc(db, 'users', uid))
        const nestedPoints = userSnap.exists()
          ? (userSnap.data() as { points?: Record<string, Record<string, Record<string, unknown>>> }).points
          : null

        if (nestedPoints && typeof nestedPoints === 'object') {
          Object.entries(nestedPoints).forEach(([state, speciesMap]) => {
            Object.entries(speciesMap ?? {}).forEach(([species, pointValues]) => {
              assignPoint(
                pointsByState,
                state,
                species,
                pointValues.bonus,
                pointValues.preference,
                pointValues.pointPurchased ?? pointValues.trackerUpdated,
                pointValues.statusYear,
                pointValues.goalUnits,
              )
            })
          })
        }
      }

      userPoints.value = pointsByState
    } finally {
      loading.value = false
    }
  }

  async function saveRows(rows: PointTrackerRow[]) {
    const uid = auth.currentUser?.uid
    if (!uid) return

    saving.value = true
    try {
      const nextPoints: StatePointData = {}
      for (const row of rows) {
        assignPoint(
          nextPoints,
          row.state,
          row.species,
          row.bonus,
          row.preference,
          row.pointPurchased,
          CURRENT_YEAR,
          row.goalUnits,
        )
      }

      const existingSnapshot = await getDocs(collection(db, 'users', uid, 'points'))
      const existingStateIds = new Set(existingSnapshot.docs.map((entry) => entry.id))

      for (const [stateKey, speciesMap] of Object.entries(nextPoints)) {
        await setDoc(doc(db, 'users', uid, 'points', stateKey), speciesMap)
      }

      for (const existingState of existingStateIds) {
        if (!nextPoints[existingState]) {
          await deleteDoc(doc(db, 'users', uid, 'points', existingState))
        }
      }

      userPoints.value = nextPoints
    } finally {
      saving.value = false
    }
  }

  return {
    userPoints,
    loading,
    saving,
    loadPoints,
    saveRows,
  }
})
