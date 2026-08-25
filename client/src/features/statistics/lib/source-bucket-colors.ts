import { readCssColor, toLegacyColor } from '@/lib/css-color'
import { resolveAppPasswordSourceColor, SOURCE_BUCKET_COLOR_TOKENS } from '@/lib/reading-source'
import type { ReadingSessionSourceBucket, ReadingSessionSourceDescriptor } from '@bookorbit/types'

export { SOURCE_BUCKET_COLOR_TOKENS } from '@/lib/reading-source'

const cache = new Map<string, Record<ReadingSessionSourceBucket, string>>()

// `themeKey` (the theme store's `appearanceKey`) is supplied by the caller so a computed re-resolves
// colors when the active theme changes; the CSS variables themselves already encode the theme.
export function resolveSourceBucketColors(themeKey: string): Record<ReadingSessionSourceBucket, string> {
  const cached = cache.get(themeKey)
  if (cached) return cached

  const colors: Record<ReadingSessionSourceBucket, string> = {
    bookorbit: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.bookorbit)),
    ios: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.ios)),
    watchos: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.watchos)),
    android: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.android)),
    koreader: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.koreader)),
    kobo: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.kobo)),
  }
  cache.set(themeKey, colors)
  return colors
}

export function resolveReadingSourceColor(
  source: Pick<ReadingSessionSourceDescriptor, 'key' | 'bucket' | 'kind' | 'appPasswordId'>,
  themeKey: string,
): string {
  if (source.kind === 'built_in') return resolveSourceBucketColors(themeKey)[source.bucket]

  const dark = themeKey.split(':', 1)[0] === 'dark'
  return resolveAppPasswordSourceColor(source, dark)
}
