import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookDockFile, BookDockUnitFile } from '@bookorbit/types'

import BookDockFileRow from '../BookDockFileRow.vue'

function unitFile(overrides: Partial<BookDockUnitFile> = {}): BookDockUnitFile {
  return { fileName: 'track-01.mp3', fileSize: 1024, format: 'mp3', role: 'content', sortOrder: 0, ...overrides }
}

function file(overrides: Partial<BookDockFile> = {}): BookDockFile {
  return {
    id: 1,
    fileName: 'track-01.mp3',
    fileSize: 1024,
    format: 'mp3',
    status: 'ready',
    embeddedMetadata: { title: 'Neuromancer', authors: ['William Gibson'] },
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: 2,
    targetFolderId: 3,
    confidence: 90,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unitFiles: [],
    ...overrides,
  }
}

function mountRow(overrides: Partial<BookDockFile> = {}, expanded = false) {
  return mount(BookDockFileRow, {
    props: {
      file: file(overrides),
      selected: false,
      expanded,
      focused: false,
      libraryName: 'Books',
      targetLabel: 'Books / Audiobooks',
    },
  })
}

describe('BookDockFileRow with a multi-file unit', () => {
  const TRACKS = [
    unitFile({ fileName: 'track-01.mp3', sortOrder: 0 }),
    unitFile({ fileName: 'track-02.mp3', sortOrder: 1 }),
    unitFile({ fileName: 'cover.jpg', format: 'jpg', role: 'cover', sortOrder: null, fileSize: 512 }),
  ]

  /** The row is named after its primary file, so without the badge it reads as a single mp3. */
  it('badges the row with how many files the entry actually holds', () => {
    expect(mountRow({ unitFiles: TRACKS }).text()).toContain('3 files')
  })

  it('leaves an ordinary single file unbadged', () => {
    expect(mountRow().text()).not.toContain('3 files')
  })

  /** The anchor row's own size is one track's; the row must show what the whole unit weighs. */
  it('sums the unit size rather than reporting the primary file alone', () => {
    expect(mountRow({ unitFiles: TRACKS }).text()).toContain('2.5 KB')
  })

  it('lists the unit files in order with their roles once expanded', () => {
    const text = mountRow({ unitFiles: TRACKS }, true).text()

    expect(text).toContain('3 files in this entry')
    expect(text).toContain('track-01.mp3')
    expect(text).toContain('track-02.mp3')
    expect(text).toContain('Cover')
    expect(text.indexOf('track-01.mp3')).toBeLessThan(text.indexOf('track-02.mp3'))
  })

  /** A unit is filed whole, so "finalize track 7 of 31" must not be expressible. */
  it('offers no per-file control in the expanded list', () => {
    const wrapper = mountRow({ unitFiles: TRACKS }, true)
    const list = wrapper.get('ol')

    expect(list.findAll('button')).toHaveLength(0)
    expect(list.findAll('input')).toHaveLength(0)
  })
})
