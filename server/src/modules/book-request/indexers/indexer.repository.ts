import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { requestIndexers, type NewRequestIndexerRow, type RequestIndexerRow } from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class IndexerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<RequestIndexerRow[]> {
    return this.db.select().from(requestIndexers).orderBy(asc(requestIndexers.id));
  }

  async findAssignedColors(): Promise<Array<RequestIndexerRow['color']>> {
    const rows = await this.db.select({ color: requestIndexers.color }).from(requestIndexers);
    return rows.map((row) => row.color);
  }

  async findById(id: number): Promise<RequestIndexerRow | undefined> {
    const [row] = await this.db.select().from(requestIndexers).where(eq(requestIndexers.id, id)).limit(1);
    return row;
  }

  /** Every enabled row. Order is stable rather than meaningful: all of them are searched. */
  async findAllEnabled(): Promise<RequestIndexerRow[]> {
    return this.db.select().from(requestIndexers).where(eq(requestIndexers.enabled, true)).orderBy(asc(requestIndexers.id));
  }

  async create(data: NewRequestIndexerRow): Promise<RequestIndexerRow> {
    const [row] = await this.db.insert(requestIndexers).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewRequestIndexerRow>): Promise<RequestIndexerRow | undefined> {
    const [row] = await this.db.update(requestIndexers).set(data).where(eq(requestIndexers.id, id)).returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(requestIndexers).where(eq(requestIndexers.id, id));
  }

  async deleteByAdapterType(adapterType: string): Promise<number> {
    const result = await this.db.delete(requestIndexers).where(eq(requestIndexers.adapterType, adapterType));
    return result.rowCount ?? 0;
  }

  async recordTestResult(id: number, ok: boolean, errorMessage: string | null): Promise<void> {
    await this.db
      .update(requestIndexers)
      .set({ lastTestedAt: new Date(), lastTestOk: ok, lastErrorMessage: errorMessage })
      .where(eq(requestIndexers.id, id));
  }
}
