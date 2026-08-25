import { describe, expect, it } from 'vitest'
import type { ReadingSessionSourceDescriptor } from '@bookorbit/types'

import { getReadingSourceDisplayLabels } from '@/lib/reading-source'

function app(id: number, label: string, bucket: ReadingSessionSourceDescriptor['bucket'] = 'ios'): ReadingSessionSourceDescriptor {
  return {
    key: `app-password:${id}:${bucket}`,
    label,
    bucket,
    kind: 'app_password',
    appPasswordId: id,
  }
}

describe('getReadingSourceDisplayLabels', () => {
  it('does not suffix repeated rows from the same source descriptor', () => {
    const source = app(7, 'Reader')
    const labels = getReadingSourceDisplayLabels([source, source, source])

    expect(labels.get(source.key)).toBe('Reader')
  })

  it('disambiguates distinct App Passwords that share a label', () => {
    const first = app(7, 'Reader')
    const second = app(8, 'Reader')
    const labels = getReadingSourceDisplayLabels([first, first, second])

    expect(labels.get(first.key)).toBe('Reader (#7)')
    expect(labels.get(second.key)).toBe('Reader (#8)')
  })

  it('includes the platform when one App Password spans multiple buckets', () => {
    const ios = app(7, 'Reader', 'ios')
    const android = app(7, 'Reader', 'android')
    const labels = getReadingSourceDisplayLabels([ios, android])

    expect(labels.get(ios.key)).toBe('Reader (#7, iOS app)')
    expect(labels.get(android.key)).toBe('Reader (#7, Android app)')
  })
})
