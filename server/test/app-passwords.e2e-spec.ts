import { createHash, randomUUID } from 'crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppPassword, AuthResponse, CreateAppPasswordResponse, RefreshResponse } from '@bookorbit/types';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import * as schema from '../src/db/schema';
import { closeE2EContext, createE2EContext, seedLibrary, type Db, type E2EContext } from './e2e/app-harness';

type CookieJar = Map<string, string>;

interface Credentials {
  id: number;
  username: string;
  password: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  sessionId: number;
  jar: CookieJar;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getSetCookieLines(headers: Record<string, string | string[] | undefined>): string[] {
  const value = headers['set-cookie'];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseCookiePair(line: string): [string, string] | null {
  const pair = line.split(';', 1)[0];
  if (!pair) return null;
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;
  return [pair.slice(0, separator), pair.slice(separator + 1)];
}

function mergeCookieJar(jar: CookieJar, lines: string[]): void {
  for (const line of lines) {
    const pair = parseCookiePair(line);
    if (!pair) continue;
    const [name, value] = pair;
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');
}

async function createUser(db: Db): Promise<Credentials> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = `app-password-e2e-${suffix}`;
  const password = 'PrimaryPassword123';
  const [user] = await db
    .insert(schema.users)
    .values({
      username,
      name: `App Password E2E ${suffix}`,
      email: `${username}@example.com`,
      passwordHash: await hash(password, 4),
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  return { id: user.id, username, password };
}

async function login(app: NestFastifyApplication, username: string, password: string): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });

  expect(response.statusCode).toBe(200);
  const body = response.json() as AuthResponse;
  const jar: CookieJar = new Map();
  mergeCookieJar(jar, getSetCookieLines(response.headers));
  const refreshToken = jar.get('refresh_token');
  expect(refreshToken).toEqual(expect.any(String));

  return { accessToken: body.accessToken, refreshToken: refreshToken!, sessionId: body.sessionId, jar };
}

async function refresh(app: NestFastifyApplication, session: Session): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { cookie: cookieHeader(session.jar) },
  });

  expect(response.statusCode).toBe(200);
  const body = response.json() as RefreshResponse;
  const previousRefreshToken = session.refreshToken;
  session.accessToken = body.accessToken;
  mergeCookieJar(session.jar, getSetCookieLines(response.headers));
  session.refreshToken = session.jar.get('refresh_token')!;
  expect(body.sessionId).toBe(session.sessionId);
  expect(session.refreshToken).toEqual(expect.any(String));
  expect(session.refreshToken).not.toBe(previousRefreshToken);
}

async function findRefreshToken(db: Db, rawToken: string) {
  return db.query.refreshTokens.findFirst({
    where: eq(schema.refreshTokens.tokenHash, sha256(rawToken)),
  });
}

async function findAuthSession(db: Db, sessionId: number) {
  return db.query.authSessions.findFirst({
    where: eq(schema.authSessions.id, sessionId),
  });
}

async function activeAppSessionCount(db: Db, appPasswordId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.authSessions.id })
    .from(schema.authSessions)
    .where(
      and(eq(schema.authSessions.appPasswordId, appPasswordId), isNull(schema.authSessions.revokedAt), gt(schema.authSessions.expiresAt, new Date())),
    );
  return rows.length;
}

async function createAppPassword(
  app: NestFastifyApplication,
  accessToken: string,
  expiresAt: Date,
  label = 'KOReader tablet',
): Promise<CreateAppPasswordResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/app-passwords',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { label, expiresAt: expiresAt.toISOString() },
  });

  expect(response.statusCode).toBe(201);
  return response.json() as CreateAppPasswordResponse;
}

async function listAppPasswords(app: NestFastifyApplication, accessToken: string): Promise<AppPassword[]> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/app-passwords',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as AppPassword[];
}

describe('Application passwords (e2e)', () => {
  let context: E2EContext;

  beforeAll(async () => {
    context = await createE2EContext();
  });

  afterAll(async () => {
    await closeE2EContext(context);
  });

  it('keeps multi-device app sessions isolated from the primary browser session', async () => {
    const credentials = await createUser(context.db);
    const primary = await login(context.app, credentials.username, credentials.password);
    const primaryRefreshRow = await findRefreshToken(context.db, primary.refreshToken);
    expect(primaryRefreshRow?.sessionId).toBe(primary.sessionId);
    const primarySessionRow = await findAuthSession(context.db, primary.sessionId);
    expect(primarySessionRow?.appPasswordId).toBeNull();

    const created = await createAppPassword(context.app, primary.accessToken, new Date(Date.now() + 180 * 24 * 60 * 60 * 1000));
    expect(created.password).toMatch(/^boap_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
    expect(created.appPassword).toMatchObject({
      label: 'KOReader tablet',
      status: 'active',
      activeSessions: 0,
      lastUsedAt: null,
      lastUsedIp: null,
    });
    expect(created.appPassword).not.toHaveProperty('password');
    expect(created.appPassword).not.toHaveProperty('secret');
    expect(created.appPassword).not.toHaveProperty('secretHash');
    expect(created.appPassword).not.toHaveProperty('selector');

    const createdRow = await context.db.query.appPasswords.findFirst({
      where: and(eq(schema.appPasswords.id, created.appPassword.id), eq(schema.appPasswords.userId, credentials.id)),
    });
    expect(createdRow?.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdRow?.secretHash).not.toContain(created.password);

    const initialList = await listAppPasswords(context.app, primary.accessToken);
    expect(initialList).toHaveLength(1);
    expect(initialList[0]).toEqual(created.appPassword);
    expect(initialList[0]).not.toHaveProperty('password');
    expect(JSON.stringify(initialList)).not.toContain(created.password);

    const deviceA = await login(context.app, credentials.username, created.password);
    const deviceB = await login(context.app, credentials.username, created.password);
    const deviceALoginBody = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${deviceA.accessToken}` },
    });
    expect(deviceALoginBody.statusCode).toBe(200);
    expect(deviceALoginBody.json()).toMatchObject({ authenticationMethod: 'app_password' });

    const deviceAInitialToken = deviceA.refreshToken;
    const deviceBInitialToken = deviceB.refreshToken;
    const deviceARow = await findRefreshToken(context.db, deviceAInitialToken);
    const deviceBRow = await findRefreshToken(context.db, deviceBInitialToken);
    expect(deviceARow?.sessionId).toBe(deviceA.sessionId);
    expect(deviceBRow?.sessionId).toBe(deviceB.sessionId);
    const deviceASessionRow = await findAuthSession(context.db, deviceA.sessionId);
    const deviceBSessionRow = await findAuthSession(context.db, deviceB.sessionId);
    expect(deviceASessionRow?.appPasswordId).toBe(created.appPassword.id);
    expect(deviceBSessionRow?.appPasswordId).toBe(created.appPassword.id);
    expect(deviceASessionRow!.expiresAt.getTime() - primarySessionRow!.expiresAt.getTime()).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);

    const browserSessions = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(browserSessions.statusCode).toBe(200);
    expect(browserSessions.json()).toHaveLength(1);

    await refresh(context.app, deviceA);
    expect((await findRefreshToken(context.db, deviceAInitialToken))?.revokedAt).not.toBeNull();
    expect((await findRefreshToken(context.db, deviceBInitialToken))?.revokedAt).toBeNull();
    await refresh(context.app, deviceB);
    expect(await activeAppSessionCount(context.db, created.appPassword.id)).toBe(2);

    const afterLoginList = await listAppPasswords(context.app, primary.accessToken);
    expect(afterLoginList[0]).toMatchObject({
      id: created.appPassword.id,
      activeSessions: 2,
      status: 'active',
    });
    expect(afterLoginList[0]!.lastUsedAt).toEqual(expect.any(String));
    expect(afterLoginList[0]!.lastUsedIp).toEqual(expect.any(String));

    const deniedList = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/app-passwords',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deniedList.statusCode).toBe(403);

    const deniedRevoke = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/app-passwords/${created.appPassword.id}`,
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deniedRevoke.statusCode).toBe(403);

    const deniedSessions = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deniedSessions.statusCode).toBe(403);

    const deniedOidcLink = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/oidc/example/link-state',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deniedOidcLink.statusCode).toBe(403);

    const logoutDeviceA = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `refresh_token=${deviceAInitialToken}` },
    });
    expect(logoutDeviceA.statusCode).toBe(200);
    expect(await activeAppSessionCount(context.db, created.appPassword.id)).toBe(1);
    expect((await findAuthSession(context.db, deviceA.sessionId))?.revokedAt).not.toBeNull();
    const deviceAAccessAfterLogout = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${deviceA.accessToken}` },
    });
    expect(deviceAAccessAfterLogout.statusCode).toBe(401);
    const deviceBAccessAfterDeviceALogout = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(deviceBAccessAfterDeviceALogout.statusCode).toBe(200);
    await refresh(context.app, deviceB);

    const revoke = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/app-passwords/${created.appPassword.id}`,
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(revoke.statusCode).toBe(204);
    expect(await activeAppSessionCount(context.db, created.appPassword.id)).toBe(0);
    expect((await findAuthSession(context.db, deviceB.sessionId))?.revokedAt).not.toBeNull();
    expect(await listAppPasswords(context.app, primary.accessToken)).toEqual([]);

    const appAccessAfterRevoke = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${deviceB.accessToken}` },
    });
    expect(appAccessAfterRevoke.statusCode).toBe(401);

    const appRefreshAfterRevoke = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(deviceB.jar) },
    });
    expect(appRefreshAfterRevoke.statusCode).toBe(401);

    const appLoginAfterRevoke = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: credentials.username, password: created.password },
    });
    expect(appLoginAfterRevoke.statusCode).toBe(401);

    const primaryAccessAfterRevoke = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(primaryAccessAfterRevoke.statusCode).toBe(200);
    await refresh(context.app, primary);
  }, 15_000);

  it('expires access, refresh, and future login at the credential expiry', async () => {
    const credentials = await createUser(context.db);
    const primary = await login(context.app, credentials.username, credentials.password);
    const created = await createAppPassword(context.app, primary.accessToken, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    const appSession = await login(context.app, credentials.username, created.password);
    const expiresAt = new Date(Date.now() + 3_000);
    await context.db.update(schema.appPasswords).set({ expiresAt }).where(eq(schema.appPasswords.id, created.appPassword.id));

    const waitMs = Math.max(0, expiresAt.getTime() - Date.now() + 100);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const accessAfterExpiry = await context.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${appSession.accessToken}` },
    });
    expect(accessAfterExpiry.statusCode).toBe(401);

    const refreshAfterExpiry = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(appSession.jar) },
    });
    expect(refreshAfterExpiry.statusCode).toBe(401);

    const loginAfterExpiry = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: credentials.username, password: created.password },
    });
    expect(loginAfterExpiry.statusCode).toBe(401);

    const [expired] = await listAppPasswords(context.app, primary.accessToken);
    expect(expired).toMatchObject({
      id: created.appPassword.id,
      status: 'expired',
      activeSessions: 0,
    });

    await refresh(context.app, primary);
  }, 15_000);

  it('attributes progress, sessions, attempts, and statistics to the named app', async () => {
    const credentials = await createUser(context.db);
    const primary = await login(context.app, credentials.username, credentials.password);
    const created = await createAppPassword(context.app, primary.accessToken, new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), 'iPhone app');
    const appSession = await login(context.app, credentials.username, created.password);
    const library = await seedLibrary(context.db, {
      rootPath: `/tmp/bookorbit-app-password-reading-${randomUUID()}`,
      mode: 'book_per_file',
      watch: false,
    });
    await context.db.insert(schema.userLibraryAccess).values({
      userId: credentials.id,
      libraryId: library.libraryId,
      accessLevel: 'owner',
    });
    const [book] = await context.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: 'iphone-reading',
      })
      .returning({ id: schema.books.id });
    const [file] = await context.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId: library.libraryFolderId,
        absolutePath: `/tmp/bookorbit-app-password-reading-${book.id}.epub`,
        relPath: `iphone-reading-${book.id}.epub`,
        ino: BigInt(900_000 + book.id),
        sizeBytes: 1024,
        format: 'epub',
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await context.db.update(schema.books).set({ primaryFileId: file.id }).where(eq(schema.books.id, book.id));

    const progressResponse = await context.app.inject({
      method: 'PUT',
      url: '/api/v1/reading-progress',
      headers: { authorization: `Bearer ${appSession.accessToken}` },
      payload: { writes: [{ fileId: file.id, percentage: 37 }] },
    });
    expect(progressResponse.statusCode).toBe(200);
    expect(progressResponse.json()).toMatchObject({
      results: [{ fileId: file.id, status: 'saved', progress: { percentage: 37, appName: 'iPhone app' } }],
    });

    const endedAt = new Date(Date.now() - 1_000);
    const startedAt = new Date(endedAt.getTime() - 10 * 60 * 1_000);
    const sessionResponse = await context.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${file.id}/sessions`,
      headers: { authorization: `Bearer ${appSession.accessToken}` },
      payload: {
        sessionId: `iphone-session-${randomUUID()}`,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: 600,
        progressDelta: 12,
        endProgress: 37,
      },
    });
    expect(sessionResponse.statusCode).toBe(204);

    const [storedProgress] = await context.db
      .select({ appPasswordId: schema.readingProgress.appPasswordId })
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.userId, credentials.id), eq(schema.readingProgress.bookFileId, file.id)));
    const [storedSession] = await context.db
      .select({ appPasswordId: schema.readingSessions.appPasswordId })
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.userId, credentials.id), eq(schema.readingSessions.bookFileId, file.id)));
    expect(storedProgress?.appPasswordId).toBe(created.appPassword.id);
    expect(storedSession?.appPasswordId).toBe(created.appPassword.id);

    const revoke = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/app-passwords/${created.appPassword.id}`,
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(revoke.statusCode).toBe(204);

    const progressRead = await context.app.inject({
      method: 'GET',
      url: `/api/v1/reading-progress?fileId=${file.id}`,
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(progressRead.statusCode).toBe(200);
    expect(progressRead.json()).toMatchObject({ items: [{ fileId: file.id, percentage: 37, appName: 'iPhone app' }] });

    const sessionsRead = await context.app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/sessions`,
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(sessionsRead.statusCode).toBe(200);
    expect(sessionsRead.json()).toMatchObject({
      items: [{ sourceAttribution: { key: `app-password:${created.appPassword.id}:bookorbit`, label: 'iPhone app', kind: 'app_password' } }],
      stats: { bySource: [{ key: `app-password:${created.appPassword.id}:bookorbit`, label: 'iPhone app', totalSeconds: 600 }] },
    });

    const sourceDistribution = await context.app.inject({
      method: 'GET',
      url: '/api/v1/user-statistics/reading-source-distribution?days=365',
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(sourceDistribution.statusCode).toBe(200);
    expect(sourceDistribution.json()).toMatchObject({
      totalSeconds: 600,
      slices: [{ key: `app-password:${created.appPassword.id}:bookorbit`, label: 'iPhone app', readingSeconds: 600 }],
    });

    const attempts = await context.app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/reading-attempts?page=1&pageSize=20`,
      headers: { authorization: `Bearer ${primary.accessToken}` },
    });
    expect(attempts.statusCode).toBe(200);
    expect(attempts.json()).toMatchObject({ items: [{ origin: 'bookorbit', externalProvider: 'iPhone app' }] });
  }, 15_000);
});
