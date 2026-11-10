<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Check, Copy } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'

const props = withDefaults(
  defineProps<{
    open: boolean
    label: string
    password: string
    mode?: 'created' | 'rotated'
  }>(),
  { mode: 'created' },
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const copied = ref(false)
const copyFailed = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

const title = computed(() => t(props.mode === 'rotated' ? 'settings.appPasswords.rotate.completedTitle' : 'settings.appPasswords.created.title'))
const description = computed(() =>
  t(props.mode === 'rotated' ? 'settings.appPasswords.rotate.completedDescription' : 'settings.appPasswords.created.description', {
    label: props.label,
  }),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    copied.value = false
    copyFailed.value = false
  },
)

onUnmounted(() => {
  if (feedbackTimer) clearTimeout(feedbackTimer)
})

function clearFeedbackLater(): void {
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => {
    copied.value = false
    copyFailed.value = false
    feedbackTimer = null
  }, 2000)
}

async function handleCopy(): Promise<void> {
  const didCopy = await copyToClipboard(props.password)
  copied.value = didCopy
  copyFailed.value = !didCopy
  clearFeedbackLater()
}

function handleOpenChange(open: boolean): void {
  if (!open) emit('close')
}

function handleClose(): void {
  emit('close')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ title }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription>

        <div class="mt-5 space-y-4">
          <div class="flex items-start gap-2 rounded-md border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-3 py-2">
            <AlertTriangle :size="16" class="mt-0.5 shrink-0 text-[var(--pill-warning)]" aria-hidden="true" />
            <p class="text-xs text-[var(--pill-warning)]">{{ t('settings.appPasswords.created.oneTimeWarning') }}</p>
          </div>

          <div class="space-y-1.5">
            <label for="created-app-password" class="settings-label">{{ t('settings.appPasswords.created.passwordLabel') }}</label>
            <div class="flex gap-2">
              <input
                id="created-app-password"
                :value="props.password"
                type="text"
                readonly
                class="input-field min-w-0 flex-1 font-mono text-xs"
                data-testid="created-app-password"
              />
              <Button type="button" variant="outline" class="shrink-0" @click="handleCopy">
                <Check v-if="copied" :size="15" aria-hidden="true" />
                <Copy v-else :size="15" aria-hidden="true" />
                {{ copied ? t('settings.appPasswords.created.copied') : t('settings.appPasswords.created.copy') }}
              </Button>
            </div>
            <p v-if="copyFailed" role="alert" class="text-xs text-destructive">{{ t('settings.appPasswords.errors.copy') }}</p>
          </div>

          <p class="settings-hint">{{ t('settings.appPasswords.created.usageHint') }}</p>

          <div class="flex justify-end pt-1">
            <Button type="button" @click="handleClose">{{ t('settings.appPasswords.created.done') }}</Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
