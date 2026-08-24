import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { AuditAction, AuditResource } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import { AppPasswordRepository, omitAppPasswordSecretHash } from './app-password.repository';
import type { CreateAppPasswordDto } from './dto/create-app-password.dto';

const APP_PASSWORD_PREFIX = 'boap';
const SELECTOR_HEX_LENGTH = 24;
const SECRET_LENGTH = 43;
const APP_PASSWORD_PATTERN = new RegExp(`^${APP_PASSWORD_PREFIX}_([a-f0-9]{${SELECTOR_HEX_LENGTH}})_([A-Za-z0-9_-]{${SECRET_LENGTH}})$`);
const MAX_ACTIVE_APP_PASSWORDS = 25;
const MIN_EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const DUMMY_SECRET_HASH = 'fb82d77b57ec9a122a30d5313abda23dc97ba8d0ccad5653bb582303ae4140c1';

export type AppPasswordStatus = 'active' | 'expired';

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretsMatch(candidateSecret: string, expectedHexDigest: string): boolean {
  const candidate = createHash('sha256').update(candidateSecret).digest();
  const expected = Buffer.from(expectedHexDigest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

@Injectable()
export class AppPasswordService {
  private readonly logger = new Logger(AppPasswordService.name);

  constructor(
    private readonly appPasswordRepo: AppPasswordRepository,
    private readonly auditEvents: AuditEventsService,
  ) {}

  async list(userId: number) {
    const rows = await this.appPasswordRepo.listByUserId(userId);
    const now = Date.now();

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      hint: row.secretHint,
      expiresAt: row.expiresAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: row.lastUsedIp,
      createdAt: row.createdAt.toISOString(),
      activeSessions: Number(row.activeSessions ?? 0),
      status: row.expiresAt.getTime() <= now ? ('expired' as const) : ('active' as const),
    }));
  }

  async create(actor: RequestUser, dto: CreateAppPasswordDto, ip?: string) {
    if (actor.provisioningMethod === 'shared') {
      throw new ForbiddenException('Shared accounts cannot create application passwords');
    }

    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Application name is required');

    const now = new Date();
    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      throw new BadRequestException('Expiration date must be in the future');
    }
    if (expiresAt.getTime() - now.getTime() < MIN_EXPIRY_MS) {
      throw new BadRequestException('Expiration date must be at least 24 hours in the future');
    }
    if (expiresAt.getTime() - now.getTime() > MAX_EXPIRY_MS) {
      throw new BadRequestException('Expiration date cannot be more than 365 days in the future');
    }

    const selector = randomBytes(12).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const password = `${APP_PASSWORD_PREFIX}_${selector}_${secret}`;
    const row = await this.appPasswordRepo.createWithinActiveLimit(
      {
        userId: actor.id,
        label,
        selector,
        secretHash: hashSecret(secret),
        secretHint: secret.slice(-4),
        expiresAt,
      },
      MAX_ACTIVE_APP_PASSWORDS,
    );
    if (!row) {
      throw new BadRequestException(`Maximum of ${MAX_ACTIVE_APP_PASSWORDS} active application passwords per user`);
    }

    this.logger.log(`[app_password.create] [end] appPasswordId=${row.id} userId=${actor.id} - application password created`);
    this.auditEvents.emit(AUDIT_EVENT, {
      userId: actor.id,
      actorUsername: actor.username,
      action: AuditAction.AuthAppPasswordCreate,
      resource: AuditResource.User,
      resourceId: actor.id,
      description: `Created application password '${label}'`,
      ip,
      meta: { appPasswordId: row.id, label },
    });

    return {
      appPassword: {
        id: row.id,
        label: row.label,
        hint: row.secretHint,
        expiresAt: row.expiresAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        lastUsedIp: row.lastUsedIp,
        createdAt: row.createdAt.toISOString(),
        activeSessions: 0,
        status: 'active' as const,
      },
      password,
    };
  }

  async revoke(actor: RequestUser, id: number, ip?: string): Promise<void> {
    const credential = await this.appPasswordRepo.revokeOwnedWithSessions(actor.id, id);
    if (!credential) throw new NotFoundException('Application password not found');

    this.logger.log(`[app_password.revoke] [end] appPasswordId=${id} userId=${actor.id} - application password revoked`);
    this.auditEvents.emit(AUDIT_EVENT, {
      userId: actor.id,
      actorUsername: actor.username,
      action: AuditAction.AuthAppPasswordRevoke,
      resource: AuditResource.User,
      resourceId: actor.id,
      description: `Revoked application password '${credential.label}'`,
      ip,
      meta: { appPasswordId: credential.id, label: credential.label },
    });
  }

  async verify(userId: number, rawPassword: string, ip?: string) {
    const parsed = APP_PASSWORD_PATTERN.exec(rawPassword);
    if (!parsed) return null;

    const [, selector, secret] = parsed;
    const credential = await this.appPasswordRepo.findForVerification(userId, selector!);
    const matches = secretsMatch(secret!, credential?.secretHash ?? DUMMY_SECRET_HASH);
    if (!credential || !matches) return null;

    await this.markUsed(credential.id, ip);
    return omitAppPasswordSecretHash(credential);
  }

  findUsableById(userId: number, id: number) {
    return this.appPasswordRepo.findUsableById(userId, id);
  }

  markUsed(id: number, ip?: string): Promise<void> {
    return this.appPasswordRepo.touchLastUsed(id, ip);
  }

  revokeForRefreshReplay(id: number) {
    return this.appPasswordRepo.revokeByIdWithSessions(id);
  }

  revokeAllForUser(userId: number) {
    return this.appPasswordRepo.revokeAllForUser(userId);
  }
}
