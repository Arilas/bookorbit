import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookReadingSourceSlice } from '@bookorbit/types'

import ReadingLogSourceSplit from '../ReadingLogSourceSplit.vue'

const descriptors = {
  bookorbit: { key: 'bookorbit', label: 'BookOrbit', bucket: 'bookorbit', kind: 'built_in', appPasswordId: null },
  koreader: { key: 'koreader', label: 'KOReader', bucket: 'koreader', kind: 'built_in', appPasswordId: null },
  kobo: { key: 'kobo', label: 'Kobo', bucket: 'kobo', kind: 'built_in', appPasswordId: null },
} as const

function makeStats(bySource: BookReadingSourceSlice[]) {
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
  }
}

describe('ReadingLogSourceSplit', () => {
  it('renders nothing when stats is null', () => {
    const wrapper = mount(ReadingLogSourceSplit, { props: { stats: null } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing when there are no source slices', () => {
    const wrapper = mount(ReadingLogSourceSplit, { props: { stats: makeStats([]) } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing when the book was read from a single source', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([{ ...descriptors.koreader, totalSeconds: 100, totalSessions: 2 }]) },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders a labelled split with percentages and durations across sources', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { ...descriptors.bookorbit, totalSeconds: 3600, totalSessions: 4 },
          { ...descriptors.koreader, totalSeconds: 120, totalSessions: 1 },
          { ...descriptors.kobo, totalSeconds: 30, totalSessions: 1 },
        ]),
      },
    })

    expect(wrapper.find('div').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain('Reading sources')
    expect(text).toContain('BookOrbit')
    expect(text).toContain('KOReader')
    expect(text).toContain('Kobo')
    // total = 3750s -> 96% / 3% / 1%
    expect(text).toContain('96%')
    expect(text).toContain('3%')
    expect(text).toContain('1%')
    // formatDuration: hours, minutes and seconds branches
    expect(text).toContain('1h 0m')
    expect(text).toContain('2m')
    expect(text).toContain('30s')
  })

  it('stays hidden when buckets exist but carry no reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { ...descriptors.bookorbit, totalSeconds: 0, totalSessions: 1 },
          { ...descriptors.kobo, totalSeconds: 0, totalSessions: 1 },
        ]),
      },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('sizes each bar segment proportionally to its reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { ...descriptors.bookorbit, totalSeconds: 300, totalSessions: 2 },
          { ...descriptors.kobo, totalSeconds: 100, totalSessions: 1 },
        ]),
      },
    })

    const segments = wrapper.findAll('.h-full')
    expect(segments).toHaveLength(2)
    expect(segments[0]!.attributes('style')).toContain('width: 75%')
    expect(segments[1]!.attributes('style')).toContain('width: 25%')
  })

  it('renders App Password names as distinct source slices', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { ...descriptors.bookorbit, totalSeconds: 100, totalSessions: 1 },
          {
            key: 'app-password:9',
            label: 'iPhone app',
            bucket: 'bookorbit',
            kind: 'app_password',
            appPasswordId: 9,
            totalSeconds: 100,
            totalSessions: 1,
          },
        ]),
      },
    })

    expect(wrapper.text()).toContain('BookOrbit')
    expect(wrapper.text()).toContain('iPhone app')
    expect(wrapper.text()).toContain('50%')
  })

  it('disambiguates duplicate App Password names by credential id', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          {
            key: 'app-password:9',
            label: 'Phone',
            bucket: 'bookorbit',
            kind: 'app_password',
            appPasswordId: 9,
            totalSeconds: 100,
            totalSessions: 1,
          },
          {
            key: 'app-password:12',
            label: 'Phone',
            bucket: 'bookorbit',
            kind: 'app_password',
            appPasswordId: 12,
            totalSeconds: 100,
            totalSessions: 1,
          },
        ]),
      },
    })

    expect(wrapper.text()).toContain('Phone (#9)')
    expect(wrapper.text()).toContain('Phone (#12)')
  })
})
