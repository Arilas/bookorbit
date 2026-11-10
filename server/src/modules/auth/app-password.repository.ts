import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type AppPasswordRow = typeof schema.appPasswords.$inferSelect;
type NewAppPassword = Pick<typeof schema.appPasswords.$inferInsert, 'userId' | 'label' | 'selector' | 'secretHash' | 'secretHint' | 'expiresAt'>;
type RotatedAppPassword = Pick<typeof schema.appPasswords.$inferInsert, 'selector' | 'secretHash' | 'secretHint' | 'expiresAt'>;

const APP_PASSWORD_ACTIVE_CAPACITY_LOCK_NAMESPACE = 4_280_400;

export type VerifiedAppPassword = Pick<AppPasswordRow, 'id' | 'label' | 'selector' | 'expiresAt'>;
export type UsableAppPassword = Omit<VerifiedAppPassword, 'selector'>;
export type UsableAppPasswordGeneration = Pick<VerifiedAppPassword, 'id' | 'selector' | 'expiresAt'>;

@Injectable()
export class AppPasswordRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async listByUserId(userId: number) {
    const activeSessions = this.db
      .select({
        appPasswordId: schema.authSessions.appPasswordId,
        total: sql<number>`count(*)::int`.as('total'),
      })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, sql`now()`),
          eq(schema.authSessions.tokenVersion, schema.users.tokenVersion),
        ),
      )
      .groupBy(schema.authSessions.appPasswordId)
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
    return and(eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt), gt(schema.appPasswords.expiresAt, sql`now()`));
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
      await tx.execute(sql`select pg_advisory_xact_lock(${APP_PASSWORD_ACTIVE_CAPACITY_LOCK_NAMESPACE}, ${data.userId})`);
      const activeAt = new Date();

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.appPasswords)
        .where(and(eq(schema.appPasswords.userId, data.userId), isNull(schema.appPasswords.revokedAt), gt(schema.appPasswords.expiresAt, activeAt)));
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

    return row ? { id: row.id, label: row.label, expiresAt: row.expiresAt } : null;
  }

  async findUsableGenerationById(userId: number, id: number): Promise<UsableAppPasswordGeneration | null> {
    const row = await this.db.query.appPasswords.findFirst({
      where: and(this.usableCondition(userId), eq(schema.appPasswords.id, id)),
    });

    return row ? { id: row.id, selector: row.selector, expiresAt: row.expiresAt } : null;
  }

  async touchLastUsedGeneration(userId: number, id: number, selector: string, ip?: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.appPasswords)
      .set({
        lastUsedAt: new Date(),
        ...(ip ? { lastUsedIp: ip } : {}),
      })
      .where(
        and(
          eq(schema.appPasswords.userId, userId),
          eq(schema.appPasswords.id, id),
          eq(schema.appPasswords.selector, selector),
          isNull(schema.appPasswords.revokedAt),
          gt(schema.appPasswords.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: schema.appPasswords.id });

    return rows.length > 0;
  }

  async rotateOwnedWithinActiveLimit(userId: number, id: number, data: RotatedAppPassword, activeLimit: number) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${APP_PASSWORD_ACTIVE_CAPACITY_LOCK_NAMESPACE}, ${userId})`);
      const now = new Date();
      const [existing] = await tx
        .select({ id: schema.appPasswords.id, expiresAt: schema.appPasswords.expiresAt })
        .from(schema.appPasswords)
        .where(and(eq(schema.appPasswords.id, id), eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)))
        .for('update');
      if (!existing) return { status: 'not_found' as const };

      if (existing.expiresAt <= now) {
        const [countRow] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.appPasswords)
          .where(and(eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt), gt(schema.appPasswords.expiresAt, now)));
        if ((countRow?.total ?? 0) >= activeLimit) return { status: 'active_limit_reached' as const };
      }

      const [credential] = await tx
        .update(schema.appPasswords)
        .set({
          ...data,
          lastUsedAt: null,
          lastUsedIp: null,
        })
        .where(and(eq(schema.appPasswords.id, id), eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)))
        .returning({
          id: schema.appPasswords.id,
          userId: schema.appPasswords.userId,
          label: schema.appPasswords.label,
          secretHint: schema.appPasswords.secretHint,
          expiresAt: schema.appPasswords.expiresAt,
          lastUsedAt: schema.appPasswords.lastUsedAt,
          lastUsedIp: schema.appPasswords.lastUsedIp,
          createdAt: schema.appPasswords.createdAt,
        });

      if (!credential) return { status: 'not_found' as const };

      await tx
        .update(schema.authSessions)
        .set({ revokedAt: now })
        .where(and(eq(schema.authSessions.userId, userId), eq(schema.authSessions.appPasswordId, id), isNull(schema.authSessions.revokedAt)));

      return { status: 'rotated' as const, credential };
    });
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
        .update(schema.authSessions)
        .set({ revokedAt })
        .where(and(eq(schema.authSessions.appPasswordId, id), isNull(schema.authSessions.revokedAt)));

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
        .update(schema.authSessions)
        .set({ revokedAt })
        .where(and(eq(schema.authSessions.appPasswordId, id), isNull(schema.authSessions.revokedAt)));

      return credential ?? null;
    });
  }

  async revokeAllForUser(userId: number) {
    const revokedAt = new Date();

    return this.db.transaction(async (tx) => {
      const credentialResult = await tx
        .update(schema.appPasswords)
        .set({ revokedAt })
        .where(and(eq(schema.appPasswords.userId, userId), isNull(schema.appPasswords.revokedAt)));

      const sessionResult = await tx
        .update(schema.authSessions)
        .set({ revokedAt })
        .where(
          and(
            eq(schema.authSessions.userId, userId),
            eq(schema.authSessions.authenticationMethod, 'app_password'),
            isNull(schema.authSessions.revokedAt),
          ),
        );

      return {
        credentialsRevoked: credentialResult.rowCount ?? 0,
        sessionsRevoked: sessionResult.rowCount ?? 0,
      };
    });
  }
}
