import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool, PoolClient } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';
import { UNRELEASED_MIGRATION_HASHES } from './migration-ledger-compatibility';

type MigrationIdentity = Pick<MigrationMeta, 'folderMillis' | 'hash'>;
type CompatibilityPool = Pick<Pool, 'connect'>;

type LedgerRow = {
  id: number;
  hash: string;
  createdAt: string;
};

type ColumnRow = {
  tableName: string;
  columnName: string;
  dataType: string;
  characterMaximumLength: number | null;
  nullable: boolean;
  columnDefault: string | null;
};

type ConstraintRow = {
  constraintName: string;
  definition: string;
};

type IndexRow = {
  indexName: string;
  definition: string;
  columns: string[];
};

type SchemaSnapshot = {
  columns: Map<string, ColumnRow>;
  constraints: Map<string, ConstraintRow>;
  indexes: Map<string, IndexRow>;
};

type LegacyState = 'absent' | 'original' | 'prepared';

export const APP_PASSWORD_MIGRATION_IDENTITIES = {
  upstream0075: {
    hash: 'c0c85ec07d6353d66e84fd13bb3f6459213ec150a47ba6684c69027709dee086',
    folderMillis: 1787530767419,
  },
  upstream0076: {
    hash: '63df59f8ce68dfd1decb8062929baaf72889d1466a504d40ed1177d12b3a554a',
    folderMillis: 1787605916561,
  },
  upstream0140: {
    hash: '039a41b2a1a5f37609c8e5c9616d3f5b6916870ddc58db4a16462d4366c77535',
    folderMillis: 1794068460741,
  },
  baseline0141: {
    hash: '7dd3125739893a08ff9568c967d94821707f32575f1532b973994db9893895a7',
    folderMillis: 1794307878596,
  },
  final0142: {
    hash: 'a834eb5e1a2b8935b092d4a5f073ffbc88031444307e425cf2e52e9f37a88409',
    folderMillis: 1794307901461,
  },
} as const satisfies Record<string, MigrationIdentity>;

export const LEGACY_APP_PASSWORD_MIGRATIONS = [
  {
    hash: 'daececb39032b6eb8efbb7d77c7cacd512e898035b84461dd98d001b03b9c626',
    originalFolderMillis: 1787608833681,
    preparedFolderMillis: 1787605916558,
  },
  {
    hash: '5b2fd77f51f5c967268cca3943e824b338d225e72caafca63ee7bf76bad0253a',
    originalFolderMillis: 1787609672856,
    preparedFolderMillis: 1787605916559,
  },
  {
    hash: 'b772ea0f5dcf443e2aad3e638663ae069801e3e426c63fd7aeb9c50c6bbaa846',
    originalFolderMillis: 1787677246781,
    preparedFolderMillis: 1787605916560,
  },
] as const;

const TRACKED_TABLES = [
  'app_passwords',
  'auth_sessions',
  'refresh_tokens',
  'reading_attempts',
  'reading_progress',
  'reading_sessions',
  'audiobook_progress',
];
const EXPECTED_UPSTREAM_MIGRATION_COUNT = 65;
const EVENT = 'db.app-password-migration-compatibility';

export type PrepareAppPasswordMigrationResult = {
  status: 'not-applicable' | 'prepared' | 'already-prepared' | 'base-migrated' | 'baseline-recorded' | 'finalized';
  repairedRows: number;
};

export type FinalizeAppPasswordMigrationResult = {
  status: 'baseline-recorded' | 'already-recorded' | 'finalized';
  revokedRefreshTokens: number;
};

export function parseAppPasswordMigrationCompatibilityPhase(values: readonly string[]): 'prepare' | 'finalize' {
  if (values.length !== 1) fail('expected exactly one phase argument: prepare or finalize');
  const value = values[0];
  if (value === 'prepare' || value === 'finalize') return value;
  fail('expected exactly one phase argument: prepare or finalize');
}

function fail(message: string): never {
  throw new Error(`App Password migration compatibility check failed: ${message}`);
}

function assertManifest(migrations: readonly MigrationIdentity[]): MigrationIdentity[] {
  for (const expected of [
    APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075,
    APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076,
    APP_PASSWORD_MIGRATION_IDENTITIES.upstream0140,
    APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141,
    APP_PASSWORD_MIGRATION_IDENTITIES.final0142,
  ]) {
    const matches = migrations.filter((migration) => migration.hash === expected.hash && migration.folderMillis === expected.folderMillis);
    if (matches.length !== 1) fail(`the packaged migration manifest does not contain the expected migration ${expected.hash}`);
  }

  const upstream = migrations.filter(
    (migration) =>
      migration.folderMillis >= APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076.folderMillis &&
      migration.folderMillis <= APP_PASSWORD_MIGRATION_IDENTITIES.upstream0140.folderMillis,
  );
  if (upstream.length !== EXPECTED_UPSTREAM_MIGRATION_COUNT) {
    fail(`the packaged upstream migration range contains ${upstream.length} entries instead of ${EXPECTED_UPSTREAM_MIGRATION_COUNT}`);
  }
  return upstream;
}

async function withCompatibilityLock<T>(pool: CompatibilityPool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('app-password-migration-compatibility'))`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readLedger(client: PoolClient): Promise<LedgerRow[] | null> {
  const table = await client.query<{ tableName: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "tableName"`);
  if (!table.rows[0]?.tableName) return null;
  const ledger = await client.query<LedgerRow>(`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `);
  return ledger.rows;
}

function rowsForHash(ledger: readonly LedgerRow[], hash: string): LedgerRow[] {
  return ledger.filter((row) => row.hash === hash);
}

function marker(ledger: readonly LedgerRow[], migration: MigrationIdentity): LedgerRow | null {
  const rows = rowsForHash(ledger, migration.hash);
  if (rows.length > 1) fail(`migration ${migration.hash} appears more than once in the ledger`);
  const row = rows[0];
  if (!row) return null;
  if (row.createdAt !== String(migration.folderMillis)) fail(`migration ${migration.hash} has an unexpected ledger timestamp`);
  return row;
}

function markerPresence(ledger: readonly LedgerRow[], migration: MigrationIdentity): LedgerRow | null {
  const rows = rowsForHash(ledger, migration.hash);
  if (rows.length > 1) fail(`migration ${migration.hash} appears more than once in the ledger`);
  return rows[0] ?? null;
}

function classifyLegacyState(ledger: readonly LedgerRow[]): LegacyState {
  const rows = LEGACY_APP_PASSWORD_MIGRATIONS.map((migration) => rowsForHash(ledger, migration.hash));
  if (rows.every((matches) => matches.length === 0)) return 'absent';
  if (rows.some((matches) => matches.length !== 1)) fail('the legacy migration ledger is partial or contains duplicate rows');

  const timestamps = rows.map((matches) => matches[0].createdAt);
  if (timestamps.every((timestamp, index) => timestamp === String(LEGACY_APP_PASSWORD_MIGRATIONS[index].originalFolderMillis))) return 'original';
  if (timestamps.every((timestamp, index) => timestamp === String(LEGACY_APP_PASSWORD_MIGRATIONS[index].preparedFolderMillis))) return 'prepared';
  fail('the legacy migration ledger contains mixed or unexpected timestamps');
}

function assertLegacyAnchor(ledger: readonly LedgerRow[]): void {
  const anchor = APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075;
  const rows = rowsForHash(ledger, anchor.hash);
  if (rows.length !== 1 || rows[0].createdAt !== String(anchor.folderMillis)) {
    fail('the legacy migration history does not have the exact upstream 0075 anchor');
  }
}

function assertKnownPackagedRowsStrict(ledger: readonly LedgerRow[], migrations: readonly MigrationIdentity[]): void {
  for (const migration of migrations) {
    const rows = rowsForHash(ledger, migration.hash);
    if (rows.length > 1) fail(`packaged migration ${migration.hash} appears more than once in the ledger`);
    if (rows[0] && rows[0].createdAt !== String(migration.folderMillis)) {
      fail(`packaged migration ${migration.hash} has an unexpected ledger timestamp`);
    }
  }
}

function assertKnownPackagedRowsUnique(ledger: readonly LedgerRow[], migrations: readonly MigrationIdentity[]): void {
  for (const migration of migrations) {
    if (rowsForHash(ledger, migration.hash).length > 1) fail(`packaged migration ${migration.hash} appears more than once in the ledger`);
  }
}

function appliedUpstreamCount(ledger: readonly LedgerRow[], upstream: readonly MigrationIdentity[]): number {
  let count = 0;
  for (const migration of upstream) {
    const rows = rowsForHash(ledger, migration.hash);
    if (rows.length > 1) fail(`upstream migration ${migration.hash} appears more than once in the ledger`);
    if (rows[0]) {
      if (rows[0].createdAt !== String(migration.folderMillis)) fail(`upstream migration ${migration.hash} has an unexpected ledger timestamp`);
      count += 1;
    }
  }
  return count;
}

function appliedUpstreamCountForGuard(ledger: readonly LedgerRow[], upstream: readonly MigrationIdentity[]): number {
  return upstream.filter((migration) => rowsForHash(ledger, migration.hash).length === 1).length;
}

async function hasAppPasswordsTable(client: PoolClient): Promise<boolean> {
  const table = await client.query<{ exists: boolean }>(`SELECT to_regclass('public.app_passwords') IS NOT NULL AS exists`);
  return table.rows[0]?.exists ?? false;
}

async function inspectSchema(client: PoolClient): Promise<SchemaSnapshot> {
  const columns = await client.query<ColumnRow>(
    `
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        character_maximum_length AS "characterMaximumLength",
        is_nullable = 'YES' AS nullable,
        column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `,
    [TRACKED_TABLES],
  );
  const constraints = await client.query<ConstraintRow>(
    `
      SELECT pg_constraint.conname AS "constraintName", pg_get_constraintdef(pg_constraint.oid, true) AS definition
      FROM pg_constraint
      INNER JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
      INNER JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
      WHERE pg_namespace.nspname = 'public' AND pg_class.relname = ANY($1::text[])
    `,
    [TRACKED_TABLES],
  );
  const indexes = await client.query<IndexRow>(
    `
      SELECT
        index_relation.relname AS "indexName",
        pg_get_indexdef(index_relation.oid) AS definition,
        ARRAY(
          SELECT pg_get_indexdef(index_relation.oid, position, true)
          FROM generate_series(1, pg_index.indnatts) AS position
          ORDER BY position
        ) AS columns
      FROM pg_index
      INNER JOIN pg_class AS index_relation ON index_relation.oid = pg_index.indexrelid
      INNER JOIN pg_class AS table_relation ON table_relation.oid = pg_index.indrelid
      INNER JOIN pg_namespace ON pg_namespace.oid = table_relation.relnamespace
      WHERE pg_namespace.nspname = 'public' AND table_relation.relname = ANY($1::text[])
    `,
    [TRACKED_TABLES],
  );
  return {
    columns: new Map(columns.rows.map((row) => [`${row.tableName}.${row.columnName}`, row])),
    constraints: new Map(constraints.rows.map((row) => [row.constraintName, row])),
    indexes: new Map(indexes.rows.map((row) => [row.indexName, row])),
  };
}

function requireColumn(
  schema: SchemaSnapshot,
  tableName: string,
  columnName: string,
  expected: { dataType: string; nullable: boolean; length?: number; defaultIncludes?: string },
): void {
  const column = schema.columns.get(`${tableName}.${columnName}`);
  if (!column) fail(`required column ${tableName}.${columnName} is missing`);
  if (column.dataType !== expected.dataType || column.nullable !== expected.nullable) {
    fail(`column ${tableName}.${columnName} has an unexpected type or nullability`);
  }
  if (expected.length !== undefined && column.characterMaximumLength !== expected.length) {
    fail(`column ${tableName}.${columnName} has an unexpected length`);
  }
  if (expected.defaultIncludes !== undefined && !column.columnDefault?.includes(expected.defaultIncludes)) {
    fail(`column ${tableName}.${columnName} has an unexpected default`);
  }
}

function requireAbsentColumn(schema: SchemaSnapshot, tableName: string, columnName: string): void {
  if (schema.columns.has(`${tableName}.${columnName}`)) fail(`column ${tableName}.${columnName} must not exist in this migration state`);
}

function normalizeDefinition(value: string): string {
  return value.toLowerCase().replaceAll('"', '').replace(/\s+/g, ' ').trim();
}

function normalizeCheckDefinition(value: string): string {
  const normalized = normalizeDefinition(value);
  if (!normalized.startsWith('check (') || !normalized.endsWith(')')) return normalized;

  let expression = normalized.slice('check ('.length, -1).trim();
  while (expression.startsWith('(') && expression.endsWith(')')) {
    let depth = 0;
    let wrapsExpression = true;
    for (let index = 0; index < expression.length; index += 1) {
      if (expression[index] === '(') depth += 1;
      if (expression[index] === ')') depth -= 1;
      if (depth === 0 && index < expression.length - 1) {
        wrapsExpression = false;
        break;
      }
    }
    if (!wrapsExpression) break;
    expression = expression.slice(1, -1).trim();
  }
  return `check(${expression.replace(/\s+/g, '')})`;
}

function requireConstraint(schema: SchemaSnapshot, name: string, fragments: readonly string[] = []): void {
  const constraint = schema.constraints.get(name);
  if (!constraint) fail(`required constraint ${name} is missing`);
  const definition = normalizeDefinition(constraint.definition);
  if (fragments.some((fragment) => !definition.includes(fragment.toLowerCase()))) fail(`constraint ${name} has an unexpected definition`);
}

function requireExactConstraint(schema: SchemaSnapshot, name: string, definition: string): void {
  const constraint = schema.constraints.get(name);
  if (!constraint) fail(`required constraint ${name} is missing`);
  if (normalizeCheckDefinition(constraint.definition) !== normalizeCheckDefinition(definition)) {
    fail(`constraint ${name} has an unexpected definition`);
  }
}

function requireAbsentConstraint(schema: SchemaSnapshot, name: string): void {
  if (schema.constraints.has(name)) fail(`constraint ${name} must not exist in this migration state`);
}

function requireIndex(schema: SchemaSnapshot, name: string, columns: readonly string[]): void {
  const index = schema.indexes.get(name);
  if (!index) fail(`required index ${name} is missing`);
  if (index.columns.length !== columns.length || index.columns.some((column, position) => normalizeDefinition(column) !== columns[position])) {
    fail(`index ${name} has an unexpected ordered column list`);
  }
}

function requireAbsentIndex(schema: SchemaSnapshot, name: string): void {
  if (schema.indexes.has(name)) fail(`index ${name} must not exist in this migration state`);
}

function validatePermanentFootprint(schema: SchemaSnapshot): void {
  const appPasswordColumns = [...schema.columns.values()].filter((column) => column.tableName === 'app_passwords');
  if (appPasswordColumns.length !== 11) fail('app_passwords does not have the expected 11 columns');
  requireColumn(schema, 'app_passwords', 'id', { dataType: 'integer', nullable: false, defaultIncludes: 'nextval' });
  requireColumn(schema, 'app_passwords', 'user_id', { dataType: 'integer', nullable: false });
  requireColumn(schema, 'app_passwords', 'label', { dataType: 'character varying', nullable: false, length: 100 });
  requireColumn(schema, 'app_passwords', 'selector', { dataType: 'character varying', nullable: false, length: 32 });
  requireColumn(schema, 'app_passwords', 'secret_hash', { dataType: 'character varying', nullable: false, length: 64 });
  requireColumn(schema, 'app_passwords', 'secret_hint', { dataType: 'character varying', nullable: false, length: 32 });
  requireColumn(schema, 'app_passwords', 'expires_at', { dataType: 'timestamp with time zone', nullable: false });
  requireColumn(schema, 'app_passwords', 'last_used_at', { dataType: 'timestamp with time zone', nullable: true });
  requireColumn(schema, 'app_passwords', 'last_used_ip', { dataType: 'character varying', nullable: true, length: 45 });
  requireColumn(schema, 'app_passwords', 'revoked_at', { dataType: 'timestamp with time zone', nullable: true });
  requireColumn(schema, 'app_passwords', 'created_at', {
    dataType: 'timestamp with time zone',
    nullable: false,
    defaultIncludes: 'now()',
  });
  requireConstraint(schema, 'app_passwords_pkey');
  requireConstraint(schema, 'app_passwords_selector_unique', ['selector']);
  requireConstraint(schema, 'app_passwords_secret_hash_unique', ['secret_hash']);
  requireExactConstraint(schema, 'app_passwords_expires_after_created_chk', 'CHECK (expires_at > created_at)');
  requireConstraint(schema, 'app_passwords_user_id_users_id_fk', ['user_id', 'users', 'on delete cascade']);
  requireIndex(schema, 'app_passwords_user_id_idx', ['user_id']);
  requireIndex(schema, 'app_passwords_expires_at_idx', ['expires_at']);

  for (const [tableName, indexName, columns] of [
    ['reading_progress', 'reading_progress_app_password_user_idx', ['app_password_id', 'user_id']],
    ['reading_sessions', 'rs_app_password_user_started_at_idx', ['app_password_id', 'user_id', 'started_at']],
    ['audiobook_progress', 'abp_app_password_user_idx', ['app_password_id', 'user_id']],
  ] as const) {
    requireColumn(schema, tableName, 'app_password_id', { dataType: 'integer', nullable: true });
    requireConstraint(schema, `${tableName}_app_password_id_app_passwords_id_fk`, ['app_password_id', 'app_passwords', 'on delete set null']);
    requireIndex(schema, indexName, columns);
  }
  requireColumn(schema, 'reading_attempts', 'external_provider', {
    dataType: 'character varying',
    nullable: true,
    length: 100,
  });
}

function validateLegacyRefreshFootprint(schema: SchemaSnapshot): void {
  requireColumn(schema, 'refresh_tokens', 'app_password_id', { dataType: 'integer', nullable: true });
  requireColumn(schema, 'refresh_tokens', 'session_family_id', {
    dataType: 'uuid',
    nullable: false,
    defaultIncludes: 'gen_random_uuid()',
  });
  requireConstraint(schema, 'refresh_tokens_app_password_id_app_passwords_id_fk', ['app_password_id', 'app_passwords', 'on delete cascade']);
  requireIndex(schema, 'refresh_tokens_app_password_id_idx', ['app_password_id']);
  requireIndex(schema, 'refresh_tokens_session_family_id_idx', ['session_family_id']);
}

async function validatePreparedLegacySchema(client: PoolClient): Promise<void> {
  const schema = await inspectSchema(client);
  validatePermanentFootprint(schema);
  validateLegacyRefreshFootprint(schema);
}

async function validateBaselineSchema(client: PoolClient): Promise<void> {
  const schema = await inspectSchema(client);
  validatePermanentFootprint(schema);
  validateLegacyRefreshFootprint(schema);
  requireAbsentColumn(schema, 'auth_sessions', 'app_password_id');
  requireConstraint(schema, 'auth_sessions_authentication_method_chk');
  if (schema.constraints.get('auth_sessions_authentication_method_chk')!.definition.includes('app_password')) {
    fail('the baseline auth_sessions authentication method check already includes app_password');
  }
  requireConstraint(schema, 'refresh_tokens_authentication_method_chk');
  if (schema.constraints.get('refresh_tokens_authentication_method_chk')!.definition.includes('app_password')) {
    fail('the baseline refresh_tokens authentication method check already includes app_password');
  }
  requireAbsentConstraint(schema, 'auth_sessions_app_password_auth_chk');
  requireAbsentIndex(schema, 'auth_sessions_app_password_id_idx');
}

async function validateFinalSchema(client: PoolClient): Promise<void> {
  const schema = await inspectSchema(client);
  validatePermanentFootprint(schema);
  requireColumn(schema, 'auth_sessions', 'app_password_id', { dataType: 'integer', nullable: true });
  requireConstraint(schema, 'auth_sessions_app_password_id_app_passwords_id_fk', ['app_password_id', 'app_passwords', 'on delete cascade']);
  requireIndex(schema, 'auth_sessions_app_password_id_idx', ['app_password_id']);
  requireConstraint(schema, 'auth_sessions_authentication_method_chk', ['app_password']);
  requireConstraint(schema, 'refresh_tokens_authentication_method_chk', ['app_password']);
  requireConstraint(schema, 'auth_sessions_app_password_auth_chk', ['authentication_method', 'app_password_id', 'app_password']);
  requireAbsentColumn(schema, 'refresh_tokens', 'app_password_id');
  requireAbsentColumn(schema, 'refresh_tokens', 'session_family_id');
  requireAbsentConstraint(schema, 'refresh_tokens_app_password_id_app_passwords_id_fk');
  requireAbsentIndex(schema, 'refresh_tokens_app_password_id_idx');
  requireAbsentIndex(schema, 'refresh_tokens_session_family_id_idx');
}

async function assertAttributionOwnership(client: PoolClient): Promise<void> {
  const mismatches = await client.query<{ count: string }>(`
    SELECT (
      (SELECT count(*) FROM refresh_tokens item INNER JOIN app_passwords credential ON credential.id = item.app_password_id WHERE item.app_password_id IS NOT NULL AND item.user_id <> credential.user_id) +
      (SELECT count(*) FROM reading_progress item INNER JOIN app_passwords credential ON credential.id = item.app_password_id WHERE item.app_password_id IS NOT NULL AND item.user_id <> credential.user_id) +
      (SELECT count(*) FROM reading_sessions item INNER JOIN app_passwords credential ON credential.id = item.app_password_id WHERE item.app_password_id IS NOT NULL AND item.user_id <> credential.user_id) +
      (SELECT count(*) FROM audiobook_progress item INNER JOIN app_passwords credential ON credential.id = item.app_password_id WHERE item.app_password_id IS NOT NULL AND item.user_id <> credential.user_id)
    )::text AS count
  `);
  if (mismatches.rows[0]?.count !== '0') fail('App Password attribution contains cross-user rows');
}

function logFailure(operation: string, startedAt: number, error: unknown): void {
  const errorClass = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[${EVENT}] [fail] operation=${operation} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - App Password migration compatibility failed`,
  );
}

function assertNoUnexpectedRowsAfter0075(ledger: readonly LedgerRow[], migrations: readonly MigrationIdentity[]): void {
  const allowed = new Set([
    ...LEGACY_APP_PASSWORD_MIGRATIONS.map((migration) => migration.hash),
    ...migrations.map((migration) => migration.hash),
    ...UNRELEASED_MIGRATION_HASHES,
  ]);
  const threshold = BigInt(APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075.folderMillis);
  if (ledger.some((row) => BigInt(row.createdAt) > threshold && !allowed.has(row.hash))) {
    fail('the ledger contains an unexpected migration after upstream 0075');
  }
}

export async function prepareLegacyAppPasswordMigration(
  pool: CompatibilityPool,
  migrations: readonly MigrationIdentity[],
): Promise<PrepareAppPasswordMigrationResult> {
  const upstream = assertManifest(migrations);
  const startedAt = Date.now();
  console.log(`[${EVENT}] [start] operation=prepare - App Password migration compatibility preparation started`);
  try {
    const result = await withCompatibilityLock(pool, async (client) => {
      const ledger = await readLedger(client);
      if (!ledger) {
        if (await hasAppPasswordsTable(client)) fail('app_passwords exists without a migration ledger');
        return { status: 'not-applicable', repairedRows: 0 } as const;
      }
      const legacyState = classifyLegacyState(ledger);
      if (legacyState === 'absent') {
        const baseline = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141);
        const final = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.final0142);
        if (final && !baseline) fail('the final migration is recorded without the baseline migration');
        if ((baseline || final) && appliedUpstreamCount(ledger, upstream) !== upstream.length) {
          fail('a generated migration marker exists before upstream migrations 0076 through 0140 are complete');
        }
        if (final) {
          await validateFinalSchema(client);
          return { status: 'finalized', repairedRows: 0 } as const;
        }
        if (baseline) {
          await validateBaselineSchema(client);
          return { status: 'baseline-recorded', repairedRows: 0 } as const;
        }
        if (await hasAppPasswordsTable(client)) fail('app_passwords exists without a recognized migration ledger history');
        return { status: 'not-applicable', repairedRows: 0 } as const;
      }
      assertLegacyAnchor(ledger);
      assertKnownPackagedRowsStrict(ledger, migrations);
      assertNoUnexpectedRowsAfter0075(ledger, migrations);

      const baseline = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141);
      const final = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.final0142);
      if (final && !baseline) fail('the final migration is recorded without the baseline migration');
      const upstreamCount = appliedUpstreamCount(ledger, upstream);
      if (baseline || final) {
        if (legacyState !== 'prepared' || upstreamCount !== upstream.length) {
          fail('a generated migration marker exists before the prepared legacy and upstream histories are complete');
        }
        if (final) {
          await validateFinalSchema(client);
          return { status: 'finalized', repairedRows: 0 } as const;
        }
        await validateBaselineSchema(client);
        return { status: 'baseline-recorded', repairedRows: 0 } as const;
      }

      if (legacyState === 'original') {
        if (upstreamCount !== 0) fail('upstream migrations are recorded while legacy timestamps are still original');
        await validatePreparedLegacySchema(client);
        let repairedRows = 0;
        for (const migration of LEGACY_APP_PASSWORD_MIGRATIONS) {
          const updated = await client.query(`UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE hash = $2 AND created_at = $3`, [
            String(migration.preparedFolderMillis),
            migration.hash,
            String(migration.originalFolderMillis),
          ]);
          if (updated.rowCount !== 1) fail(`legacy migration ${migration.hash} could not be prepared atomically`);
          repairedRows += updated.rowCount;
        }
        return { status: 'prepared', repairedRows } as const;
      }

      if (upstreamCount === 0) {
        await validatePreparedLegacySchema(client);
        return { status: 'already-prepared', repairedRows: 0 } as const;
      }
      if (upstreamCount === upstream.length) {
        await validateBaselineSchema(client);
        return { status: 'base-migrated', repairedRows: 0 } as const;
      }
      fail('the upstream migration range is only partially applied; rerun the upstream-only migrator');
    });
    console.log(
      `[${EVENT}] [end] operation=prepare durationMs=${Date.now() - startedAt} status=${result.status} repaired=${result.repairedRows} - App Password migration compatibility preparation completed`,
    );
    return result;
  } catch (error) {
    logFailure('prepare', startedAt, error);
    throw error;
  }
}

export async function finalizeLegacyAppPasswordMigration(
  pool: CompatibilityPool,
  migrations: readonly MigrationIdentity[],
): Promise<FinalizeAppPasswordMigrationResult> {
  const upstream = assertManifest(migrations);
  const startedAt = Date.now();
  console.log(`[${EVENT}] [start] operation=finalize - App Password migration compatibility finalization started`);
  try {
    const result = await withCompatibilityLock(pool, async (client) => {
      const ledger = await readLedger(client);
      if (!ledger) fail('the migration ledger does not exist');
      const legacyState = classifyLegacyState(ledger);
      if (legacyState === 'absent') fail('this database does not contain the legacy App Password migration history');
      assertLegacyAnchor(ledger);
      assertKnownPackagedRowsStrict(ledger, migrations);
      if (legacyState !== 'prepared') fail('the legacy migration timestamps have not been prepared');
      assertNoUnexpectedRowsAfter0075(ledger, migrations);

      const baseline = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141);
      const final = marker(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.final0142);
      if (final && !baseline) fail('the final migration is recorded without the baseline migration');
      if (appliedUpstreamCount(ledger, upstream) !== upstream.length) fail('upstream migrations 0076 through 0140 are not fully applied');
      if (final) {
        await validateFinalSchema(client);
        return { status: 'finalized', revokedRefreshTokens: 0 } as const;
      }

      await validateBaselineSchema(client);
      await assertAttributionOwnership(client);
      const revoked = await client.query(`
        UPDATE refresh_tokens
        SET revoked_at = statement_timestamp()
        WHERE app_password_id IS NOT NULL AND revoked_at IS NULL
      `);
      if (baseline) return { status: 'already-recorded', revokedRefreshTokens: revoked.rowCount ?? 0 } as const;

      const inserted = await client.query(
        `
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          SELECT $1, $2
          WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1)
        `,
        [APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.hash, String(APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.folderMillis)],
      );
      if (inserted.rowCount !== 1) fail('the generated legacy baseline migration could not be recorded atomically');
      return { status: 'baseline-recorded', revokedRefreshTokens: revoked.rowCount ?? 0 } as const;
    });
    console.log(
      `[${EVENT}] [end] operation=finalize durationMs=${Date.now() - startedAt} status=${result.status} revokedRefreshTokens=${result.revokedRefreshTokens} - App Password migration compatibility finalization completed`,
    );
    return result;
  } catch (error) {
    logFailure('finalize', startedAt, error);
    throw error;
  }
}

export async function assertAppPasswordMigrationStateSafe(pool: CompatibilityPool, migrations: readonly MigrationIdentity[]): Promise<void> {
  const upstream = assertManifest(migrations);
  await withCompatibilityLock(pool, async (client) => {
    const ledger = await readLedger(client);
    if (!ledger) {
      if (await hasAppPasswordsTable(client)) fail('app_passwords exists without a migration ledger');
      return;
    }
    const legacyState = classifyLegacyState(ledger);
    if (legacyState !== 'absent') assertLegacyAnchor(ledger);
    assertKnownPackagedRowsUnique(ledger, migrations);
    const baseline = markerPresence(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141);
    const final = markerPresence(ledger, APP_PASSWORD_MIGRATION_IDENTITIES.final0142);
    if (final && !baseline) fail('the final migration is recorded without the baseline migration');

    if (legacyState === 'absent') {
      if ((baseline || final) && appliedUpstreamCountForGuard(ledger, upstream) !== upstream.length) {
        fail('a generated migration marker exists before upstream migrations 0076 through 0140 are complete');
      }
      if (final) {
        await validateFinalSchema(client);
        return;
      }
      if (baseline) {
        await validateBaselineSchema(client);
        return;
      }
      if (await hasAppPasswordsTable(client)) fail('app_passwords exists without a recognized migration ledger history');
      return;
    }

    assertNoUnexpectedRowsAfter0075(ledger, migrations);
    if (!baseline) {
      fail(
        `legacy migration state ${legacyState} requires the staged prepare, upstream-only migration, and finalize procedure before the final migrator can run`,
      );
    }
    if (legacyState !== 'prepared' || appliedUpstreamCountForGuard(ledger, upstream) !== upstream.length) {
      fail('the generated baseline marker is present before the prepared legacy and upstream histories are complete');
    }
    if (final) await validateFinalSchema(client);
    else await validateBaselineSchema(client);
  });
}
