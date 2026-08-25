import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/css-color', () => ({
  readCssColor: (varName: string) => `rgb(${varName})`,
  toLegacyColor: (value: string) => value,
  oklchToHex: (_lightness: number, _chroma: number, hue: number) => `hue(${hue})`,
}))

import {
  BREAKDOWN_OPTIONS,
  collectReadingSourceDescriptors,
  DEFAULT_BREAKDOWN_DIMENSION,
  getBreakdownColor,
  getBreakdownSeries,
  getReadingSecondsForSource,
} from './breakdown'

describe('breakdown', () => {
  it('defaults source-or-format charts to format', () => {
    expect(DEFAULT_BREAKDOWN_DIMENSION).toBe('format')
    expect(BREAKDOWN_OPTIONS[0]).toEqual({ value: 'format', label: 'Format' })
  })

  it('returns all source buckets for the source dimension', () => {
    const series = getBreakdownSeries('source', 'theme:violet', [])
    expect(series.map((s) => s.key)).toEqual(['bookorbit', 'ios', 'watchos', 'android', 'koreader', 'kobo'])
    expect(series.map((s) => s.label)).toEqual(['BookOrbit', 'iOS app', 'Apple Watch', 'Android app', 'KOReader', 'Kobo'])
  })

  it('adds named App Password sources in a stable label and id order', () => {
    const series = getBreakdownSeries(
      'source',
      'theme:violet',
      [],
      [
        { key: 'app-password:8:bookorbit', label: 'Tablet', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 8 },
        { key: 'app-password:4:bookorbit', label: 'Phone', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 4 },
        { key: 'app-password:2:bookorbit', label: 'Phone', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 2 },
      ],
    )

    expect(series.map((item) => item.key)).toEqual([
      'bookorbit',
      'ios',
      'watchos',
      'android',
      'koreader',
      'kobo',
      'app-password:2:bookorbit',
      'app-password:4:bookorbit',
      'app-password:8:bookorbit',
    ])
    expect(series.slice(6).map((item) => item.label)).toEqual(['Phone (#2)', 'Phone (#4)', 'Tablet'])
    expect(series[6]!.color).not.toBe(series[7]!.color)
    expect(series[6]!.color).not.toBe('rgb(--pill-web)')
  })

  it('deduplicates descriptors and resolves source usage by stable key', () => {
    const descriptor = { key: 'app-password:4:bookorbit', label: 'Phone', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 4 } as const

    expect(collectReadingSourceDescriptors([descriptor, descriptor]).filter((item) => item.key === descriptor.key)).toHaveLength(1)
    expect(getReadingSecondsForSource([{ ...descriptor, readingSeconds: 90 }], descriptor.key)).toBe(90)
    expect(getReadingSecondsForSource([], descriptor.key)).toBe(0)
  })

  it('returns one series per format key for the format dimension', () => {
    expect(getBreakdownSeries('format', 'theme:violet', ['EPUB', 'PDF'])).toEqual([
      { key: 'EPUB', label: 'EPUB', color: '#16a34a' },
      { key: 'PDF', label: 'PDF', color: '#dc2626' },
    ])
  })

  it('resolves a per-item colour for each dimension', () => {
    expect(getBreakdownColor('format', 'EPUB', 'theme:violet')).toBe('#16a34a')
    expect(getBreakdownColor('source', 'koreader', 'theme:violet')).toBe('rgb(--pill-koreader)')
    expect(getBreakdownColor('source', 'app-password:4:bookorbit', 'theme:violet', 'bookorbit')).toContain('hue(')
  })
})
