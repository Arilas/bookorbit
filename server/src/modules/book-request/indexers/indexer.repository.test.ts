import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
import { IndexerRepository } from './indexer.repository';

describe('IndexerRepository', () => {
  it('selects only assigned colors when choosing a default for a new indexer', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.findAssignedColors();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/^select "color" from "request_indexers"/);
  });

  it('deletes every indexer with the requested adapter type in one query', async () => {
    const { db, queries } = createCapturingDb();
    const repository = new IndexerRepository(db);

    await repository.deleteByAdapterType('demo-tracker');

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/delete from "request_indexers" where "request_indexers"\."adapter_type" = \$1/);
    expect(queries[0].params).toEqual(['demo-tracker']);
  });
});
