import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { ALLOW_DEFAULT_PASSWORD_KEY } from '../decorators/allow-default-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PRIMARY_AUTHENTICATION_KEY } from '../decorators/require-primary-authentication.decorator';
import { RequestUser } from '../types/request-user';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T extends RequestUser>(err: unknown, user: T, _info: unknown, context: ExecutionContext): T {
    if (err || !user) {
      throw new UnauthorizedException();
    }

    const requiresPrimaryAuthentication = this.reflector.getAllAndOverride<boolean>(REQUIRE_PRIMARY_AUTHENTICATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresPrimaryAuthentication && user.authMethod === 'app_password') {
      throw new ForbiddenException('Primary authentication required');
    }

    if (user.isDefaultPassword) {
      const allowDefaultPassword = this.reflector.getAllAndOverride<boolean>(ALLOW_DEFAULT_PASSWORD_KEY, [context.getHandler(), context.getClass()]);
      if (!allowDefaultPassword) {
        throw new ForbiddenException('Password change required');
      }
    }

    return user;
  }
}
