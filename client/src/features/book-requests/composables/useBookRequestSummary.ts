import { ref } from 'vue'
import type { BookRequestSummary } from '@bookorbit/types'
import { api } from '@/lib/api'

const summary = ref<BookRequestSummary | null>(null)
let fetchPromise: Promise<void> | null = null
let requestGeneration = 0

export function resetBookRequestSummary(): void {
  requestGeneration += 1
  summary.value = null
  fetchPromise = null
}

export function useBookRequestSummary() {
  function fetchSummary(force = false): Promise<void> {
    if (!force && summary.value) return Promise.resolve()
    if (fetchPromise) return fetchPromise
    const generation = requestGeneration
    fetchPromise = api('/api/v1/book-requests/summary')
      .then(async (res) => {
        if (!res.ok) return
        const next: BookRequestSummary = await res.json()
        if (generation !== requestGeneration) return
        summary.value = next
      })
      .catch(() => {
        // The badge is supplementary, so a failed refresh leaves it hidden or stale.
      })
      .finally(() => {
        if (generation === requestGeneration) fetchPromise = null
      })
    return fetchPromise
  }

  function refreshSummary(): Promise<void> {
    return fetchSummary(true)
  }

  return { summary, fetchSummary, refreshSummary }
}
