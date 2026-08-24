import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type AppPasswordRow = typeof schema.appPasswords.$inferSelect;
type NewAppPassword = Pick<typeof schema.appPasswords.$inferInsert, 'userId' | 'label' | 'selector' | 'secretHash' | 'secretHint' | 'expiresAt'>;

const APP_PASSWORD_CREATE_LOCK_NAMESPACE = 4_280_400;

export type UsableAppPassword = Omit<AppPasswordRow, 'secretHash'>;

export function omitAppPasswordSecretHash(row: AppPasswordRow): UsableAppPassword {
  const credential: Partial<AppPasswordRow> = { ...row };
  delete credential.secretHash;
  return credential as UsableAppPassword;
}

@Injectable()
export class AppPasswordRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async listByUserId(userId: number) {
    const activeSessions = this.db
      .select({
        appPasswordId: schema.refreshTokens.appPasswordId,
        total: sql<number>`count(*)::int`.as('total'),
      })
      .from(schema.refreshTokens)
      .where(and(isNull(schema.refreshTokens.revokedAt), gt(schema.refreshTokens.expiresAt, sql`now()`)))
      .groupBy(schema.refreshTokens.appPasswordId)
      .as('active_app_password_sessions');

    return this.db
      .select({
        id: schema.appPasswords.id,
        userId: schema.appPasswords.userId,
        label: schema.appPasswords.label,
        secretHint: schema.appPasswords.secretHint,
        expiresAt: schema.appPasswords.expiresAt,
        lastUsedAt: schema.appPasswords.lastUsedAt,
        lastUsedIp: schema.appPasswords.lastUsedIp,
        createdAt: schema.appPasswords.createdAt,
        activeSessions: sql<number>`case when ${schema.appPasswords.expiresAt} > now() then coalesce(${activeSessions.total}, 0) else 0 end`.mapWith(
          Number,
        ),
      })
      .from(schema.appPasswords)
      .leftJoin(activeSessions, eq(activeSessions.appPasswordId, schema.appPasswords.id))
      .where(and(eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)))
      .orderBy(desc(schema.appPasswords.createdAt))
      .limit(100);
  }

  private usableCondition(userId: number) {
    return and(
      eq(schema.appPasswords.userId, userId),
      isNull(schema.appPasswords.revokedAt),
      or(isNull(schema.appPasswords.expiresAt), gt(schema.appPasswords.expiresAt, sql`now()`)),
    );
  }

  async countActiveByUserId(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.appPasswords)
      .where(this.usableCondition(userId));

    return row?.total ?? 0;
  }

  async create(data: { userId: number; label: string; selector: string; secretHash: string; secretHint: string; expiresAt: Date }) {
    const [row] = await this.db.insert(schema.appPasswords).values(data).returning({
      id: schema.appPasswords.id,
      userId: schema.appPasswords.userId,
      label: schema.appPasswords.label,
      secretHint: schema.appPasswords.secretHint,
      expiresAt: schema.appPasswords.expiresAt,
      lastUsedAt: schema.appPasswords.lastUsedAt,
      lastUsedIp: schema.appPasswords.lastUsedIp,
      createdAt: schema.appPasswords.createdAt,
    });

    return row;
  }

  async createWithinActiveLimit(data: NewAppPassword, activeLimit: number) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${APP_PASSWORD_CREATE_LOCK_NAMESPACE}, ${data.userId})`);

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.appPasswords)
        .where(this.usableCondition(data.userId));
      if ((countRow?.total ?? 0) >= activeLimit) return null;

      const [row] = await tx.insert(schema.appPasswords).values(data).returning({
        id: schema.appPasswords.id,
        userId: schema.appPasswords.userId,
        label: schema.appPasswords.label,
        secretHint: schema.appPasswords.secretHint,
        expiresAt: schema.appPasswords.expiresAt,
        lastUsedAt: schema.appPasswords.lastUsedAt,
        lastUsedIp: schema.appPasswords.lastUsedIp,
        createdAt: schema.appPasswords.createdAt,
      });
      return row;
    });
  }

  async findForVerification(userId: number, selector: string) {
    return this.db.query.appPasswords.findFirst({
      where: and(this.usableCondition(userId), eq(schema.appPasswords.selector, selector)),
    });
  }

  async findUsableById(userId: number, id: number): Promise<UsableAppPassword | null> {
    const row = await this.db.query.appPasswords.findFirst({
      where: and(this.usableCondition(userId), eq(schema.appPasswords.id, id)),
    });

    return row ? omitAppPasswordSecretHash(row) : null;
  }

  async touchLastUsed(id: number, ip?: string): Promise<void> {
    await this.db
      .update(schema.appPasswords)
      .set({
        lastUsedAt: new Date(),
        ...(ip ? { lastUsedIp: ip } : {}),
      })
      .where(and(eq(schema.appPasswords.id, id), isNull(schema.appPasswords.revokedAt)));
  }

  async revokeOwnedWithSessions(userId: number, id: number) {
    const revokedAt = new Date();

    return this.db.transaction(async (tx) => {
      const [credential] = await tx
        .update(schema.appPasswords)
        .set({ revokedAt })
        .where(and(eq(schema.appPasswords.id, id), eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)))
        .returning({
          id: schema.appPasswords.id,
          userId: schema.appPasswords.userId,
          label: schema.appPasswords.label,
        });

      if (!credential) return null;

      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt })
        .where(and(eq(schema.refreshTokens.appPasswordId, id), isNull(schema.refreshTokens.revokedAt)));

      return credential;
    });
  }

  async revokeByIdWithSessions(id: number) {
    const revokedAt = new Date();

    return this.db.transaction(async (tx) => {
      const [credential] = await tx
        .update(schema.appPasswords)
        .set({ revokedAt })
        .where(and(eq(schema.appPasswords.id, id), isNull(schema.appPasswords.revokedAt)))
        .returning({
          id: schema.appPasswords.id,
          userId: schema.appPasswords.userId,
          label: schema.appPasswords.label,
        });

      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt })
        .where(and(eq(schema.refreshTokens.appPasswordId, id), isNull(schema.refreshTokens.revokedAt)));

      return credential ?? null;
    });
  }

  async revokeAllForUser(userId: number) {
    const revokedAt = new Date();

    return this.db.transaction(async (tx) => {
      const credentials = await tx.select({ id: schema.appPasswords.id }).from(schema.appPasswords).where(eq(schema.appPasswords.userId, userId));
      const ids = credentials.map(({ id }) => id);

      const credentialResult = await tx
        .update(schema.appPasswords)
        .set({ revokedAt })
        .where(and(eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)));

      let sessionsRevoked = 0;
      if (ids.length > 0) {
        const sessionResult = await tx
          .update(schema.refreshTokens)
          .set({ revokedAt })
          .where(and(inArray(schema.refreshTokens.appPasswordId, ids), isNull(schema.refreshTokens.revokedAt)));
        sessionsRevoked = sessionResult.rowCount ?? 0;
      }

      return {
        credentialsRevoked: credentialResult.rowCount ?? 0,
        sessionsRevoked,
      };
    });
  }
}
