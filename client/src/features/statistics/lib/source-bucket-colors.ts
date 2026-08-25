import { oklchToHex, readCssColor } from '@/lib/echarts'
import { getAppPasswordSourceHue, SOURCE_BUCKET_COLOR_TOKENS } from '@/lib/reading-source'
import type { ReadingSessionSourceBucket, ReadingSessionSourceDescriptor } from '@bookorbit/types'

// The 3 reading-source buckets reuse the existing pill tokens (light + dark variants
// live in client/src/assets/theme/tokens.css). bookorbit shares the "web" hue.
export { SOURCE_BUCKET_COLOR_TOKENS } from '@/lib/reading-source'

const cache = new Map<string, Record<ReadingSessionSourceBucket, string>>()

// The pill tokens are authored in oklch(), and getComputedStyle serializes them back as
// oklch() strings. The browser paints `fill: oklch(...)` fine, but zrender cannot parse
// oklch when it derives the hover/emphasis color, which makes the hovered bar vanish.
// Convert to a hex string zrender can parse, mirroring how getThemePalette() emits hex.
function toParseableColor(input: string): string {
  const value = input.trim()
  if (value.startsWith('#') || value.startsWith('rgb')) return value

  const match = /^oklch\(([^)]+)\)/i.exec(value)
  const inside = match?.[1]
  if (inside) {
    const [lRaw, cRaw, hRaw] = inside.split('/')[0]!.trim().split(/\s+/)
    const l = lRaw?.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw ?? '')
    const c = cRaw?.endsWith('%') ? (parseFloat(cRaw) / 100) * 0.4 : parseFloat(cRaw ?? '')
    const h = parseFloat(hRaw ?? '')
    if (Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h)) return oklchToHex(l, c, h)
  }
  return value
}

// `themeKey` (e.g. `${theme}:${accent}`) is supplied by the caller so a computed re-resolves
// colors when the active theme changes; the CSS variables themselves already encode the theme.
export function resolveSourceBucketColors(themeKey: string): Record<ReadingSessionSourceBucket, string> {
  const cached = cache.get(themeKey)
  if (cached) return cached

  const colors: Record<ReadingSessionSourceBucket, string> = {
    bookorbit: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.bookorbit)),
    koreader: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.koreader)),
    kobo: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.kobo)),
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
  return oklchToHex(dark ? 0.75 : 0.55, dark ? 0.16 : 0.18, getAppPasswordSourceHue(source))
}
