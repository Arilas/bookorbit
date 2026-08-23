import type { BookRequestRow } from '../../../db/schema';
import { emptyReleaseProfiles } from '@bookorbit/types';
import type { IndexerAdapterType } from '@bookorbit/types';

import { IndexerSearchException, type ReleaseCandidate, type ResolvedIndexerConfig } from './indexer-adapter';
import { IndexerSearchService } from './indexer-search.service';

function request(overrides: Partial<BookRequestRow> = {}): BookRequestRow {
  return {
    id: 7,
    title: 'Dune',
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    metadataSources: [],
    mediaKind: 'ebook',
    preferredFormats: ['epub'],
    language: null,
    ...overrides,
  } as BookRequestRow;
}

/**
 * Torznab is the only built-in type, so anything else a row can name is a plugin slug. Cast the way
 * `IndexerConfigService` casts a row it read from the database, which is where these come from.
 */
const pluginType = (slug: string) => slug as IndexerAdapterType;

function indexer(overrides: Partial<ResolvedIndexerConfig> = {}): ResolvedIndexerConfig {
  return {
    id: 1,
    name: 'jackett',
    adapterType: 'torznab',
    baseUrl: 'http://127.0.0.1:9117',
    credential: null,
    allowPrivateAddress: true,
    categories: { ebook: [7020], audiobook: [3030], comic: [7030] },
    disabledMediaKinds: [],
    settings: null,
    ...overrides,
  };
}

function release(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    indexerId: 1,
    guid: 'g1',
    title: 'Frank Herbert - Dune [EPUB]',
    sizeBytes: 2 * 1024 * 1024,
    seeders: 10,
    leechers: 1,
    format: 'epub',
    ...overrides,
  };
}

/**
 * Adapters here declare every medium unless a test says otherwise, so a stub is not silently read
 * as a source that carries nothing.
 */
function makeService(
  configs: ResolvedIndexerConfig[],
  adapters: Record<string, { search: ReturnType<typeof vi.fn>; mediaKinds?: readonly string[]; seedsBack?: boolean; supportsIsbnSearch?: boolean }>,
) {
  const indexers = { resolveEnabledConfigs: vi.fn().mockResolvedValue(configs) };
  const registry = {
    find: vi.fn((type: string) => {
      const adapter = adapters[type];
      return adapter ? { mediaKinds: ['ebook', 'audiobook', 'comic'], supportsIsbnSearch: false, ...adapter } : undefined;
    }),
    seedsBack: vi.fn((type: string) => adapters[type]?.seedsBack ?? true),
  };
  // No profile, which is the shipped default and keeps these cases about search and scoring.
  const automationSettings = { get: vi.fn(() => Promise.resolve({ profiles: emptyReleaseProfiles() })) };
  return {
    service: new IndexerSearchService(indexers as never, registry as never, automationSettings as never),
    indexers,
    adapters,
    automationSettings,
  };
}

describe('IndexerSearchService', () => {
  it('merges every enabled indexer into one list ranked by score', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ title: 'Something Else [EPUB]', seeders: 400 })]) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2', seeders: 5 })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    const result = await service.search(request());

    expect(result.releases.map((item) => item.indexerName)).toEqual(['archive', 'jackett']);
    expect(result.releases[0].score).toBeGreaterThan(result.releases[1].score);
  });

  it('reports the request fields used to search and rank the releases', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const { service } = makeService([indexer()], { torznab });

    const result = await service.search(
      request({
        authors: ['Frank Herbert', 'Brian Herbert'],
        isbn10: '0441172717',
        isbn13: '9780441172719',
        language: 'en',
        preferredFormats: ['epub', 'azw3'],
      }),
    );

    expect(result.criteria).toEqual({
      title: 'Dune',
      authors: ['Frank Herbert', 'Brian Herbert'],
      isbn10: null,
      isbn13: '9780441172719',
      activeIsbn: '9780441172719',
      isbns: ['9780441172719'],
      mediaKind: 'ebook',
      language: 'en',
      preferredFormats: ['epub', 'azw3'],
    });
  });

  it('searches only the recommended ISBN while retaining every distinct provider ISBN as an alternative', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(
      request({
        metadataSources: [
          { providerKey: 'google', providerId: 'g1', providerLabel: 'Google Books', isbn10: '0441013597', isbn13: null },
          { providerKey: 'amazon', providerId: 'a1', providerLabel: 'Amazon', isbn10: null, isbn13: '9781250301697' },
        ],
      }),
    );

    expect(libgen.search).toHaveBeenCalledWith(
      expect.objectContaining({ isbn13: '9780441013593', isbn13s: ['9780441013593'] }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.criteria).toMatchObject({ activeIsbn: '9780441013593', isbns: ['9780441013593', '9781250301697'] });
    expect(result.indexers[0]?.query).toEqual({ kind: 'isbn', value: '9780441013593' });
  });

  it('uses explicit picker overrides instead of silently retaining request search fields', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(request({ isbn13: '9780441172719', language: 'en' }), {
      refresh: true,
      overrides: {
        title: 'Dune Messiah',
        authors: ['Frank Herbert'],
        isbn: '9780593098233',
        language: null,
        preferredFormats: ['azw3'],
      },
    });

    expect(libgen.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Dune Messiah',
        author: 'Frank Herbert',
        isbn13: '9780593098233',
        isbn13s: ['9780593098233'],
        language: null,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.criteria).toEqual({
      title: 'Dune Messiah',
      authors: ['Frank Herbert'],
      isbn10: null,
      isbn13: '9780593098233',
      activeIsbn: '9780593098233',
      isbns: ['9780593098233', '9780441172719'],
      mediaKind: 'ebook',
      language: null,
      preferredFormats: ['azw3'],
    });
  });

  it('lets an explicit null ISBN select a title and author search', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });

    const result = await service.search(request({ isbn13: '9780441172719' }), { refresh: true, overrides: { isbn: null } });

    expect(libgen.search).toHaveBeenCalledWith(expect.objectContaining({ isbn13: null, isbn13s: [] }), expect.anything(), expect.anything());
    expect(result.criteria).toMatchObject({ activeIsbn: null, isbns: ['9780441172719'] });
    expect(result.indexers[0]?.query).toEqual({ kind: 'titleAuthor', value: 'Dune Frank Herbert' });
  });

  it('limits fallback passes to ISBN-capable indexers', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: pluginType('libgen') })], {
      torznab,
      libgen,
    });

    const result = await service.search(request({ isbn13: '9780441172719' }), { indexerMode: 'isbn-capable' });

    expect(torznab.search).not.toHaveBeenCalled();
    expect(libgen.search).toHaveBeenCalledTimes(1);
    expect(result.indexers.map((status) => status.indexerName)).toEqual(['libgen']);
    expect(result.uncoveredIndexerCount).toBe(0);
  });

  it('sends the final title fallback only to ISBN-capable indexers', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([]) };
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: pluginType('libgen') })], {
      torznab,
      libgen,
    });

    const result = await service.search(request({ isbn13: '9780441172719' }), {
      indexerMode: 'isbn-capable',
      overrides: { isbn: null },
    });

    expect(torznab.search).not.toHaveBeenCalled();
    expect(libgen.search).toHaveBeenCalledWith(expect.objectContaining({ isbn13: null, isbn13s: [] }), expect.anything(), expect.anything());
    expect(result.indexers[0]?.query).toEqual({ kind: 'titleAuthor', value: 'Dune Frank Herbert' });
  });

  /** One tracker being down is a per-indexer state in the picker, not a failed search. */
  it('reports a failing indexer beside the results the others returned', async () => {
    const torznab = { search: vi.fn().mockRejectedValue(new IndexerSearchException('unauthorized', 'bad key')) };
    const archive = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2' })]) };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'archive', adapterType: 'internet-archive' })], {
      torznab,
      'internet-archive': archive,
    });

    const result = await service.search(request());

    expect(result.releases).toHaveLength(1);
    expect(result.indexers).toEqual([
      {
        indexerId: 1,
        indexerName: 'jackett',
        ok: false,
        count: 0,
        filtered: 0,
        query: { kind: 'titleAuthor', value: 'Dune Frank Herbert' },
        failure: 'unauthorized',
        error: 'bad key',
        seedsBack: true,
      },
      {
        indexerId: 2,
        indexerName: 'archive',
        ok: true,
        count: 1,
        filtered: 0,
        query: { kind: 'titleAuthor', value: 'Dune Frank Herbert' },
        seedsBack: true,
      },
    ]);
  });

  /**
   * A source that serves the file itself has no swarm to report, which the picker must not read
   * as one release having omitted its seeder count. The answer belongs to the adapter, so it
   * travels with the indexer's status rather than being guessed from the merged release list.
   */
  it('reports whether each source joins a swarm', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const libgen = { search: vi.fn().mockResolvedValue([release({ indexerId: 2, guid: 'g2', seeders: null })]), seedsBack: false };
    const { service } = makeService([indexer(), indexer({ id: 2, name: 'libgen', adapterType: 'libgen' })], { torznab, libgen });

    const result = await service.search(request());

    expect(result.indexers.map((status) => [status.indexerName, status.seedsBack])).toEqual([
      ['jackett', true],
      ['libgen', false],
    ]);
  });

  it('counts what the hard filters dropped, so an empty list stays explainable', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ seeders: 0 }), release({ guid: 'g2', format: 'mp3' })]) };
    const { service } = makeService([indexer()], { torznab });

    const result = await service.search(request());

    expect(result.releases).toHaveLength(0);
    expect(result.indexers[0]).toMatchObject({ ok: true, count: 0, filtered: 2 });
  });

  /** Reopening the picker must not re-hit a private tracker; `refresh` is the way past that. */
  it('serves a repeat search from the cache until asked to refresh', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());
    const second = await service.search(request());
    expect(second.cached).toBe(true);
    expect(torznab.search).toHaveBeenCalledTimes(1);

    const refreshed = await service.search(request(), { refresh: true });
    expect(refreshed.cached).toBe(false);
    expect(torznab.search).toHaveBeenCalledTimes(2);
  });

  it('keeps manual and default search caches separate while retaining both pickable result sets', async () => {
    const torznab = {
      search: vi.fn((query: { title: string }) =>
        Promise.resolve([release(query.title === 'Dune Messiah' ? { guid: 'custom' } : { guid: 'default' })]),
      ),
    };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());
    await service.search(request(), { overrides: { title: 'Dune Messiah' } });
    const defaultAgain = await service.search(request());

    expect(defaultAgain.cached).toBe(true);
    expect(torznab.search).toHaveBeenCalledTimes(2);
    expect(service.find(7, 1, 'default')).toBeDefined();
    expect(service.find(7, 1, 'custom')).toBeDefined();
  });

  it('keeps all-indexer and ISBN-capable search caches separate', async () => {
    const libgen = { search: vi.fn().mockResolvedValue([]), supportsIsbnSearch: true };
    const { service } = makeService([indexer({ adapterType: pluginType('libgen') })], { libgen });
    const book = request({ isbn13: '9780441172719' });

    await service.search(book);
    await service.search(book, { indexerMode: 'isbn-capable' });
    const capableAgain = await service.search(book, { indexerMode: 'isbn-capable' });

    expect(libgen.search).toHaveBeenCalledTimes(2);
    expect(capableAgain.cached).toBe(true);
  });

  /**
   * An open library that holds only text has nothing to say about an audiobook. Nothing goes wrong
   * when it is asked for one, because it is never asked: the mismatch is a permanent property of
   * the source, known before any request, so it is left out of the search rather than reported as
   * a per-indexer failure the operator might try to fix.
   */
  it('leaves out a source that does not carry the requested medium instead of failing it', async () => {
    const gutenberg = { search: vi.fn(), mediaKinds: ['ebook'] as const };
    const { service } = makeService([indexer({ id: 2, name: 'gutenberg', adapterType: pluginType('project-gutenberg') })], {
      'project-gutenberg': gutenberg,
    });

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(gutenberg.search).not.toHaveBeenCalled();
    expect(result.indexers).toEqual([]);
  });

  /**
   * The operator's own narrowing, on top of what the adapter declares. A general torznab proxy in
   * front of an audiobook-only tracker still says it carries all three, and an empty category list
   * cannot express the exclusion either: torznab reads that as "send no `cat`".
   */
  it('leaves out a source the operator took out of this medium', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer({ disabledMediaKinds: ['ebook'] })], { torznab });

    const result = await service.search(request({ mediaKind: 'ebook' }));

    expect(torznab.search).not.toHaveBeenCalled();
    expect(result.uncoveredIndexerCount).toBe(1);
  });

  it('still searches that source for the media it was left in', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer({ disabledMediaKinds: ['ebook'] })], { torznab });

    await service.search(request({ mediaKind: 'audiobook' }));

    expect(torznab.search).toHaveBeenCalledTimes(1);
  });

  /**
   * A missing adapter is a fact about the build and is reported rather than hidden, but an
   * exclusion is a decision about the source, and it stands whether or not the adapter loaded.
   */
  it('honours the exclusion even for a row whose adapter this build no longer has', async () => {
    const { service } = makeService([indexer({ adapterType: pluginType('departed'), disabledMediaKinds: ['ebook'] })], {});

    const result = await service.search(request({ mediaKind: 'ebook' }));

    expect(result.indexers).toEqual([]);
    expect(result.uncoveredIndexerCount).toBe(1);
  });

  /** Counted rather than dropped, so an empty list can still say why it is empty. */
  it('counts the sources it left out, so an empty list stays explainable', async () => {
    const gutenberg = { search: vi.fn(), mediaKinds: ['ebook'] as const };
    const librivox = { search: vi.fn().mockResolvedValue([]), mediaKinds: ['audiobook'] as const };
    const { service } = makeService(
      [
        indexer({ id: 2, name: 'gutenberg', adapterType: pluginType('project-gutenberg') }),
        indexer({ id: 3, name: 'librivox', adapterType: pluginType('librivox') }),
      ],
      { 'project-gutenberg': gutenberg, librivox },
    );

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(result.uncoveredIndexerCount).toBe(1);
    expect(result.indexers).toEqual([expect.objectContaining({ indexerName: 'librivox', ok: true })]);
  });

  it('counts nothing as uncovered when every source carries the medium', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release()]) };
    const { service } = makeService([indexer()], { torznab });

    await expect(service.search(request())).resolves.toMatchObject({ uncoveredIndexerCount: 0 });
  });

  /**
   * A row whose adapter is gone cannot be judged on its media at all, so leaving it out here would
   * hide the one state the operator has to act on.
   */
  it('still searches a row whose adapter this build no longer has, so it is reported', async () => {
    const { service } = makeService([indexer({ adapterType: pluginType('departed') })], {});

    const result = await service.search(request({ mediaKind: 'audiobook' }));

    expect(result.uncoveredIndexerCount).toBe(0);
    expect(result.indexers).toEqual([expect.objectContaining({ ok: false, failure: 'error' })]);
  });

  it('resolves a picked release from its own results rather than anything a client sent', async () => {
    const torznab = { search: vi.fn().mockResolvedValue([release({ downloadUrl: 'https://tracker.example.com/dl?tid=1' })]) };
    const { service } = makeService([indexer()], { torznab });

    await service.search(request());

    expect(service.find(7, 1, 'g1')).toMatchObject({ downloadUrl: 'https://tracker.example.com/dl?tid=1' });
    expect(service.find(7, 1, 'unknown')).toBeUndefined();
    expect(service.find(99, 1, 'g1')).toBeUndefined();
  });

  it('reports an indexer whose adapter is not built rather than silently skipping it', async () => {
    const { service } = makeService([indexer({ adapterType: 'internet-archive' })], {});

    const result = await service.search(request());

    expect(result.indexers[0]).toMatchObject({ ok: false, failure: 'error' });
  });
});
