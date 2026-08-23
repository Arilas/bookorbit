import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { RequestCredentialService } from '../request-credential.service';
import { IndexerRepository } from './indexer.repository';

/**
 * Write-back for a session id the tracker rotated under us. Kept to its own tiny service so an
 * adapter never reaches for the repository, and so the dependency runs adapter -> store ->
 * repository rather than back into `IndexerConfigService`, which owns the adapters.
 *
 * Without this, a rotated session lives only in adapter memory and stops working at the next
 * restart - a failure that looks like "the tracker suddenly logged us out" days later.
 */
@Injectable()
export class IndexerCredentialStore {
  private readonly logger = new Logger(IndexerCredentialStore.name);

  constructor(
    private readonly repo: IndexerRepository,
    private readonly credentials: RequestCredentialService,
  ) {}

  async rotate(indexerId: number, credential: string): Promise<void> {
    try {
      await this.repo.update(indexerId, { credentialsEnc: this.credentials.encrypt(credential) });
      this.logger.log(`[request_indexer.rotate] [end] indexerId=${indexerId} - stored a rotated tracker session`);
    } catch (error) {
      // A search that found releases must not fail because we could not write the new session
      // back; the old one keeps working until it lapses, and the next tick tries again.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[request_indexer.rotate] [fail] indexerId=${indexerId} error="${sanitizeLogValue(message)}" - could not store the rotated session`,
      );
    }
  }
}
