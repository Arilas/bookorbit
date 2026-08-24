import { ForbiddenException, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { AuthenticationMethod, Permission, type NotificationItem } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { UserService } from '../user/user.service';
import { NotificationRepository } from './notification.repository';
import { disconnectSocketAtTokenExpiry, rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { appConfig } from '../../config/config';

@WebSocketGateway({ namespace: '/notifications', cors: { credentials: true } })
export class NotificationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly notificationRepo: NotificationRepository,
    @Inject(appConfig.KEY) app: ConfigType<typeof appConfig>,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.clientOrigin = app.appUrl;
  }

  afterInit(server: Server): void {
    if (!server.engine?.opts) return;
    server.engine.opts.cors = {
      ...(server.engine.opts.cors ?? {}),
      origin: this.clientOrigin,
      credentials: true,
    };
  }

  async handleConnection(client: Socket): Promise<void> {
    const event = 'notification.socket';
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException('No token provided');

      const payload = this.jwtService.verify<{
        sub: number;
        ver: number;
        sid?: number;
        amr?: AuthenticationMethod;
        exp?: number;
      }>(token, { algorithms: ['HS256'] });
      const user = await this.validateSessionUser(payload);

      this.assertHasAccess(user);
      disconnectSocketAtTokenExpiry(client, payload.exp);

      await client.join(`user:${user.id}`);
      this.logger.debug(`[${event}] [start] userId=${user.id} socketId=${client.id} - websocket connected`);

      const unreadCount = await this.notificationRepo.countUnread(user.id);
      client.emit('notification:unread-count', { count: unreadCount });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[${event}] [fail] socketId=${client.id} errorClass=${errorClass} error="${message}" - websocket rejected`);
      rejectSocketConnection(client, err);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[notification.socket] [end] socketId=${client.id} - websocket disconnected`);
  }

  emitNew(userId: number, notification: NotificationItem): void {
    this.server?.to(`user:${userId}`).emit('notification:new', notification);
  }

  /**
   * A collapsed occurrence. Separate from emitNew because the row was already unread and already
   * counted; reusing emitNew would double-count the unread badge and the page total.
   */
  emitUpdated(userId: number, notification: NotificationItem): void {
    this.server?.to(`user:${userId}`).emit('notification:updated', notification);
  }

  emitRefresh(userId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:refresh');
  }

  emitCountUpdate(userId: number, count: number): void {
    this.server?.to(`user:${userId}`).emit('notification:unread-count', { count });
  }

  emitRead(userId: number, notificationId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:read', { id: notificationId });
  }

  emitDismissed(userId: number, notificationId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:dismissed', { id: notificationId });
  }

  emitAllRead(userId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:all-read', {});
  }

  emitCleared(userId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:cleared', {});
  }

  private assertHasAccess(user: RequestUser): void {
    if (user.permissions.includes(Permission.DemoRestricted)) {
      throw new ForbiddenException('Demo-restricted account cannot access notifications');
    }
    if (user.isSuperuser) return;
    if (user.permissions.includes(Permission.NotificationAccess)) return;
    throw new ForbiddenException('Missing permission: notification_access');
  }

  private async validateSessionUser(payload: { sub: number; ver: number; sid?: number; amr?: AuthenticationMethod }): Promise<RequestUser> {
    if (!Number.isSafeInteger(payload.sid) || !payload.sid || payload.sid < 1) {
      throw new UnauthorizedException('Missing session binding');
    }
    const authenticationMethod = payload.amr ?? AuthenticationMethod.Legacy;
    const user = await this.userService.findByIdWithPermissions(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('User not found or inactive');
    if (user.tokenVersion !== payload.ver) throw new UnauthorizedException('Token revoked');

    const session = await this.db.query.authSessions.findFirst({
      where: and(
        eq(schema.authSessions.id, payload.sid),
        eq(schema.authSessions.userId, payload.sub),
        eq(schema.authSessions.tokenVersion, payload.ver),
        eq(schema.authSessions.authenticationMethod, authenticationMethod),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, new Date()),
      ),
      columns: { id: true, appPasswordId: true },
    });
    if (!session) throw new UnauthorizedException('Session revoked');

    const appPasswordId = session.appPasswordId ?? undefined;
    return {
      ...user,
      sessionId: session.id,
      authenticationMethod,
      ...(appPasswordId ? { appPasswordId } : {}),
    };
  }
}
