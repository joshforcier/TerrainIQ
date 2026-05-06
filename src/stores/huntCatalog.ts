import { defineStore } from 'pinia'
import { ref } from 'vue'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '@/config/firebase'
import type { DrawOddsDoc, HuntCatalogEntry } from '@/types/hunting'

type UnitsByState = Record<string, Record<string, string[]>>
type CatalogByState = Record<string, Record<string, HuntCatalogEntry[]>>

const STATE_CODE: Record<string, string> = {
  colorado: 'co',
  wyoming: 'wy',
  montana: 'mt',
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeStateCode(state: string): string {
  const key = normalizeKey(state)
  return STATE_CODE[key] || key
}

function buildOddsDocId(state: string, huntCode: string): string {
  return `${normalizeStateCode(state)}_${huntCode.trim().toUpperCase()}`
}

function isCatalogEntry(raw: unknown): raw is HuntCatalogEntry {
  if (!raw || typeof raw !== 'object') return false
  const record = raw as Record<string, unknown>
  return (
    typeof record.unit === 'string' &&
    typeof record.sex === 'string' &&
    typeof record.weapon === 'string' &&
    typeof record.seasonType === 'string' &&
    Number.isFinite(Number(record.seasonNumber)) &&
    typeof record.huntCode === 'string'
  )
}

export const useHuntCatalogStore = defineStore('huntCatalog', () => {
  const unitsByState = ref<UnitsByState>({})
  const catalogByState = ref<CatalogByState>({})
  const unitsLoaded = ref(false)
  const oddsCache = ref<Record<string, DrawOddsDoc | null>>({})
  let unitsInflight: Promise<void> | null = null
  const oddsInflight: Record<string, Promise<DrawOddsDoc | null>> = {}

  async function loadUnits(): Promise<void> {
    if (unitsLoaded.value) return
    if (unitsInflight) return unitsInflight

    unitsInflight = (async () => {
      try {
        const snapshot = await getDocs(collection(db, 'huntUnits'))
        const nextUnits: UnitsByState = {}
        const nextCatalog: CatalogByState = {}

        snapshot.forEach((unitDoc) => {
          const data = unitDoc.data() as {
            species?: Record<string, unknown>
            catalog?: Record<string, unknown>
          }
          const stateKey = normalizeKey(unitDoc.id)
          if (!stateKey) return

          nextUnits[stateKey] = {}
          if (data.species && typeof data.species === 'object') {
            Object.entries(data.species).forEach(([species, units]) => {
              if (!Array.isArray(units)) return
              const cleaned = units.map((unit) => String(unit).trim()).filter(Boolean)
              if (cleaned.length > 0) nextUnits[stateKey][normalizeKey(species)] = cleaned
            })
          }

          nextCatalog[stateKey] = {}
          if (data.catalog && typeof data.catalog === 'object') {
            Object.entries(data.catalog).forEach(([species, entries]) => {
              if (!Array.isArray(entries)) return
              const cleaned = entries.filter(isCatalogEntry).map((entry) => ({
                ...entry,
                seasonNumber: Number(entry.seasonNumber),
                huntCode: entry.huntCode.trim().toUpperCase(),
              }))
              if (cleaned.length > 0) nextCatalog[stateKey][normalizeKey(species)] = cleaned
            })
          }
        })

        unitsByState.value = nextUnits
        catalogByState.value = nextCatalog
        unitsLoaded.value = true
      } finally {
        unitsInflight = null
      }
    })()

    return unitsInflight
  }

  function getUnits(state: string, species: string): string[] {
    return unitsByState.value[normalizeKey(state)]?.[normalizeKey(species)] ?? []
  }

  function getCatalog(state: string, species: string): HuntCatalogEntry[] {
    return catalogByState.value[normalizeKey(state)]?.[normalizeKey(species)] ?? []
  }

  async function loadOdds(state: string, huntCode: string): Promise<DrawOddsDoc | null> {
    if (!state || !huntCode) return null
    const docId = buildOddsDocId(state, huntCode)
    if (docId in oddsCache.value) return oddsCache.value[docId]
    if (oddsInflight[docId]) return oddsInflight[docId]

    oddsInflight[docId] = (async () => {
      try {
        const snap = await getDoc(doc(db, 'drawOdds', docId))
        const value = snap.exists() ? (snap.data() as DrawOddsDoc) : null
        oddsCache.value = { ...oddsCache.value, [docId]: value }
        return value
      } catch {
        oddsCache.value = { ...oddsCache.value, [docId]: null }
        return null
      } finally {
        delete oddsInflight[docId]
      }
    })()

    return oddsInflight[docId]
  }

  function getOdds(state: string, huntCode: string): DrawOddsDoc | null {
    if (!state || !huntCode) return null
    return oddsCache.value[buildOddsDocId(state, huntCode)] ?? null
  }

  return {
    unitsLoaded,
    loadUnits,
    getUnits,
    getCatalog,
    loadOdds,
    getOdds,
  }
})
