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

  it('does not expose the stored digest from findUsableById', async () => {
    const db = makeRepositoryDb();
    db.query.appPasswords.findFirst.mockResolvedValue({ id: 2, userId: 7, label: 'KOReader', secretHash: 'digest' });
    const repository = new AppPasswordRepository(db as never);

    const result = await repository.findUsableById(7, 2);

    expect(result).toEqual({ id: 2, userId: 7, label: 'KOReader' });
    expect(result).not.toHaveProperty('secretHash');
  });

  it('records last-used metadata without erasing the previous IP when none is supplied', async () => {
    const db = makeRepositoryDb();
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });
    const repository = new AppPasswordRepository(db as never);

    await repository.touchLastUsed(2);

    expect(set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
  });

  it('rotates an owned credential and deletes every linked refresh family in one transaction', async () => {
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
    const credentialReturning = vi.fn().mockResolvedValue([rotated]);
    const credentialWhere = vi.fn().mockReturnValue({ returning: credentialReturning });
    const credentialSet = vi.fn().mockReturnValue({ where: credentialWhere });
    const sessionWhere = vi.fn().mockResolvedValue({ rowCount: 3 });
    const tx = {
      update: vi.fn().mockReturnValue({ set: credentialSet }),
      delete: vi.fn().mockReturnValue({ where: sessionWhere }),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    const result = await repository.rotateOwnedWithSessions(7, 2, {
      selector: 'new-selector',
      secretHash: 'new-hash',
      secretHint: 'wxyz',
      expiresAt,
    });

    expect(result).toEqual(rotated);
    expect(credentialSet).toHaveBeenCalledWith({
      selector: 'new-selector',
      secretHash: 'new-hash',
      secretHint: 'wxyz',
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(sessionWhere).toHaveBeenCalledTimes(1);
  });

  it('does not delete refresh families when rotation does not match an owned credential', async () => {
    const db = makeRepositoryDb();
    const credentialReturning = vi.fn().mockResolvedValue([]);
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: credentialReturning }) }),
      }),
      delete: vi.fn(),
    };
    db.transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
    const repository = new AppPasswordRepository(db as never);

    await expect(
      repository.rotateOwnedWithSessions(7, 999, {
        selector: 'new-selector',
        secretHash: 'new-hash',
        secretHint: 'wxyz',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).resolves.toBeNull();
    expect(tx.delete).not.toHaveBeenCalled();
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
