import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AuthService } from './auth.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req: any) => req?.cookies?.access_token ?? null]),
      secretOrKey: config.get<string>('auth.jwtSecret')!,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: number; ver: number; am?: string; aid?: number; sid?: string }) {
    if ((payload.am === 'app_password') !== Number.isInteger(payload.aid)) {
      throw new UnauthorizedException();
    }
    if (payload.am !== undefined && payload.am !== 'app_password') {
      throw new UnauthorizedException();
    }
    if (payload.sid !== undefined && !UUID_PATTERN.test(payload.sid)) {
      throw new UnauthorizedException();
    }
    if (payload.am === 'app_password' && !payload.sid) {
      throw new UnauthorizedException();
    }

    const user = await this.authService.validateUser(payload.sub, payload.ver, payload.aid, payload.sid);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
