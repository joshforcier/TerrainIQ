/**
 * Per-user, per-month analyze usage tracking + plan-based limit enforcement.
 *
 * Document layout in Firestore:
 *   customers/{uid}/usage/{YYYY-MM}  →  { count: number, updatedAt: Timestamp }
 *
 * Plan inference reads customers/{uid}/subscriptions for an active or trialing
 * sub and matches the price ID against PLAN_LIMITS. If no active sub exists,
 * the user is `none` and gets one free analysis after signing in.
 */

import { adminDb } from './firebaseAdmin.js'
import { FieldValue } from 'firebase-admin/firestore'

export type PlanId = 'pro' | 'guide' | 'none'

const PRO_PRICE_ID = 'price_1TQ9YQB4dW44xtsTefWTOqhf'
const GUIDE_PRICE_ID = 'price_1TQ9YhB4dW44xtsTeOfPyRYU'

/**
 * Monthly analyze quota per plan. `Infinity` means uncapped (Guide).
 * `none` is the post-Google-sign-in free tier.
 */
const PLAN_LIMITS: Record<PlanId, number> = {
  pro: 20,
  guide: Infinity,
  none: 1,
}

export interface UsageState {
  plan: PlanId
  used: number
  limit: number
  remaining: number
  monthKey: string
}

export interface OpenAITokenUsageEntry {
  model: string
  comboKey: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedPromptTokens: number
  estimatedCostUsd: number
}

const OPENAI_PRICES_PER_1M: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.50 },
}

export function estimateOpenAICostUsd(params: {
  model: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens?: number
}): number {
  const price = OPENAI_PRICES_PER_1M[params.model]
  if (!price) return 0

  const cachedPromptTokens = Math.min(
    Math.max(0, params.cachedPromptTokens ?? 0),
    params.promptTokens,
  )
  const uncachedPromptTokens = Math.max(0, params.promptTokens - cachedPromptTokens)

  return (
    (uncachedPromptTokens / 1_000_000) * price.input +
    (cachedPromptTokens / 1_000_000) * price.cachedInput +
    (params.completionTokens / 1_000_000) * price.output
  )
}

function currentMonthKey(date = new Date()): string {
  // YYYY-MM in UTC. Using UTC avoids "the user's local month" drift across
  // timezones — billing and quota windows align on calendar UTC months.
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Look up the user's currently effective plan based on their Stripe sub.
 * Returns 'pro' / 'guide' for any active or trialing subscription whose
 * price matches a known plan; 'none' otherwise.
 */
export async function getPlanForUser(uid: string): Promise<PlanId> {
  const subsSnap = await adminDb
    .collection('customers')
    .doc(uid)
    .collection('subscriptions')
    .where('status', 'in', ['trialing', 'active'])
    .limit(1)
    .get()

  if (subsSnap.empty) return 'none'

  const sub = subsSnap.docs[0].data() as {
    items?: Array<{ price?: { id?: string } | { _path?: { segments?: string[] } } }>
    price?: { id?: string } | { _path?: { segments?: string[] } }
  }

  // The extension shape: subscription has `items: [{ price: DocumentReference }]`.
  // Older extension versions used a top-level `price` ref. Handle both.
  const priceRef = sub.items?.[0]?.price ?? sub.price
  const priceId = extractPriceId(priceRef)

  if (priceId === PRO_PRICE_ID) return 'pro'
  if (priceId === GUIDE_PRICE_ID) return 'guide'
  return 'none'
}

function extractPriceId(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null
  const r = ref as { id?: string; _path?: { segments?: string[] } }
  if (typeof r.id === 'string') return r.id
  // Firestore DocumentReferences serialized over Admin SDK have an `_path.segments`
  // array; the last segment is the doc id (the price id).
  const segs = r._path?.segments
  if (Array.isArray(segs) && segs.length > 0) return segs[segs.length - 1] ?? null
  return null
}

/**
 * Atomically check whether the user has remaining quota for this month and,
 * if so, increment the counter. Returns the post-increment usage state.
 *
 * Throws an `Error` with `code === 'LIMIT_EXCEEDED'` if the user is at or
 * over their plan's limit.
 */
export async function checkAndIncrementUsage(uid: string): Promise<UsageState> {
  const plan = await getPlanForUser(uid)
  const limit = PLAN_LIMITS[plan]
  const monthKey = currentMonthKey()
  const ref = adminDb.collection('customers').doc(uid).collection('usage').doc(monthKey)

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const used = snap.exists ? Number(snap.data()?.count ?? 0) : 0

    if (used >= limit) {
      const err = new Error(`Monthly limit reached (${used} / ${limit}) on ${plan} plan`)
      ;(err as Error & { code?: string }).code = 'LIMIT_EXCEEDED'
      throw err
    }

    if (snap.exists) {
      tx.update(ref, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    } else {
      tx.set(ref, { count: 1, updatedAt: FieldValue.serverTimestamp() })
    }
    return used + 1
  })

  return {
    plan,
    used: result,
    limit,
    remaining: Math.max(0, limit - result),
    monthKey,
  }
}

/**
 * Read-only — returns current usage without mutating.
 */
export async function getUsage(uid: string): Promise<UsageState> {
  const plan = await getPlanForUser(uid)
  const limit = PLAN_LIMITS[plan]
  const monthKey = currentMonthKey()
  const snap = await adminDb
    .collection('customers')
    .doc(uid)
    .collection('usage')
    .doc(monthKey)
    .get()
  const used = snap.exists ? Number(snap.data()?.count ?? 0) : 0
  return { plan, used, limit, remaining: Math.max(0, limit - used), monthKey }
}

export async function recordOpenAITokenUsage(
  uid: string,
  monthKey: string,
  entries: OpenAITokenUsageEntry[],
): Promise<void> {
  if (entries.length === 0) return

  const totals = entries.reduce(
    (acc, entry) => {
      acc.calls += 1
      acc.promptTokens += entry.promptTokens
      acc.completionTokens += entry.completionTokens
      acc.totalTokens += entry.totalTokens
      acc.cachedPromptTokens += entry.cachedPromptTokens
      acc.estimatedCostUsd += entry.estimatedCostUsd
      return acc
    },
    {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
      estimatedCostUsd: 0,
    },
  )

  const usageRef = adminDb.collection('customers').doc(uid).collection('usage').doc(monthKey)
  const analysisRef = usageRef.collection('openaiAnalyses').doc()
  const batch = adminDb.batch()

  batch.set(
    usageRef,
    {
      openaiCalls: FieldValue.increment(totals.calls),
      openaiPromptTokens: FieldValue.increment(totals.promptTokens),
      openaiCompletionTokens: FieldValue.increment(totals.completionTokens),
      openaiTotalTokens: FieldValue.increment(totals.totalTokens),
      openaiCachedPromptTokens: FieldValue.increment(totals.cachedPromptTokens),
      openaiEstimatedCostUsd: FieldValue.increment(totals.estimatedCostUsd),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  batch.set(analysisRef, {
    createdAt: FieldValue.serverTimestamp(),
    totals,
    entries,
  })

  await batch.commit()
}
