import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookReadingSession } from '@bookorbit/types'
import ReadingLogExportMenu from '../ReadingLogExportMenu.vue'

function makeSession(appPasswordLabel: string, overrides: Partial<BookReadingSession> = {}): BookReadingSession {
  return {
    id: 1,
    bookFileId: 3,
    startedAt: '2026-08-25T10:00:00.000Z',
    endedAt: '2026-08-25T10:30:00.000Z',
    durationSeconds: 1800,
    progressDelta: 10,
    endProgress: 40,
    format: 'epub',
    source: 'web',
    sourceAttribution: {
      key: 'app-password:7:bookorbit',
      label: appPasswordLabel,
      bucket: 'bookorbit',
      kind: 'app_password',
      appPasswordId: 7,
    },
    attemptId: null,
    sessionType: 'read',
    ...overrides,
  }
}

const stubs = {
  Popover: { name: 'Popover', props: ['open'], template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
}

async function exportCsv(appPasswordLabel: string, sessionOverrides: Partial<BookReadingSession> = {}): Promise<string> {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reading-log')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

  const wrapper = mount(ReadingLogExportMenu, {
    props: {
      bookTitle: 'Test Book',
      total: 1,
      exportAll: vi.fn<() => Promise<BookReadingSession[]>>().mockResolvedValue([makeSession(appPasswordLabel, sessionOverrides)]),
    },
    global: { stubs },
  })

  const csvButton = wrapper.findAll('button').find((button) => button.text().includes('CSV'))
  expect(csvButton).toBeDefined()
  await csvButton!.trigger('click')
  await flushPromises()

  const blob = createObjectURL.mock.calls[0]?.[0]
  expect(blob).toBeInstanceOf(Blob)
  return (blob as Blob).text()
}

describe('ReadingLogExportMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['=HYPERLINK("https://attacker.example","Open")', '"\'=HYPERLINK(""https://attacker.example"",""Open"")"'],
    ['  +SUM(1,2)', '"\'  +SUM(1,2)"'],
    ['\t-2+3', "'\t-2+3"],
    ['\n@SUM(1,2)', '"\'\n@SUM(1,2)"'],
  ])('neutralizes an App Password label beginning with formula syntax: %j', async (label, escapedLabel) => {
    const csv = await exportCsv(label)

    expect(csv).toContain(`,app-password:7:bookorbit,${escapedLabel}`)
  })

  it('escapes quotes, commas, and CRLF after neutralizing an adversarial App Password label', async () => {
    const csv = await exportCsv(' \r\n=HYPERLINK("https://attacker.example/a,b","Open")')

    expect(csv).toContain(',app-password:7:bookorbit,"\' \r\n=HYPERLINK(""https://attacker.example/a,b"",""Open"")"')
  })

  it('leaves a safe App Password label unchanged', async () => {
    const csv = await exportCsv('iPhone + KOReader')

    expect(csv).toContain(',app-password:7:bookorbit,iPhone + KOReader')
    expect(csv).not.toContain("'iPhone + KOReader")
  })

  it('keeps negative progress and pace values numeric', async () => {
    const csv = await exportCsv('iPhone app', { progressDelta: -5, endProgress: 35 })

    expect(csv).toContain(',1800,-5,35,-10.00,epub,web,app-password:7:bookorbit,iPhone app')
    expect(csv).not.toContain("'-5")
    expect(csv).not.toContain("'-10.00")
  })
})
