import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerRegistry } from './indexer-registry';

/**
 * Some trackers hand out a session that lapses on its own clock rather than on use, and the only
 * thing that surfaces the lapse is the next approval failing. Touching each of them on a schedule
 * moves that discovery to a background tick and, for adapters that rotate their session, keeps
 * the stored credential current while there is still a valid one to rotate from.
 *
 * Adapters that need nothing simply do not implement `keepalive`, so this costs a quiet instance
 * one query every six hours.
 */
@Injectable()
export class IndexerKeepaliveService {
  private readonly logger = new Logger(IndexerKeepaliveService.name);
  private running = false;

  constructor(
    private readonly indexers: IndexerConfigService,
    private readonly registry: IndexerRegistry,
  ) {}

  @Cron('0 0 */6 * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[request_indexer.keepalive] [fail] error="${sanitizeLogValue(message)}" - keepalive tick failed`);
    } finally {
      this.running = false;
    }
  }

  private async refreshSessions(): Promise<void> {
    const configs = await this.indexers.resolveEnabledConfigs();

    for (const config of configs) {
      const adapter = this.registry.find(config.adapterType);
      if (!adapter?.keepalive) continue;

      try {
        await adapter.keepalive(config);
      } catch (error) {
        // One tracker being unreachable must not stop the others from being kept alive.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[request_indexer.keepalive] [fail] indexerId=${config.id} error="${sanitizeLogValue(message)}" - could not refresh the tracker session`,
        );
      }
    }
  }
}
