import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationType, type NotificationItem } from '@bookorbit/types'
import NotificationItemVue from './NotificationItem.vue'

const routerPush = vi.fn<(url: string) => void>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('../composables/useNotifications', () => ({
  useNotifications: () => ({ formatRelativeTime: () => 'now' }),
}))

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    type: NotificationType.BookRequestSubmitted,
    title: 'New book request',
    message: 'Reader requested "Dune"',
    actionUrl: '/requests',
    meta: { requestId: 42 },
    read: false,
    createdAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('NotificationItem', () => {
  beforeEach(() => {
    routerPush.mockClear()
  })

  it('opens an existing submitted-request notification on the all tab', async () => {
    const wrapper = mount(NotificationItemVue, { props: { notification: notification() } })

    await wrapper.get('[role="button"]').trigger('click')

    expect(routerPush).toHaveBeenCalledExactlyOnceWith('/requests?tab=all')
  })
})
