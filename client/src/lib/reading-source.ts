import type { ReadingSessionSourceBucket, ReadingSessionSourceDescriptor } from '@bookorbit/types'

export const SOURCE_BUCKET_COLOR_TOKENS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
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
  const labelCounts = new Map<string, number>()
  for (const source of sources) labelCounts.set(source.label, (labelCounts.get(source.label) ?? 0) + 1)

  return new Map(
    sources.map((source) => {
      const hasDuplicate = (labelCounts.get(source.label) ?? 0) > 1
      const suffix = source.appPasswordId == null ? source.key : `#${source.appPasswordId}`
      return [source.key, source.kind === 'app_password' && hasDuplicate ? `${source.label} (${suffix})` : source.label]
    }),
  )
}

export function resolveReadingSourceCssColor(source: Pick<ReadingSessionSourceDescriptor, 'key' | 'bucket' | 'kind' | 'appPasswordId'>): string {
  if (source.kind === 'built_in') return `var(${SOURCE_BUCKET_COLOR_TOKENS[source.bucket]})`

  const hue = getAppPasswordSourceHue(source)
  return `light-dark(oklch(0.55 0.18 ${hue}), oklch(0.75 0.16 ${hue}))`
}
