import { onScopeDispose, ref } from 'vue'
import { Socket } from 'socket.io-client'
import { createAuthenticatedSocket } from '@/lib/socket'
import type { BookRequestDownloadStatus, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'

/**
 * One shared namespace connection for the whole page. Progress arrives as small events keyed on a
 * request id, so a card can move without the list refetching on every tick; `changed` is the
 * coarse signal for anything a percentage cannot express, such as a status transition.
 */
const progressByRequest = ref<Record<number, BookRequestProgressEvent>>({})
const connected = ref(false)
const changeListeners = new Set<() => void>()
let socket: Socket | null = null
let subscribers = 0

/** An attempt in one of these is over, so a tick describing it is history rather than progress. */
const SETTLED_DOWNLOAD_STATUSES = new Set<BookRequestDownloadStatus>(['imported', 'needs_review', 'failed'])

function getSocket(): Socket {
  if (socket) return socket

  socket = createAuthenticatedSocket('/book-requests', {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  })

  socket.on('book-requests:progress', (event: BookRequestProgressEvent) => {
    if (SETTLED_DOWNLOAD_STATUSES.has(event.status)) delete progressByRequest.value[event.requestId]
    else progressByRequest.value[event.requestId] = event
  })

  socket.on('book-requests:changed', () => {
    for (const listener of changeListeners) listener()
  })

  socket.on('connect', () => {
    connected.value = true
  })

  socket.on('disconnect', () => {
    connected.value = false
  })

  return socket
}

export function useBookRequestProgress() {
  let disposed = false
  subscribers++
  getSocket()

  onScopeDispose(() => {
    if (disposed) return
    disposed = true
    subscribers--
    if (subscribers > 0 || !socket) return
    socket.disconnect()
    socket = null
    connected.value = false
    progressByRequest.value = {}
  })

  /**
   * Cleanup is by scope alone, so this must be called during synchronous setup like any other
   * lifecycle registration. There is deliberately no unsubscribe handle: two ways to stop
   * listening is one more than any caller has ever needed, and returning one invites a call from
   * outside a scope, where nothing would ever remove the listener.
   */
  function onRequestsChanged(fn: () => void): void {
    changeListeners.add(fn)
    onScopeDispose(() => changeListeners.delete(fn))
  }

  /**
   * Drops the ticks that the rows just fetched have caught up with. The map lives for as long as
   * the app does - the sidebar subscribes at startup, so it is never torn down by the last page
   * unmounting - and without this it keeps one entry per request that ever downloaded.
   *
   * Only rows whose own attempt has settled are dropped, and only where the tick describes that
   * same attempt, so a fetch that started before a fresh grab cannot evict its first tick.
   */
  function pruneSettledProgress(requests: readonly Pick<BookRequestItem, 'id' | 'download'>[]): void {
    for (const request of requests) {
      const download = request.download
      const tick = progressByRequest.value[request.id]
      if (!download || !tick || tick.downloadId !== download.id) continue
      if (SETTLED_DOWNLOAD_STATUSES.has(download.status)) delete progressByRequest.value[request.id]
    }
  }

  return { progressByRequest, connected, onRequestsChanged, pruneSettledProgress }
}
