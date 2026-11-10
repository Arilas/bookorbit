import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';

import { AuditAction } from '@bookorbit/types';

import { AppPasswordService } from './app-password.service';

function makeActor() {
  return { id: 7, username: 'reader', provisioningMethod: 'local' } as never;
}

function makeService() {
  const appPasswordRepo = {
    listByUserId: vi.fn().mockResolvedValue([]),
    countActiveByUserId: vi.fn().mockResolvedValue(0),
    createWithinActiveLimit: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
      id: 11,
      userId: data.userId,
      label: data.label,
      secretHint: data.secretHint,
      expiresAt: data.expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: new Date('2026-08-25T10:00:00.000Z'),
    })),
    findForVerification: vi.fn(),
    findUsableById: vi.fn(),
    findUsableGenerationById: vi.fn(),
    touchLastUsedGeneration: vi.fn().mockResolvedValue(true),
    rotateOwnedWithinActiveLimit: vi.fn(),
    revokeOwnedWithSessions: vi.fn(),
    revokeByIdWithSessions: vi.fn(),
    revokeAllForUser: vi.fn(),
  };
  const auditEvents = { emit: vi.fn() };
  const service = new AppPasswordService(appPasswordRepo as never, auditEvents as never);

  return { service, appPasswordRepo, auditEvents };
}

describe('AppPasswordService', () => {
  describe('list', () => {
    it('maps non-secret credential metadata and status', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.listByUserId.mockResolvedValue([
        {
          id: 1,
          label: 'KOReader',
          secretHint: 'abcd',
          expiresAt: new Date(Date.now() + 60_000),
          lastUsedAt: new Date('2026-08-24T10:00:00.000Z'),
          lastUsedIp: '127.0.0.1',
          createdAt: new Date('2026-08-20T10:00:00.000Z'),
          activeSessions: 2,
        },
        {
          id: 2,
          label: 'Old client',
          secretHint: 'wxyz',
          expiresAt: new Date(Date.now() - 60_000),
          lastUsedAt: null,
          lastUsedIp: null,
          createdAt: new Date('2026-07-20T10:00:00.000Z'),
          activeSessions: 0,
        },
      ]);

      const result = await service.list(7);

      expect(result).toEqual([
        expect.objectContaining({ id: 1, hint: 'abcd', activeSessions: 2, status: 'active' }),
        expect.objectContaining({ id: 2, hint: 'wxyz', activeSessions: 0, status: 'expired' }),
      ]);
      expect(result[0]).not.toHaveProperty('secretHash');
      expect(result[0]).not.toHaveProperty('selector');
    });
  });

  describe('create', () => {
    it('generates a prefixed password, persists only its digest, and emits an audit event', async () => {
      const { service, appPasswordRepo, auditEvents } = makeService();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const result = await service.create(makeActor(), { label: '  KOReader  ', expiresAt }, '10.0.0.5');

      expect(result.password).toMatch(/^boap_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
      const [, selector, secret] = /^boap_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/.exec(result.password)!;
      const persisted = appPasswordRepo.createWithinActiveLimit.mock.calls[0][0];
      expect(persisted).toEqual(
        expect.objectContaining({
          userId: 7,
          label: 'KOReader',
          selector,
          secretHash: createHash('sha256').update(secret!).digest('hex'),
          secretHint: secret!.slice(-4),
        }),
      );
      expect(persisted).not.toHaveProperty('password');
      expect(persisted).not.toHaveProperty('secret');
      expect(appPasswordRepo.createWithinActiveLimit).toHaveBeenCalledWith(expect.any(Object), 25);
      expect(result.appPassword).toEqual(expect.objectContaining({ id: 11, label: 'KOReader', hint: secret!.slice(-4), status: 'active' }));
      expect(auditEvents.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: AuditAction.AuthAppPasswordCreate, ip: '10.0.0.5' }),
      );
    });

    it('rejects creation after 25 active credentials', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.createWithinActiveLimit.mockResolvedValue(null);

      await expect(
        service.create(makeActor(), { label: 'Client', expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() }),
      ).rejects.toThrow('Maximum of 25 active application passwords per user');
    });

    it('rejects shared accounts', async () => {
      const { service, appPasswordRepo } = makeService();

      await expect(
        service.create({ id: 7, username: 'shared', provisioningMethod: 'shared' } as never, {
          label: 'Client',
          expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow('Shared accounts cannot create application passwords');
      expect(appPasswordRepo.createWithinActiveLimit).not.toHaveBeenCalled();
    });

    it('allows OIDC-provisioned users to create credentials', async () => {
      const { service, appPasswordRepo } = makeService();

      await service.create({ id: 7, username: 'oidc-user', provisioningMethod: 'oidc' } as never, {
        label: 'Client',
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      });

      expect(appPasswordRepo.createWithinActiveLimit).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, label: 'Client' }), 25);
    });

    it.each([
      ['an invalid date', 'not-a-date'],
      ['a past date', new Date(Date.now() - 60_000).toISOString()],
      ['less than 24 hours', new Date(Date.now() + 60_000).toISOString()],
      ['more than 365 days', new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()],
    ])('rejects %s', async (_description, expiresAt) => {
      const { service } = makeService();

      await expect(service.create(makeActor(), { label: 'Client', expiresAt })).rejects.toThrow(BadRequestException);
    });
  });

  describe('verify', () => {
    const selector = 'a'.repeat(24);
    const secret = 'B'.repeat(43);
    const rawPassword = `boap_${selector}_${secret}`;

    it('uses a constant-time digest check and returns only the internal verified binding', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.findForVerification.mockResolvedValue({
        id: 3,
        userId: 7,
        label: 'KOReader',
        selector,
        secretHash: createHash('sha256').update(secret).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.verify(7, rawPassword);

      expect(appPasswordRepo.findForVerification).toHaveBeenCalledWith(7, selector);
      expect(appPasswordRepo.touchLastUsedGeneration).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 3, label: 'KOReader', selector }));
      expect(result).not.toHaveProperty('secretHash');
    });

    it('returns null and does not record usage for a digest mismatch', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.findForVerification.mockResolvedValue({
        id: 3,
        secretHash: createHash('sha256').update('different-secret').digest('hex'),
      });

      await expect(service.verify(7, rawPassword)).resolves.toBeNull();
      expect(appPasswordRepo.touchLastUsedGeneration).not.toHaveBeenCalled();
    });

    it('performs the dummy digest path for an unknown selector', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.findForVerification.mockResolvedValue(null);

      await expect(service.verify(7, rawPassword)).resolves.toBeNull();
      expect(appPasswordRepo.findForVerification).toHaveBeenCalledWith(7, selector);
      expect(appPasswordRepo.touchLastUsedGeneration).not.toHaveBeenCalled();
    });

    it('rejects malformed input before querying storage', async () => {
      const { service, appPasswordRepo } = makeService();

      await expect(service.verify(7, 'not-an-app-password')).resolves.toBeNull();
      expect(appPasswordRepo.findForVerification).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('replaces the secret while preserving the credential identity and label', async () => {
      const { service, appPasswordRepo, auditEvents } = makeService();
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      appPasswordRepo.rotateOwnedWithinActiveLimit.mockImplementation((_userId: number, id: number, data: Record<string, unknown>) => ({
        status: 'rotated',
        credential: {
          id,
          userId: 7,
          label: 'KOReader on Kobo',
          secretHint: data.secretHint,
          expiresAt: data.expiresAt,
          lastUsedAt: null,
          lastUsedIp: null,
          createdAt,
        },
      }));

      const result = await service.rotate(makeActor(), 11, { expiresAt }, '10.0.0.10');

      expect(result.password).toMatch(/^boap_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
      const [, selector, secret] = /^boap_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/.exec(result.password)!;
      expect(appPasswordRepo.rotateOwnedWithinActiveLimit).toHaveBeenCalledWith(
        7,
        11,
        {
          selector,
          secretHash: createHash('sha256').update(secret!).digest('hex'),
          secretHint: secret!.slice(-4),
          expiresAt: new Date(expiresAt),
        },
        25,
      );
      expect(result.appPassword).toEqual({
        id: 11,
        label: 'KOReader on Kobo',
        hint: secret!.slice(-4),
        expiresAt,
        lastUsedAt: null,
        lastUsedIp: null,
        createdAt: createdAt.toISOString(),
        activeSessions: 0,
        status: 'active',
      });
      expect(auditEvents.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: AuditAction.AuthAppPasswordRotate,
          ip: '10.0.0.10',
          meta: { appPasswordId: 11, label: 'KOReader on Kobo' },
        }),
      );
    });

    it('allows an expired but non-revoked credential to be renewed', async () => {
      const { service, appPasswordRepo } = makeService();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      appPasswordRepo.rotateOwnedWithinActiveLimit.mockResolvedValue({
        status: 'rotated',
        credential: {
          id: 9,
          userId: 7,
          label: 'Expired reader',
          secretHint: 'abcd',
          expiresAt,
          lastUsedAt: null,
          lastUsedIp: null,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      });

      await expect(service.rotate(makeActor(), 9, { expiresAt: expiresAt.toISOString() })).resolves.toEqual(
        expect.objectContaining({ appPassword: expect.objectContaining({ id: 9, status: 'active' }) }),
      );
      expect(appPasswordRepo.rotateOwnedWithinActiveLimit).toHaveBeenCalledWith(7, 9, expect.any(Object), 25);
    });

    it('rejects renewal when all active credential slots are occupied', async () => {
      const { service, appPasswordRepo, auditEvents } = makeService();
      appPasswordRepo.rotateOwnedWithinActiveLimit.mockResolvedValue({ status: 'active_limit_reached' });

      await expect(service.rotate(makeActor(), 9, { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })).rejects.toThrow(
        'Maximum of 25 active application passwords per user',
      );
      expect(auditEvents.emit).not.toHaveBeenCalled();
    });

    it('rejects shared accounts before replacing the secret', async () => {
      const { service, appPasswordRepo } = makeService();

      await expect(
        service.rotate({ id: 7, username: 'shared', provisioningMethod: 'shared' } as never, 9, {
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow('Shared accounts cannot rotate application passwords');
      expect(appPasswordRepo.rotateOwnedWithinActiveLimit).not.toHaveBeenCalled();
    });

    it.each([
      ['an invalid date', 'not-a-date'],
      ['a past date', new Date(Date.now() - 60_000).toISOString()],
      ['less than 24 hours', new Date(Date.now() + 60_000).toISOString()],
      ['more than 365 days', new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()],
    ])('rejects %s before replacing the secret', async (_description, expiresAt) => {
      const { service, appPasswordRepo } = makeService();

      await expect(service.rotate(makeActor(), 9, { expiresAt })).rejects.toThrow(BadRequestException);
      expect(appPasswordRepo.rotateOwnedWithinActiveLimit).not.toHaveBeenCalled();
    });

    it('does not reveal whether a missing credential belongs to another user', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.rotateOwnedWithinActiveLimit.mockResolvedValue({ status: 'not_found' });

      await expect(service.rotate(makeActor(), 999, { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revocation and integration helpers', () => {
    it('revokes an owned credential and emits the revoke audit action', async () => {
      const { service, appPasswordRepo, auditEvents } = makeService();
      appPasswordRepo.revokeOwnedWithSessions.mockResolvedValue({ id: 4, userId: 7, label: 'KOReader' });

      await service.revoke(makeActor(), 4, '10.0.0.9');

      expect(appPasswordRepo.revokeOwnedWithSessions).toHaveBeenCalledWith(7, 4);
      expect(auditEvents.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: AuditAction.AuthAppPasswordRevoke, ip: '10.0.0.9' }),
      );
    });

    it('does not reveal whether a missing credential belongs to another user', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.revokeOwnedWithSessions.mockResolvedValue(null);

      await expect(service.revoke(makeActor(), 999)).rejects.toThrow(NotFoundException);
    });

    it('keeps read validation and usage tracking as separate operations', async () => {
      const { service, appPasswordRepo } = makeService();
      appPasswordRepo.findUsableById.mockResolvedValue({ id: 5 });
      appPasswordRepo.findUsableGenerationById.mockResolvedValue({ id: 5, selector: 'verified-selector' });

      await expect(service.findUsableById(7, 5)).resolves.toEqual({ id: 5 });
      await expect(service.findUsableGenerationById(7, 5)).resolves.toEqual({ id: 5, selector: 'verified-selector' });
      expect(appPasswordRepo.touchLastUsedGeneration).not.toHaveBeenCalled();

      await service.markUsed(7, 5, 'verified-selector', '127.0.0.1');
      expect(appPasswordRepo.touchLastUsedGeneration).toHaveBeenCalledWith(7, 5, 'verified-selector', '127.0.0.1');
    });

    it('delegates replay and account-wide revocation', async () => {
      const { service, appPasswordRepo } = makeService();

      await service.revokeForRefreshReplay(6);
      await service.revokeAllForUser(7);

      expect(appPasswordRepo.revokeByIdWithSessions).toHaveBeenCalledWith(6);
      expect(appPasswordRepo.revokeAllForUser).toHaveBeenCalledWith(7);
    });
  });
});
