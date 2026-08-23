// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

function response(body: unknown, ok = true): Pick<Response, 'json' | 'ok'> {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  }
}

async function freshRequests(scope: 'mine' | 'all') {
  vi.resetModules()
  const { useBookRequests } = await import('../composables/useBookRequests')
  return useBookRequests(scope)
}

describe('useBookRequests filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends requester, media kind, and every selected status to the paginated endpoint', async () => {
    apiMock.mockResolvedValue(response({ items: [], total: 0 }))
    const requests = await freshRequests('all')
    requests.requesterUserId.value = 42
    requests.mediaKind.value = 'audiobook'
    requests.status.value = 'needs_review'

    await requests.fetchRequests()

    const url = String(apiMock.mock.calls[0]?.[0])
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('requesterUserId')).toBe('42')
    expect(params.get('mediaKind')).toBe('audiobook')
    expect(params.get('status')).toBe('needs_review')
  })

  it('loads requester options once for the all-requests scope', async () => {
    const options = [{ userId: 42, username: 'reader', name: 'Reader' }]
    apiMock.mockResolvedValue(response(options))
    const requests = await freshRequests('all')

    await requests.fetchRequesterOptions()
    await requests.fetchRequesterOptions()

    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/book-requests/requesters')
    expect(requests.requesterOptions.value).toEqual(options)
  })
})

/**
 * The endpoint answers with a bounded page, so on an instance with more requesters than that the
 * select silently omits people. The search is what makes the rest of them reachable, and pinning
 * the active choice is what stops a narrowing search from dropping the filter out of its control.
 */
describe('useBookRequests requester search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function settleSearch() {
    await vi.runAllTimersAsync()
  }

  it('asks the server for the term rather than filtering the page it already has', async () => {
    apiMock.mockResolvedValue(response([]))
    const requests = await freshRequests('all')

    requests.requesterSearch.value = 'ada'
    requests.searchRequesters()
    await settleSearch()

    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/book-requests/requesters?search=ada')
  })

  it('asks once for a burst of keystrokes', async () => {
    apiMock.mockResolvedValue(response([]))
    const requests = await freshRequests('all')

    for (const term of ['a', 'ad', 'ada']) {
      requests.requesterSearch.value = term
      requests.searchRequesters()
    }
    await settleSearch()

    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/book-requests/requesters?search=ada')
  })

  it('keeps the requester the list is filtered on when a search no longer matches them', async () => {
    const ada = { userId: 42, username: 'ada', name: 'Ada Lovelace' }
    apiMock.mockResolvedValue(response([ada]))
    const requests = await freshRequests('all')
    await requests.fetchRequesterOptions()
    requests.requesterUserId.value = 42
    await vi.waitFor(() => expect(requests.requesterOptions.value).toContainEqual(ada))

    apiMock.mockResolvedValue(response([{ userId: 7, username: 'grace', name: 'Grace Hopper' }]))
    requests.requesterSearch.value = 'grace'
    requests.searchRequesters()
    await settleSearch()

    expect(requests.requesterOptions.value).toEqual([ada, { userId: 7, username: 'grace', name: 'Grace Hopper' }])
  })

  it('does nothing for the caller-scoped list, which has no requester filter', async () => {
    const requests = await freshRequests('mine')

    requests.requesterSearch.value = 'ada'
    requests.searchRequesters()
    await settleSearch()

    expect(apiMock).not.toHaveBeenCalled()
  })
})

/**
 * Filters, sorts, pages and every change broadcast all ask the same endpoint again, so several
 * answers are routinely in flight at once and they do not come back in the order they were asked.
 */
describe('useBookRequests out-of-order answers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Resolved by hand, so a test can decide which answer arrives second. */
  function deferredResponse(body: unknown, ok = true) {
    let release: () => void = () => {}
    const pending = new Promise((resolve) => {
      release = () => resolve(response(body, ok))
    })
    return { pending, release: () => release() }
  }

  it('does not let a slow answer to an older filter overwrite a newer one', async () => {
    const requests = await freshRequests('mine')
    const stale = deferredResponse({ items: [{ id: 1 }], total: 1 })
    apiMock.mockImplementationOnce(() => stale.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ items: [{ id: 2 }], total: 1 })))

    const older = requests.fetchRequests()
    requests.status.value = 'pending'
    await requests.applyFilters()
    stale.release()
    await older

    expect(requests.items.value).toEqual([{ id: 2 }])
    expect(requests.total.value).toBe(1)
  })

  it('leaves the spinner to whichever fetch is newest', async () => {
    const requests = await freshRequests('mine')
    const older = deferredResponse({ items: [], total: 0 })
    const newer = deferredResponse({ items: [], total: 0 })
    apiMock.mockImplementationOnce(() => older.pending)
    apiMock.mockImplementationOnce(() => newer.pending)

    const first = requests.fetchRequests()
    const second = requests.fetchRequests()
    older.release()
    await first

    expect(requests.loading.value).toBe(true)

    newer.release()
    await second
    expect(requests.loading.value).toBe(false)
  })

  /** A page that has just loaded fine must not turn into an error because an older ask failed. */
  it('does not report a stale failure over a newer success', async () => {
    const requests = await freshRequests('mine')
    const older = deferredResponse(null, false)
    apiMock.mockImplementationOnce(() => older.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ items: [{ id: 2 }], total: 1 })))

    const first = requests.fetchRequests()
    await requests.fetchRequests()
    older.release()
    await first

    expect(requests.error.value).toBeNull()
    expect(requests.items.value).toEqual([{ id: 2 }])
  })
})
