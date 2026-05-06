import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore'
import { auth, db } from '@/config/firebase'
import type { ApplicationReminder, ReminderPreferences } from '@/types/hunting'

const FALLBACK_REMINDERS: ApplicationReminder[] = [
  {
    id: 'wyoming_elk_nonresident_preference_point',
    state: 'wyoming',
    species: 'elk',
    name: 'Nonresident preference point',
    deadline: new Date(new Date().getFullYear(), 9, 31),
  },
  {
    id: 'montana_elk_nonresident_combo',
    state: 'montana',
    species: 'elk',
    name: 'Nonresident combo',
    deadline: new Date(new Date().getFullYear(), 2, 15),
  },
  {
    id: 'colorado_elk_primary_draw',
    state: 'colorado',
    species: 'elk',
    name: 'Primary draw',
    deadline: new Date(new Date().getFullYear(), 3, 2),
  },
]

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function firstString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.name === 'string' && record.name.trim()) return record.name.trim()
      if (typeof record.label === 'string' && record.label.trim()) return record.label.trim()
      if (typeof record.value === 'string' && record.value.trim()) return record.value.trim()
    }
  }
  return ''
}

function firstDate(data: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const parsed = normalizeDate(data[key])
    if (parsed) return parsed
  }
  return null
}

function deriveCatalogParts(id: string) {
  const parts = id.split(/[_-]+/).filter(Boolean)
  return {
    state: parts[0] ?? '',
    species: parts[1] ?? '',
    name: parts.slice(2).join(' '),
  }
}

function normalizeReminder(id: string, data: Record<string, unknown>): ApplicationReminder | null {
  const derived = deriveCatalogParts(id)
  const state = (firstString(data, ['state', 'stateId', 'stateCode', 'stateName']) || derived.state).toLowerCase()
  const species = (firstString(data, ['species', 'gameSpecies', 'animal', 'huntSpecies']) || derived.species).toLowerCase()
  const name =
    firstString(data, [
      'name',
      'notificationName',
      'title',
      'displayName',
      'applicationName',
      'deadlineName',
      'label',
    ]) || derived.name
  const deadline = firstDate(data, [
    'deadline',
    'deadlineDate',
    'applicationDeadline',
    'closeDate',
    'closingDate',
    'endDate',
    'dueDate',
    'closesAt',
  ])
  if (!state || !species || !name || !deadline) return null

  return {
    id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id,
    state,
    species,
    name,
    deadline,
    openDate: firstDate(data, ['openDate', 'openDateTime', 'openAt', 'opensAt', 'startDate', 'windowOpenDate']),
    applicationUrl:
      firstString(data, ['applicationUrl', 'url', 'sourceUrl', 'link', 'href']) || null,
  }
}

function normalizePreferences(data: Record<string, unknown> | null): ReminderPreferences {
  const ids = Array.isArray(data?.ids)
    ? data.ids.filter((id): id is string => typeof id === 'string')
    : []
  const notes =
    data?.notes && typeof data.notes === 'object'
      ? Object.fromEntries(
          Object.entries(data.notes as Record<string, unknown>).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === 'string' && typeof entry[1] === 'string',
          ),
        )
      : {}

  return {
    ids,
    notes,
    emailEnabled: data?.emailEnabled !== false,
    smsEnabled: data?.smsEnabled === true,
    phone: typeof data?.phone === 'string' ? data.phone : '',
  }
}

export const useDeadlineNotificationsStore = defineStore('deadlineNotifications', () => {
  const catalog = ref<ApplicationReminder[]>([])
  const catalogError = ref<string | null>(null)
  const preferences = ref<ReminderPreferences>({
    ids: [],
    notes: {},
    emailEnabled: true,
    smsEnabled: false,
    phone: '',
  })
  const loading = ref(false)
  const saving = ref(false)

  async function loadCatalog() {
    loading.value = true
    catalogError.value = null
    try {
      const snapshot = await getDocs(collection(db, 'applications'))
      const next: ApplicationReminder[] = []
      snapshot.forEach((applicationDoc) => {
        const reminder = normalizeReminder(applicationDoc.id, applicationDoc.data())
        if (reminder) next.push(reminder)
      })
      next.sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
      catalog.value = next
      if (snapshot.size > 0 && next.length === 0) {
        catalogError.value = 'Applications were found, but none had enough deadline fields to display.'
      }
    } catch (error) {
      catalog.value = FALLBACK_REMINDERS
      catalogError.value = error instanceof Error ? error.message : 'Using starter reminder catalog.'
    } finally {
      loading.value = false
    }
  }

  async function loadPreferences() {
    const uid = auth.currentUser?.uid
    if (!uid) {
      preferences.value = normalizePreferences(null)
      return
    }

    const snap = await getDoc(doc(db, 'users', uid, 'meta', 'notifications'))
    preferences.value = normalizePreferences(snap.exists() ? snap.data() : null)
  }

  async function savePreferences(next: ReminderPreferences) {
    const uid = auth.currentUser?.uid
    if (!uid) return

    saving.value = true
    try {
      const ids = Array.from(new Set(next.ids.filter(Boolean)))
      const notes = Object.fromEntries(
        Object.entries(next.notes)
          .filter(([, note]) => note.trim().length > 0)
          .map(([id, note]) => [id, note.trim()]),
      )

      const clean: ReminderPreferences = {
        ids,
        notes,
        emailEnabled: next.emailEnabled,
        smsEnabled: next.smsEnabled,
        phone: next.phone.trim(),
      }

      await setDoc(
        doc(db, 'users', uid, 'meta', 'notifications'),
        { ...clean, updatedAt: serverTimestamp() },
        { merge: true },
      )
      preferences.value = clean
    } finally {
      saving.value = false
    }
  }

  return {
    catalog,
    preferences,
    loading,
    saving,
    catalogError,
    loadCatalog,
    loadPreferences,
    savePreferences,
  }
})
