<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useSubscriptionStore } from '@/stores/subscription'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const sub = useSubscriptionStore()

function close() {
  if (sub.checkoutLoading) return
  emit('update:modelValue', false)
  sub.clearCheckoutError()
}

async function upgrade() {
  if (isFreeLimit.value) {
    await sub.startCheckout(sub.plans.pro)
    return
  }

  // Customer Portal lets users switch from Pro to Guide cleanly. Opening a
  // raw checkout for Guide would create a *second* subscription, not an
  // upgrade — Stripe requires plan changes to go through the portal (or
  // the Subscriptions API server-side).
  await sub.openCustomerPortal()
  // If openCustomerPortal succeeds it redirects away; on failure it sets
  // checkoutError which renders inline.
}

function onKeydown(e: KeyboardEvent) {
  if (props.modelValue && e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const used = computed(() => sub.analysesUsed)
const limit = computed(() => (sub.analysesLimit === Infinity ? '∞' : sub.analysesLimit))
const isFreeLimit = computed(() => !sub.hasAccess)
/**
 * First day of next UTC month — when Pro's 20-analysis quota resets.
 */
const resetDate = computed<string>(() => {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  })
})
const title = computed(() => (
  isFreeLimit.value ? 'Your free analysis is complete' : "You've used all your Pro analyses"
))
const subtitle = computed(() => (
  isFreeLimit.value
    ? 'Create a plan to keep analyzing terrain, saving POIs, and comparing spots across seasons.'
    : `You've run ${used.value} of ${limit.value} analyses this month. Your Pro quota resets on ${resetDate.value}, or you can upgrade to Guide for unlimited analyses today.`
))
const primaryLabel = computed(() => (isFreeLimit.value ? 'Start Pro Trial' : 'Upgrade to Guide'))
const secondaryLabel = computed(() => (isFreeLimit.value ? 'Keep Exploring' : `Wait until ${resetDate.value}`))
</script>

<template>
  <transition name="modal-fade">
    <div v-if="modelValue" class="lim-modal-backdrop" @click.self="close">
      <div class="lim-modal">
        <button class="lim-modal-close" type="button" @click="close" :aria-label="'Close'">
          <q-icon name="close" size="18px" />
        </button>

        <div class="lim-modal-eyebrow">{{ isFreeLimit ? 'FREE ANALYSIS USED' : 'MONTHLY LIMIT REACHED' }}</div>
        <h2 class="lim-modal-title">{{ title }}</h2>
        <p class="lim-modal-sub">
          {{ subtitle }}
        </p>

        <div class="lim-modal-card">
          <div class="lim-modal-card-row">
            <div>
              <div class="lim-modal-card-name">{{ isFreeLimit ? 'Pro' : 'Guide' }}</div>
              <div class="lim-modal-card-detail">
                {{ isFreeLimit ? '20 analyses per month · 30-day free trial' : 'Unlimited analyses · same features as Pro' }}
              </div>
            </div>
            <div class="lim-modal-card-price">
              {{ isFreeLimit ? '$10' : '$25' }}<span class="lim-modal-card-per">/mo</span>
            </div>
          </div>
        </div>

        <p v-if="sub.checkoutError" class="lim-modal-error">{{ sub.checkoutError }}</p>

        <div class="lim-modal-actions">
          <button
            class="lim-modal-cta lim-modal-cta--primary"
            type="button"
            :disabled="sub.checkoutLoading"
            @click="upgrade"
          >
            <q-spinner v-if="sub.checkoutLoading" size="18px" />
            <span v-else>{{ primaryLabel }}</span>
          </button>
          <button class="lim-modal-cta lim-modal-cta--ghost" type="button" @click="close">
            {{ secondaryLabel }}
          </button>
        </div>

        <p class="lim-modal-fineprint">
          {{ isFreeLimit
            ? "No charge today during the trial. Stripe handles checkout securely."
            : "Upgrading takes you to Stripe's billing portal. You'll only pay the prorated difference for the rest of this billing period."
          }}
        </p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.lim-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(5, 8, 12, 0.7);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.lim-modal {
  position: relative;
  width: 100%;
  max-width: 460px;
  background: #111a24;
  border: 1px solid #1e2d3d;
  border-radius: 14px;
  padding: 32px 28px 24px;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.5);
  color: #c8d6e5;
}

.lim-modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: transparent;
  border: none;
  color: #6b7c8d;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: inline-flex;
}
.lim-modal-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}

.lim-modal-eyebrow {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: #ff8a8a;
  background: rgba(213, 78, 78, 0.12);
  border: 1px solid rgba(213, 78, 78, 0.3);
  padding: 4px 10px;
  border-radius: 12px;
  margin-bottom: 16px;
}

.lim-modal-title {
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  margin: 0 0 10px;
  letter-spacing: -0.5px;
  line-height: 1.25;
}

.lim-modal-sub {
  font-size: 14px;
  line-height: 1.6;
  color: #8899aa;
  margin: 0 0 22px;
}
.lim-modal-sub strong {
  color: #c8d6e5;
}

.lim-modal-card {
  background: rgba(232, 197, 71, 0.06);
  border: 1px solid rgba(232, 197, 71, 0.25);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.lim-modal-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lim-modal-card-name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 2px;
}

.lim-modal-card-detail {
  font-size: 12px;
  color: #8899aa;
}

.lim-modal-card-price {
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
}
.lim-modal-card-per {
  font-size: 12px;
  font-weight: 500;
  color: #6b7c8d;
}

.lim-modal-error {
  font-size: 12px;
  color: #ff8a8a;
  background: rgba(213, 78, 78, 0.12);
  border: 1px solid rgba(213, 78, 78, 0.35);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0 0 12px;
  line-height: 1.4;
}

.lim-modal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lim-modal-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 14px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  border: 1px solid transparent;
}
.lim-modal-cta:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.lim-modal-cta--primary {
  background: #e8c547;
  color: #0a0e14;
}
.lim-modal-cta--primary:hover:not(:disabled) {
  background: #f0d260;
}

.lim-modal-cta--ghost {
  background: transparent;
  color: #a8b8c8;
  border-color: #2c4055;
}
.lim-modal-cta--ghost:hover:not(:disabled) {
  color: #fff;
  border-color: #4a90e2;
}

.lim-modal-fineprint {
  font-size: 11px;
  color: #6b7c8d;
  text-align: center;
  margin: 14px 0 0;
  line-height: 1.5;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
