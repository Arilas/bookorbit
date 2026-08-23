import { Logger } from '@nestjs/common';
import type {
  IndexerPlugin,
  PluginHost,
  PluginIndexerConfig,
  PluginReleaseCandidate,
  PluginReleaseQuery,
  PluginRequestInit,
  PluginSearchFailure,
} from '@bookorbit/plugin-api';
import type { BookRequestMediaKind, IndexerAdapterType, IndexerSettingsField } from '@bookorbit/types';

import { boundedResponse } from '../../../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../../common/utils/safe-fetch';
import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import { buildSearchText } from '../search-text';
import { MAX_TORRENT_FILE_BYTES } from '../../fulfillment/torrent.utils';
import type { IndexerCredentialStore } from '../indexer-credential-store';
import {
  IndexerSearchException,
  type IndexerAdapter,
  type ReleaseCandidate,
  type ReleaseFile,
  type ReleaseQuery,
  type ResolvedIndexerConfig,
} from '../indexer-adapter';

/**
 * A ceiling on any one request a plugin makes, and one it cannot opt out of.
 *
 * A ceiling per request is not a deadline for the work, though: a plugin that reads four pages
 * can sit behind this one four times over while the per-indexer deadline expires unheard. Where a
 * caller has a deadline of its own, `deadlineFor` combines the two.
 */
const REQUEST_TIMEOUT_MS = 25_000;
/**
 * A ceiling on the body of any one request too, and likewise one a plugin cannot opt out of.
 *
 * What a plugin reads is a page, a feed or a JSON document, never a book: a file a download client
 * will open is resolved as a URL rather than fetched here. Generous enough that no real source
 * reaches it, low enough that a body which never ends is bounded rather than fatal.
 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/** A redirect chain, not a loop. Matches the other outbound fetchers. */
const MAX_REDIRECTS = 5;

/**
 * Wraps a plugin so the rest of the module sees an ordinary `IndexerAdapter` and never learns
 * that this one came off disk.
 *
 * The wrapper is what a well-behaved plugin is held to, not a sandbox: a plugin runs in this
 * process with this process's reach, and `plugin-loader.service.ts` states that trade openly.
 * What the wrapper does hold is every path through it. `host.fetch` applies the address policy
 * and the deadline; `host.saveCredential` is the only credential write it offers; and whatever a
 * plugin throws is normalised here, because an error thrown across a dynamic import boundary is
 * not an `instanceof` anything we own.
 */
export class PluginIndexerAdapter implements IndexerAdapter {
  readonly type: IndexerAdapterType;
  readonly label: string;
  readonly requiresCredential: boolean;
  readonly mediaKinds: readonly BookRequestMediaKind[];
  readonly supportsIsbnSearch: boolean;
  readonly settingsFields: readonly IndexerSettingsField[];

  private readonly logger: Logger;

  constructor(
    readonly plugin: IndexerPlugin,
    private readonly credentials: IndexerCredentialStore,
  ) {
    this.type = plugin.type as IndexerAdapterType;
    this.label = plugin.label;
    this.requiresCredential = plugin.requiresCredential;
    this.mediaKinds = plugin.mediaKinds as readonly BookRequestMediaKind[];
    this.supportsIsbnSearch = plugin.supportsIsbnSearch === true;
    this.settingsFields = plugin.settingsFields ?? [];
    this.logger = new Logger(`plugin:${plugin.type}`);
  }

  async search(query: ReleaseQuery, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseCandidate[]> {
    const found = await this.guard(config, () => this.plugin.search(toPluginQuery(query), toPluginConfig(config), this.host(config, signal), signal));
    return found.map((release) => ({ ...release, indexerId: config.id }));
  }

  async test(config: ResolvedIndexerConfig) {
    return this.guard(config, () => this.plugin.test(toPluginConfig(config), this.host(config)));
  }

  get fetchTorrentFile() {
    if (!this.plugin.fetchTorrentFile) return undefined;
    return async (release: ReleaseCandidate, config: ResolvedIndexerConfig): Promise<Buffer> => {
      const bytes = await this.guard(config, () =>
        this.plugin.fetchTorrentFile!(toPluginRelease(release), toPluginConfig(config), this.host(config)),
      );
      // A plugin has no reason to be trusted about size, and this lands in memory.
      if (bytes.byteLength > MAX_TORRENT_FILE_BYTES) {
        throw new IndexerSearchException('error', `${config.name} returned something too large to be a .torrent file`);
      }
      return Buffer.from(bytes);
    };
  }

  get resolveFile() {
    if (!this.plugin.resolveFile) return undefined;
    return async (release: ReleaseCandidate, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseFile> => {
      const file = await this.guard(config, () =>
        this.plugin.resolveFile!(toPluginRelease(release), toPluginConfig(config), this.host(config, signal), signal),
      );
      // The URL is about to be handed to a download client, so it is checked here rather than
      // trusted: this is the one value a plugin produces that reaches the network on its own.
      await ensureSafeUrl(file.url, { allowPrivate: config.allowPrivateAddress });
      return file;
    };
  }

  get keepalive() {
    if (!this.plugin.keepalive) return undefined;
    return async (config: ResolvedIndexerConfig): Promise<void> => {
      await this.guard(config, () => this.plugin.keepalive!(toPluginConfig(config), this.host(config)));
    };
  }

  /**
   * `deadline` is the caller's, where the caller has one. It is applied here rather than handed to
   * the plugin because a plugin can only check a signal between requests, and the request that
   * overruns is the one already in flight.
   */
  private host(config: ResolvedIndexerConfig, deadline?: AbortSignal): PluginHost {
    return {
      fetch: (url: string, init?: PluginRequestInit) => this.fetchForPlugin(config, url, init, deadline),
      logger: {
        log: (message: string) => this.logger.log(sanitizeLogValue(message)),
        warn: (message: string) => this.logger.warn(sanitizeLogValue(message)),
      },
      buildSearchText: (query: PluginReleaseQuery) => buildSearchText(query as ReleaseQuery),
      saveCredential: (credential: string) => this.credentials.rotate(config.id, credential),
      fail: (failure: PluginSearchFailure, message: string) => new IndexerSearchException(failure, `${config.name}: ${message}`),
    };
  }

  /**
   * The one way a plugin reaches the network, and therefore where every guarantee about that
   * traffic is made rather than hoped for.
   *
   * Redirects are followed here rather than by the fetch, because `redirect: 'follow'` checks the
   * first URL and nothing after it: a hop to loopback or to a link-local metadata address would
   * be taken without ever being seen. A plugin that asks for `'manual'` gets the 3xx itself,
   * which is how an expired session is told apart from a real answer, and never a body fetched
   * from an address that was not checked.
   */
  private async fetchForPlugin(
    config: ResolvedIndexerConfig,
    rawUrl: string,
    init: PluginRequestInit | undefined,
    deadline: AbortSignal | undefined,
  ): Promise<Response> {
    const signal = deadlineFor(deadline);
    const options = { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile };

    let current = rawUrl;
    let method = init?.method ?? 'GET';
    let headers = { ...(init?.headers ?? {}) };
    let body = init?.body;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await safeFetch(current, { method, headers, ...(body !== undefined ? { body } : {}), redirect: 'manual', signal }, options);

      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (init?.redirect === 'manual' || !location) return boundedResponse(response, MAX_RESPONSE_BYTES);

      void response.body?.cancel().catch(() => undefined);
      const next = await ensureSafeUrl(new URL(location, current).href, options);

      // The two rules `redirect: 'follow'` would have applied for us, and both matter here: a
      // plugin posts a search and authenticates with a session cookie, so replaying the body or
      // carrying the cookie onward would send a tracker's credential wherever it pointed.
      if (downgradesToGet(response.status, method)) {
        method = 'GET';
        body = undefined;
      }
      if (new URL(current).origin !== next.origin) headers = withoutCredentialHeaders(headers);

      current = next.href;
    }

    throw new IndexerSearchException('error', `${config.name} redirected more than ${MAX_REDIRECTS} times`);
  }

  /**
   * Anything a plugin throws becomes a failure the picker can act on. Without this a plugin that
   * throws a bare `TypeError` would surface as an unexplained empty result, which is the failure
   * mode this module exists to avoid.
   */
  private async guard<T>(config: ResolvedIndexerConfig, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof IndexerSearchException) throw error;
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new IndexerSearchException('timeout', `${config.name} did not answer in time`);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[request_indexer.plugin] [fail] indexerId=${config.id} type=${this.type} error="${sanitizeLogValue(message)}" - the plugin threw`,
      );
      throw new IndexerSearchException('error', `${config.name}: ${message}`);
    }
  }
}

/** 303 always, and 301 or 302 for anything that was not already a GET or a HEAD. */
function downgradesToGet(status: number, method: string): boolean {
  const safeMethod = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
  return status === 303 || ((status === 301 || status === 302) && !safeMethod);
}

const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'cookie2', 'proxy-authorization']);

function withoutCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
}

/**
 * Whichever expires first ends the request: the per-request ceiling, or the deadline the search
 * itself is working to. Without the second one a stalled source runs the full ceiling and blows
 * past the per-indexer deadline, which is measurably what happens - libgen.li answers the same
 * query in under a second and, occasionally, not at all.
 */
function deadlineFor(deadline?: AbortSignal): AbortSignal {
  const ceiling = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return deadline ? AbortSignal.any([deadline, ceiling]) : ceiling;
}

function toPluginQuery(query: ReleaseQuery): PluginReleaseQuery {
  return {
    title: query.title,
    author: query.author,
    isbn13: query.isbn13,
    isbn13s: query.isbn13s,
    mediaKind: query.mediaKind,
    language: query.language,
    limit: query.limit,
  };
}

/**
 * Deliberately a deep copy. A shallow one still shares the category arrays and the settings
 * object, so a plugin that pushed onto `categories.ebook` would be editing the config every other
 * adapter in this search is reading from.
 */
function toPluginConfig(config: ResolvedIndexerConfig): PluginIndexerConfig {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    credential: config.credential,
    allowPrivateAddress: config.allowPrivateAddress,
    categories: {
      ebook: [...config.categories.ebook],
      audiobook: [...config.categories.audiobook],
      comic: [...config.categories.comic],
    },
    settings: config.settings ? structuredClone(config.settings as Record<string, unknown>) : null,
  };
}

/** `indexerId` is ours to set, not a plugin's to see echoed back. */
function toPluginRelease(release: ReleaseCandidate): PluginReleaseCandidate {
  const rest: Partial<ReleaseCandidate> = { ...release };
  delete rest.indexerId;
  return rest as PluginReleaseCandidate;
}
