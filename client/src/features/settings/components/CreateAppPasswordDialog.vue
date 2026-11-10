<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { CreateAppPasswordRequest } from '@bookorbit/types'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: CreateAppPasswordRequest]
}>()

const { t } = useI18n()
const label = ref('')
const expiryDays = ref(365)
const expiryOptions = [30, 90, 180, 365] as const

const trimmedLabel = computed(() => label.value.trim())
const canSubmit = computed(() => !props.saving && trimmedLabel.value.length > 0 && trimmedLabel.value.length <= 100)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    label.value = ''
    expiryDays.value = 365
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
  if (!canSubmit.value) return
  const expiresAt = new Date(Date.now() + expiryDays.value * 24 * 60 * 60 * 1000).toISOString()
  emit('submit', { label: trimmedLabel.value, expiresAt })
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
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('settings.appPasswords.create.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.appPasswords.create.description') }}
        </DialogDescription>

        <form class="mt-5 space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-1.5">
            <label for="app-password-label" class="settings-label">{{ t('settings.appPasswords.create.label') }}</label>
            <input
              id="app-password-label"
              v-model="label"
              type="text"
              maxlength="100"
              autocomplete="off"
              class="input-field w-full"
              :placeholder="t('settings.appPasswords.create.labelPlaceholder')"
              autofocus
            />
            <p class="settings-hint">{{ t('settings.appPasswords.create.labelHint') }}</p>
          </div>

          <div class="space-y-1.5">
            <label for="app-password-expiry" class="settings-label">{{ t('settings.appPasswords.create.expiration') }}</label>
            <select id="app-password-expiry" v-model="expiryDays" class="select-field w-full">
              <option v-for="days in expiryOptions" :key="days" :value="days">
                {{ t(`settings.appPasswords.create.expirationDays.${days}`) }}
              </option>
            </select>
            <p class="settings-hint">{{ t('settings.appPasswords.create.expirationHint') }}</p>
          </div>

          <p class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {{ t('settings.appPasswords.create.deviceGuidance') }}
          </p>
          <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

          <div class="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" :disabled="props.saving" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="!canSubmit">
              <Loader2 v-if="props.saving" class="animate-spin" aria-hidden="true" />
              {{ props.saving ? t('settings.appPasswords.create.creating') : t('settings.appPasswords.create.action') }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
