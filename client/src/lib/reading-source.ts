import { READING_SESSION_SOURCE_BUCKET_LABELS, type ReadingSessionSourceBucket, type ReadingSessionSourceDescriptor } from '@bookorbit/types'
import { oklchToHex } from '@/lib/css-color'

export const SOURCE_BUCKET_COLOR_TOKENS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  ios: '--pill-ios',
  watchos: '--pill-watchos',
  android: '--pill-android',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

export function getAppPasswordSourceHue(source: Pick<ReadingSessionSourceDescriptor, 'key' | 'appPasswordId'>): number {
  if (source.appPasswordId != null) return (source.appPasswordId * 137.508) % 360

  let hash = 2166136261
  for (let index = 0; index < source.key.length; index += 1) {
    hash ^= source.key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 360
}

export function getReadingSourceDisplayLabels(sources: readonly ReadingSessionSourceDescriptor[]): Map<string, string> {
  const keysByLabel = new Map<string, Set<string>>()
  for (const source of sources) {
    const keys = keysByLabel.get(source.label) ?? new Set<string>()
    keys.add(source.key)
    keysByLabel.set(source.label, keys)
  }

  return new Map(
    sources.map((source) => {
      const hasDuplicate = (keysByLabel.get(source.label)?.size ?? 0) > 1
      const spansBuckets =
        source.appPasswordId != null &&
        sources.some(
          (candidate) =>
            candidate.key !== source.key &&
            candidate.label === source.label &&
            candidate.appPasswordId === source.appPasswordId &&
            candidate.bucket !== source.bucket,
        )
      const suffix =
        source.appPasswordId == null
          ? source.key
          : spansBuckets
            ? `#${source.appPasswordId}, ${READING_SESSION_SOURCE_BUCKET_LABELS[source.bucket]}`
            : `#${source.appPasswordId}`
      return [source.key, source.kind === 'app_password' && hasDuplicate ? `${source.label} (${suffix})` : source.label]
    }),
  )
}

export function resolveReadingSourceCssColor(source: Pick<ReadingSessionSourceDescriptor, 'key' | 'bucket' | 'kind' | 'appPasswordId'>): string {
  if (source.kind === 'built_in') return `var(${SOURCE_BUCKET_COLOR_TOKENS[source.bucket]})`

  const hue = getAppPasswordSourceHue(source)
  return `light-dark(oklch(0.55 0.18 ${hue}), oklch(0.75 0.16 ${hue}))`
}

export function resolveAppPasswordSourceColor(source: Pick<ReadingSessionSourceDescriptor, 'key' | 'appPasswordId'>, dark: boolean): string {
  return oklchToHex(dark ? 0.75 : 0.55, dark ? 0.16 : 0.18, getAppPasswordSourceHue(source))
}
