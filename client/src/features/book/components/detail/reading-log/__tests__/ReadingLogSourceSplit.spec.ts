import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import {
  READING_SESSION_SOURCE_BUCKET_LABELS,
  type BookReadingSessionStats,
  type BookReadingSourceSlice,
  type ReadingSessionSourceBucket,
} from '@bookorbit/types'

import ReadingLogSourceSplit from '../ReadingLogSourceSplit.vue'

function builtIn(bucket: ReadingSessionSourceBucket, totalSeconds: number, totalSessions: number): BookReadingSourceSlice {
  return {
    key: bucket,
    label: READING_SESSION_SOURCE_BUCKET_LABELS[bucket],
    bucket,
    kind: 'built_in',
    appPasswordId: null,
    totalSeconds,
    totalSessions,
  }
}

function app(id: number, label: string, bucket: ReadingSessionSourceBucket, totalSeconds: number): BookReadingSourceSlice {
  return {
    key: `app-password:${id}:${bucket}`,
    label,
    bucket,
    kind: 'app_password',
    appPasswordId: id,
    totalSeconds,
    totalSessions: 1,
  }
}

function makeStats(bySource: BookReadingSourceSlice[]): BookReadingSessionStats {
  return {
    totalSessions: 0,
    totalSeconds: 0,
    avgDurationSeconds: 0,
    firstSessionAt: null,
    lastSessionAt: null,
    dailySummary: [],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    latestEndProgress: null,
    bySource,
    longestSessionSeconds: 0,
    longestSessionAt: null,
    backtrackCount: 0,
  }
}

describe('ReadingLogSourceSplit', () => {
  it('renders nothing when stats is null', () => {
    const wrapper = mount(ReadingLogSourceSplit, { props: { stats: null } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing when the book was read from a single source', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([builtIn('koreader', 100, 2)]) },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('stays hidden when sources exist but carry no reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([builtIn('bookorbit', 0, 1), builtIn('kobo', 0, 1)]) },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders named apps alongside every native and integration source', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          app(7, 'iPhone app', 'ios', 3600),
          builtIn('watchos', 60, 1),
          builtIn('android', 60, 1),
          builtIn('koreader', 120, 1),
          builtIn('kobo', 30, 1),
        ]),
      },
    })

    const text = wrapper.text()
    expect(text).toContain('Reading sources')
    expect(text).toContain('iPhone app')
    expect(text).toContain('Apple Watch')
    expect(text).toContain('Android app')
    expect(text).toContain('KOReader')
    expect(text).toContain('Kobo')
    expect(text).toContain('1h 0m')
    expect(text).toContain('2m')
    expect(text).toContain('30s')
  })

  it('disambiguates duplicate App Password labels by id', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([app(2, 'Phone', 'ios', 300), app(4, 'Phone', 'android', 100)]) },
    })

    expect(wrapper.text()).toContain('Phone (#2)')
    expect(wrapper.text()).toContain('Phone (#4)')
  })

  it('disambiguates one App Password used across platform buckets', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([app(7, 'Reader', 'ios', 300), app(7, 'Reader', 'android', 100)]) },
    })

    expect(wrapper.text()).toContain('Reader (#7, iOS app)')
    expect(wrapper.text()).toContain('Reader (#7, Android app)')
  })

  it('sizes each bar segment proportionally to its reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([app(7, 'Phone', 'ios', 300), builtIn('kobo', 100, 1)]) },
    })

    const segments = wrapper.findAll('.h-full')
    expect(segments).toHaveLength(2)
    expect(segments[0]!.attributes('style')).toContain('width: 75%')
    expect(segments[1]!.attributes('style')).toContain('width: 25%')
  })

  it('drops the card chrome in the stacked column form', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        variant: 'stacked',
        stats: makeStats([app(7, 'Phone', 'ios', 300), builtIn('kobo', 100, 1)]),
      },
    })
    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Reading sources')
    expect(wrapper.text()).toContain('75%')
  })
})
