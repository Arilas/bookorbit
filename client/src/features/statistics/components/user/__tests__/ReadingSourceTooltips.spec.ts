import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BookReadingSession,
  ReadingSessionSourceDescriptor,
  ReadingSessionSourceUsage,
  UserDailyReadingStat,
  UserGenreReadingTimeItem,
  UserReadingSessionTimeline,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  genreData: { value: [] as unknown[] },
  heatmapData: { value: [] as unknown[] },
  fetchTimeline: vi.fn<typeof import('@/features/statistics/api/statistics.api').fetchUserReadingSessionTimeline>(),
  updateTimeline: vi.fn<typeof import('@/features/statistics/api/statistics.api').updateUserReadingSessionTimelineSession>(),
}))

vi.mock('@/components/charts/AppChart.vue', () => ({
  default: { name: 'AppChart', props: ['option'], template: '<div class="app-chart" />' },
}))

vi.mock('@/lib/reading-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reading-source')>()
  return { ...actual, resolveAppPasswordSourceColor: () => '#123456' }
})

vi.mock('@/features/statistics/lib/breakdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/statistics/lib/breakdown')>()
  return { ...actual, getBreakdownColor: () => '#123456', getBreakdownSeries: () => [] }
})

vi.mock('@/lib/heatmap-palette', () => ({
  buildHeatmapPalette: () => ({
    axisColor: '#123456',
    borderColor: '#123456',
    tooltipBackground: '#ffffff',
    tooltipBorder: '#123456',
    tooltipText: '#123456',
    seriesColor: '#123456',
    scale: ['#ffffff', '#eeeeee', '#dddddd', '#cccccc', '#bbbbbb'],
  }),
}))

vi.mock('@/composables/useChartTokens', () => ({
  useChartTokens: () => ({
    value: {
      key: 'light:test',
      dark: false,
      color: () => '#123456',
      palette: () => ['#123456', '#654321'],
    },
  }),
}))

vi.mock('@/features/statistics/composables/useUserGenreReadingTime', async () => {
  const { shallowRef } = await import('vue')
  return {
    useUserGenreReadingTime: () => ({ data: shallowRef(mocks.genreData.value), loading: shallowRef(false), error: shallowRef(false) }),
  }
})

vi.mock('@/features/statistics/composables/useUserReadingHeatmap', async () => {
  const { shallowRef } = await import('vue')
  return {
    useUserReadingHeatmap: () => ({ data: shallowRef(mocks.heatmapData.value), loading: shallowRef(false), error: shallowRef(false) }),
  }
})

vi.mock('@/features/statistics/composables/useStatisticsConfig', () => ({
  useStatisticsConfig: () => ({ filters: { value: { libraryIds: [] } } }),
}))

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: (bookId: number) => `/covers/${bookId}` }),
}))

vi.mock('@/features/statistics/api/statistics.api', () => ({
  fetchUserReadingSessionTimeline: mocks.fetchTimeline,
  updateUserReadingSessionTimelineSession: mocks.updateTimeline,
}))

import ReadingLogTraceChart from '@/features/book/components/detail/reading-log/ReadingLogTraceChart.vue'
import GenreReadingTimeTreemapChart from '../GenreReadingTimeTreemapChart.vue'
import ReadingHeatmapChart from '../ReadingHeatmapChart.vue'
import ReadingSessionTimelineChart from '../ReadingSessionTimelineChart.vue'

function app(id: number, label = 'Reader'): ReadingSessionSourceDescriptor {
  return {
    key: `app-password:${id}:ios`,
    label,
    bucket: 'ios',
    kind: 'app_password',
    appPasswordId: id,
  }
}

function usage(source: ReadingSessionSourceDescriptor, readingSeconds: number): ReadingSessionSourceUsage {
  return { ...source, readingSeconds }
}

function session(id: number, sourceAttribution: ReadingSessionSourceDescriptor, startedAt: string): BookReadingSession {
  return {
    id,
    bookFileId: 1,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 30 * 60_000).toISOString(),
    durationSeconds: 1800,
    progressDelta: 10,
    endProgress: id * 10,
    format: 'epub',
    source: 'ios',
    sourceAttribution,
    attemptId: null,
  }
}

function chartOption(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'AppChart' }).props('option')
}

describe('reading source tooltips', () => {
  beforeEach(() => {
    mocks.genreData.value = []
    mocks.heatmapData.value = []
    mocks.fetchTimeline.mockReset()
    mocks.updateTimeline.mockReset()
  })

  it('disambiguates duplicate App Password labels in the book trace', () => {
    const first = app(7)
    const second = app(8)
    const wrapper = mount(ReadingLogTraceChart, {
      props: {
        sessions: [
          session(1, first, '2026-11-09T10:00:00.000Z'),
          session(2, first, '2026-11-09T11:00:00.000Z'),
          session(3, second, '2026-11-09T12:00:00.000Z'),
        ],
        stats: null,
        loading: false,
      },
    })

    const option = chartOption(wrapper) as {
      tooltip: { formatter: (params: { data: { sourceLabel: string } }) => string }
      series: { data: { sourceLabel: string }[] }[]
    }
    const rows = option.series[0]!.data

    expect(option.tooltip.formatter({ data: rows[0]! })).toContain('Reader (#7)')
    expect(option.tooltip.formatter({ data: rows[2]! })).toContain('Reader (#8)')
  })

  it('disambiguates duplicate App Password labels in the session timeline', async () => {
    const first = app(7)
    const second = app(8)
    const timeline: UserReadingSessionTimeline = {
      year: 2026,
      week: 46,
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      items: [
        {
          sessionId: 1,
          bookId: 11,
          bookTitle: 'First book',
          bookFormat: 'epub',
          bookSource: first,
          startedAt: '2026-11-09T10:00:00.000Z',
          endedAt: '2026-11-09T10:30:00.000Z',
          durationSeconds: 1800,
        },
        {
          sessionId: 2,
          bookId: 12,
          bookTitle: 'Second book',
          bookFormat: 'epub',
          bookSource: second,
          startedAt: '2026-11-10T10:00:00.000Z',
          endedAt: '2026-11-10T10:30:00.000Z',
          durationSeconds: 1800,
        },
      ],
    }
    mocks.fetchTimeline.mockResolvedValue(timeline)

    const wrapper = mount(ReadingSessionTimelineChart)
    await flushPromises()

    const option = chartOption(wrapper) as {
      tooltip: { formatter: (params: { data: { bookSource: ReadingSessionSourceDescriptor; value: number[] } }) => string }
      series: { id: string; data: { bookSource: ReadingSessionSourceDescriptor; value: number[] }[] }[]
    }
    const rows = option.series.find((series) => series.id === 'sessionTimeline')!.data

    expect(option.tooltip.formatter({ data: rows[0]! })).toContain('Reader (#7)')
    expect(option.tooltip.formatter({ data: rows[1]! })).toContain('Reader (#8)')
  })

  it('disambiguates duplicate App Password labels in genre source rows', () => {
    const first = app(7)
    const second = app(8)
    mocks.genreData.value = [
      { genre: 'Fantasy', readingSeconds: 3600, bySource: [usage(first, 3600)] },
      { genre: 'History', readingSeconds: 1800, bySource: [usage(second, 1800)] },
    ] satisfies UserGenreReadingTimeItem[]

    const wrapper = mount(GenreReadingTimeTreemapChart)
    const option = chartOption(wrapper) as {
      tooltip: { formatter: (params: { name: string; value: number }) => string }
    }
    const fantasyTooltip = option.tooltip.formatter({ name: 'Fantasy', value: 3600 })
    const historyTooltip = option.tooltip.formatter({ name: 'History', value: 1800 })

    expect(fantasyTooltip).toContain('Reader (#7): 1.0h')
    expect(historyTooltip).toContain('Reader (#8): 0.5h')
  })

  it('disambiguates duplicate App Password labels in heatmap source rows', () => {
    const first = app(7)
    const second = app(8)
    const year = new Date().getUTCFullYear()
    const days: UserDailyReadingStat[] = Array.from({ length: 5 }, (_, index) => ({
      day: `${year}-01-0${index + 1}`,
      readingSeconds: 1800,
      progressDelta: 1,
      eventsCount: 1,
      bySource: index === 0 ? [usage(first, 1200)] : index === 1 ? [usage(second, 600)] : [],
    }))
    mocks.heatmapData.value = days

    const wrapper = mount(ReadingHeatmapChart)
    const option = chartOption(wrapper) as {
      tooltip: { formatter: (params: { value: [string, number, number] }) => string }
    }
    const firstTooltip = option.tooltip.formatter({ value: [days[0]!.day, 20, 1] })
    const secondTooltip = option.tooltip.formatter({ value: [days[1]!.day, 10, 1] })

    expect(firstTooltip).toContain('Reader (#7): 20m')
    expect(secondTooltip).toContain('Reader (#8): 10m')
  })
})
