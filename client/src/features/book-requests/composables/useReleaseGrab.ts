import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { findGrabRefusal, releaseInspectionBlocksGrab } from '@bookorbit/types'
import type {
  BookRequestItem,
  GrabBookRequestPayload,
  GrabFailureCode,
  GrabRefusal,
  ReleaseCandidateItem,
  ReleaseFileInspection,
} from '@bookorbit/types'

/** Only the refusals that rule another release out get a note; the rest are about one row. */
const REFUSAL_KEYS: Partial<Record<GrabFailureCode, string>> = {
  GRAB_SOURCE_REFUSED: 'sourceRefused',
  GRAB_SOURCE_UNAVAILABLE: 'sourceUnavailable',
  GRAB_VIP_REQUIRED: 'vipRequired',
  GRAB_CLIENT_REFUSED: 'clientRefused',
}

export interface ReleaseGrabOptions {
  request: Ref<BookRequestItem | null>
  requestId: Ref<number>
  grab: (id: number, body: GrabBookRequestPayload) => Promise<BookRequestItem | null>
  /** Why the last grab was refused, as the server classified it and as it worded it. */
  lastErrorCode: Ref<GrabFailureCode | null>
  lastReason: Ref<string | null>
  setRequest: (value: BookRequestItem) => void
  inspectRelease: (requestId: number, release: ReleaseCandidateItem) => Promise<ReleaseFileInspection | null>
  /** Opens a row's file list, which is where a blocked inspection explains itself. */
  setFilesExpanded: (release: ReleaseCandidateItem, expanded: boolean) => void
  /** Whether this release's source joins a swarm, which decides if a client refusal generalises. */
  seedsBack: (release: ReleaseCandidateItem) => boolean
}

/**
 * Sending a release, and remembering what this visit was already told.
 *
 * A tracker that refuses one release refuses the rest of its list the same way, and clicking down
 * a source's rows to collect the same 406 four times is the part worth taking off the approver.
 */
export function useReleaseGrab(options: ReleaseGrabOptions) {
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { request, requestId, grab, lastErrorCode, lastReason, setRequest, inspectRelease, setFilesExpanded, seedsBack } = options

  const manualOpen = ref(false)
  const refusals = ref<GrabRefusal[]>([])

  function openManual() {
    manualOpen.value = true
  }

  function closeManual() {
    manualOpen.value = false
  }

  /** A fresh search is also how an approver retries a source that was merely slow. */
  function forgetRefusals() {
    refusals.value = []
  }

  /** A sent release leaves nothing to pick, so the drawer pops back to the request it belongs to. */
  async function submitGrab(body: GrabBookRequestPayload) {
    if (!request.value) return
    const updated = await grab(request.value.id, body)
    if (!updated) {
      rememberRefusal(body)
      toast.error(t('bookRequests.errors.grabFailed'), lastReason.value ? { description: lastReason.value } : undefined)
      return
    }
    setRequest(updated)
    manualOpen.value = false
    toast.success(t('bookRequests.toasts.grabbed'))
    void router.push({ name: 'book-request-detail', params: { id: request.value.id }, query: route.query })
  }

  async function handleGrab(release: ReleaseCandidateItem): Promise<void> {
    const inspection = await inspectRelease(requestId.value, release)
    if (!inspection || releaseInspectionBlocksGrab(inspection.status)) {
      setFilesExpanded(release, true)
      return
    }

    await submitGrab({
      indexerId: release.indexerId,
      releaseGuid: release.guid,
    })
  }

  function handleManualGrab(payload: { request: BookRequestItem; body: GrabBookRequestPayload }) {
    void submitGrab(payload.body)
  }

  /** Only a refusal the server classified; anything else says nothing about the other releases. */
  function rememberRefusal(body: GrabBookRequestPayload) {
    const code = lastErrorCode.value
    if (!code) return
    refusals.value = [...refusals.value, { indexerId: body.indexerId ?? null, code }]
  }

  function refusalFor(release: ReleaseCandidateItem): GrabRefusal | null {
    return findGrabRefusal({ indexerId: release.indexerId, vipOnly: release.vipOnly, seedsBack: seedsBack(release) }, refusals.value)
  }

  function isRefused(release: ReleaseCandidateItem): boolean {
    return refusalFor(release) !== null
  }

  function refusalText(release: ReleaseCandidateItem): string | null {
    const refusal = refusalFor(release)
    const key = refusal ? REFUSAL_KEYS[refusal.code] : undefined
    return key ? t(`bookRequests.releases.refused.${key}`) : null
  }

  return { manualOpen, refusals, openManual, closeManual, forgetRefusals, submitGrab, handleGrab, handleManualGrab, isRefused, refusalText }
}
