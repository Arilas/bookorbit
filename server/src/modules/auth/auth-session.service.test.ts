import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from '../../config/config';
import { AuthSessionRepository } from './auth-session.repository';
import { AuthSessionService } from './auth-session.service';
import { hashRefreshToken, nextRefreshToken } from './refresh-token.utils';

const secret = 'unit-test-session-secret';
const user = { id: 9, userId: 1, tokenVersion: 2, authenticationMethod: 'password' };
async function fixture() {
  const repository = { create: vi.fn().mockImplementation((data: object) => Promise.resolve({ ...user, ...data })), exchange: vi.fn() };
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '15m', algorithm: 'HS256' } });
  const module = await Test.createTestingModule({
    providers: [
      AuthSessionService,
      { provide: AuthSessionRepository, useValue: repository },
      { provide: JwtService, useValue: jwt },
      {
        provide: authConfig.KEY,
        useValue: { jwtSecret: secret, jwtRefreshExpiresIn: '7d', appPasswordRefreshExpiresIn: '90d', refreshRotationGraceMs: 30_000 },
      },
    ],
  }).compile();
  return { service: module.get(AuthSessionService), repository, jwt };
}

describe('AuthSessionService', () => {
  it('issues a scoped JWT and opaque refresh token, storing only the refresh hash', async () => {
    const { service, repository, jwt } = await fixture();
    const result = await service.issue(1, 2, 'password', { clientKind: 'native', deviceLabel: ' iOS ' });
    expect(result.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, tokenVersion: 2, clientKind: 'native', deviceLabel: 'iOS' }),
      hashRefreshToken(result.refreshToken),
      undefined,
    );
    const claims = jwt.verify(result.accessToken);
    expect(claims).toMatchObject({ sub: 1, ver: 2, sid: 9, amr: 'password' });
    expect(result.accessTokenExpiresAt).toBe(new Date(claims.exp * 1000).toISOString());
    expect(result.sessionId).toBe(9);
  });

  it('does not sign when an account changed while login was in flight', async () => {
    const { service, repository, jwt } = await fixture();
    repository.create.mockResolvedValue(null);
    const sign = vi.spyOn(jwt, 'sign');
    await expect(service.issue(1, 2, 'password')).rejects.toThrow(UnauthorizedException);
    expect(sign).not.toHaveBeenCalled();
  });

  it('binds an app-password session and caps it at the credential expiry', async () => {
    const { service, repository, jwt } = await fixture();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await service.issue(1, 2, 'app_password', { clientKind: 'native' }, undefined, { id: 17, expiresAt });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ appPasswordId: 17, authenticationMethod: 'app_password', expiresAt }),
      hashRefreshToken(result.refreshToken),
      undefined,
    );
    expect(jwt.verify(result.accessToken)).toMatchObject({ sub: 1, ver: 2, sid: 9, amr: 'app_password' });
    expect(result.refreshTokenExpiresAt).toBe(expiresAt.toISOString());
  });

  it('refuses an app-password method without server-side credential binding', async () => {
    const { service, repository } = await fixture();

    await expect(service.issue(1, 2, 'app_password')).rejects.toThrow(UnauthorizedException);
    await expect(service.refresh('a'.repeat(64), 1, 2, 9, 'app_password')).rejects.toThrow(UnauthorizedException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.exchange).not.toHaveBeenCalled();
  });

  it('recovers the identical replacement across independent server instances', async () => {
    const first = await fixture();
    const restarted = await fixture();
    const expiresAt = new Date(Date.now() + 60_000);
    for (const context of [first, restarted]) context.repository.exchange.mockResolvedValue({ session: user, refresh: { expiresAt }, tokenIndex: 1 });
    const raw = 'a'.repeat(64);
    const a = await first.service.refresh(raw, 1, 2, 9, 'password');
    const b = await restarted.service.refresh(raw, 1, 2, 9, 'password');
    expect(a.refreshToken).toBe(b.refreshToken);
    expect(a.refreshToken).not.toBe(raw);
    expect(b.refreshTokenExpiresAt).toBe(a.refreshTokenExpiresAt);
    expect(first.repository.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 9,
        userId: 1,
        tokenVersion: 2,
        tokenHashes: expect.arrayContaining([hashRefreshToken(raw), hashRefreshToken(a.refreshToken)]),
      }),
    );
  });

  it('fails closed when rotation or recovery is rejected', async () => {
    const { service, repository } = await fixture();
    repository.exchange.mockResolvedValue(null);
    await expect(service.refresh('a'.repeat(64), 1, 2, 9, 'password')).rejects.toThrow(UnauthorizedException);
  });

  it('uses a keyed, domain-separated successor rather than a publicly computable hash', () => {
    const token = 'a'.repeat(64);
    expect(nextRefreshToken(token, secret)).not.toBe(hashRefreshToken(token));
    expect(nextRefreshToken(token, secret)).not.toBe(nextRefreshToken(token, 'another-secret'));
  });
});
