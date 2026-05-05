import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  collection,
  addDoc,
  doc,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
  type Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/config/firebase'
import { useAuthStore } from './auth'
import { PLANS, type PlanConfig } from '@/config/stripe'

/**
 * Subset of fields written by the firestore-stripe-payments extension to
 * customers/{uid}/subscriptions/{subscriptionId}. We only consume what we
 * need for gating + status display.
 */
export interface FirestoreSubscription {
  id: string
  status:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused'
  trial_end?: Timestamp | null
  current_period_end?: Timestamp
  cancel_at_period_end?: boolean
}

/**
 * Monthly analyze quotas — must match server/services/usage.ts (PLAN_LIMITS).
 * Free signed-in users get 1 analysis. Pro: 20/mo. Guide: unlimited.
 */
const PLAN_LIMITS: Record<'pro' | 'guide' | 'none', number> = {
  pro: 20,
  guide: Infinity,
  none: 1,
}

function currentMonthKey(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export const useSubscriptionStore = defineStore('subscription', () => {
  const subscription = ref<FirestoreSubscription | null>(null)
  const loading = ref(true)
  const checkoutLoading = ref(false)
  const checkoutError = ref<string | null>(null)
  const usageCount = ref(0)

  let unsub: Unsubscribe | null = null
  let usageUnsub: Unsubscribe | null = null
  let activeUid: string | null = null

  const auth = useAuthStore()

  function subscribe(uid: string) {
    if (activeUid === uid && unsub) return
    unsubscribeFn()
    activeUid = uid
    loading.value = true

    // The extension writes one doc per Stripe subscription. We only care
    // about ones that grant access (`trialing` or `active`).
    const q = query(
      collection(db, 'customers', uid, 'subscriptions'),
      where('status', 'in', ['trialing', 'active']),
    )

    unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          subscription.value = null
        } else {
          const d = snap.docs[0]
          subscription.value = {
            id: d.id,
            ...(d.data() as Omit<FirestoreSubscription, 'id'>),
          }
        }
        loading.value = false
      },
      (err) => {
        console.error('[subscription] onSnapshot error:', err)
        loading.value = false
      },
    )

    // Live-track current-month usage count so the UI can show "X / 20 left".
    const usageRef = doc(db, 'customers', uid, 'usage', currentMonthKey())
    usageUnsub = onSnapshot(
      usageRef,
      (snap) => {
        usageCount.value = snap.exists() ? Number(snap.data()?.count ?? 0) : 0
      },
      (err) => {
        console.error('[subscription] usage onSnapshot error:', err)
      },
    )
  }

  function unsubscribeFn() {
    if (unsub) {
      unsub()
      unsub = null
    }
    if (usageUnsub) {
      usageUnsub()
      usageUnsub = null
    }
    activeUid = null
    subscription.value = null
    usageCount.value = 0
    loading.value = true
  }

  // Auto-track signed-in user.
  watch(
    () => auth.user?.uid ?? null,
    (uid) => {
      if (uid) subscribe(uid)
      else unsubscribeFn()
    },
    { immediate: true },
  )

  const hasAccess = computed(() => {
    const s = subscription.value
    if (!s) return false
    return s.status === 'trialing' || s.status === 'active'
  })

  const isOnTrial = computed(() => subscription.value?.status === 'trialing')

  const trialEndDate = computed<Date | null>(() => {
    const t = subscription.value?.trial_end
    if (!t) return null
    return new Date(t.seconds * 1000)
  })

  const trialDaysLeft = computed<number | null>(() => {
    const end = trialEndDate.value
    if (!end) return null
    const ms = end.getTime() - Date.now()
    if (ms <= 0) return 0
    return Math.ceil(ms / (24 * 60 * 60 * 1000))
  })

  /**
   * Best-effort plan inference from the current subscription's price ID.
   * Server is authoritative — this is for display only.
   */
  const plan = computed<'pro' | 'guide' | 'none'>(() => {
    const sub = subscription.value as
      | (FirestoreSubscription & { items?: Array<{ price?: { id?: string } }> })
      | null
    if (!sub) return 'none'
    const priceId = sub.items?.[0]?.price?.id
    if (priceId === PLANS.pro.priceId) return 'pro'
    if (priceId === PLANS.guide.priceId) return 'guide'
    return 'none'
  })

  const analysesLimit = computed(() => PLAN_LIMITS[plan.value])
  const analysesUsed = computed(() => usageCount.value)
  const analysesRemaining = computed(() => {
    const lim = analysesLimit.value
    if (lim === Infinity) return Infinity
    return Math.max(0, lim - analysesUsed.value)
  })

  const hasAnalysisAccess = computed(() => {
    return hasAccess.value || analysesRemaining.value > 0
  })

  /**
   * Trigger a Stripe Checkout session for the given plan. Writes a
   * checkout-session doc; the extension responds with `url` (or `error`)
   * which we then redirect to.
   */
  async function startCheckout(plan: PlanConfig): Promise<void> {
    if (!auth.user?.uid) {
      checkoutError.value = 'Sign in before subscribing.'
      return
    }
    checkoutLoading.value = true
    checkoutError.value = null

    try {
      const sessionRef = await addDoc(
        collection(db, 'customers', auth.user.uid, 'checkout_sessions'),
        {
          price: plan.priceId,
          mode: 'subscription',
          trial_period_days: plan.trialDays,
          // Required by Stripe Checkout when starting a trial without
          // collecting payment up-front would default to "skip" — we want
          // the card on file so the trial converts cleanly.
          payment_method_collection: 'always',
          allow_promotion_codes: true,
          success_url: `${window.location.origin}/map?subscribed=true`,
          cancel_url: `${window.location.origin}/map`,
        },
      )

      // Wait for the extension function to populate `url` or `error`.
      const sessionUnsub = onSnapshot(sessionRef, (snap) => {
        const data = snap.data()
        if (!data) return
        if (data.error) {
          checkoutError.value = data.error.message ?? 'Checkout failed'
          checkoutLoading.value = false
          sessionUnsub()
        } else if (data.url) {
          sessionUnsub()
          window.location.assign(data.url as string)
        }
      })
    } catch (err: unknown) {
      console.error('[subscription] checkout error:', err)
      checkoutError.value = err instanceof Error ? err.message : 'Checkout failed'
      checkoutLoading.value = false
    }
  }

  function clearCheckoutError() {
    checkoutError.value = null
  }

  /**
   * Open Stripe's hosted Customer Portal — the only correct way to *change*
   * an existing subscription (upgrade, downgrade, cancel, update card).
   * Calls the firestore-stripe-payments extension's `createPortalLink`
   * Cloud Function and redirects to the returned URL.
   */
  async function openCustomerPortal(): Promise<void> {
    if (!auth.user?.uid) {
      checkoutError.value = 'Sign in before managing your subscription.'
      return
    }
    checkoutLoading.value = true
    checkoutError.value = null
    try {
      const createPortalLink = httpsCallable<
        { returnUrl: string; locale?: string },
        { url: string }
      >(functions, 'ext-firestore-stripe-payments-createPortalLink')
      const { data } = await createPortalLink({
        returnUrl: `${window.location.origin}/map`,
      })
      window.location.assign(data.url)
    } catch (err: unknown) {
      console.error('[subscription] portal link error:', err)
      checkoutError.value =
        err instanceof Error ? err.message : 'Could not open billing portal'
      checkoutLoading.value = false
    }
  }

  return {
    subscription,
    loading,
    checkoutLoading,
    checkoutError,
    hasAccess,
    hasAnalysisAccess,
    isOnTrial,
    trialEndDate,
    trialDaysLeft,
    plan,
    analysesLimit,
    analysesUsed,
    analysesRemaining,
    plans: PLANS,
    startCheckout,
    openCustomerPortal,
    clearCheckoutError,
  }
})
