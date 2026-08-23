import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS } from '@bookorbit/types'
import type { BookRequestAutomationSettings } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

import { toast } from 'vue-sonner'
import RequestAutomationPanel from '../RequestAutomationPanel.vue'

const PATH = '/api/v1/admin/book-request-automation'

function settings(overrides: Partial<BookRequestAutomationSettings> = {}): BookRequestAutomationSettings {
  return { ...DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS, ...overrides }
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) } as unknown as Response
}

async function mountPanel(loaded: BookRequestAutomationSettings = settings()) {
  apiMock.mockResolvedValue(response(loaded))
  const wrapper = mount(RequestAutomationPanel)
  await flushPromises()
  return wrapper
}

function lastBody(): Record<string, unknown> {
  const [, init] = apiMock.mock.calls.at(-1)!
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function sentBodies(): Record<string, unknown>[] {
  return apiMock.mock.calls.filter(([, init]) => init?.body).map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

/** What the panel has switched off, named so a diff says which control changed rather than how many. */
function disabledControls(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('input, select, button')
    .filter((control) => control.attributes('disabled') !== undefined)
    .map((control) => control.attributes('aria-label') ?? control.attributes('name') ?? control.attributes('type') ?? control.element.tagName)
}

/** A save the test holds open, so the panel can be inspected mid-flight. */
function heldSave(body: BookRequestAutomationSettings): () => void {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  apiMock.mockImplementationOnce(async () => {
    await held
    return response(body)
  })
  return release
}

describe('RequestAutomationPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the settings the instance is actually running', async () => {
    await mountPanel()

    expect(apiMock).toHaveBeenCalledWith(PATH)
  })

  /** Unattended grabbing is off out of the box, so its knobs are not there to be fiddled with. */
  it('keeps the score floor out of the way until unattended grabbing is on', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).not.toContain('Minimum release score')

    const enabled = await mountPanel(settings({ autoGrabEnabled: true }))
    expect(enabled.text()).toContain('Minimum release score')
  })

  /**
   * The card header answers "what will this server do to my requests" without the reader having to
   * assemble it from four separate settings, so it has to track all of them.
   */
  describe('the summary each card leads with', () => {
    it('reports the picker is the only route while unattended grabbing is off', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.text()).toContain('Every approved request waits for a person to open the release picker')
    })

    it('names the floor and how many releases will be tried', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoRetryEnabled: true, maxAutoGrabAttempts: 3 }))

      expect(wrapper.text()).toContain('scores 80 or more')
      expect(wrapper.text()).toContain('Up to 3 releases are tried')
    })

    it('drops the retry clause when a failure is the end of it', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoRetryEnabled: false }))

      expect(wrapper.text()).toContain('If it fails, the request waits for a person')
      expect(wrapper.text()).not.toContain('releases are tried')
    })

    /** Dragging is the moment the number means something, so the sentence cannot wait for the save. */
    it('follows the slider before anything is saved', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
      apiMock.mockClear()

      // `setValue` fires the change the panel saves on; a drag in progress is only ever `input`.
      const slider = wrapper.get('#auto-grab-min-score')
      ;(slider.element as HTMLInputElement).value = '95'
      await slider.trigger('input')

      expect(wrapper.text()).toContain('scores 95 or more')
      expect(apiMock).not.toHaveBeenCalled()
    })
  })

  it('sends only the knob that moved', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))

    await wrapper.get('input[type="number"]').setValue(2)
    await wrapper.get('input[type="number"]').trigger('change')
    await flushPromises()

    expect(lastBody()).toEqual({ maxAutoGrabAttempts: 2 })
  })

  /** A cleared box is not an instruction to set the attempt limit to nothing. */
  it('puts an unusable attempt count back rather than posting it for a 400', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    apiMock.mockClear()

    // `setValue` on a number box already fires the change the component listens for.
    const box = wrapper.get('input[type="number"]')
    await box.setValue('')
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect((box.element as HTMLInputElement).value).toBe(String(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.maxAutoGrabAttempts))
  })

  it('offers the verification threshold whether or not anything is automated', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Verification threshold')
    expect((wrapper.get('#request-verification-threshold').element as HTMLInputElement).value).toBe('70')
  })

  /**
   * Off is the operator choosing to trust the grab, so the threshold it would have been measured
   * against is not a knob any more. It stays stored, and comes back with the number they tuned.
   */
  it('puts the threshold away when import checking is switched off', async () => {
    const wrapper = await mountPanel(settings({ verificationEnabled: false }))

    expect(wrapper.text()).not.toContain('Verification threshold')
    expect(wrapper.text()).toContain('Nothing is held for review')
  })

  it('sends the mode when the checking switch is thrown', async () => {
    const wrapper = await mountPanel()
    apiMock.mockResolvedValue(response(settings({ verificationEnabled: false })))

    const switches = wrapper.findAll('[role="switch"]')
    await switches[switches.length - 1].trigger('click')
    await flushPromises()

    expect(lastBody()).toEqual({ verificationEnabled: false })
  })

  it('adopts whatever the server reports back rather than what was typed', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    apiMock.mockResolvedValue(response(settings({ autoGrabEnabled: true, verificationThreshold: 85 })))

    const slider = wrapper.findAll('input[type="range"]').at(-1)!
    await slider.setValue(90)
    await slider.trigger('change')
    await flushPromises()

    expect((wrapper.get('#request-verification-threshold').element as HTMLInputElement).value).toBe('85')
  })

  /**
   * One shared saving flag used to disable all seventeen controls for the round trip, so moving
   * any one knob greyed out the whole panel and dropped focus to the document.
   */
  it('leaves every other control alone while a save is in flight', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    const before = disabledControls(wrapper)
    const release = heldSave(settings({ autoGrabEnabled: true }))

    await wrapper.findAll('[role="switch"]')[1]!.trigger('click')

    expect(disabledControls(wrapper)).toEqual(before)

    release()
    await flushPromises()
  })

  /** Refusing the second change lost it, and told the operator their save had failed. */
  it('queues a knob moved mid-save rather than reporting it failed', async () => {
    const wrapper = await mountPanel()
    apiMock.mockClear()
    const release = heldSave(settings({ verificationEnabled: false }))
    apiMock.mockResolvedValue(response(settings({ verificationEnabled: false, importFormats: 'preferred' })))

    const switches = wrapper.findAll('[role="switch"]')
    await switches[switches.length - 1]!.trigger('click')
    await wrapper.findAll('input[name="import-formats"]')[1]!.trigger('change')
    await flushPromises()

    expect(sentBodies()).toEqual([{ verificationEnabled: false }])

    release()
    await flushPromises()

    expect(sentBodies()).toEqual([{ verificationEnabled: false }, { importFormats: 'preferred' }])
    expect(toast.error).not.toHaveBeenCalled()
  })

  describe('import formats', () => {
    /**
     * Neither value is the "off" one, so a toggle would have to pick a side to be off. The default
     * is stated rather than implied by an unchecked box.
     */
    it('shows which format rule the instance is running', async () => {
      const wrapper = await mountPanel(settings({ importFormats: 'preferred' }))
      const radios = wrapper.findAll('input[name="import-formats"]')

      expect(radios).toHaveLength(2)
      expect((radios[1]!.element as HTMLInputElement).checked).toBe(true)
    })

    it('saves the rule the operator picked', async () => {
      const wrapper = await mountPanel()
      apiMock.mockResolvedValue(response(settings({ importFormats: 'preferred' })))

      await wrapper.findAll('input[name="import-formats"]')[1]!.trigger('change')
      await flushPromises()

      expect(lastBody()).toEqual({ importFormats: 'preferred' })
    })

    it('explains what each rule keeps', async () => {
      const text = (await mountPanel()).text()

      expect(text).toContain('All available')
      expect(text).toContain('Preferred only')
      expect(text).toContain("destination library's format priority")
    })
  })
})
