import {
  READING_SESSION_SOURCE_BUCKETS,
  READING_SESSION_SOURCE_BUCKET_LABELS,
  type ReadingSessionSourceBucket,
  type ReadingSessionSourceDescriptor,
  type ReadingSessionSourceUsage,
} from '@bookorbit/types'

import { getFormatColor } from '@/features/book/lib/format-colors'
import { getReadingSourceDisplayLabels } from '@/lib/reading-source'
import { resolveReadingSourceColor } from './source-bucket-colors'

export type BreakdownDimension = 'source' | 'format'

export const DEFAULT_BREAKDOWN_DIMENSION: BreakdownDimension = 'format'

export const BREAKDOWN_OPTIONS: { value: BreakdownDimension; label: string }[] = [
  { value: 'format', label: 'Format' },
  { value: 'source', label: 'Source' },
]

export interface BreakdownSeries {
  key: string
  label: string
  color: string
}

const BUILT_IN_SOURCES: ReadingSessionSourceDescriptor[] = READING_SESSION_SOURCE_BUCKETS.map((bucket) => ({
  key: bucket,
  label: READING_SESSION_SOURCE_BUCKET_LABELS[bucket],
  bucket,
  kind: 'built_in',
  appPasswordId: null,
}))

export function collectReadingSourceDescriptors(sources: readonly ReadingSessionSourceDescriptor[]): ReadingSessionSourceDescriptor[] {
  const descriptors = new Map(BUILT_IN_SOURCES.map((source) => [source.key, source]))
  const appSources = [...sources]
    .filter((source) => source.kind === 'app_password')
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))

  for (const source of appSources) descriptors.set(source.key, source)
  return [...descriptors.values()]
}

export function getReadingSecondsForSource(sources: readonly ReadingSessionSourceUsage[], key: string): number {
  return sources.find((source) => source.key === key)?.readingSeconds ?? 0
}

// Ordered series descriptors for charts that stack/colour by the chosen dimension.
// `formatKeys` (uppercase, e.g. EPUB/PDF/UNKNOWN) is only consulted for the format dimension.
export function getBreakdownSeries(
  dimension: BreakdownDimension,
  themeKey: string,
  formatKeys: string[],
  sourceDescriptors: readonly ReadingSessionSourceDescriptor[] = [],
): BreakdownSeries[] {
  if (dimension === 'source') {
    const sources = collectReadingSourceDescriptors(sourceDescriptors)
    const displayLabels = getReadingSourceDisplayLabels(sources)
    return sources.map((source) => ({
      key: source.key,
      label: displayLabels.get(source.key) ?? source.label,
      color: resolveReadingSourceColor(source, themeKey),
    }))
  }
  return formatKeys.map((key) => ({ key, label: key, color: getFormatColor(key) }))
}

// Colour for a single item keyed by the chosen dimension (used by per-item charts).
export function getBreakdownColor(
  dimension: BreakdownDimension,
  key: string,
  themeKey: string,
  sourceBucket: ReadingSessionSourceBucket = 'bookorbit',
): string {
  if (dimension === 'source') {
    const isBuiltIn = READING_SESSION_SOURCE_BUCKETS.includes(key as ReadingSessionSourceBucket)
    const appPasswordId = key.startsWith('app-password:') ? Number.parseInt(key.slice('app-password:'.length), 10) : null
    return resolveReadingSourceColor(
      {
        key,
        bucket: isBuiltIn ? (key as ReadingSessionSourceBucket) : sourceBucket,
        kind: isBuiltIn ? 'built_in' : 'app_password',
        appPasswordId: Number.isFinite(appPasswordId) ? appPasswordId : null,
      },
      themeKey,
    )
  }
  return getFormatColor(key)
}
