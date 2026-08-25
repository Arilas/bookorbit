import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readCssColor: vi.fn<(varName: string) => string>((varName: string) => `oklch(${varName})`),
  toLegacyColor: vi.fn<(input: string) => string>(() => '#abcdef'),
  oklchToHex: vi.fn<(_lightness: number, _chroma: number, _hue: number) => string>(() => '#abcdef'),
}))

vi.mock('@/lib/css-color', () => ({
  readCssColor: mocks.readCssColor,
  toLegacyColor: mocks.toLegacyColor,
  oklchToHex: mocks.oklchToHex,
}))

import { resolveReadingSourceColor, resolveSourceBucketColors, SOURCE_BUCKET_COLOR_TOKENS } from './source-bucket-colors'
import { resolveReadingSourceCssColor } from '@/lib/reading-source'

describe('source-bucket-colors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps each bucket to its pill token (bookorbit reuses the web hue)', () => {
    expect(SOURCE_BUCKET_COLOR_TOKENS).toEqual({
      bookorbit: '--pill-web',
      ios: '--pill-ios',
      watchos: '--pill-watchos',
      android: '--pill-android',
      koreader: '--pill-koreader',
      kobo: '--pill-kobo',
    })
  })

  it('reads each pill token and converts it to a zrender-parseable colour', () => {
    const colors = resolveSourceBucketColors('dark:violet')

    expect(colors).toEqual({ bookorbit: '#abcdef', ios: '#abcdef', watchos: '#abcdef', android: '#abcdef', koreader: '#abcdef', kobo: '#abcdef' })
    for (const token of Object.values(SOURCE_BUCKET_COLOR_TOKENS)) {
      expect(mocks.readCssColor).toHaveBeenCalledWith(token)
      expect(mocks.toLegacyColor).toHaveBeenCalledWith(`oklch(${token})`)
    }
  })

  it('caches resolved colors per theme key', () => {
    const first = resolveSourceBucketColors('light:violet')
    const second = resolveSourceBucketColors('light:violet')
    expect(first).toBe(second)
    expect(mocks.readCssColor).toHaveBeenCalledTimes(6)
  })

  it('assigns deterministic theme-aware colors to App Password sources', () => {
    const source = { key: 'app-password:4:bookorbit', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 4 } as const

    expect(resolveReadingSourceColor(source, 'dark:violet')).toBe('#abcdef')
    expect(mocks.oklchToHex).toHaveBeenLastCalledWith(0.75, 0.16, (4 * 137.508) % 360)

    resolveReadingSourceColor({ ...source, key: 'app-password:5:bookorbit', appPasswordId: 5 }, 'light:violet')
    expect(mocks.oklchToHex).toHaveBeenLastCalledWith(0.55, 0.18, (5 * 137.508) % 360)
  })

  it('returns CSS colors that adapt to the active color scheme', () => {
    const source = { key: 'app-password:4:bookorbit', bucket: 'bookorbit', kind: 'app_password', appPasswordId: 4 } as const

    expect(resolveReadingSourceCssColor(source)).toContain('light-dark(')
    expect(resolveReadingSourceCssColor({ key: 'kobo', bucket: 'kobo', kind: 'built_in', appPasswordId: null })).toBe('var(--pill-kobo)')
  })
})
