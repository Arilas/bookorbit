<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AppPassword, CreateAppPasswordRequest, RotateAppPasswordRequest } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatDate, formatDateTime, formatNumber } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'
import AppPasswordCreatedDialog from './components/AppPasswordCreatedDialog.vue'
import CreateAppPasswordDialog from './components/CreateAppPasswordDialog.vue'
import RotateAppPasswordDialog from './components/RotateAppPasswordDialog.vue'
import { useAppPasswords } from './composables/useAppPasswords'

const HEADER_ACTIONS_TARGET = '#settings-header-actions'

const { t } = useI18n()
const { appPasswords, loading, loaded, creating, rotatingId, revokingId, loadError, load, create, rotate, revoke } = useAppPasswords()

const headerSlotAvailable = ref(false)
const createOpen = ref(false)
const createError = ref<string | null>(null)
const createdPassword = ref('')
const createdLabel = ref('')
const createdMode = ref<'created' | 'rotated'>('created')
const rotateTarget = ref<AppPassword | null>(null)
const rotateError = ref<string | null>(null)
const revokeTarget = ref<AppPassword | null>(null)
const revokeError = ref<string | null>(null)

const rows = computed(() =>
  [...appPasswords.value].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'active' ? -1 : 1
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  }),
)

const revokeDescription = computed(() => {
  if (!revokeTarget.value) return ''
  return t('settings.appPasswords.revoke.description', {
    label: revokeTarget.value.label,
    count: revokeTarget.value.activeSessions,
  })
})

onMounted(() => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  void load()
})

onUnmounted(() => {
  createdPassword.value = ''
})

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function openCreate(): void {
  createError.value = null
  createOpen.value = true
}

function handleCreateOpenChange(open: boolean): void {
  createOpen.value = open
  if (open) createError.value = null
}

async function handleCreate(payload: CreateAppPasswordRequest): Promise<void> {
  createError.value = null
  try {
    const result = await create(payload)
    createOpen.value = false
    createdLabel.value = result.appPassword.label
    createdPassword.value = result.password
    createdMode.value = 'created'
    toast.success(t('settings.appPasswords.feedback.created'))
  } catch (error) {
    createError.value = errorMessage(error, t('settings.appPasswords.errors.create'))
  }
}

function closeCreatedPassword(): void {
  createdPassword.value = ''
  createdLabel.value = ''
  createdMode.value = 'created'
}

function requestRotate(appPassword: AppPassword): void {
  rotateError.value = null
  rotateTarget.value = appPassword
}

function handleRotateOpenChange(open: boolean): void {
  if (!open && rotatingId.value === null) {
    rotateTarget.value = null
    rotateError.value = null
  }
}

async function handleRotate(payload: RotateAppPasswordRequest): Promise<void> {
  const target = rotateTarget.value
  if (!target) return
  rotateError.value = null
  try {
    const result = await rotate(target.id, payload)
    rotateTarget.value = null
    createdLabel.value = result.appPassword.label
    createdPassword.value = result.password
    createdMode.value = 'rotated'
    toast.success(t(target.status === 'expired' ? 'settings.appPasswords.feedback.renewed' : 'settings.appPasswords.feedback.rotated'))
  } catch (error) {
    rotateError.value = errorMessage(error, t('settings.appPasswords.errors.rotate'))
  }
}

function requestRevoke(appPassword: AppPassword): void {
  revokeError.value = null
  revokeTarget.value = appPassword
}

function cancelRevoke(): void {
  if (revokingId.value === null) revokeTarget.value = null
}

async function handleRevoke(): Promise<void> {
  if (!revokeTarget.value) return
  revokeError.value = null
  try {
    await revoke(revokeTarget.value.id)
    revokeTarget.value = null
    toast.success(t('settings.appPasswords.feedback.revoked'))
  } catch (error) {
    revokeError.value = errorMessage(error, t('settings.appPasswords.errors.revoke'))
    toast.error(revokeError.value)
  }
}

function handleRetry(): void {
  void load()
}

function formatCalendarDate(value: string): string {
  return formatDate(new Date(value), { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatLastUsed(value: string | null): string {
  return value ? relativeTimestamp(value) : t('settings.appPasswords.neverUsed')
}

function statusClass(status: AppPassword['status']): string {
  return status === 'active'
    ? 'border-[var(--pill-success)]/40 bg-[var(--pill-success)]/10 text-[var(--pill-success)]'
    : 'border-border bg-muted text-muted-foreground'
}

function rotationActionLabel(appPassword: AppPassword): string {
  return t(appPassword.status === 'expired' ? 'settings.appPasswords.rotate.renewAction' : 'settings.appPasswords.rotate.action')
}
</script>

<template>
  <div class="space-y-5">
    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <Button size="sm" type="button" class="max-sm:size-8 max-sm:p-0" @click="openCreate">
        <Plus :size="14" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t('settings.appPasswords.create.action') }}</span>
      </Button>
    </Teleport>

    <div class="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-4 shadow-xs md:px-5">
      <ShieldCheck :size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0">
        <p class="settings-label">{{ t('settings.appPasswords.guidance.title') }}</p>
        <p class="settings-hint">{{ t('settings.appPasswords.guidance.description') }}</p>
      </div>
    </div>

    <div v-if="loadError && !loaded" role="alert" class="space-y-3 settings-error-state">
      <p>{{ t('settings.appPasswords.errors.load') }}</p>
      <Button variant="outline" size="sm" type="button" @click="handleRetry">
        <RefreshCw :size="14" aria-hidden="true" />
        {{ t('common.retry') }}
      </Button>
    </div>
    <p v-else-if="loading && !loaded" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>

    <template v-else>
      <p v-if="loadError" role="alert" class="settings-error-state">{{ t('settings.appPasswords.errors.load') }}</p>

      <div v-if="rows.length === 0" class="settings-empty-state" data-testid="app-passwords-empty">
        <KeyRound :size="32" class="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.appPasswords.empty.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.appPasswords.empty.description') }}</p>
        <Button size="sm" type="button" class="mt-4" @click="openCreate">
          <Plus :size="14" aria-hidden="true" />
          {{ t('settings.appPasswords.create.action') }}
        </Button>
      </div>

      <template v-else>
        <section aria-labelledby="app-passwords-list-heading" class="space-y-2">
          <h2 id="app-passwords-list-heading" class="settings-group-label mb-0">{{ t('settings.appPasswords.listTitle') }}</h2>

          <div class="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-xs md:block" data-testid="app-passwords-table">
            <table class="w-full min-w-[1040px] table-fixed text-sm">
              <colgroup>
                <col class="w-[21%]" />
                <col class="w-[9%]" />
                <col class="w-[12%]" />
                <col class="w-[12%]" />
                <col class="w-[18%]" />
                <col class="w-[8%]" />
                <col class="w-[20%]" />
              </colgroup>
              <thead class="bg-muted/50 text-muted-foreground">
                <tr>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.app') }}</th>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.status') }}</th>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.created') }}</th>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.expires') }}</th>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.lastUsed') }}</th>
                  <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.appPasswords.columns.sessions') }}</th>
                  <th class="px-3 py-2 text-end text-xs font-medium">{{ t('settings.appPasswords.columns.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <tr v-for="appPassword in rows" :key="appPassword.id" class="bg-card hover:bg-muted/30">
                  <td class="px-3 py-3">
                    <div class="flex min-w-0 items-center gap-2">
                      <KeyRound :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div class="min-w-0">
                        <p class="truncate font-medium text-foreground">{{ appPassword.label }}</p>
                        <p class="truncate text-xs text-muted-foreground">
                          {{ t('settings.appPasswords.passwordHint', { hint: appPassword.hint }) }}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td class="px-3 py-3">
                    <span class="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium" :class="statusClass(appPassword.status)">
                      {{ t(`settings.appPasswords.status.${appPassword.status}`) }}
                    </span>
                  </td>
                  <td class="px-3 py-3 text-xs text-muted-foreground">
                    <time :datetime="appPassword.createdAt" :title="formatDateTime(new Date(appPassword.createdAt))">
                      {{ formatCalendarDate(appPassword.createdAt) }}
                    </time>
                  </td>
                  <td class="px-3 py-3 text-xs" :class="appPassword.status === 'expired' ? 'text-destructive' : 'text-muted-foreground'">
                    <time :datetime="appPassword.expiresAt" :title="formatDateTime(new Date(appPassword.expiresAt))">
                      {{ formatCalendarDate(appPassword.expiresAt) }}
                    </time>
                  </td>
                  <td class="px-3 py-3 text-xs text-muted-foreground">
                    <time v-if="appPassword.lastUsedAt" :datetime="appPassword.lastUsedAt" :title="formatDateTime(new Date(appPassword.lastUsedAt))">
                      {{ formatLastUsed(appPassword.lastUsedAt) }}
                    </time>
                    <span v-else>{{ formatLastUsed(null) }}</span>
                    <p v-if="appPassword.lastUsedIp" class="mt-0.5 truncate font-mono text-[11px]">{{ appPassword.lastUsedIp }}</p>
                  </td>
                  <td class="px-3 py-3 text-xs tabular-nums text-muted-foreground">{{ formatNumber(appPassword.activeSessions) }}</td>
                  <td class="px-3 py-3 text-end">
                    <div class="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        :disabled="rotatingId !== null || revokingId !== null"
                        @click="requestRotate(appPassword)"
                      >
                        <RefreshCw :size="14" aria-hidden="true" />
                        {{ rotationActionLabel(appPassword) }}
                      </Button>
                      <Button
                        variant="destructive-ghost"
                        size="sm"
                        type="button"
                        :disabled="rotatingId !== null || revokingId !== null"
                        @click="requestRevoke(appPassword)"
                      >
                        <Trash2 :size="14" aria-hidden="true" />
                        {{ t('settings.appPasswords.revoke.action') }}
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="space-y-2 md:hidden" data-testid="app-passwords-cards">
            <article v-for="appPassword in rows" :key="appPassword.id" class="rounded-lg border border-border bg-card p-4 shadow-xs">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <KeyRound :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <p class="truncate text-sm font-medium text-foreground">{{ appPassword.label }}</p>
                  </div>
                  <p class="mt-1 truncate text-xs text-muted-foreground">
                    {{ t('settings.appPasswords.passwordHint', { hint: appPassword.hint }) }}
                  </p>
                </div>
                <span class="inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium" :class="statusClass(appPassword.status)">
                  {{ t(`settings.appPasswords.status.${appPassword.status}`) }}
                </span>
              </div>

              <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-xs">
                <div>
                  <dt class="text-muted-foreground">{{ t('settings.appPasswords.columns.expires') }}</dt>
                  <dd class="mt-0.5 text-foreground">{{ formatCalendarDate(appPassword.expiresAt) }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">{{ t('settings.appPasswords.columns.lastUsed') }}</dt>
                  <dd class="mt-0.5 text-foreground">{{ formatLastUsed(appPassword.lastUsedAt) }}</dd>
                  <dd v-if="appPassword.lastUsedIp" class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {{ appPassword.lastUsedIp }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">{{ t('settings.appPasswords.columns.sessions') }}</dt>
                  <dd class="mt-0.5 text-foreground">{{ formatNumber(appPassword.activeSessions) }}</dd>
                </div>
              </dl>

              <div class="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  :disabled="rotatingId !== null || revokingId !== null"
                  @click="requestRotate(appPassword)"
                >
                  <RefreshCw :size="14" aria-hidden="true" />
                  {{ rotationActionLabel(appPassword) }}
                </Button>
                <Button
                  variant="destructive-outline"
                  size="sm"
                  type="button"
                  :disabled="rotatingId !== null || revokingId !== null"
                  @click="requestRevoke(appPassword)"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                  {{ t('settings.appPasswords.revoke.action') }}
                </Button>
              </div>
            </article>
          </div>
        </section>
      </template>
    </template>
  </div>

  <CreateAppPasswordDialog :open="createOpen" :saving="creating" :error="createError" @update:open="handleCreateOpenChange" @submit="handleCreate" />
  <RotateAppPasswordDialog
    :open="rotateTarget !== null"
    :app-password="rotateTarget"
    :saving="rotatingId !== null"
    :error="rotateError"
    @update:open="handleRotateOpenChange"
    @submit="handleRotate"
  />
  <AppPasswordCreatedDialog
    :open="createdPassword.length > 0"
    :label="createdLabel"
    :password="createdPassword"
    :mode="createdMode"
    @close="closeCreatedPassword"
  />
  <ConfirmDialog
    :open="revokeTarget !== null"
    :title="t('settings.appPasswords.revoke.title')"
    :description="revokeDescription"
    :confirm-label="revokingId !== null ? t('settings.appPasswords.revoke.revoking') : t('settings.appPasswords.revoke.action')"
    :busy="revokingId !== null"
    @confirm="handleRevoke"
    @cancel="cancelRevoke"
  >
    <p v-if="revokeError" role="alert" class="mt-3 text-sm text-destructive">{{ revokeError }}</p>
  </ConfirmDialog>
</template>
