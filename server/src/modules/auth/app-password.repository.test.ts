import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { AppPasswordRepository } from './app-password.repository';

function makeRepositoryDb() {
  const db = {
    query: { appPasswords: { findFirst: vi.fn() } },
    transaction: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  return db;
}

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

function makeRotationTx(options: { existing: object | null; activeCount?: number; rotated?: object | null }) {
  const targetFor = vi.fn().mockResolvedValue(options.existing ? [options.existing] : []);
  const targetWhere = vi.fn().mockReturnValue({ for: targetFor });
  const targetFrom = vi.fn().mockReturnValue({ where: targetWhere });
  const countWhere = vi.fn().mockResolvedValue([{ total: options.activeCount ?? 0 }]);
  const countFrom = vi.fn().mockReturnValue({ where: countWhere });
  const credentialReturning = vi.fn().mockResolvedValue(options.rotated ? [options.rotated] : []);
  const credentialWhere = vi.fn().mockReturnValue({ returning: credentialReturning });
  const credentialSet = vi.fn().mockReturnValue({ where: credentialWhere });
  const sessionWhere = vi.fn().mockResolvedValue({ rowCount: 1 });
  const sessionSet = vi.fn().mockReturnValue({ where: sessionWhere });
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValueOnce({ from: targetFrom }).mockReturnValueOnce({ from: countFrom }),
    update: vi.fn().mockReturnValueOnce({ set: credentialSet }).mockReturnValueOnce({ set: sessionSet }),
  };

  return { tx, targetFor, countWhere, credentialSet, sessionSet, sessionWhere };
}

describe('AppPasswordRepository', () => {
  it('counts active credentials', async () => {
    const db = makeRepositoryDb();
    const where = vi.fn().mockResolvedValue([{ total: 3 }]);
    const from = vi.fn().mockReturnValue({ where });
    db.select.mockReturnValue({ from });
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.countActiveByUserId(7)).resolves.toBe(3);
  });

  it('serializes active-limit checks and creates below the cap', async () => {
    const db = makeRepositoryDb();
    const created = {
      id: 2,
      userId: 7,
      label: 'KOReader',
      secretHint: 'abcd',
      expiresAt: new Date(Date.now() + 86_400_000),
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: new Date(),
    };
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 24 }]) }) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([created]) }),
      }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.createWithinActiveLimit(
        {
          userId: 7,
          label: 'KOReader',
          selector: 'selector',
          secretHash: 'hash',
          secretHint: 'abcd',
          expiresAt: created.expiresAt,
        },
        25,
      ),
    ).resolves.toEqual(created);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(compileSql(tx.execute.mock.calls[0]![0])).toMatchObject({
      sql: expect.stringContaining('pg_advisory_xact_lock'),
      params: [4_280_400, 7],
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('does not insert after the serialized active limit is reached', async () => {
    const db = makeRepositoryDb();
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 25 }]) }) }),
      insert: vi.fn(),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.createWithinActiveLimit(
        {
          userId: 7,
          label: 'KOReader',
          selector: 'selector',
          secretHash: 'hash',
          secretHint: 'abcd',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        25,
      ),
    ).resolves.toBeNull();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('does not expose verification material from findUsableById', async () => {
    const db = makeRepositoryDb();
    const expiresAt = new Date(Date.now() + 60_000);
    db.query.appPasswords.findFirst.mockResolvedValue({
      id: 2,
      userId: 7,
      label: 'KOReader',
      selector: 'selector',
      secretHash: 'digest',
      expiresAt,
    });
    const repository = new AppPasswordRepository(db as never);

    const result = await repository.findUsableById(7, 2);

    expect(result).toEqual({ id: 2, label: 'KOReader', expiresAt });
    expect(result).not.toHaveProperty('selector');
    expect(result).not.toHaveProperty('secretHash');
  });

  it('returns the selector only through the internal refresh-generation lookup', async () => {
    const db = makeRepositoryDb();
    const expiresAt = new Date(Date.now() + 60_000);
    db.query.appPasswords.findFirst.mockResolvedValue({
      id: 2,
      label: 'KOReader',
      selector: 'verified-selector',
      secretHash: 'digest',
      expiresAt,
    });
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.findUsableGenerationById(7, 2)).resolves.toEqual({
      id: 2,
      selector: 'verified-selector',
      expiresAt,
    });
  });

  it('records last-used metadata without erasing the previous IP when none is supplied', async () => {
    const db = makeRepositoryDb();
    const returning = vi.fn().mockResolvedValue([{ id: 2 }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.touchLastUsedGeneration(7, 2, 'verified-selector')).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
    const compiledWhere = compileSql(where.mock.calls[0]![0]);
    expect(compiledWhere.params).toEqual(expect.arrayContaining([7, 2, 'verified-selector']));
  });

  it('does not record usage when the credential generation changed', async () => {
    const db = makeRepositoryDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    db.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.touchLastUsedGeneration(7, 2, 'stale-selector', '127.0.0.1')).resolves.toBe(false);

    expect(compileSql(where.mock.calls[0]![0]).params).toEqual(expect.arrayContaining([7, 2, 'stale-selector']));
  });

  it('rotates an active credential at capacity without consuming another slot', async () => {
    const db = makeRepositoryDb();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const rotated = {
      id: 2,
      userId: 7,
      label: 'KOReader',
      secretHint: 'wxyz',
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const { tx, countWhere, credentialSet, sessionSet, sessionWhere } = makeRotationTx({
      existing: { id: 2, expiresAt },
      activeCount: 25,
      rotated,
    });
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    const result = await repository.rotateOwnedWithinActiveLimit(
      7,
      2,
      {
        selector: 'new-selector',
        secretHash: 'new-hash',
        secretHint: 'wxyz',
        expiresAt,
      },
      25,
    );

    expect(result).toEqual({ status: 'rotated', credential: rotated });
    expect(credentialSet).toHaveBeenCalledWith({
      selector: 'new-selector',
      secretHash: 'new-hash',
      secretHint: 'wxyz',
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(compileSql(tx.execute.mock.calls[0]![0]).params).toEqual([4_280_400, 7]);
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(tx.select.mock.invocationCallOrder[0]!);
    expect(tx.select.mock.invocationCallOrder[0]).toBeLessThan(tx.update.mock.invocationCallOrder[0]!);
    expect(countWhere).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(sessionSet).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
    expect(sessionWhere).toHaveBeenCalledTimes(1);
  });

  it('renews an expired credential when 24 active slots are occupied', async () => {
    const db = makeRepositoryDb();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const rotated = {
      id: 2,
      userId: 7,
      label: 'Expired reader',
      secretHint: 'wxyz',
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const { tx, countWhere } = makeRotationTx({
      existing: { id: 2, expiresAt: new Date(Date.now() - 1) },
      activeCount: 24,
      rotated,
    });
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.rotateOwnedWithinActiveLimit(
        7,
        2,
        {
          selector: 'new-selector',
          secretHash: 'new-hash',
          secretHint: 'wxyz',
          expiresAt,
        },
        25,
      ),
    ).resolves.toEqual({ status: 'rotated', credential: rotated });
    expect(countWhere).toHaveBeenCalledTimes(1);
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(tx.select.mock.invocationCallOrder[0]!);
    expect(tx.select.mock.invocationCallOrder[1]).toBeLessThan(tx.update.mock.invocationCallOrder[0]!);
  });

  it('rejects expired credential renewal when all 25 active slots are occupied', async () => {
    const db = makeRepositoryDb();
    const { tx, countWhere } = makeRotationTx({
      existing: { id: 2, expiresAt: new Date(Date.now() - 1) },
      activeCount: 25,
    });
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.rotateOwnedWithinActiveLimit(
        7,
        2,
        {
          selector: 'new-selector',
          secretHash: 'new-hash',
          secretHint: 'wxyz',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        25,
      ),
    ).resolves.toEqual({ status: 'active_limit_reached' });
    expect(countWhere).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('does not mutate credentials or sessions when rotation does not match an owned credential', async () => {
    const db = makeRepositoryDb();
    const { tx } = makeRotationTx({ existing: null });
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.rotateOwnedWithinActiveLimit(
        7,
        999,
        {
          selector: 'new-selector',
          secretHash: 'new-hash',
          secretHint: 'wxyz',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        25,
      ),
    ).resolves.toEqual({ status: 'not_found' });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('revokes an owned credential and its refresh tokens in one transaction', async () => {
    const db = makeRepositoryDb();
    const credentialReturning = vi.fn().mockResolvedValue([{ id: 2, userId: 7, label: 'KOReader' }]);
    const credentialWhere = vi.fn().mockReturnValue({ returning: credentialReturning });
    const credentialSet = vi.fn().mockReturnValue({ where: credentialWhere });
    const sessionWhere = vi.fn().mockResolvedValue({ rowCount: 2 });
    const sessionSet = vi.fn().mockReturnValue({ where: sessionWhere });
    const tx = {
      update: vi.fn().mockReturnValueOnce({ set: credentialSet }).mockReturnValueOnce({ set: sessionSet }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    const result = await repository.revokeOwnedWithSessions(7, 2);

    expect(result).toEqual({ id: 2, userId: 7, label: 'KOReader' });
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(credentialSet).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
    expect(sessionSet).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
  });

  it('does not touch sessions when the owned credential did not match', async () => {
    const db = makeRepositoryDb();
    const credentialReturning = vi.fn().mockResolvedValue([]);
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: credentialReturning }) }),
      }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.revokeOwnedWithSessions(7, 999)).resolves.toBeNull();
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('revokes all credential sessions when handling refresh replay, even if the credential was already revoked', async () => {
    const db = makeRepositoryDb();
    const credentialReturning = vi.fn().mockResolvedValue([]);
    const credentialSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: credentialReturning }),
    });
    const sessionSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 1 }) });
    const tx = {
      update: vi.fn().mockReturnValueOnce({ set: credentialSet }).mockReturnValueOnce({ set: sessionSet }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.revokeByIdWithSessions(2)).resolves.toBeNull();
    expect(tx.update).toHaveBeenCalledTimes(2);
  });

  it('revokes every credential and linked live refresh token for a user', async () => {
    const db = makeRepositoryDb();
    const selectWhere = vi.fn().mockResolvedValue([{ id: 2 }, { id: 3 }]);
    const tx = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
      update: vi
        .fn()
        .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 2 }) }) })
        .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 4 }) }) }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(repository.revokeAllForUser(7)).resolves.toEqual({ credentialsRevoked: 2, sessionsRevoked: 4 });
    expect(tx.update).toHaveBeenCalledTimes(2);
  });
});
