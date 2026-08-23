import { BadRequestException, Injectable } from '@nestjs/common';
import { realpath, stat } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { DownloadClientRepository } from './download-client.repository';

const MAX_PATH_LENGTH = 4096;

/**
 * The one instruction that fixes a client with no mapping, said the same way at grab time and at
 * import time because either can be the first to notice the absence.
 */
export const ADD_PATH_MAPPING_HINT =
  'Add one under Settings > System > Requests; if the client and BookOrbit see the same filesystem, map the download directory to itself.';

export interface ResolvedDownloadPath {
  localPath: string;
  /** The mapping that produced it, and therefore the root the path must stay inside. */
  containmentRoot: string;
}

/**
 * Translates what a download client reports into something BookOrbit can open.
 *
 * Containment is rooted at the matched mapping's own `localPath`, not at `LIBRARY_BROWSE_ROOT`.
 * `PathPolicyService` guards the latter, which defaults to `/` and would therefore accept every
 * path on the host; a download directory is also not the library browse root semantically. The
 * symlink-aware walk below is that service's technique with the root swapped.
 */
@Injectable()
export class PathMappingService {
  constructor(private readonly repo: DownloadClientRepository) {}

  /**
   * Every client must declare at least one mapping, the single-host case included: qBittorrent and
   * BookOrbit seeing the same filesystem makes the translation an identity, not an absence, and
   * `/downloads -> /downloads` still says which directory the import may read out of. Accepting
   * whatever an unmapped client reported left a compromised or misconfigured one able to point the
   * importer at any readable path on the host.
   */
  async toLocalPath(clientId: number, remotePath: string): Promise<ResolvedDownloadPath> {
    const reported = remotePath?.trim() ?? '';
    if (!reported) throw new BadRequestException('The download client did not report a content path');
    if (reported.length > MAX_PATH_LENGTH) throw new BadRequestException('The download client reported a path that is too long');

    const mappings = await this.repo.findPathMappings(clientId);
    if (mappings.length === 0) {
      throw new BadRequestException(
        `This download client has no path mapping, so there is no directory BookOrbit may import from. ${ADD_PATH_MAPPING_HINT}`,
      );
    }

    for (const mapping of mappings) {
      const remainder = prefixRemainder(reported, mapping.remotePath);
      if (remainder === null) continue;

      const root = resolve(mapping.localPath);
      const candidate = remainder ? resolve(join(root, remainder)) : root;
      if (!(await isWithin(root, candidate))) {
        throw new BadRequestException('The mapped download path resolves outside its configured local path');
      }
      return { localPath: candidate, containmentRoot: root };
    }

    throw new BadRequestException(`No path mapping covers "${reported}". Add one under the download client's settings.`);
  }

  /**
   * Re-checks a path the release plan produced against the root the download was resolved inside,
   * immediately before it is opened or linked. `toLocalPath` answers for the directory the client
   * named; everything under it was named by the release, whose contents nobody vouched for.
   */
  async assertWithinRoot(containmentRoot: string, candidate: string): Promise<void> {
    if (await isWithin(containmentRoot, candidate)) return;
    throw new BadRequestException('The download points at a file outside the directory it was downloaded into');
  }

  /**
   * Whether a hardlink from this local path into the Book Dock can work at all. Comparing device
   * ids answers that without writing anything, and a different device is a supported (if
   * space-doubling) configuration rather than an error.
   */
  async testHardlink(
    localPath: string,
    bookDockPath: string,
  ): Promise<{ localPathExists: boolean; bookDockPathExists: boolean; sameFilesystem: boolean }> {
    const [local, dock] = await Promise.all([safeStatDevice(localPath), safeStatDevice(bookDockPath)]);
    return {
      localPathExists: local !== null,
      bookDockPathExists: dock !== null,
      sameFilesystem: local !== null && dock !== null && local === dock,
    };
  }
}

/**
 * Prefix matching on segment boundaries: `/downloads/complete` must not match `/downloads/completed-books`.
 * Returns the remainder after the prefix, `''` for an exact match, or null when it does not match.
 */
function prefixRemainder(reported: string, remotePrefix: string): string | null {
  const normalizedReported = normalizeSeparators(reported);
  const normalizedPrefix = trimTrailingSeparator(normalizeSeparators(remotePrefix));
  if (!normalizedPrefix) return null;

  if (normalizedReported === normalizedPrefix) return '';
  if (!normalizedReported.startsWith(normalizedPrefix)) return null;
  const next = normalizedReported.charAt(normalizedPrefix.length);
  if (next !== '/') return null;
  return normalizedReported.slice(normalizedPrefix.length + 1);
}

/** Windows clients report backslashes; the mapping's local side is always POSIX. */
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function trimTrailingSeparator(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

/**
 * Lexical check first, then `realpath` up the existing-ancestor chain, so a symlink planted
 * inside the download directory cannot point the import at something outside it.
 */
async function isWithin(root: string, candidate: string): Promise<boolean> {
  if (isEscaping(relative(root, candidate))) return false;

  const [canonicalRoot, canonicalCandidate] = await Promise.all([canonicalize(root), canonicalize(candidate)]);
  return !isEscaping(relative(canonicalRoot, canonicalCandidate));
}

function isEscaping(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function canonicalize(target: string): Promise<string> {
  const suffixSegments: string[] = [];
  let current = resolve(target);

  while (true) {
    try {
      const canonical = await realpath(current);
      return suffixSegments.reduceRight((built, segment) => join(built, segment), canonical);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return resolve(target);
    }

    const parent = dirname(current);
    if (parent === current) return resolve(target);
    suffixSegments.push(basename(current));
    current = parent;
  }
}

async function safeStatDevice(target: string): Promise<number | null> {
  try {
    return (await stat(target)).dev;
  } catch {
    return null;
  }
}
