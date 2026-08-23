import { onUnmounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { bookRequestSubmitErrorCode } from '@bookorbit/types'
import type {
  BookRequestAvailability,
  BookRequestFailureMeta,
  BookRequestItem,
  BookRequestMediaKind,
  BookRequestMetadataSource,
  BookRequestSubmitErrorCode,
  CreateBookRequestPayload,
  MetadataCandidate,
} from '@bookorbit/types'

/** Stands in for a candidate key while a free-text submission is in flight; there is no candidate. */
const FREE_TEXT_KEY = '__free_text__'

/** Providers stream in; annotate in bounded batches rather than one call per arriving result. */
const ANNOTATE_BATCH_LIMIT = 50

/**
 * A search streams a dozen providers in over several seconds, and the results array changes
 * identity on every arrival. Coalescing the arrivals inside this window is what keeps that from
 * becoming one availability round trip per candidate.
 */
const ANNOTATE_COALESCE_MS = 150

/**
 * Why the server refused, in the two forms it can answer with.
 *
 * `code` is the one the form renders: every rule this instance applies has one, so the reason is
 * translated rather than repeated in English. `message` survives only as the fallback for a
 * refusal nothing has classified, which is what an unrecognised code and a validation error both
 * come back as.
 */
export interface SubmitFailure {
  code: BookRequestSubmitErrorCode | null
  meta: BookRequestFailureMeta | null
  message: string | null
}

const UNCLASSIFIED_FAILURE: SubmitFailure = { code: null, meta: null, message: null }

async function submitFailure(res: Response): Promise<SubmitFailure> {
  try {
    const body = (await res.json()) as { message?: string | string[]; errorCode?: unknown; errorMeta?: BookRequestFailureMeta }
    const message = Array.isArray(body.message) ? body.message[0] : body.message
    return { code: bookRequestSubmitErrorCode(body.errorCode), meta: body.errorMeta ?? null, message: message ?? null }
  } catch {
    return UNCLASSIFIED_FAILURE
  }
}

/**
 * What to show somebody whose submission was refused, in their language where the server said
 * enough for that to be possible.
 *
 * The code wins wherever there is one: the sentence beside it is English written at the point of
 * refusal and was only ever the fallback. It is still the right fallback, because a validation
 * error naming the field beats "that did not work".
 *
 * `t` is injected so this stays a pure function of the failure, testable without standing up i18n.
 */
export function submitFailureText(failure: SubmitFailure | null, t: (key: string, named: Record<string, unknown>) => string): string | null {
  if (!failure) return null
  if (failure.code) return t(`bookRequests.submitError.${failure.code}`, failure.meta ?? {})
  return failure.message
}

export function candidateKey(candidate: MetadataCandidate): string {
  return `${candidate.provider}:${candidate.providerId}`
}

export function candidateTitle(candidate: MetadataCandidate): string {
  return candidate.displayTitle ?? candidate.title ?? ''
}

export function useRequestSubmission() {
  const availability = ref<Record<string, BookRequestAvailability>>({})
  /**
   * Why the last submission was refused, so the page can say the specific reason rather than
   * replacing it with "that did not work". A self-serve request can be turned down for reasons
   * only the server knows: too many downloads already in flight, or a destination the requester
   * cannot reach.
   */
  const lastFailure = ref<SubmitFailure | null>(null)
  const submitting = ref<string | null>(null)
  const mediaKind = ref<BookRequestMediaKind>('ebook')

  /** Claimed keys, in flight or already answered, so a candidate is never asked about twice. */
  let claimed = new Set<string>()
  let queue: MetadataCandidate[] = []
  let coalesceHandle: ReturnType<typeof setTimeout> | null = null
  let draining = false
  /** Bumped whenever the question changes, so an answer to the old one is discarded. */
  let generation = 0

  /**
   * Queues a page of candidates for "already in your library" and "already requested". Results
   * arriving one provider at a time collapse into a small number of batched round trips.
   */
  function annotate(candidates: MetadataCandidate[]): void {
    for (const candidate of candidates) {
      const key = candidateKey(candidate)
      if (!candidateTitle(candidate) || claimed.has(key)) continue
      claimed.add(key)
      queue.push(candidate)
    }
    if (queue.length === 0 || coalesceHandle !== null) return

    coalesceHandle = setTimeout(() => {
      coalesceHandle = null
      void drainQueue()
    }, ANNOTATE_COALESCE_MS)
  }

  /** One batch in flight at a time; later arrivals join the queue rather than opening a request. */
  async function drainQueue(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const batch = queue.splice(0, ANNOTATE_BATCH_LIMIT)
        const asked = generation
        const answered = await fetchAvailability(batch)

        // The media kind changed while this was in flight, so the answer is to the wrong question.
        if (generation !== asked) return
        if (!answered) continue

        const next = { ...availability.value }
        batch.forEach((candidate, index) => {
          const result = answered[index]
          if (result) next[candidateKey(candidate)] = result
        })
        availability.value = next
      }
    } finally {
      draining = false
    }
  }

  async function fetchAvailability(batch: MetadataCandidate[]): Promise<BookRequestAvailability[] | null> {
    try {
      const res = await api('/api/v1/book-requests/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: batch.map((c) => ({
            title: candidateTitle(c),
            author: c.authors?.[0],
            isbn13: c.isbn13,
            providerKey: c.provider,
            providerId: c.providerId,
            mediaKind: mediaKind.value,
          })),
        }),
      })
      // A rejected request is deterministic, so the keys stay claimed rather than retrying per chunk.
      return res.ok ? ((await res.json()) as BookRequestAvailability[]) : null
    } catch {
      // A dropped connection is not, so release the batch and let the next arrival ask again.
      for (const candidate of batch) claimed.delete(candidateKey(candidate))
      return null
    }
  }

  /** A different medium is a different question, so every annotation is recomputed. */
  watch(mediaKind, () => {
    generation += 1
    availability.value = {}
    claimed = new Set()
    queue = []
    if (coalesceHandle !== null) clearTimeout(coalesceHandle)
    coalesceHandle = null
  })

  onUnmounted(() => {
    if (coalesceHandle !== null) clearTimeout(coalesceHandle)
    coalesceHandle = null
  })

  function getAvailability(candidate: MetadataCandidate): BookRequestAvailability | null {
    return availability.value[candidateKey(candidate)] ?? null
  }

  async function submit(
    candidate: MetadataCandidate,
    extra: {
      targetLibraryId?: number | null
      targetFolderId?: number | null
      note?: string | null
      language?: string | null
      coverUrl?: string | null
      selfServe?: boolean
      isbn10?: string | null
      isbn13?: string | null
      providerKey?: string | null
      providerId?: string | null
      metadataSources?: BookRequestMetadataSource[]
    },
  ): Promise<{ request: BookRequestItem; subscribed: boolean } | null> {
    const payload: CreateBookRequestPayload = {
      title: candidateTitle(candidate),
      mediaKind: mediaKind.value,
      ...(extra.selfServe ? { selfServe: true } : {}),
      subtitle: candidate.subtitle ?? null,
      authors: candidate.authors ?? [],
      seriesName: candidate.seriesName ?? null,
      seriesIndex: candidate.seriesIndex != null ? Math.trunc(candidate.seriesIndex) : null,
      isbn10: extra.isbn10 !== undefined ? extra.isbn10 : (candidate.isbn10 ?? null),
      isbn13: extra.isbn13 !== undefined ? extra.isbn13 : (candidate.isbn13 ?? null),
      publishedYear: candidate.publishedYear ?? null,
      // What the requester chose, not what the edition happened to be. Inheriting the edition's
      // language silently is how a request for a book became a request for a translation.
      language: extra.language ?? null,
      coverUrl: extra.coverUrl !== undefined ? extra.coverUrl : (candidate.coverUrl ?? null),
      providerKey: extra.providerKey !== undefined ? extra.providerKey : candidate.provider,
      providerId: extra.providerId !== undefined ? extra.providerId : candidate.providerId,
      metadataSources: extra.metadataSources ?? [],
      targetLibraryId: extra.targetLibraryId ?? null,
      targetFolderId: extra.targetFolderId ?? null,
      note: extra.note ?? null,
    }

    submitting.value = candidateKey(candidate)
    lastFailure.value = null
    try {
      const res = await api('/api/v1/book-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        lastFailure.value = await submitFailure(res)
        return null
      }

      const result = (await res.json()) as { request: BookRequestItem; subscribed: boolean }
      // Claim the key so a queued annotation cannot land on top of what we now know for certain.
      claimed.add(candidateKey(candidate))
      availability.value = {
        ...availability.value,
        [candidateKey(candidate)]: {
          ownedBookId: getAvailability(candidate)?.ownedBookId ?? null,
          existingRequestId: result.request.id,
          existingRequestStatus: result.request.status,
          alreadySubscribed: true,
        },
      }
      return result
    } finally {
      submitting.value = null
    }
  }

  /**
   * What the library and the queue already know about a title nobody searched a provider for.
   *
   * Free text has no provider id and usually no ISBN, so this is the weakest identity the dedupe
   * rules ever see and it will miss matches a provider result would have caught. It is here to
   * show a person what was found before they commit, not to decide anything.
   */
  async function checkFreeText(work: { title: string; author?: string | null }): Promise<BookRequestAvailability | null> {
    const title = work.title.trim()
    if (!title) return null

    try {
      const res = await api('/api/v1/book-requests/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ title, mediaKind: mediaKind.value, ...(work.author?.trim() ? { author: work.author.trim() } : {}) }] }),
      })
      if (!res.ok) return null
      const [first] = (await res.json()) as BookRequestAvailability[]
      return first ?? null
    } catch {
      return null
    }
  }

  /**
   * A request for a work no metadata provider returned. Everything the row carries is what the
   * person typed, which is enough for the release search to score against and is the whole point:
   * the provider catalogues are not the limit of what a tracker has.
   */
  async function submitFreeText(
    work: { title: string; author?: string | null },
    extra: { targetLibraryId?: number | null; targetFolderId?: number | null; language?: string | null; selfServe?: boolean },
  ): Promise<{ request: BookRequestItem; subscribed: boolean } | null> {
    const title = work.title.trim()
    if (!title) return null

    const payload: CreateBookRequestPayload = {
      title,
      mediaKind: mediaKind.value,
      authors: work.author?.trim() ? [work.author.trim()] : [],
      targetLibraryId: extra.targetLibraryId ?? null,
      targetFolderId: extra.targetFolderId ?? null,
      language: extra.language ?? null,
      ...(extra.selfServe ? { selfServe: true } : {}),
    }

    submitting.value = FREE_TEXT_KEY
    lastFailure.value = null
    try {
      const res = await api('/api/v1/book-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        lastFailure.value = await submitFailure(res)
        return null
      }
      return (await res.json()) as { request: BookRequestItem; subscribed: boolean }
    } catch {
      return null
    } finally {
      submitting.value = null
    }
  }

  return {
    availability,
    lastFailure,
    submitting,
    mediaKind,
    annotate,
    getAvailability,
    submit,
    submitFreeText,
    checkFreeText,
    candidateKey,
    candidateTitle,
  }
}
