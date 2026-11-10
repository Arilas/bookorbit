import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthenticationMethod } from '@bookorbit/types';
import type { AuthClientOptions, NativeCredentials } from '@bookorbit/types';
import { authConfig } from '../../config/config';
import { AuthSessionRepository, type OidcSessionInput } from './auth-session.repository';
import { hashRefreshToken, nextRefreshToken } from './refresh-token.utils';
import ms, { type StringValue } from 'ms';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly repository: AuthSessionRepository,
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  expiry(base = new Date(), authenticationMethod: AuthenticationMethod = AuthenticationMethod.Password, maximum?: Date) {
    const duration =
      authenticationMethod === AuthenticationMethod.AppPassword ? this.config.appPasswordRefreshExpiresIn : this.config.jwtRefreshExpiresIn;
    const configured = new Date(base.getTime() + ms(duration as StringValue));
    return maximum && maximum < configured ? maximum : configured;
  }

  async issue(
    userId: number,
    tokenVersion: number,
    authenticationMethod: AuthenticationMethod,
    options: AuthClientOptions = {},
    oidc?: OidcSessionInput,
    appPassword?: { id: number; selector: string; expiresAt: Date; lastUsedIp?: string },
  ) {
    if ((authenticationMethod === AuthenticationMethod.AppPassword) !== !!appPassword) throw new UnauthorizedException();
    const refreshToken = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = this.expiry(now, authenticationMethod, appPassword?.expiresAt);
    if (expiresAt <= now) throw new UnauthorizedException();
    const session = await this.repository.create(
      {
        userId,
        appPasswordId: appPassword?.id ?? null,
        tokenVersion,
        authenticationMethod,
        clientKind: options.clientKind ?? 'web',
        deviceLabel: options.deviceLabel?.trim() || null,
        expiresAt,
      },
      hashRefreshToken(refreshToken),
      oidc,
      appPassword ? { id: appPassword.id, selector: appPassword.selector, lastUsedIp: appPassword.lastUsedIp } : undefined,
    );
    if (!session) throw new UnauthorizedException();
    return this.credentials(session, refreshToken, session.expiresAt);
  }

  async refresh(
    rawToken: string,
    userId: number,
    tokenVersion: number,
    sessionId: number,
    authenticationMethod: AuthenticationMethod,
    maximumExpiresAt?: Date,
  ) {
    if ((authenticationMethod === AuthenticationMethod.AppPassword) !== !!maximumExpiresAt) throw new UnauthorizedException();
    const tokens = [rawToken];
    for (let hop = 0; hop < 5; hop++) tokens.push(nextRefreshToken(tokens[hop], this.config.jwtSecret));
    const now = new Date();
    const expiresAt = this.expiry(now, authenticationMethod, maximumExpiresAt);
    if (expiresAt <= now) throw new UnauthorizedException();
    const result = await this.repository.exchange({
      sessionId,
      userId,
      tokenVersion,
      tokenHashes: tokens.map(hashRefreshToken),
      now,
      expiresAt,
      graceMs: this.config.refreshRotationGraceMs,
    });
    if (!result) throw new UnauthorizedException();
    return this.credentials(result.session, tokens[result.tokenIndex], result.refresh.expiresAt);
  }

  private credentials(
    session: { id: number; userId: number; tokenVersion: number; authenticationMethod: string },
    refreshToken: string,
    expiresAt: Date,
  ): NativeCredentials {
    const accessToken = this.jwt.sign({ sub: session.userId, ver: session.tokenVersion, amr: session.authenticationMethod, sid: session.id });
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return {
      accessToken,
      accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      sessionId: session.id,
    };
  }
}
