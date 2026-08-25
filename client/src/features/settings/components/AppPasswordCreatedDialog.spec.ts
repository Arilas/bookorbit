import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppPasswordCreatedDialog from './AppPasswordCreatedDialog.vue'

const copyToClipboardMock = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: copyToClipboardMock,
}))

describe('AppPasswordCreatedDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    copyToClipboardMock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('shows the generated password and copies it with feedback', async () => {
    mount(AppPasswordCreatedDialog, {
      props: { open: true, label: 'KOReader on Kobo', password: 'bo_app_generated_secret' },
      attachTo: document.body,
    })
    await flushPromises()

    const input = document.body.querySelector<HTMLInputElement>('[data-testid="created-app-password"]')
    const copyButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Copy'))

    expect(input?.value).toBe('bo_app_generated_secret')
    copyButton?.click()
    await flushPromises()

    expect(copyToClipboardMock).toHaveBeenCalledWith('bo_app_generated_secret')
    expect(document.body.textContent).toContain('Copied!')

    await vi.advanceTimersByTimeAsync(2000)
    expect(document.body.textContent).not.toContain('Copied!')
  })

  it('uses rotation copy when showing a replacement secret', async () => {
    mount(AppPasswordCreatedDialog, {
      props: { open: true, label: 'iPhone app', password: 'bo_app_rotated_secret', mode: 'rotated' },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('App password rotated')
    expect(document.body.textContent).toContain('Use this new password to sign in from iPhone app')
  })

  it('emits close so the owner can clear the one-time password', async () => {
    const wrapper = mount(AppPasswordCreatedDialog, {
      props: { open: true, label: 'KOReader on Kobo', password: 'bo_app_generated_secret' },
      attachTo: document.body,
    })
    await flushPromises()

    const doneButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Done'))
    doneButton?.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows an accessible error when clipboard access fails', async () => {
    copyToClipboardMock.mockResolvedValue(false)
    mount(AppPasswordCreatedDialog, {
      props: { open: true, label: 'KOReader on Kobo', password: 'bo_app_generated_secret' },
      attachTo: document.body,
    })
    await flushPromises()

    const copyButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Copy'))
    copyButton?.click()
    await flushPromises()

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Failed to copy app password')
  })
})
