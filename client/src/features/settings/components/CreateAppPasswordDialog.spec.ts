import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import CreateAppPasswordDialog from './CreateAppPasswordDialog.vue'

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CreateAppPasswordDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('defaults to a 365 day expiry and emits the exact create payload', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const wrapper = mount(CreateAppPasswordDialog, {
      props: { open: true, saving: false, error: null },
      attachTo: document.body,
    })
    await flushPromises()

    const input = document.body.querySelector<HTMLInputElement>('#app-password-label')
    const select = document.body.querySelector<HTMLSelectElement>('#app-password-expiry')
    const form = document.body.querySelector<HTMLFormElement>('form')
    if (!input || !select || !form) throw new Error('Expected the create form to render')

    expect(select.value).toBe('365')
    setInputValue(input, '  KOReader on Kobo  ')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          label: 'KOReader on Kobo',
          expiresAt: '2027-08-25T12:00:00.000Z',
        },
      ],
    ])
  })

  it('offers every supported expiry preset', async () => {
    mount(CreateAppPasswordDialog, {
      props: { open: true, saving: false, error: null },
      attachTo: document.body,
    })
    await flushPromises()

    const labels = Array.from(document.body.querySelectorAll('#app-password-expiry option')).map((option) => option.textContent?.trim())
    expect(labels).toEqual(['30 days', '90 days', '180 days', '1 year'])
  })
})
