import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY, type ForbiddenPermissionRule } from '../decorators/forbid-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionService } from '../services/permission.service';
import { RequestUser } from '../types/request-user';

const PRIMARY_AUTH_ONLY_PERMISSIONS = new Set<Permission>([
  Permission.ManageLibraries,
  Permission.ManageMetadataConfig,
  Permission.ManageIcons,
  Permission.ManageAppSettings,
  Permission.ManageBookDock,
  Permission.ManageUsers,
  Permission.ManageEmail,
  Permission.ViewUserActivity,
  Permission.ViewAuditLog,
]);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
    const forbidden = this.reflector.getAllAndOverride<ForbiddenPermissionRule | undefined>(FORBIDDEN_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (forbidden && this.permissionService.userHasExplicit(user, forbidden.permission)) {
      throw new ForbiddenException(forbidden.message ?? `Forbidden permission: ${forbidden.permission}`);
    }

    const required = this.reflector.getAllAndOverride<Permission | Permission[] | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const permissions = Array.isArray(required) ? required : [required];
    if (user.authMethod === 'app_password' && permissions.some((permission) => PRIMARY_AUTH_ONLY_PERMISSIONS.has(permission))) {
      throw new ForbiddenException('Primary authentication required for administrative operations');
    }
    const missing = permissions.find((permission) => !this.permissionService.userHas(user, permission));
    if (missing) {
      throw new ForbiddenException(`Missing permission: ${missing}`);
    }
    return true;
  }
}
