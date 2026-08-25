import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { AppPassword } from '@bookorbit/types'

import RotateAppPasswordDialog from './RotateAppPasswordDialog.vue'

function appPassword(overrides: Partial<AppPassword> = {}): AppPassword {
  return {
    id: 7,
    label: 'iPhone app',
    hint: '2af9',
    createdAt: '2026-08-25T08:00:00.000Z',
    expiresAt: '2027-08-25T08:00:00.000Z',
    lastUsedAt: '2026-08-25T09:00:00.000Z',
    lastUsedIp: '192.0.2.10',
    activeSessions: 2,
    status: 'active',
    ...overrides,
  }
}

describe('RotateAppPasswordDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('warns about immediate session invalidation and preserved history', async () => {
    mount(RotateAppPasswordDialog, {
      props: { open: true, appPassword: appPassword(), saving: false, error: null },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('The current password stops working immediately')
    expect(document.body.textContent).toContain('2 active app sessions will end immediately')
    expect(document.body.textContent).toContain('Reading history and statistics stay attributed to "iPhone app"')
  })

  it('defaults to a 365 day expiry and emits only the replacement expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const wrapper = mount(RotateAppPasswordDialog, {
      props: { open: true, appPassword: appPassword(), saving: false, error: null },
      attachTo: document.body,
    })
    await flushPromises()

    const select = document.body.querySelector<HTMLSelectElement>('#app-password-rotation-expiry')
    const form = document.body.querySelector<HTMLFormElement>('form')
    if (!select || !form) throw new Error('Expected the rotation form to render')

    expect(select.value).toBe('365')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[{ expiresAt: '2027-08-25T12:00:00.000Z' }]])
  })

  it('uses renewal copy for an expired credential', async () => {
    mount(RotateAppPasswordDialog, {
      props: { open: true, appPassword: appPassword({ status: 'expired', activeSessions: 0 }), saving: false, error: null },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('Renew app password?')
    expect(document.body.textContent).toContain('Renew password')
  })
})
