<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/config/firebase'
import { useAuthStore } from '@/stores/auth'
import { useDeadlineNotificationsStore } from '@/stores/deadlineNotifications'
import type { ApplicationReminder, ReminderPreferences } from '@/types/hunting'

const $q = useQuasar()
const authStore = useAuthStore()
const reminderStore = useDeadlineNotificationsStore()

const activeTab = ref<'active' | 'add'>('active')
const filterState = ref<string | null>(null)
const filterSpecies = ref<string | null>(null)
const expandedIds = ref<Set<string>>(new Set())
const localPrefs = ref<ReminderPreferences>({
  ids: [],
  notes: {},
  emailEnabled: true,
  smsEnabled: false,
  phone: '',
})
const hydrated = ref(false)
const testingSend = ref(false)
const runningPass = ref(false)
const catalogSectionRef = ref<HTMLElement | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null

const adminEmails = new Set(['joshforcier@gmail.com'])

interface ReminderVm extends ApplicationReminder {
  days: number
  dateLabel: string
  stateAbbrev: string
  on: boolean
  note: string
  urgent: boolean
}

interface DateMetaPart {
  label: string
  value: string
}

interface HorizonClusterVm {
  id: string
  reminders: ReminderVm[]
  count: number
  minDays: number
  maxDays: number
  x: number
  labelX: number
  labelY: number
  markerY: number
  popoverX: number
  popoverY: number
  popoverHeight: number
  color: string
  tier: 'urgent' | 'soon' | 'upcoming'
}

const allReminders = computed<ReminderVm[]>(() => {
  const today = startOfDay(new Date()).getTime()
  return reminderStore.catalog
    .map((reminder) => {
      const days = Math.ceil((startOfDay(reminder.deadline).getTime() - today) / 86400000)
      return {
        ...reminder,
        days,
        dateLabel:
          days <= 0
            ? 'Awaiting next cycle'
            : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(reminder.deadline),
        stateAbbrev: stateAbbrev(reminder.state),
        on: localPrefs.value.ids.includes(reminder.id),
        note: localPrefs.value.notes[reminder.id] ?? '',
        urgent: days > 0 && days <= 30,
      }
    })
    .sort((a, b) => {
      if (a.days <= 0 && b.days > 0) return 1
      if (b.days <= 0 && a.days > 0) return -1
      return a.days - b.days
    })
})

const activeReminders = computed(() => allReminders.value.filter((reminder) => reminder.on))
const availableReminders = computed(() => allReminders.value.filter((reminder) => !reminder.on))
const urgentCount = computed(() => activeReminders.value.filter((reminder) => reminder.urgent).length)
const isAdmin = computed(() => adminEmails.has(authStore.email.trim().toLowerCase()))
const soonCount = computed(() => activeReminders.value.filter((reminder) => reminder.days > 0 && reminder.days <= 30).length)
const nextFireDays = computed(() => {
  const next = activeReminders.value.find((reminder) => reminder.days > 0)
  return next?.days ?? null
})
const catalogStatesCount = computed(() => new Set(allReminders.value.map((reminder) => reminder.state)).size)
const catalogSpeciesCount = computed(() => new Set(allReminders.value.map((reminder) => reminder.species)).size)
const emailSmsSummary = computed(() => {
  const email = localPrefs.value.emailEnabled ? activeReminders.value.length : 0
  const sms = localPrefs.value.smsEnabled ? activeReminders.value.length : 0
  return `${email} EMAIL · ${sms} SMS`
})
const nextInCatalog = computed(() => availableReminders.value.find((reminder) => reminder.days > 0) ?? availableReminders.value[0] ?? null)
const horizonRangeLabel = computed(() => {
  const start = startOfDay(new Date())
  const end = new Date(start)
  end.setDate(start.getDate() + 90)
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  return `${fmt.format(start)} – ${fmt.format(end)}, ${end.getFullYear()}`
})
const todayLabel = computed(() => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date()))
const beyondWindowCount = computed(() => activeReminders.value.filter((reminder) => reminder.days > 90).length)
const horizonClusters = computed<HorizonClusterVm[]>(() => {
  const laneEnds = [0, 0, 0]
  const labelWidth = 126
  const minGap = 10
  const clusterWindowDays = 2

  const clusters = activeReminders.value
    .filter((reminder) => reminder.days >= 0 && reminder.days <= 90)
    .sort((a, b) => a.days - b.days)
    .reduce<ReminderVm[][]>((groups, reminder) => {
      const last = groups[groups.length - 1]
      const firstInLast = last?.[0]
      if (!last || !firstInLast || reminder.days - firstInLast.days > clusterWindowDays) {
        groups.push([reminder])
      } else {
        last.push(reminder)
      }
      return groups
    }, [])

  return clusters.map((reminders) => {
    const minDays = reminders[0].days
    const maxDays = reminders[reminders.length - 1].days
    const midpointDays = (minDays + maxDays) / 2
    const x = 20 + Math.min(90, Math.max(0, midpointDays)) / 90 * 1040
    const tier = urgencyTier(minDays)
    const color = urgencyColor(minDays)
    return {
      id: reminders.map((reminder) => reminder.id).join('__'),
      reminders,
      count: reminders.length,
      minDays,
      maxDays,
      x,
      color,
      tier,
    }
  }).map((cluster) => {
      const x = Math.max(24, Math.min(950, cluster.x - labelWidth / 2))
      let lane = laneEnds.findIndex((end) => x >= end + minGap)
      if (lane < 0) {
        lane = laneEnds.indexOf(Math.min(...laneEnds))
      }
      const labelX = Math.max(24, Math.min(950, x))
      laneEnds[lane] = labelX + labelWidth
      const popoverHeight = Math.min(122, 38 + Math.min(4, cluster.count) * 17 + (cluster.count > 4 ? 16 : 0))
      return {
        ...cluster,
        labelX,
        labelY: 14 + lane * 28,
        markerY: 102,
        popoverX: Math.max(24, Math.min(834, cluster.x - 118)),
        popoverY: 12,
        popoverHeight,
      }
    })
})

const stateOptions = computed(() => {
  return Array.from(new Set(availableReminders.value.map((reminder) => reminder.state)))
    .sort()
    .map((state) => ({ label: capitalizeEachWord(state), value: state }))
})

const speciesOptions = computed(() => {
  return Array.from(
    new Set(
      availableReminders.value
        .filter((reminder) => !filterState.value || reminder.state === filterState.value)
        .map((reminder) => reminder.species),
    ),
  )
    .sort()
    .map((species) => ({ label: capitalizeEachWord(species), value: species }))
})

const filteredAvailable = computed(() => {
  return availableReminders.value.filter((reminder) => {
    if (filterState.value && reminder.state !== filterState.value) return false
    if (filterSpecies.value && reminder.species !== filterSpecies.value) return false
    return true
  })
})

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function capitalizeEachWord(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatFullDate(date?: Date | null): string {
  if (!date) return 'TBD'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function isVisibleDate(date?: Date | null): boolean {
  if (!date) return false
  return startOfDay(date).getTime() >= startOfDay(new Date()).getTime()
}

function visibleDateParts(reminder: ApplicationReminder, openLabel = 'Opens'): DateMetaPart[] {
  const parts: DateMetaPart[] = []
  if (isVisibleDate(reminder.deadline)) {
    parts.push({ label: 'Deadline', value: formatFullDate(reminder.deadline) })
  }
  if (isVisibleDate(reminder.openDate)) {
    parts.push({ label: openLabel, value: formatFullDate(reminder.openDate) })
  }
  return parts
}

function clusterTitle(cluster: HorizonClusterVm): string {
  if (cluster.count === 1) {
    const reminder = cluster.reminders[0]
    return `${reminder.stateAbbrev} · ${capitalizeEachWord(reminder.species).slice(0, 3)}`
  }
  return `${cluster.count} deadlines`
}

function clusterDaysLabel(cluster: HorizonClusterVm): string {
  if (cluster.minDays === cluster.maxDays) return `${cluster.minDays} days`
  return `${cluster.minDays}-${cluster.maxDays} days`
}

function urgencyTier(days: number): 'urgent' | 'soon' | 'upcoming' {
  if (days < 14) return 'urgent'
  if (days <= 30) return 'soon'
  return 'upcoming'
}

function urgencyColor(days: number): string {
  if (days < 14) return '#f97316'
  if (days <= 30) return '#e8c547'
  return '#6cb3f0'
}

function stateAbbrev(name: string): string {
  const map: Record<string, string> = {
    arizona: 'AZ',
    colorado: 'CO',
    idaho: 'ID',
    montana: 'MT',
    nevada: 'NV',
    'new mexico': 'NM',
    oregon: 'OR',
    utah: 'UT',
    washington: 'WA',
    wyoming: 'WY',
  }
  return map[name.trim().toLowerCase()] ?? name.slice(0, 2).toUpperCase()
}

function toggleExpanded(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function scheduleSave() {
  if (!hydrated.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await reminderStore.savePreferences(localPrefs.value)
  }, 700)
}

function addReminder(id: string) {
  if (localPrefs.value.ids.includes(id)) return
  localPrefs.value = { ...localPrefs.value, ids: [...localPrefs.value.ids, id] }
  activeTab.value = 'active'
}

async function showCatalog() {
  activeTab.value = 'add'
  await nextTick()
  catalogSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function removeReminder(id: string) {
  const notes = { ...localPrefs.value.notes }
  delete notes[id]
  localPrefs.value = {
    ...localPrefs.value,
    ids: localPrefs.value.ids.filter((entry) => entry !== id),
    notes,
  }
  const next = new Set(expandedIds.value)
  next.delete(id)
  expandedIds.value = next
}

function updateNote(id: string, note: string) {
  localPrefs.value = {
    ...localPrefs.value,
    notes: { ...localPrefs.value.notes, [id]: note },
  }
}

async function refreshCatalog() {
  await reminderStore.loadCatalog()
  $q.notify({ type: 'positive', message: 'Deadline catalog refreshed.' })
}

async function sendTestReminder() {
  testingSend.value = true
  try {
    const selected = activeReminders.value[0]
    const callable = httpsCallable(functions, 'sendTestReminder')
    await callable({ notificationId: selected?.id ?? '' })
    $q.notify({ type: 'positive', message: 'Test reminder sent.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Unable to send test reminder.' })
  } finally {
    testingSend.value = false
  }
}

async function runReminderPass() {
  runningPass.value = true
  try {
    const callable = httpsCallable(functions, 'sendDeadlineRemindersNow')
    const result = await callable()
    const data = result.data as { sentEmail?: number; sentSms?: number; evaluated?: number }
    $q.notify({
      type: 'positive',
      message: `Checked ${data.evaluated ?? 0}; email ${data.sentEmail ?? 0}, SMS ${data.sentSms ?? 0}.`,
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Unable to run reminders.' })
  } finally {
    runningPass.value = false
  }
}

onMounted(async () => {
  await Promise.all([reminderStore.loadCatalog(), reminderStore.loadPreferences()])
  localPrefs.value = { ...reminderStore.preferences }
  hydrated.value = true
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

watch(localPrefs, scheduleSave, { deep: true })
watch(filterState, () => {
  if (!filterSpecies.value) return
  if (!speciesOptions.value.some((option) => option.value === filterSpecies.value)) {
    filterSpecies.value = null
  }
})
</script>

<template>
  <q-page class="notifications-page">
    <div class="radar-shell">
      <header class="page-head">
        <div class="page-copy">
          <!-- <div class="page-eyebrow"><span />RADAR · APPLICATION DEADLINES</div> -->
          <h1>Application Reminders</h1>
          <p>Application windows you've subscribed to, ranked by urgency. We'll email and/or text you ahead of every deadline so a missed cycle doesn't cost you a year of points.</p>
        </div>
        <button class="rr-btn rr-btn--primary" type="button" @click="showCatalog">
          <q-icon name="add_alert" size="14px" />
          Add Reminder
        </button>
      </header>

      <div v-if="reminderStore.catalogError" class="catalog-warning">
        <q-icon name="warning" />
        <span>{{ reminderStore.catalogError }}</span>
      </div>

      <section class="delivery-strip">
        <div>
          <q-icon name="mail_outline" size="14px" />
          <strong>Delivery preferences</strong>
          <span>email and SMS for all reminders are managed in your account.</span>
          <small v-if="reminderStore.saving">Saving...</small>
        </div>
        <button class="text-link" type="button">Account settings →</button>
      </section>

      <section class="statband">
        <div class="stat">
          <div class="stat-k">Active Reminders</div>
          <div class="stat-v">{{ activeReminders.length }}</div>
          <div class="stat-trend">{{ emailSmsSummary }}</div>
        </div>
        <div class="stat">
          <div class="stat-k">Within 30 Days</div>
          <div class="stat-v stat-v--amber">{{ soonCount }}</div>
          <div class="stat-trend">{{ activeReminders.find((r) => r.days > 0)?.stateAbbrev || 'None' }} · {{ activeReminders.find((r) => r.days > 0)?.days ?? '-' }} DAYS</div>
        </div>
        <div class="stat">
          <div class="stat-k">Next Fires</div>
          <div class="stat-v">{{ nextFireDays ?? '—' }} <small>days</small></div>
          <div class="stat-trend">7-DAY HEADS-UP</div>
        </div>
        <div class="stat">
          <div class="stat-k">Catalog</div>
          <div class="stat-v">{{ allReminders.length }} <small>available</small></div>
          <div class="stat-trend">{{ catalogSpeciesCount }} SPECIES</div>
        </div>
      </section>

      <section class="horizon">
        <div class="horizon-head">
          <span>Next 90 Days</span>
          <small>{{ horizonRangeLabel }}</small>
        </div>
        <svg viewBox="0 0 1100 140" preserveAspectRatio="none" class="horizon-svg" role="img" aria-label="Next 90 days of subscribed deadlines">
          <defs>
            <linearGradient id="todayLine" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#e8c547" stop-opacity="0.6" />
              <stop offset="100%" stop-color="#e8c547" stop-opacity="0.05" />
            </linearGradient>
          </defs>
          <line x1="20" x2="1060" y1="102" y2="102" stroke="#1a2735" />
          <line x1="20" x2="20" y1="22" y2="120" stroke="url(#todayLine)" stroke-width="1.5" />
          <circle cx="20" cy="102" r="4" fill="#e8c547" />
          <text x="28" y="60" fill="#e8c547" font-size="9" font-weight="800">TODAY</text>
          <text x="28" y="72" fill="#8a9cad" font-size="9">{{ todayLabel }}</text>
          <g v-for="x in [20, 368, 717, 1060]" :key="x">
            <line :x1="x" :x2="x" y1="96" y2="108" stroke="#25374a" />
          </g>
          <g v-for="cluster in horizonClusters" :key="cluster.id" class="horizon-cluster" tabindex="0">
            <line :x1="cluster.x" :x2="cluster.x" :y1="cluster.labelY + 30" :y2="cluster.markerY" :stroke="cluster.color" stroke-width="2" opacity="0.8" />
            <circle :cx="cluster.x" :cy="cluster.markerY" :r="cluster.count > 1 ? 7 : cluster.tier === 'upcoming' ? 5 : 6" :fill="cluster.color" />
            <text v-if="cluster.count > 1" :x="cluster.x" :y="cluster.markerY + 3.5" text-anchor="middle" fill="#071018" font-size="8" font-weight="900">
              {{ cluster.count }}
            </text>
            <rect
              :x="cluster.labelX"
              :y="cluster.labelY"
              width="126"
              height="30"
              rx="2"
              :fill="cluster.tier === 'urgent' ? '#1f1108' : cluster.tier === 'soon' ? '#1f1a08' : '#0d1620'"
              :stroke="cluster.color"
            />
            <text :x="cluster.labelX + 6" :y="cluster.labelY + 12" :fill="cluster.color" font-size="9" font-weight="800">
              {{ clusterTitle(cluster) }}
            </text>
            <text :x="cluster.labelX + 6" :y="cluster.labelY + 24" fill="#ffffff" font-size="10" font-weight="800">
              {{ clusterDaysLabel(cluster) }}
            </text>
            <g class="cluster-popover">
              <rect
                :x="cluster.popoverX"
                :y="cluster.popoverY"
                width="236"
                :height="cluster.popoverHeight"
                rx="4"
                fill="#0f1922"
                stroke="#25374a"
              />
              <text :x="cluster.popoverX + 12" :y="cluster.popoverY + 17" fill="#e8c547" font-size="9" font-weight="900">
                {{ clusterTitle(cluster) }} · {{ clusterDaysLabel(cluster) }}
              </text>
              <text
                v-for="(reminder, reminderIndex) in cluster.reminders.slice(0, 4)"
                :key="reminder.id"
                :x="cluster.popoverX + 12"
                :y="cluster.popoverY + 39 + reminderIndex * 17"
                fill="#dbe7f3"
                font-size="10"
                font-weight="700"
              >
                {{ reminder.stateAbbrev }} · {{ capitalizeEachWord(reminder.species).slice(0, 3) }} · {{ reminder.name.slice(0, 26) }}
              </text>
              <text v-if="cluster.count > 4" :x="cluster.popoverX + 12" :y="cluster.popoverY + 109" fill="#8a9cad" font-size="9" font-weight="800">
                +{{ cluster.count - 4 }} more in this window
              </text>
            </g>
          </g>
          <text v-if="beyondWindowCount" x="1010" y="92" fill="#556676" font-size="9">+{{ beyondWindowCount }} BEYOND →</text>
        </svg>
        <div class="horizon-axis"><span>NOW</span><span>+30d</span><span>+60d</span><span>+90d</span></div>
        <div class="legend"><span><i class="urgent" />Urgent &lt;14d</span><span><i class="soon" />Soon 14–30d</span><span><i class="upcoming" />Upcoming 30d+</span></div>
      </section>

      <section v-if="isAdmin" class="admin-card">
        <details>
          <summary>Admin · dev only</summary>
          <div class="admin-actions">
            <button class="rr-btn" type="button" :disabled="reminderStore.loading" @click="refreshCatalog">Refresh Catalog</button>
            <button class="rr-btn" type="button" :disabled="testingSend" @click="sendTestReminder">Test Send</button>
            <button class="rr-btn rr-btn--primary" type="button" :disabled="runningPass" @click="runReminderPass">Run Pass</button>
          </div>
        </details>
      </section>

      <div ref="catalogSectionRef" class="list-toolbar">
        <nav class="seg" aria-label="Notification tabs">
          <button :class="{ active: activeTab === 'active' }" type="button" @click="activeTab = 'active'">Active <span>{{ activeReminders.length }}</span></button>
          <button :class="{ active: activeTab === 'add' }" type="button" @click="activeTab = 'add'">Catalog <span>{{ availableReminders.length }}</span></button>
        </nav>
        <div v-if="activeTab === 'add'" class="filters">
          <q-select v-model="filterState" :options="stateOptions" dark borderless dense clearable emit-value map-options label="State" class="filter-select" />
          <q-select v-model="filterSpecies" :options="speciesOptions" dark borderless dense clearable emit-value map-options label="Species" class="filter-select" />
        </div>
      </div>

      <div v-if="reminderStore.loading" class="empty-panel">
        <q-spinner color="amber" size="28px" />
      </div>

      <section v-else-if="activeTab === 'active'" class="reminder-list">
        <div v-if="activeReminders.length === 0" class="empty-panel empty-panel--radar">
          <div class="radar-icon">
            <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" /><circle cx="32" cy="32" r="18" /><circle cx="32" cy="32" r="9" /><path d="M32 32 L48 17" /><circle cx="32" cy="32" r="3" /></svg>
          </div>
          <div class="empty-eyebrow">Radar Clear</div>
          <h2>You're all clear</h2>
          <p>Add subscriptions from the catalog and RidgeRead will keep watch on the cycle.</p>
          <article v-if="nextInCatalog" class="next-preview">
            <div class="state-flag">{{ nextInCatalog.stateAbbrev }}</div>
            <div>
              <div class="card-eyebrow">Next In Catalog</div>
              <strong>{{ capitalizeEachWord(nextInCatalog.state) }} {{ capitalizeEachWord(nextInCatalog.species) }} · {{ nextInCatalog.name }}</strong>
              <span v-if="isVisibleDate(nextInCatalog.deadline)">{{ formatFullDate(nextInCatalog.deadline) }}</span>
            </div>
            <button class="rr-btn rr-btn--primary rr-btn--sm" type="button" @click="addReminder(nextInCatalog.id)">Subscribe</button>
          </article>
        </div>

        <article v-for="reminder in activeReminders" :key="reminder.id" class="reminder-card" :style="{ '--rc': urgencyColor(reminder.days) }">
          <button class="reminder-main" type="button" @click="toggleExpanded(reminder.id)">
            <div class="countdown"><strong>{{ reminder.days > 0 ? reminder.days : '—' }}</strong><span>Days</span></div>
            <div class="state-flag"><strong>{{ reminder.stateAbbrev }}</strong><span>{{ capitalizeEachWord(reminder.species).slice(0, 3) }}</span></div>
            <div class="reminder-copy">
              <h3>{{ reminder.name }}</h3>
              <p v-if="visibleDateParts(reminder, 'Window opens').length || reminder.days > 0">
                <template v-for="(part, partIndex) in visibleDateParts(reminder, 'Window opens')" :key="part.label">
                  <span v-if="partIndex"> · </span><b>{{ part.label }}</b> · {{ part.value }}
                </template>
                <template v-if="reminder.days > 0">
                  <span v-if="visibleDateParts(reminder, 'Window opens').length"> · </span><b>Heads-up</b> · 7 days before
                </template>
              </p>
              <span v-if="reminder.note && !expandedIds.has(reminder.id)" class="note-preview">{{ reminder.note }}</span>
            </div>
            <div class="channels">
              <button :class="{ on: localPrefs.emailEnabled }" type="button" @click.stop="localPrefs.emailEnabled = !localPrefs.emailEnabled"><q-icon name="mail" size="13px" /></button>
              <button :class="{ on: localPrefs.smsEnabled }" type="button" @click.stop="localPrefs.smsEnabled = !localPrefs.smsEnabled"><q-icon name="sms" size="13px" /></button>
            </div>
            <div class="row-actions">
              <q-icon name="edit" size="14px" />
              <q-icon name="delete_outline" size="14px" @click.stop="removeReminder(reminder.id)" />
            </div>
          </button>
          <div v-if="expandedIds.has(reminder.id)" class="reminder-expand">
            <q-input :model-value="reminder.note" dark outlined dense label="Note to self" placeholder="Application account, point target, unit, or partner note" @update:model-value="(value) => updateNote(reminder.id, String(value ?? ''))" />
            <a v-if="reminder.applicationUrl" :href="reminder.applicationUrl" target="_blank" rel="noreferrer" class="source-link">Open application source <q-icon name="open_in_new" size="14px" /></a>
          </div>
        </article>
      </section>

      <section v-else class="reminder-list">
        <div v-if="filteredAvailable.length === 0" class="empty-panel">
          <q-icon name="task_alt" size="28px" />
          <h2>No available reminders</h2>
          <p>Clear filters or refresh the catalog when new state deadlines are published.</p>
          <button v-if="filterState || filterSpecies" class="rr-btn rr-btn--primary" type="button" @click="filterState = null; filterSpecies = null">Clear Filters</button>
        </div>

        <article v-for="(reminder, index) in filteredAvailable" :key="reminder.id" class="catalog-row">
          <div class="state-flag"><strong>{{ reminder.stateAbbrev }}</strong><span>{{ capitalizeEachWord(reminder.species).slice(0, 3) }}</span></div>
          <div class="reminder-copy">
            <div class="card-eyebrow">{{ capitalizeEachWord(reminder.state) }} · {{ capitalizeEachWord(reminder.species) }}</div>
            <h3>{{ reminder.name }}</h3>
            <p v-if="visibleDateParts(reminder).length">
              <template v-for="(part, partIndex) in visibleDateParts(reminder)" :key="part.label">
                <span v-if="partIndex"> · </span><b>{{ part.label }}</b> · {{ part.value }}
              </template>
            </p>
          </div>
          <button class="rr-btn" :class="{ 'rr-btn--primary': index === 0 }" type="button" @click="addReminder(reminder.id)">+ Subscribe</button>
        </article>
      </section>
    </div>
  </q-page>
</template>

<style scoped>
.notifications-page {
  min-height: calc(100vh - 56px);
  background: #07090c;
  color: #e7eef5;
}

.radar-shell {
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
  font-family: var(--mono, monospace);
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
  cursor: pointer;
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

.catalog-warning,
.delivery-strip,
.horizon,
.admin-card,
.reminder-card,
.catalog-row,
.empty-panel {
  border: 1px solid #1a2735;
  border-radius: 6px;
  background: #0a0e14;
}

.catalog-warning {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px 14px;
  color: #e8c547;
}

.delivery-strip {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 28px;
  padding: 13px 18px;
  border-style: dashed;
  color: #8a9cad;
  font-size: 12px;
}

.delivery-strip > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delivery-strip strong {
  color: #e7eef5;
}

.delivery-strip small {
  color: #4ade80;
}

.text-link {
  border: 0;
  background: transparent;
  color: #e8c547;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
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
.horizon-head,
.horizon-axis,
.legend,
.seg,
.countdown,
.state-flag,
.card-eyebrow {
  font-family: var(--mono, monospace);
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
}

.stat-v--amber { color: #e8c547; }

.stat-trend {
  margin-top: 7px;
  color: #6f8296;
  font-size: 10px;
  letter-spacing: 0.06em;
}

.horizon {
  margin-bottom: 28px;
  padding: 18px 22px 14px;
}

.horizon-head,
.horizon-axis,
.legend {
  display: flex;
  justify-content: space-between;
  color: #556676;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.horizon-head span {
  color: #e7eef5;
  letter-spacing: 0.22em;
}

.horizon-svg {
  width: 100%;
  height: 140px;
  margin-top: 8px;
  overflow: visible;
  font-family: var(--mono, monospace);
}

.horizon-cluster {
  cursor: default;
  outline: none;
}

.cluster-popover {
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
}

.horizon-cluster:hover .cluster-popover,
.horizon-cluster:focus .cluster-popover,
.horizon-cluster:focus-within .cluster-popover {
  opacity: 1;
}

.legend {
  justify-content: flex-start;
  gap: 18px;
  margin-top: 12px;
  font-size: 9px;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.legend .urgent { background: #f97316; }
.legend .soon { background: #e8c547; }
.legend .upcoming { background: #6cb3f0; }

.admin-card {
  margin-bottom: 16px;
  padding: 12px 14px;
}

.admin-card summary {
  color: #8a9cad;
  cursor: pointer;
  font-family: var(--mono, monospace);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.admin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.list-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  margin-bottom: 16px;
}

.seg {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid #1a2735;
  border-radius: 6px;
  background: #0a0e14;
}

.seg button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8a9cad;
  padding: 7px 11px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.seg button.active {
  background: rgba(232, 197, 71, 0.1);
  color: #e8c547;
}

.seg span {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #0f1922;
}

.filters {
  display: grid;
  grid-template-columns: 180px 180px;
  gap: 8px;
}

.filter-select {
  border: 1px solid #1a2735;
  border-radius: 4px;
  background: #0f1922;
}

.filter-select :deep(.q-field__control) {
  min-height: 42px;
  height: 42px;
  padding: 0 10px 0 12px;
}

.filter-select :deep(.q-field__label) {
  top: 7px;
  color: #6cb3f0;
  font-size: 11px;
  line-height: 1;
}

.filter-select :deep(.q-field__native),
.filter-select :deep(.q-field__input) {
  min-height: 0;
  height: 42px;
  align-items: center;
  padding-top: 14px;
  padding-bottom: 2px;
  color: #e7eef5;
  line-height: 16px;
}

.filter-select :deep(.q-field__native span) {
  line-height: 16px;
}

.filter-select :deep(.q-field__append) {
  height: 42px;
  padding-left: 8px;
}

.reminder-list {
  display: grid;
  gap: 10px;
}

.reminder-card {
  overflow: hidden;
  border-left: 3px solid var(--rc);
}

.reminder-main,
.catalog-row {
  display: grid;
  grid-template-columns: 76px 56px minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: linear-gradient(90deg, color-mix(in srgb, var(--rc) 10%, transparent), transparent 28%);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.countdown strong {
  display: block;
  color: var(--rc);
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
}

.countdown span {
  color: #556676;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.state-flag {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 1px solid #25374a;
  border-radius: 4px;
  background: #0f1922;
  color: #c8d6e5;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.state-flag span {
  color: #556676;
  font-size: 8px;
}

.reminder-copy {
  min-width: 0;
}

.reminder-copy h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.015em;
}

.reminder-copy p,
.note-preview {
  margin: 5px 0 0;
  color: #9bb0c8;
  font-size: 12px;
  line-height: 1.45;
}

.reminder-copy b {
  color: #e7eef5;
}

.note-preview {
  display: block;
  overflow: hidden;
  color: #e8c547;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channels,
.row-actions {
  display: flex;
  gap: 6px;
}

.channels button,
.row-actions .q-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid #1a2735;
  border-radius: 4px;
  background: #0f1922;
  color: #556676;
}

.channels button.on {
  border-color: rgba(232, 197, 71, 0.42);
  background: rgba(232, 197, 71, 0.1);
  color: #e8c547;
}

.reminder-expand {
  display: grid;
  gap: 10px;
  padding: 14px 16px 16px 162px;
  border-top: 1px solid #1a2735;
  background: rgba(0, 0, 0, 0.18);
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #e8c547;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}

.catalog-row {
  grid-template-columns: 56px minmax(0, 1fr) auto;
  background: #0a0e14;
}

.card-eyebrow {
  color: #556676;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.empty-panel {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 56px 32px;
  color: #8a9cad;
  text-align: center;
}

.empty-panel h2 {
  margin: 0;
  color: #fff;
  font-size: 28px;
  font-weight: 900;
}

.empty-panel p {
  max-width: 54ch;
  margin: 0;
}

.radar-icon {
  position: relative;
  width: 64px;
  height: 64px;
  color: #4ade80;
}

.radar-icon::after {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid rgba(74, 222, 128, 0.42);
  border-radius: 50%;
  animation: empty-pulse 2.6s ease-in-out infinite;
}

.radar-icon svg {
  width: 64px;
  height: 64px;
  fill: none;
  stroke: currentColor;
}

.radar-icon circle:last-child {
  fill: currentColor;
}

.empty-eyebrow {
  color: #4ade80;
  font-family: var(--mono, monospace);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.next-preview {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: min(100%, 420px);
  margin-top: 8px;
  padding: 12px;
  border: 1px solid #25374a;
  border-radius: 5px;
  background: #0f1922;
  text-align: left;
}

.next-preview strong,
.next-preview span {
  display: block;
}

.next-preview span {
  margin-top: 3px;
  color: #8a9cad;
  font-size: 12px;
}

@keyframes empty-pulse {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.15); }
}

@media (max-width: 900px) {
  .statband {
    grid-template-columns: repeat(2, 1fr);
  }

  .reminder-main {
    grid-template-columns: 62px 48px minmax(0, 1fr);
  }

  .channels,
  .row-actions {
    grid-column: 3;
  }

  .reminder-expand {
    padding-left: 16px;
  }
}

@media (max-width: 640px) {
  .radar-shell {
    padding: 28px 14px 56px;
  }

  .page-head,
  .statband,
  .list-toolbar,
  .filters,
  .catalog-row,
  .reminder-main {
    grid-template-columns: 1fr;
  }

  .list-toolbar {
    display: grid;
  }

  .delivery-strip,
  .delivery-strip > div {
    display: grid;
  }
}
</style>
