import { Injectable, Logger } from '@nestjs/common';
import { canonicalizeBookRequestIsbn, compareByTier, MAX_BOOK_REQUEST_SEARCH_ISBNS, releaseProfileIsActive } from '@bookorbit/types';
import type {
  BookRequestMediaKind,
  IndexerSearchQuery,
  IndexerSearchFailure,
  IndexerSearchStatus,
  ReleaseSearchOverrides,
  ReleaseSearchCriteria,
  ReleaseSearchResult,
  ReleaseTier,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestRow } from '../../../db/schema';
import { RequestAutomationSettingsService } from '../fulfillment/request-automation-settings.service';
import { IndexerSearchException, type ReleaseCandidate, type ReleaseQuery, type ResolvedIndexerConfig } from './indexer-adapter';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerRegistry } from './indexer-registry';
import { rejectRelease, scoreRelease, toReleaseItem, type ScoredRelease, type ScoringRequest } from './release-scoring';
import { buildSearchText } from './search-text';

/**
 * Parallel search across every enabled indexer is exactly the pattern that gets a private tracker
 * account throttled, so it is capped rather than unbounded, each indexer gets its own deadline,
 * and a repeat open of the picker is served from the cache instead of hitting the trackers again.
 */
const MAX_CONCURRENT_SEARCHES = 3;
const PER_INDEXER_TIMEOUT_MS = 20_000;
const RESULT_LIMIT_PER_INDEXER = 50;
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_CACHE_ENTRIES_PER_REQUEST = 5;
/** A ceiling on the merged list. The picker shows a ranked shortlist, not a tracker browser. */
const MAX_MERGED_RELEASES = 100;

interface CacheEntry {
  requestId: number;
  result: ReleaseSearchResult;
  expiresAt: number;
  /** The resolved release, kept server-side so a grab names an id and never a URL. */
  candidates: Map<string, ReleaseCandidate>;
}

export type IndexerSearchMode = 'all' | 'isbn-capable';

interface IndexerSearchOptions {
  refresh?: boolean;
  overrides?: ReleaseSearchOverrides;
  /** Internal automation pass selection. Manual searches always use every compatible indexer. */
  indexerMode?: IndexerSearchMode;
}

@Injectable()
export class IndexerSearchService {
  private readonly logger = new Logger(IndexerSearchService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly indexers: IndexerConfigService,
    private readonly registry: IndexerRegistry,
    private readonly automationSettings: RequestAutomationSettingsService,
  ) {}

  async search(request: BookRequestRow, options: IndexerSearchOptions = {}): Promise<ReleaseSearchResult> {
    const searchKey = JSON.stringify({ overrides: options.overrides ?? null, indexerMode: options.indexerMode ?? 'all' });
    const cacheKey = `${request.id}:${searchKey}`;
    const cached = this.cache.get(cacheKey);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cached: true };
    }

    const configs = await this.indexers.resolveEnabledConfigs();
    const { profiles } = await this.automationSettings.get();
    const tiers = profiles[request.mediaKind] ?? [];
    const { scoringRequest, availableIsbns } = prepareScoringRequest(request, tiers, options.overrides);
    const query = toQuery(scoringRequest);

    // A source that does not carry the requested medium is left out of the search rather than
    // searched and reported: nothing went wrong, no request was ever going to be made, and a
    // permanent property of the source has no business in a list of search outcomes. Counted, so
    // an empty list can still say why it is empty.
    const compatible = configs.filter((config) => this.carriesMedium(config, query.mediaKind));
    const searchable =
      options.indexerMode === 'isbn-capable'
        ? compatible.filter((config) => this.registry.find(config.adapterType)?.supportsIsbnSearch === true)
        : compatible;
    const uncoveredIndexerCount = configs.length - compatible.length;

    const started = Date.now();
    const outcomes = await this.searchAll(searchable, query);

    const candidates = new Map<string, ReleaseCandidate>();
    const statuses: IndexerSearchStatus[] = [];
    const scored: Array<{ scored: ScoredRelease; indexerName: string }> = [];

    for (const { config, releases, query: indexerQuery, failure, error } of outcomes) {
      const seedsBack = this.registry.seedsBack(config.adapterType);
      if (failure) {
        statuses.push({
          indexerId: config.id,
          indexerName: config.name,
          color: config.color,
          ok: false,
          count: 0,
          filtered: 0,
          ...(indexerQuery ? { query: indexerQuery } : {}),
          failure,
          error,
          seedsBack,
        });
        continue;
      }

      let filtered = 0;
      let kept = 0;
      for (const candidate of releases) {
        const rejection = rejectRelease(candidate, scoringRequest);
        if (rejection) {
          filtered++;
          continue;
        }
        candidates.set(candidateKey(candidate), candidate);
        scored.push({ scored: scoreRelease(candidate, scoringRequest), indexerName: config.name });
        kept++;
      }
      statuses.push({
        indexerId: config.id,
        indexerName: config.name,
        color: config.color,
        ok: true,
        count: kept,
        filtered,
        query: indexerQuery,
        seedsBack,
      });
    }

    // Mapped before the sort because tier is a property of the finished item, and the merged list
    // has to be cut on the same axis the automation will read it by: tier first, so truncating at
    // a hundred can never drop a release from a tier the operator asked for in favour of an
    // untiered one that merely scored well.
    const items = scored.map((entry) => toReleaseItem(entry.scored, entry.indexerName, scoringRequest));
    // An unreported seeder count sorts below a stated one rather than above every zero.
    items.sort((a, b) => compareByTier(a.tier, b.tier) || b.score - a.score || (b.seeders ?? -1) - (a.seeders ?? -1));
    const releases = items.slice(0, MAX_MERGED_RELEASES);

    const result: ReleaseSearchResult = {
      releases,
      criteria: toSearchCriteria(scoringRequest, availableIsbns),
      indexers: statuses,
      uncoveredIndexerCount,
      profileActive: releaseProfileIsActive(tiers),
      searchedAt: new Date().toISOString(),
      cached: false,
    };
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { requestId: request.id, result, expiresAt: Date.now() + CACHE_TTL_MS, candidates });
    this.prune(request.id);

    this.logger.log(
      `[book_request.release_search] [end] requestId=${request.id} indexers=${searchable.length} uncovered=${uncoveredIndexerCount} releases=${releases.length} durationMs=${Date.now() - started} - searched enabled indexers`,
    );
    return result;
  }

  /**
   * The exact release the approver looked at, resolved server-side. A grab names an indexer and a
   * guid; it never carries a download URL, so a client cannot point the download client anywhere.
   */
  find(requestId: number, indexerId: number, guid: string): ReleaseCandidate | undefined {
    const key = `${indexerId}:${guid}`;
    for (const entry of [...this.cache.values()].reverse()) {
      if (entry.requestId !== requestId || entry.expiresAt <= Date.now()) continue;
      const candidate = entry.candidates.get(key);
      if (candidate) return candidate;
    }
    return undefined;
  }

  forget(requestId: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.requestId === requestId) this.cache.delete(key);
    }
  }

  /**
   * Whether this source is searched for the requested medium: what its adapter can answer for, and
   * then what the operator left it in. A row whose adapter is no longer part of this build cannot
   * be judged on its media and is kept in the search, so `searchOne` reports the missing adapter
   * instead of this hiding it; an operator's own exclusion still applies to such a row, because
   * that one is a decision about the source rather than a fact about the build.
   */
  private carriesMedium(config: ResolvedIndexerConfig, mediaKind: BookRequestMediaKind): boolean {
    if (config.disabledMediaKinds.includes(mediaKind)) return false;
    const adapter = this.registry.find(config.adapterType);
    return !adapter || adapter.mediaKinds.includes(mediaKind);
  }

  private async searchAll(configs: ResolvedIndexerConfig[], query: ReleaseQuery): Promise<SearchOutcome[]> {
    const outcomes: SearchOutcome[] = [];
    const queue = [...configs];

    const worker = async (): Promise<void> => {
      for (let config = queue.shift(); config !== undefined; config = queue.shift()) {
        outcomes.push(await this.searchOne(config, query));
      }
    };

    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SEARCHES, configs.length) }, worker));
    // Workers drain a shared queue, so completion order is arbitrary; the UI wants pick order.
    return outcomes.sort((a, b) => configs.indexOf(a.config) - configs.indexOf(b.config));
  }

  private async searchOne(config: ResolvedIndexerConfig, query: ReleaseQuery): Promise<SearchOutcome> {
    const adapter = this.registry.find(config.adapterType);
    if (!adapter) {
      // A row whose adapter is no longer part of the build. It is kept rather than deleted, so
      // that the operator can see it and replace it instead of losing a stored credential.
      return {
        config,
        releases: [],
        failure: 'error',
        error: `This install has no "${config.adapterType}" adapter. Edit it or delete its plugin under Settings > System > Requests.`,
      };
    }

    const indexerQuery: IndexerSearchQuery =
      adapter.supportsIsbnSearch && query.isbn13 ? { kind: 'isbn', value: query.isbn13 } : { kind: 'titleAuthor', value: buildSearchText(query) };

    try {
      const releases = await adapter.search(query, config, AbortSignal.timeout(PER_INDEXER_TIMEOUT_MS));
      return { config, releases, query: indexerQuery };
    } catch (error) {
      const failure: IndexerSearchFailure = error instanceof IndexerSearchException ? error.failure : 'error';
      const message = error instanceof Error ? error.message : String(error);
      // One tracker failing is a per-indexer state in the picker, not a failed search.
      this.logger.warn(
        `[book_request.release_search] [fail] indexerId=${config.id} failure=${failure} error="${sanitizeLogValue(message)}" - indexer search failed`,
      );
      return { config, releases: [], query: indexerQuery, failure, error: message };
    }
  }

  /** Search variants are short-lived and bounded per request, so manual edits cannot grow this forever. */
  private prune(requestId: number): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }

    const requestEntries = [...this.cache.entries()].filter(([, entry]) => entry.requestId === requestId);
    for (const [key] of requestEntries.slice(0, -MAX_CACHE_ENTRIES_PER_REQUEST)) {
      this.cache.delete(key);
    }
  }
}

interface SearchOutcome {
  config: ResolvedIndexerConfig;
  releases: ReleaseCandidate[];
  query?: IndexerSearchQuery;
  failure?: IndexerSearchFailure;
  error?: string;
}

function candidateKey(candidate: ReleaseCandidate): string {
  return `${candidate.indexerId}:${candidate.guid}`;
}

function toQuery(request: ScoringRequest): ReleaseQuery {
  return {
    title: request.title,
    author: request.authors[0] ?? null,
    isbn13: request.isbns[0] ?? null,
    isbn13s: request.isbns,
    mediaKind: request.mediaKind,
    language: request.language,
    limit: RESULT_LIMIT_PER_INDEXER,
  };
}

function prepareScoringRequest(
  request: BookRequestRow,
  tiers: readonly ReleaseTier[],
  overrides?: ReleaseSearchOverrides,
): { scoringRequest: ScoringRequest; availableIsbns: string[] } {
  const requestIdentifiers = bookRequestSearchIsbns(request);
  const activeIsbn = overrides?.isbn !== undefined ? overrides.isbn : (requestIdentifiers[0] ?? null);
  const availableIsbns = activeIsbn && !requestIdentifiers.includes(activeIsbn) ? [activeIsbn, ...requestIdentifiers] : requestIdentifiers;
  return {
    scoringRequest: {
      title: overrides?.title ?? request.title,
      authors: overrides?.authors ?? request.authors ?? [],
      isbn13: activeIsbn,
      isbn10: null,
      isbns: activeIsbn ? [activeIsbn] : [],
      mediaKind: request.mediaKind,
      preferredFormats: overrides?.preferredFormats ?? request.preferredFormats ?? [],
      language: overrides?.language !== undefined ? overrides.language : request.language,
      tiers,
    },
    availableIsbns: availableIsbns.slice(0, MAX_BOOK_REQUEST_SEARCH_ISBNS),
  };
}

function toSearchCriteria(request: ScoringRequest, availableIsbns: string[]): ReleaseSearchCriteria {
  return {
    title: request.title,
    authors: request.authors,
    isbn10: request.isbn10,
    isbn13: request.isbn13,
    activeIsbn: request.isbns[0] ?? null,
    isbns: availableIsbns,
    mediaKind: request.mediaKind,
    language: request.language,
    preferredFormats: request.preferredFormats,
  };
}

export function bookRequestSearchIsbns(request: BookRequestRow): string[] {
  const values = [
    canonicalizeBookRequestIsbn(request.isbn10, request.isbn13),
    ...(request.metadataSources ?? []).map((source) => canonicalizeBookRequestIsbn(source.isbn10, source.isbn13)),
  ].filter((value): value is string => value !== null);
  return [...new Set(values)].slice(0, MAX_BOOK_REQUEST_SEARCH_ISBNS);
}
