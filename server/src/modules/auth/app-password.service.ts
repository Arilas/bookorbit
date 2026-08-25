import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { AuditAction, AuditResource, type RotateAppPasswordResponse } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import { AppPasswordRepository, omitAppPasswordSecretHash } from './app-password.repository';
import type { CreateAppPasswordDto } from './dto/create-app-password.dto';
import type { RotateAppPasswordDto } from './dto/rotate-app-password.dto';

const APP_PASSWORD_PREFIX = 'boap';
const SELECTOR_HEX_LENGTH = 24;
const SECRET_LENGTH = 43;
const APP_PASSWORD_PATTERN = new RegExp(`^${APP_PASSWORD_PREFIX}_([a-f0-9]{${SELECTOR_HEX_LENGTH}})_([A-Za-z0-9_-]{${SECRET_LENGTH}})$`);
const MAX_ACTIVE_APP_PASSWORDS = 25;
const MIN_EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const DUMMY_SECRET_HASH = 'fb82d77b57ec9a122a30d5313abda23dc97ba8d0ccad5653bb582303ae4140c1';

export type AppPasswordStatus = 'active' | 'expired';

interface AppPasswordSummaryRow {
  id: number;
  label: string;
  secretHint: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
  activeSessions?: number;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretsMatch(candidateSecret: string, expectedHexDigest: string): boolean {
  const candidate = createHash('sha256').update(candidateSecret).digest();
  const expected = Buffer.from(expectedHexDigest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function generateAppPasswordSecret() {
  const selector = randomBytes(12).toString('hex');
  const secret = randomBytes(32).toString('base64url');

  return {
    selector,
    secretHash: hashSecret(secret),
    secretHint: secret.slice(-4),
    password: `${APP_PASSWORD_PREFIX}_${selector}_${secret}`,
  };
}

function parseAppPasswordExpiration(value: string, now = new Date()): Date {
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new BadRequestException('Expiration date must be in the future');
  }
  if (expiresAt.getTime() - now.getTime() < MIN_EXPIRY_MS) {
    throw new BadRequestException('Expiration date must be at least 24 hours in the future');
  }
  if (expiresAt.getTime() - now.getTime() > MAX_EXPIRY_MS) {
    throw new BadRequestException('Expiration date cannot be more than 365 days in the future');
  }
  return expiresAt;
}

function toAppPasswordSummary(row: AppPasswordSummaryRow, now = Date.now()) {
  return {
    id: row.id,
    label: row.label,
    hint: row.secretHint,
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt.toISOString(),
    activeSessions: Number(row.activeSessions ?? 0),
    status: row.expiresAt.getTime() <= now ? ('expired' as const) : ('active' as const),
  };
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

    return rows.map((row) => toAppPasswordSummary(row, now));
  }

  async create(actor: RequestUser, dto: CreateAppPasswordDto, ip?: string) {
    if (actor.provisioningMethod === 'shared') {
      throw new ForbiddenException('Shared accounts cannot create application passwords');
    }

    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Application name is required');

    const expiresAt = parseAppPasswordExpiration(dto.expiresAt);
    const generated = generateAppPasswordSecret();
    const row = await this.appPasswordRepo.createWithinActiveLimit(
      {
        userId: actor.id,
        label,
        selector: generated.selector,
        secretHash: generated.secretHash,
        secretHint: generated.secretHint,
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
      appPassword: toAppPasswordSummary(row),
      password: generated.password,
    };
  }

  async rotate(actor: RequestUser, id: number, dto: RotateAppPasswordDto, ip?: string): Promise<RotateAppPasswordResponse> {
    const startedAt = Date.now();
    this.logger.log(
      `[app_password.rotate] [start] appPasswordId=${id} userId=${actor.id} expiresAt="${sanitizeLogValue(dto.expiresAt)}" - application password rotation started`,
    );

    try {
      if (actor.provisioningMethod === 'shared') {
        throw new ForbiddenException('Shared accounts cannot rotate application passwords');
      }

      const expiresAt = parseAppPasswordExpiration(dto.expiresAt);
      const generated = generateAppPasswordSecret();
      const row = await this.appPasswordRepo.rotateOwnedWithSessions(actor.id, id, {
        selector: generated.selector,
        secretHash: generated.secretHash,
        secretHint: generated.secretHint,
        expiresAt,
      });
      if (!row) throw new NotFoundException('Application password not found');

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: actor.id,
        actorUsername: actor.username,
        action: AuditAction.AuthAppPasswordRotate,
        resource: AuditResource.User,
        resourceId: actor.id,
        description: `Rotated application password '${row.label}'`,
        ip,
        meta: { appPasswordId: row.id, label: row.label },
      });

      this.logger.log(
        `[app_password.rotate] [end] appPasswordId=${id} userId=${actor.id} durationMs=${Date.now() - startedAt} sessionsInvalidated=true - application password rotation completed`,
      );

      return {
        appPassword: toAppPasswordSummary(row),
        password: generated.password,
      };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[app_password.rotate] [fail] appPasswordId=${id} userId=${actor.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - application password rotation failed`,
      );
      throw error;
    }
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
