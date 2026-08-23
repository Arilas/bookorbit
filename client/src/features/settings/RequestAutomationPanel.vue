<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { BOOK_REQUEST_IMPORT_FORMATS, BOOK_REQUEST_MEDIA_KINDS, MAX_AUTO_GRAB_ATTEMPTS_LIMIT, MIN_AUTO_GRAB_SCORE_FLOOR } from '@bookorbit/types'
import type { BookRequestImportFormats, BookRequestMediaKind, ReleaseTier, RequestDestination } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ReleaseProfileEditor from './components/ReleaseProfileEditor.vue'
import RequestDestinationRow from './components/RequestDestinationRow.vue'
import SettingsRow from './components/SettingsRow.vue'
import SettingsSlider from './components/SettingsSlider.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useRequestAutomation } from '@/features/book-requests/composables/useRequestAutomation'

const { t } = useI18n()

const { settings, loading, loadFailed, fetchSettings, save } = useRequestAutomation()
const { libraries, fetchLibraries } = useLibraries()

const MEDIA_KINDS = BOOK_REQUEST_MEDIA_KINDS

/**
 * The sliders are dragged, so they need a local value to move against. Everything else writes
 * straight through, and every save adopts what the server reports back.
 */
const minScore = ref(settings.value.autoGrabMinScore)
const attempts = ref(settings.value.maxAutoGrabAttempts)
const threshold = ref(settings.value.verificationThreshold)

watch(settings, (next) => {
  minScore.value = next.autoGrabMinScore
  attempts.value = next.maxAutoGrabAttempts
  threshold.value = next.verificationThreshold
})

onMounted(fetchSettings)
onMounted(fetchLibraries)

/**
 * What this server will actually do to an approved request, in one sentence. Assembled from the
 * dragged values rather than the saved ones so it answers the question while the slider moves.
 */
const downloadsSummary = computed(() => {
  if (!settings.value.autoGrabEnabled) return t('settings.system.requests.automation.summaryOff')
  const score = minScore.value
  if (!settings.value.autoRetryEnabled) return t('settings.system.requests.automation.summaryNoRetry', { score })
  const count = Number.isInteger(attempts.value) ? attempts.value : settings.value.maxAutoGrabAttempts
  return t('settings.system.requests.automation.summaryRetry', { score, count })
})

const importsSummary = computed(() =>
  settings.value.verificationEnabled ? t('settings.system.requests.automation.verifyOnHint') : t('settings.system.requests.automation.verifyOffHint'),
)

function stateLabel(enabled: boolean) {
  return enabled ? t('settings.system.requests.automation.stateOn') : t('settings.system.requests.automation.stateOff')
}

async function persist(payload: Parameters<typeof save>[0], successKey: string) {
  if (await save(payload)) toast.success(t(successKey))
  else toast.error(t('settings.system.requests.automation.saveFailed'))
}

function handleAutoGrabChange(enabled: boolean) {
  void persist(
    { autoGrabEnabled: enabled },
    enabled ? 'settings.system.requests.automation.autoGrabEnabled' : 'settings.system.requests.automation.autoGrabDisabled',
  )
}

/**
 * Radios rather than a toggle: neither value is the "off" one, and a switch would have to pick a
 * side to be off. Both are ordinary choices about what a library should hold.
 */
const IMPORT_FORMAT_OPTIONS = BOOK_REQUEST_IMPORT_FORMATS

function handleImportFormatsChange(importFormats: BookRequestImportFormats) {
  void persist({ importFormats }, 'settings.system.requests.automation.saved')
}

/**
 * One medium at a time, so changing where audiobooks go cannot resend, and therefore cannot
 * clobber, a destination somebody else set for ebooks between this page loading and saving.
 */
function handleDestinationChange(mediaKind: BookRequestMediaKind, destination: RequestDestination) {
  void persist({ destinations: { [mediaKind]: destination } }, 'settings.system.requests.automation.saved')
}

/**
 * One medium at a time, for the same reason destinations are: a profile is an ordered list, and
 * resending all three would clobber a list somebody else reordered between this page loading and
 * this one saving.
 */
function handleProfileChange(mediaKind: BookRequestMediaKind, tiers: ReleaseTier[]) {
  void persist({ profiles: { [mediaKind]: tiers } }, 'settings.system.requests.automation.saved')
}

function handleAutoRetryChange(enabled: boolean) {
  void persist({ autoRetryEnabled: enabled }, 'settings.system.requests.automation.saved')
}

function handleMinScoreChange() {
  void persist({ autoGrabMinScore: minScore.value }, 'settings.system.requests.automation.saved')
}

/**
 * `v-model.number` hands back an empty string for a cleared box, and the spinner does not clamp
 * what is typed into it. Anything the endpoint would reject is put back to the running value
 * rather than sent for a 400.
 */
function handleAttemptsChange() {
  const next = Number(attempts.value)
  if (!Number.isInteger(next) || next < 1 || next > MAX_AUTO_GRAB_ATTEMPTS_LIMIT) {
    attempts.value = settings.value.maxAutoGrabAttempts
    return
  }
  void persist({ maxAutoGrabAttempts: next }, 'settings.system.requests.automation.saved')
}

function handleThresholdChange() {
  void persist({ verificationThreshold: threshold.value }, 'settings.system.requests.automation.saved')
}

function handleVerificationChange(enabled: boolean) {
  void persist(
    { verificationEnabled: enabled },
    enabled ? 'settings.system.requests.automation.verificationEnabled' : 'settings.system.requests.automation.verificationDisabled',
  )
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
    <span class="sr-only">{{ t('settings.system.requests.automation.loading') }}</span>
  </div>

  <section v-else aria-labelledby="request-automation-heading" class="space-y-3">
    <h2 id="request-automation-heading" class="sr-only">{{ t('settings.system.requests.automation.title') }}</h2>

    <p v-if="loadFailed" role="alert" class="text-sm text-destructive">{{ t('settings.system.requests.automation.loadFailed') }}</p>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.automation.groupDownloads') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.autoGrabEnabled) }}</span>
      </div>

      <p class="settings-hint settings-prose bg-card px-4 py-3 md:px-5">{{ downloadsSummary }}</p>

      <SettingsRow :label="t('settings.system.requests.automation.autoGrab')">
        <ToggleSwitch
          :model-value="settings.autoGrabEnabled"
          :aria-label="t('settings.system.requests.automation.autoGrab')"
          @update:model-value="handleAutoGrabChange"
        />
      </SettingsRow>

      <div v-if="settings.autoGrabEnabled" class="settings-subgroup ml-4 md:ml-5">
        <SettingsRow
          class="pl-3 md:pl-4"
          control-id="auto-grab-min-score"
          :label="t('settings.system.requests.automation.minScore')"
          :hint="t('settings.system.requests.automation.minScoreShort')"
        >
          <SettingsSlider
            id="auto-grab-min-score"
            v-model="minScore"
            :min="MIN_AUTO_GRAB_SCORE_FLOOR"
            :max="100"
            :step="5"
            @change="handleMinScoreChange"
          />
        </SettingsRow>

        <SettingsRow
          class="pl-3 md:pl-4"
          :label="t('settings.system.requests.automation.autoRetry')"
          :hint="t('settings.system.requests.automation.autoRetryShort')"
        >
          <ToggleSwitch
            :model-value="settings.autoRetryEnabled"
            :aria-label="t('settings.system.requests.automation.autoRetry')"
            @update:model-value="handleAutoRetryChange"
          />
        </SettingsRow>

        <SettingsRow
          class="pl-3 md:pl-4"
          control-id="auto-grab-attempts"
          :label="t('settings.system.requests.automation.maxAttempts')"
          :hint="t('settings.system.requests.automation.maxAttemptsShort')"
        >
          <input
            id="auto-grab-attempts"
            v-model.number="attempts"
            type="number"
            inputmode="numeric"
            min="1"
            :max="MAX_AUTO_GRAB_ATTEMPTS_LIMIT"
            step="1"
            class="input-field w-20"
            @change="handleAttemptsChange"
          />
        </SettingsRow>
      </div>

      <details class="group bg-card px-4 py-3 md:px-5">
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight class="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          {{ t('settings.system.requests.automation.howDownloads') }}
        </summary>
        <div class="mt-2 space-y-2 settings-prose">
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoGrabHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.minScoreHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoRetryHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.maxAttemptsHint') }}</p>
        </div>
      </details>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.automation.groupImports') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.verificationEnabled) }}</span>
      </div>

      <p class="settings-hint settings-prose bg-card px-4 py-3 md:px-5">{{ importsSummary }}</p>

      <SettingsRow :label="t('settings.system.requests.automation.verify')">
        <ToggleSwitch
          :model-value="settings.verificationEnabled"
          :aria-label="t('settings.system.requests.automation.verify')"
          @update:model-value="handleVerificationChange"
        />
      </SettingsRow>

      <SettingsRow
        v-if="settings.verificationEnabled"
        class="settings-subgroup ml-4 pl-3 md:ml-5 md:pl-4"
        control-id="request-verification-threshold"
        :label="t('settings.system.requests.automation.verification')"
        :hint="t('settings.system.requests.automation.verificationShort')"
      >
        <SettingsSlider id="request-verification-threshold" v-model="threshold" :min="0" :max="100" :step="5" @change="handleThresholdChange" />
      </SettingsRow>

      <details class="group bg-card px-4 py-3 md:px-5">
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight class="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          {{ t('settings.system.requests.automation.howImports') }}
        </summary>
        <div class="mt-2 space-y-2 settings-prose">
          <p class="settings-hint">{{ t('settings.system.requests.automation.pipeline') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.verificationHint') }}</p>
        </div>
      </details>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.automation.destinations') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.automation.destinationsHint') }}</p>

          <div class="mt-3 grid gap-3">
            <RequestDestinationRow
              v-for="mediaKind in MEDIA_KINDS"
              :key="mediaKind"
              :media-kind="mediaKind"
              :libraries="libraries"
              :destination="settings.destinations[mediaKind]"
              @update="handleDestinationChange"
            />
          </div>
        </div>
      </fieldset>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.profiles.title') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.profiles.hint') }}</p>

          <div class="mt-3 grid gap-4">
            <div v-for="mediaKind in MEDIA_KINDS" :key="mediaKind">
              <h3 class="text-xs font-medium text-foreground">{{ t(`bookRequests.mediaKind.${mediaKind}`) }}</h3>
              <div class="mt-1.5">
                <ReleaseProfileEditor :media-kind="mediaKind" :tiers="settings.profiles[mediaKind]" @update="handleProfileChange" />
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.automation.importFormats') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.automation.importFormatsHint') }}</p>

          <div class="mt-3 grid gap-2">
            <label v-for="option in IMPORT_FORMAT_OPTIONS" :key="option" class="flex items-start gap-2.5">
              <input
                type="radio"
                name="import-formats"
                class="mt-0.5 accent-primary"
                :value="option"
                :checked="settings.importFormats === option"
                @change="handleImportFormatsChange(option)"
              />
              <span class="min-w-0 settings-prose">
                <span class="block text-xs font-medium text-foreground">
                  {{ t(`settings.system.requests.automation.importFormatsOption.${option}`) }}
                </span>
                <span class="settings-hint block">
                  {{ t(`settings.system.requests.automation.importFormatsOption.${option}Hint`) }}
                </span>
              </span>
            </label>
          </div>
        </div>
      </fieldset>
    </div>
  </section>
</template>
