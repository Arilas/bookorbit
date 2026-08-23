<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Plus, X } from '@lucide/vue'
import { AUDIO_FORMAT_LIST, COMIC_FORMAT_LIST, EBOOK_FORMAT_LIST, MAX_RELEASE_TIERS } from '@bookorbit/types'
import type { BookRequestMediaKind, ReleaseFileLayout, ReleaseTier, ReleaseTierConditions } from '@bookorbit/types'
import { Button } from '@/components/ui/button'

/**
 * One medium's release profile: an ordered list of the shapes an operator will accept, best first.
 * Order is the whole meaning here, so reordering is a first-class control rather than a detail.
 */
const props = defineProps<{
  mediaKind: BookRequestMediaKind
  tiers: ReleaseTier[]
}>()

const emit = defineEmits<{ update: [mediaKind: BookRequestMediaKind, tiers: ReleaseTier[]] }>()

const { t } = useI18n()

/** Offered from the same lists the matcher accepts, so a form can never state an impossible tier. */
const FORMATS: Record<BookRequestMediaKind, readonly string[]> = {
  ebook: EBOOK_FORMAT_LIST,
  audiobook: AUDIO_FORMAT_LIST,
  comic: [...COMIC_FORMAT_LIST, 'pdf'],
}

/** Bitrate and channels describe an encode, which an ebook or a comic does not have. */
const isAudio = computed(() => props.mediaKind === 'audiobook')
const formats = computed(() => FORMATS[props.mediaKind])
const canAdd = computed(() => props.tiers.length < MAX_RELEASE_TIERS)
/**
 * Shown only once a tier actually sets a floor. MyAnonaMouse publishes MediaInfo for some torrents
 * and not others, so a floor silently matches nothing on a book nobody measured, and the fix - a
 * tier below it without one - is not something an operator would guess from an empty result.
 */
const warnsAboutBitrate = computed(() => props.tiers.some((tier) => tier.conditions.minBitrateKbps !== undefined))
const LAYOUTS: ReleaseFileLayout[] = ['single', 'multi']

function commit(tiers: ReleaseTier[]) {
  emit('update', props.mediaKind, tiers)
}

function patch(index: number, conditions: Partial<ReleaseTierConditions>) {
  commit(props.tiers.map((tier, i) => (i === index ? { ...tier, conditions: prune({ ...tier.conditions, ...conditions }) } : tier)))
}

/**
 * An absent key and an empty one mean different things to the matcher: `formats: []` would be
 * stored as a condition that constrains nothing, and a cleared number must stop being a floor
 * rather than become a floor of zero.
 */
function prune(conditions: ReleaseTierConditions): ReleaseTierConditions {
  const next: ReleaseTierConditions = { ...conditions }
  if (next.formats && next.formats.length === 0) delete next.formats
  if (next.minBitrateKbps === undefined || Number.isNaN(next.minBitrateKbps)) delete next.minBitrateKbps
  if (next.minSeeders === undefined || Number.isNaN(next.minSeeders)) delete next.minSeeders
  if (next.freeleechOnly === false) delete next.freeleechOnly
  if (next.excludeVipOnly === false) delete next.excludeVipOnly
  return next
}

function addTier() {
  if (!canAdd.value) return
  const tier: ReleaseTier = {
    id: crypto.randomUUID(),
    name: t('settings.system.requests.profiles.newTier', { position: props.tiers.length + 1 }),
    conditions: {},
  }
  commit([...props.tiers, tier])
}

function removeTier(index: number) {
  commit(props.tiers.filter((_, i) => i !== index))
}

/** Buttons rather than drag: the list is short, and this stays usable from a keyboard. */
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= props.tiers.length) return
  const next = [...props.tiers]
  const [moved] = next.splice(index, 1)
  if (!moved) return
  next.splice(target, 0, moved)
  commit(next)
}

function handleName(index: number, event: Event) {
  const name = (event.target as HTMLInputElement).value
  commit(props.tiers.map((tier, i) => (i === index ? { ...tier, name } : tier)))
}

function toggleFormat(index: number, format: string) {
  const current = props.tiers[index]?.conditions.formats ?? []
  const next = current.includes(format) ? current.filter((value) => value !== format) : [...current, format]
  patch(index, { formats: next })
}

function handleLayout(index: number, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  patch(index, { fileLayout: value === '' ? undefined : (value as ReleaseFileLayout) })
}

function handleNumber(index: number, key: 'minBitrateKbps' | 'minSeeders', event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  patch(index, { [key]: raw === '' ? undefined : Number(raw) })
}

function handleFreeleech(index: number, event: Event) {
  patch(index, { freeleechOnly: (event.target as HTMLInputElement).checked })
}

function handleExcludeVip(index: number, event: Event) {
  patch(index, { excludeVipOnly: (event.target as HTMLInputElement).checked })
}

function hasFormat(index: number, format: string): boolean {
  return (props.tiers[index]?.conditions.formats ?? []).includes(format)
}
</script>

<template>
  <div>
    <p v-if="tiers.length === 0" class="settings-hint settings-prose">
      {{ t('settings.system.requests.profiles.empty') }}
    </p>

    <ol v-else class="grid gap-2">
      <li v-for="(tier, index) in tiers" :key="tier.id" class="rounded-lg border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {{ index + 1 }}
          </span>

          <input
            :value="tier.name"
            type="text"
            class="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :aria-label="t('settings.system.requests.profiles.tierName')"
            :maxlength="60"
            @change="handleName(index, $event)"
          />

          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === 0"
              :aria-label="t('settings.system.requests.profiles.moveUp')"
              @click="move(index, -1)"
            >
              <ArrowUp :size="14" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === tiers.length - 1"
              :aria-label="t('settings.system.requests.profiles.moveDown')"
              @click="move(index, 1)"
            >
              <ArrowDown :size="14" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" :aria-label="t('settings.system.requests.profiles.removeTier')" @click="removeTier(index)">
              <X :size="14" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {{ t('settings.system.requests.profiles.formats') }}
            </span>
            <button
              v-for="format in formats"
              :key="format"
              type="button"
              class="rounded-full border px-2 py-0.5 text-xs uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              :class="
                hasFormat(index, format)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-ring hover:text-foreground'
              "
              :aria-pressed="hasFormat(index, format)"
              @click="toggleFormat(index, format)"
            >
              {{ format }}
            </button>
          </div>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.files') }}
            <select
              :value="tier.conditions.fileLayout ?? ''"
              class="rounded-md border border-input bg-background px-1.5 py-1 text-xs text-foreground"
              @change="handleLayout(index, $event)"
            >
              <option value="">{{ t('settings.system.requests.profiles.anyLayout') }}</option>
              <option v-for="layout in LAYOUTS" :key="layout" :value="layout">
                {{ t(`bookRequests.releases.fileLayout.${layout}`) }}
              </option>
            </select>
          </label>

          <label v-if="isAudio" class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.minBitrate') }}
            <input
              :value="tier.conditions.minBitrateKbps ?? ''"
              type="number"
              min="0"
              step="16"
              class="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
              @change="handleNumber(index, 'minBitrateKbps', $event)"
            />
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.minSeeders') }}
            <input
              :value="tier.conditions.minSeeders ?? ''"
              type="number"
              min="0"
              class="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
              @change="handleNumber(index, 'minSeeders', $event)"
            />
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              class="accent-primary"
              :checked="tier.conditions.freeleechOnly === true"
              @change="handleFreeleech(index, $event)"
            />
            {{ t('bookRequests.releases.freeleech') }}
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              class="accent-primary"
              :checked="tier.conditions.excludeVipOnly === true"
              @change="handleExcludeVip(index, $event)"
            />
            {{ t('bookRequests.releases.hideVipOnly') }}
          </label>
        </div>
      </li>
    </ol>

    <p v-if="warnsAboutBitrate" class="settings-hint settings-prose mt-2">
      {{ t('settings.system.requests.profiles.bitrateNote') }}
    </p>

    <Button variant="outline" size="sm" class="mt-2.5" :disabled="!canAdd" @click="addTier">
      <Plus :size="14" aria-hidden="true" />
      {{ t('settings.system.requests.profiles.addTier') }}
    </Button>
  </div>
</template>
