<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { AppPassword, RotateAppPasswordRequest } from '@bookorbit/types'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  appPassword: AppPassword | null
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: RotateAppPasswordRequest]
}>()

const { t } = useI18n()
const expiryDays = ref(365)
const expiryOptions = [30, 90, 180, 365] as const

const renewing = computed(() => props.appPassword?.status === 'expired')
const title = computed(() => t(renewing.value ? 'settings.appPasswords.rotate.renewTitle' : 'settings.appPasswords.rotate.title'))
const description = computed(() =>
  t('settings.appPasswords.rotate.description', {
    label: props.appPassword?.label ?? '',
  }),
)
const sessionWarning = computed(() =>
  t('settings.appPasswords.rotate.sessionWarning', {
    count: props.appPassword?.activeSessions ?? 0,
  }),
)
const historyHint = computed(() =>
  t('settings.appPasswords.rotate.historyHint', {
    label: props.appPassword?.label ?? '',
  }),
)
const submitLabel = computed(() => {
  if (props.saving) return t(renewing.value ? 'settings.appPasswords.rotate.renewing' : 'settings.appPasswords.rotate.rotating')
  return t(renewing.value ? 'settings.appPasswords.rotate.renewConfirm' : 'settings.appPasswords.rotate.confirm')
})

watch(
  () => props.open,
  (open) => {
    if (open) expiryDays.value = 365
  },
  { immediate: true },
)

function handleOpenChange(open: boolean): void {
  if (!open && props.saving) return
  emit('update:open', open)
}

function handleCancel(): void {
  if (!props.saving) emit('update:open', false)
}

function handleSubmit(): void {
  if (props.saving || !props.appPassword) return
  const expiresAt = new Date(Date.now() + expiryDays.value * 24 * 60 * 60 * 1000).toISOString()
  emit('submit', { expiresAt })
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ title }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription>

        <form class="mt-5 space-y-4" @submit.prevent="handleSubmit">
          <div class="flex items-start gap-2 rounded-md border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-3 py-2">
            <AlertTriangle :size="16" class="mt-0.5 shrink-0 text-[var(--pill-warning)]" aria-hidden="true" />
            <p class="text-xs text-[var(--pill-warning)]">{{ sessionWarning }}</p>
          </div>

          <p class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{{ historyHint }}</p>

          <div class="space-y-1.5">
            <label for="app-password-rotation-expiry" class="settings-label">{{ t('settings.appPasswords.rotate.expiration') }}</label>
            <select id="app-password-rotation-expiry" v-model="expiryDays" class="select-field w-full">
              <option v-for="days in expiryOptions" :key="days" :value="days">
                {{ t(`settings.appPasswords.create.expirationDays.${days}`) }}
              </option>
            </select>
            <p class="settings-hint">{{ t('settings.appPasswords.rotate.expirationHint') }}</p>
          </div>

          <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

          <div class="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" :disabled="props.saving" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="props.saving || !props.appPassword">
              <Loader2 v-if="props.saving" class="animate-spin" aria-hidden="true" />
              {{ submitLabel }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
