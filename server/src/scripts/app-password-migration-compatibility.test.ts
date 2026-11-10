import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import {
  APP_PASSWORD_MIGRATION_IDENTITIES,
  LEGACY_APP_PASSWORD_MIGRATIONS,
  assertAppPasswordMigrationStateSafe,
  finalizeLegacyAppPasswordMigration,
  parseAppPasswordMigrationCompatibilityPhase,
  prepareLegacyAppPasswordMigration,
} from './app-password-migration-compatibility';
import { UNRELEASED_MIGRATION_HASHES } from './migration-ledger-compatibility';
import { resolveMigrationsFolder } from './migrations-folder';

type MigrationIdentity = Pick<MigrationMeta, 'folderMillis' | 'hash'>;
type LedgerRow = { id: number; hash: string; createdAt: string };
type SchemaKind = 'none' | 'legacy' | 'baseline' | 'final';

type FakeState = {
  ledgerTable?: boolean;
  ledger?: LedgerRow[];
  schema?: SchemaKind;
  ownershipMismatches?: number;
  activeLegacyRefreshTokens?: number;
  invalidExpiryCheck?: boolean;
  readingSessionIndexMissingStartedAt?: boolean;
};

const upstream0074: MigrationIdentity = {
  hash: 'upstream-0074',
  folderMillis: APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075.folderMillis - 1,
};

const upstreamMigrations: MigrationIdentity[] = Array.from({ length: 65 }, (_, index) => ({
  hash: `upstream-${index}`,
  folderMillis: APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076.folderMillis + index,
}));
upstreamMigrations[0] = APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076;
upstreamMigrations[64] = APP_PASSWORD_MIGRATION_IDENTITIES.upstream0140;

const migrations: MigrationIdentity[] = [
  upstream0074,
  APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075,
  ...upstreamMigrations,
  APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141,
  APP_PASSWORD_MIGRATION_IDENTITIES.final0142,
];

function migrationRow(id: number, migration: MigrationIdentity): LedgerRow {
  return { id, hash: migration.hash, createdAt: String(migration.folderMillis) };
}

function legacyRows(state: 'original' | 'prepared'): LedgerRow[] {
  return LEGACY_APP_PASSWORD_MIGRATIONS.map((migration, index) => ({
    id: 100 + index,
    hash: migration.hash,
    createdAt: String(state === 'original' ? migration.originalFolderMillis : migration.preparedFolderMillis),
  }));
}

function legacyLedger(state: 'original' | 'prepared'): LedgerRow[] {
  return [migrationRow(99, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075), ...legacyRows(state)];
}

function upstreamRows(): LedgerRow[] {
  return upstreamMigrations.map((migration, index) => migrationRow(200 + index, migration));
}

function column(
  tableName: string,
  columnName: string,
  dataType: string,
  nullable: boolean,
  characterMaximumLength: number | null = null,
  columnDefault: string | null = null,
) {
  return { tableName, columnName, dataType, characterMaximumLength, nullable, columnDefault };
}

function schemaColumns(kind: SchemaKind) {
  if (kind === 'none') return [];
  const columns = [
    column('app_passwords', 'id', 'integer', false, null, "nextval('app_passwords_id_seq'::regclass)"),
    column('app_passwords', 'user_id', 'integer', false),
    column('app_passwords', 'label', 'character varying', false, 100),
    column('app_passwords', 'selector', 'character varying', false, 32),
    column('app_passwords', 'secret_hash', 'character varying', false, 64),
    column('app_passwords', 'secret_hint', 'character varying', false, 32),
    column('app_passwords', 'expires_at', 'timestamp with time zone', false),
    column('app_passwords', 'last_used_at', 'timestamp with time zone', true),
    column('app_passwords', 'last_used_ip', 'character varying', true, 45),
    column('app_passwords', 'revoked_at', 'timestamp with time zone', true),
    column('app_passwords', 'created_at', 'timestamp with time zone', false, null, 'now()'),
    column('reading_progress', 'app_password_id', 'integer', true),
    column('reading_sessions', 'app_password_id', 'integer', true),
    column('audiobook_progress', 'app_password_id', 'integer', true),
    column('reading_attempts', 'external_provider', 'character varying', true, 100),
  ];
  if (kind === 'legacy' || kind === 'baseline') {
    columns.push(column('refresh_tokens', 'app_password_id', 'integer', true));
    columns.push(column('refresh_tokens', 'session_family_id', 'uuid', false, null, 'gen_random_uuid()'));
  }
  if (kind === 'final') columns.push(column('auth_sessions', 'app_password_id', 'integer', true));
  return columns;
}

function constraint(constraintName: string, definition: string) {
  return { constraintName, definition };
}

function schemaConstraints(kind: SchemaKind, invalidExpiryCheck: boolean) {
  if (kind === 'none') return [];
  const constraints = [
    constraint('app_passwords_pkey', 'PRIMARY KEY (id)'),
    constraint('app_passwords_selector_unique', 'UNIQUE (selector)'),
    constraint('app_passwords_secret_hash_unique', 'UNIQUE (secret_hash)'),
    constraint(
      'app_passwords_expires_after_created_chk',
      invalidExpiryCheck ? 'CHECK (expires_at >= created_at)' : 'CHECK ((expires_at > created_at))',
    ),
    constraint('app_passwords_user_id_users_id_fk', 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'),
    constraint(
      'reading_progress_app_password_id_app_passwords_id_fk',
      'FOREIGN KEY (app_password_id) REFERENCES app_passwords(id) ON DELETE SET NULL',
    ),
    constraint(
      'reading_sessions_app_password_id_app_passwords_id_fk',
      'FOREIGN KEY (app_password_id) REFERENCES app_passwords(id) ON DELETE SET NULL',
    ),
    constraint(
      'audiobook_progress_app_password_id_app_passwords_id_fk',
      'FOREIGN KEY (app_password_id) REFERENCES app_passwords(id) ON DELETE SET NULL',
    ),
  ];
  if (kind === 'legacy' || kind === 'baseline') {
    constraints.push(
      constraint(
        'refresh_tokens_app_password_id_app_passwords_id_fk',
        'FOREIGN KEY (app_password_id) REFERENCES app_passwords(id) ON DELETE CASCADE',
      ),
    );
  }
  if (kind === 'baseline') {
    constraints.push(constraint('auth_sessions_authentication_method_chk', "CHECK (authentication_method IN ('password', 'legacy'))"));
    constraints.push(constraint('refresh_tokens_authentication_method_chk', "CHECK (authentication_method IN ('password', 'legacy'))"));
  }
  if (kind === 'final') {
    constraints.push(
      constraint('auth_sessions_app_password_id_app_passwords_id_fk', 'FOREIGN KEY (app_password_id) REFERENCES app_passwords(id) ON DELETE CASCADE'),
      constraint('auth_sessions_authentication_method_chk', "CHECK (authentication_method IN ('password', 'app_password'))"),
      constraint('refresh_tokens_authentication_method_chk', "CHECK (authentication_method IN ('password', 'app_password'))"),
      constraint('auth_sessions_app_password_auth_chk', "CHECK ((authentication_method = 'app_password') = (app_password_id IS NOT NULL))"),
    );
  }
  return constraints;
}

function index(indexName: string, columns: string[]) {
  return { indexName, definition: `CREATE INDEX ${indexName} ON public.placeholder USING btree (${columns.join(', ')})`, columns };
}

function schemaIndexes(kind: SchemaKind, readingSessionIndexMissingStartedAt: boolean) {
  if (kind === 'none') return [];
  const indexes = [
    index('app_passwords_user_id_idx', ['user_id']),
    index('app_passwords_expires_at_idx', ['expires_at']),
    index('reading_progress_app_password_user_idx', ['app_password_id', 'user_id']),
    index(
      'rs_app_password_user_started_at_idx',
      readingSessionIndexMissingStartedAt ? ['app_password_id', 'user_id'] : ['app_password_id', 'user_id', 'started_at'],
    ),
    index('abp_app_password_user_idx', ['app_password_id', 'user_id']),
  ];
  if (kind === 'legacy' || kind === 'baseline') {
    indexes.push(index('refresh_tokens_app_password_id_idx', ['app_password_id']));
    indexes.push(index('refresh_tokens_session_family_id_idx', ['session_family_id']));
  }
  if (kind === 'final') indexes.push(index('auth_sessions_app_password_id_idx', ['app_password_id']));
  return indexes;
}

function createPool(initial: FakeState = {}) {
  const state = {
    ledgerTable: initial.ledgerTable ?? true,
    ledger: [...(initial.ledger ?? [])],
    schema: initial.schema ?? 'none',
    ownershipMismatches: initial.ownershipMismatches ?? 0,
    activeLegacyRefreshTokens: initial.activeLegacyRefreshTokens ?? 0,
    invalidExpiryCheck: initial.invalidExpiryCheck ?? false,
    readingSessionIndexMissingStartedAt: initial.readingSessionIndexMissingStartedAt ?? false,
  };
  const query = vi.fn((statement: string, parameters?: unknown[]) => {
    const sql = statement.trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("to_regclass('drizzle.__drizzle_migrations')")) {
      return { rows: [{ tableName: state.ledgerTable ? 'drizzle.__drizzle_migrations' : null }], rowCount: 1 };
    }
    if (sql.includes("to_regclass('public.app_passwords')")) {
      return { rows: [{ exists: state.schema !== 'none' }], rowCount: 1 };
    }
    if (sql.includes('SELECT id, hash, created_at::text')) return { rows: state.ledger, rowCount: state.ledger.length };
    if (sql.includes('FROM information_schema.columns')) return { rows: schemaColumns(state.schema), rowCount: 0 };
    if (sql.includes('FROM pg_constraint')) return { rows: schemaConstraints(state.schema, state.invalidExpiryCheck), rowCount: 0 };
    if (sql.includes('FROM pg_index')) {
      return { rows: schemaIndexes(state.schema, state.readingSessionIndexMissingStartedAt), rowCount: 0 };
    }
    if (sql.startsWith('SELECT (') && sql.includes('INNER JOIN app_passwords')) {
      return { rows: [{ count: String(state.ownershipMismatches) }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE drizzle.__drizzle_migrations')) {
      const [prepared, hash, original] = parameters as [string, string, string];
      const row = state.ledger.find((candidate) => candidate.hash === hash && candidate.createdAt === original);
      if (!row) return { rows: [], rowCount: 0 };
      row.createdAt = prepared;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE refresh_tokens')) {
      const rowCount = state.activeLegacyRefreshTokens;
      state.activeLegacyRefreshTokens = 0;
      return { rows: [], rowCount };
    }
    if (sql.startsWith('INSERT INTO drizzle.__drizzle_migrations')) {
      const [hash, createdAt] = parameters as [string, string];
      if (state.ledger.some((row) => row.hash === hash)) return { rows: [], rowCount: 0 };
      state.ledger.push({ id: 1000, hash, createdAt });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release, state };
}

function baselineLedger() {
  return [...legacyLedger('prepared'), ...upstreamRows(), migrationRow(900, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141)];
}

function finalLedger() {
  return [...baselineLedger(), migrationRow(901, APP_PASSWORD_MIGRATION_IDENTITIES.final0142)];
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseAppPasswordMigrationCompatibilityPhase', () => {
  it.each(['prepare', 'finalize'] as const)('accepts %s', (phase) => {
    expect(parseAppPasswordMigrationCompatibilityPhase([phase])).toBe(phase);
  });

  it.each([{ phases: [] }, { phases: [''] }, { phases: ['migrate'] }, { phases: ['prepare', 'extra'] }])(
    'rejects invalid phase arguments',
    ({ phases }) => {
      expect(() => parseAppPasswordMigrationCompatibilityPhase(phases)).toThrow('expected exactly one phase argument');
    },
  );

  it('matches the hashes, timestamps, and upstream range generated into the packaged migration folder', async () => {
    const packaged = readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() });

    expect(packaged).toEqual(
      expect.arrayContaining([
        expect.objectContaining(APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141),
        expect.objectContaining(APP_PASSWORD_MIGRATION_IDENTITIES.final0142),
      ]),
    );
    const { pool } = createPool({ ledgerTable: false });
    await expect(assertAppPasswordMigrationStateSafe(pool, packaged)).resolves.toBeUndefined();
  });
});

describe('assertAppPasswordMigrationStateSafe', () => {
  it('allows a fresh database without a migration ledger', async () => {
    const { pool, query, release } = createPool({ ledgerTable: false });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses an untracked App Password schema when the ledger is absent', async () => {
    const { pool, query, release } = createPool({ ledgerTable: false, schema: 'legacy' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('app_passwords exists without a migration ledger');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('allows a vanilla upstream ledger without the App Password table', async () => {
    const { pool } = createPool({ ledger: upstreamRows() });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('refuses an untracked App Password schema with an empty ledger', async () => {
    const { pool } = createPool({ schema: 'legacy' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow(
      'app_passwords exists without a recognized migration ledger history',
    );
  });

  it.each([
    ['raw', legacyLedger('original'), 'legacy'],
    ['prepared', legacyLedger('prepared'), 'legacy'],
    ['partially base-migrated', [...legacyLedger('prepared'), ...upstreamRows().slice(0, 4)], 'baseline'],
    ['fully base-migrated', [...legacyLedger('prepared'), ...upstreamRows()], 'baseline'],
  ] as const)('refuses a %s legacy database until the baseline marker exists', async (_label, ledger, schema) => {
    const { pool } = createPool({ ledger: [...ledger], schema });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('requires the staged prepare');
  });

  it('allows an exact baseline-marked legacy database', async () => {
    const { pool } = createPool({ ledger: baselineLedger(), schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('allows an exact final legacy database', async () => {
    const { pool } = createPool({ ledger: finalLedger(), schema: 'final' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('allows known upstream timestamp drift so the normal migrator can reconcile it', async () => {
    const ledger = baselineLedger();
    ledger.find((row) => row.hash === upstreamMigrations[12].hash)!.createdAt = String(
      APP_PASSWORD_MIGRATION_IDENTITIES.final0142.folderMillis + 100,
    );
    const { pool } = createPool({ ledger, schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it.each([
    {
      label: 'baseline',
      ledger: baselineLedger(),
      marker: APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141,
      schema: 'baseline',
    },
    {
      label: 'final',
      ledger: finalLedger(),
      marker: APP_PASSWORD_MIGRATION_IDENTITIES.final0142,
      schema: 'final',
    },
  ] as const)('allows known $label marker timestamp drift so the normal migrator can reconcile it', async ({ ledger, marker, schema }) => {
    ledger.find((row) => row.hash === marker.hash)!.createdAt = String(APP_PASSWORD_MIGRATION_IDENTITIES.final0142.folderMillis + 100);
    const { pool } = createPool({ ledger: [...ledger], schema });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('allows known packaged and removable rows so normal ledger repair remains reachable', async () => {
    const driftedPackagedRow = migrationRow(80, upstream0074);
    driftedPackagedRow.createdAt = String(APP_PASSWORD_MIGRATION_IDENTITIES.final0142.folderMillis + 100);
    const removableRow: LedgerRow = {
      id: 81,
      hash: UNRELEASED_MIGRATION_HASHES[0],
      createdAt: String(APP_PASSWORD_MIGRATION_IDENTITIES.final0142.folderMillis + 101),
    };
    const { pool } = createPool({ ledger: [...baselineLedger(), driftedPackagedRow, removableRow], schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('rejects an unknown migration recorded after the upstream 0075 anchor', async () => {
    const unknown: LedgerRow = {
      id: 82,
      hash: 'unknown-after-0075',
      createdAt: String(APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075.folderMillis + 1),
    };
    const { pool } = createPool({ ledger: [...baselineLedger(), unknown], schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('unexpected migration after upstream 0075');
  });

  it.each([
    ['missing', legacyRows('prepared')],
    ['wrong timestamp', [{ ...migrationRow(99, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075), createdAt: '1' }, ...legacyRows('prepared')]],
    [
      'duplicate',
      [
        migrationRow(98, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075),
        migrationRow(99, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075),
        ...legacyRows('prepared'),
      ],
    ],
  ])('rejects a %s upstream 0075 anchor in a legacy state', async (_label, ledger) => {
    const { pool } = createPool({ ledger, schema: 'legacy' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('exact upstream 0075 anchor');
  });

  it('allows normal 0142 recovery after a vanilla database recorded only 0141', async () => {
    const ledger = [...upstreamRows(), migrationRow(900, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141)];
    const { pool } = createPool({ ledger, schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).resolves.toBeUndefined();
  });

  it('rejects a final marker without a baseline marker', async () => {
    const ledger = [...upstreamRows(), migrationRow(901, APP_PASSWORD_MIGRATION_IDENTITIES.final0142)];
    const { pool } = createPool({ ledger, schema: 'final' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('final migration is recorded without the baseline');
  });

  it('rejects a baseline marker before the upstream range is complete', async () => {
    const ledger = [migrationRow(900, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141)];
    const { pool } = createPool({ ledger, schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('before upstream migrations 0076 through 0140 are complete');
  });

  it('rejects duplicate generated migration markers', async () => {
    const ledger = baselineLedger();
    ledger.push(migrationRow(999, APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141));
    const { pool } = createPool({ ledger, schema: 'baseline' });

    await expect(assertAppPasswordMigrationStateSafe(pool, migrations)).rejects.toThrow('appears more than once');
  });

  it('rejects partial, duplicate, and mixed legacy histories', async () => {
    const partial = createPool({
      ledger: [migrationRow(99, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0075), ...legacyRows('prepared').slice(0, 2)],
      schema: 'legacy',
    });
    await expect(assertAppPasswordMigrationStateSafe(partial.pool, migrations)).rejects.toThrow('partial or contains duplicate');

    const duplicatedRows = legacyLedger('prepared');
    duplicatedRows.push({ ...duplicatedRows[1], id: 999 });
    const duplicate = createPool({ ledger: duplicatedRows, schema: 'legacy' });
    await expect(assertAppPasswordMigrationStateSafe(duplicate.pool, migrations)).rejects.toThrow('partial or contains duplicate');

    const mixedRows = legacyLedger('prepared');
    mixedRows[1].createdAt = String(LEGACY_APP_PASSWORD_MIGRATIONS[0].originalFolderMillis);
    const mixed = createPool({ ledger: mixedRows, schema: 'legacy' });
    await expect(assertAppPasswordMigrationStateSafe(mixed.pool, migrations)).rejects.toThrow('mixed or unexpected timestamps');
  });
});

describe('prepareLegacyAppPasswordMigration', () => {
  it('does nothing for a fresh database and rejects an untracked legacy footprint', async () => {
    const fresh = createPool({ ledgerTable: false });
    await expect(prepareLegacyAppPasswordMigration(fresh.pool, migrations)).resolves.toEqual({
      status: 'not-applicable',
      repairedRows: 0,
    });

    const untracked = createPool({ ledgerTable: false, schema: 'legacy' });
    await expect(prepareLegacyAppPasswordMigration(untracked.pool, migrations)).rejects.toThrow('app_passwords exists without a migration ledger');

    const emptyLedger = createPool({ schema: 'legacy' });
    await expect(prepareLegacyAppPasswordMigration(emptyLedger.pool, migrations)).rejects.toThrow(
      'app_passwords exists without a recognized migration ledger history',
    );
  });

  it('moves all three exact legacy timestamps immediately before upstream 0076', async () => {
    const { pool, query, state } = createPool({ ledger: legacyLedger('original'), schema: 'legacy' });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).resolves.toEqual({ status: 'prepared', repairedRows: 3 });
    for (const legacy of LEGACY_APP_PASSWORD_MIGRATIONS) {
      expect(query).toHaveBeenCalledWith('UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE hash = $2 AND created_at = $3', [
        String(legacy.preparedFolderMillis),
        legacy.hash,
        String(legacy.originalFolderMillis),
      ]);
      expect(state.ledger.find((row) => row.hash === legacy.hash)?.createdAt).toBe(String(legacy.preparedFolderMillis));
    }
    const lockCall = query.mock.calls.findIndex(([statement]) => String(statement).includes('pg_advisory_xact_lock'));
    const firstUpdate = query.mock.calls.findIndex(([statement]) => String(statement).startsWith('UPDATE drizzle'));
    expect(lockCall).toBeGreaterThan(-1);
    expect(firstUpdate).toBeGreaterThan(lockCall);
  });

  it('is idempotent after preparation', async () => {
    const fake = createPool({ ledger: legacyLedger('original'), schema: 'legacy' });

    await prepareLegacyAppPasswordMigration(fake.pool, migrations);
    await expect(prepareLegacyAppPasswordMigration(fake.pool, migrations)).resolves.toEqual({
      status: 'already-prepared',
      repairedRows: 0,
    });
  });

  it('recognizes a fully upstream-migrated baseline schema before finalization', async () => {
    const { pool } = createPool({ ledger: [...legacyLedger('prepared'), ...upstreamRows()], schema: 'baseline' });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).resolves.toEqual({ status: 'base-migrated', repairedRows: 0 });
  });

  it('refuses original legacy timestamps after any upstream migration was recorded', async () => {
    const { pool } = createPool({
      ledger: [...legacyLedger('original'), migrationRow(200, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076)],
      schema: 'legacy',
    });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('while legacy timestamps are still original');
  });

  it('refuses a partially applied upstream range and rolls back', async () => {
    const { pool, query, release } = createPool({
      ledger: [...legacyLedger('prepared'), ...upstreamRows().slice(0, 5)],
      schema: 'baseline',
    });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('only partially applied');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses an incomplete schema before changing ledger timestamps', async () => {
    const { pool, query } = createPool({ ledger: legacyLedger('original'), schema: 'none' });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('app_passwords does not have the expected 11 columns');
    expect(query.mock.calls.some(([statement]) => String(statement).startsWith('UPDATE drizzle'))).toBe(false);
  });

  it('requires the exact upstream 0075 anchor before changing ledger timestamps', async () => {
    const { pool, query } = createPool({ ledger: legacyRows('original'), schema: 'legacy' });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('exact upstream 0075 anchor');
    expect(query.mock.calls.some(([statement]) => String(statement).startsWith('UPDATE drizzle'))).toBe(false);
  });

  it('keeps timestamp validation strict in the explicit prepare phase', async () => {
    const ledger = legacyLedger('prepared');
    const drifted = migrationRow(200, APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076);
    drifted.createdAt = String(APP_PASSWORD_MIGRATION_IDENTITIES.upstream0076.folderMillis + 1);
    ledger.push(drifted);
    const { pool } = createPool({ ledger, schema: 'legacy' });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('unexpected ledger timestamp');
  });

  it.each([
    ['an incomplete reading-session index', { readingSessionIndexMissingStartedAt: true }, 'unexpected ordered column list'],
    ['a weakened expiry check', { invalidExpiryCheck: true }, 'unexpected definition'],
  ] as const)('rejects %s before changing ledger timestamps', async (_label, state, message) => {
    const { pool, query } = createPool({ ledger: legacyLedger('original'), schema: 'legacy', ...state });

    await expect(prepareLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow(message);
    expect(query.mock.calls.some(([statement]) => String(statement).startsWith('UPDATE drizzle'))).toBe(false);
  });
});

describe('finalizeLegacyAppPasswordMigration', () => {
  it('revokes only active linked refresh rows and records the exact generated baseline', async () => {
    const { pool, query, state } = createPool({
      ledger: [...legacyLedger('prepared'), ...upstreamRows()],
      schema: 'baseline',
      activeLegacyRefreshTokens: 2,
    });

    await expect(finalizeLegacyAppPasswordMigration(pool, migrations)).resolves.toEqual({
      status: 'baseline-recorded',
      revokedRefreshTokens: 2,
    });
    const refreshUpdate = query.mock.calls.find(([statement]) => String(statement).trim().startsWith('UPDATE refresh_tokens'));
    expect(String(refreshUpdate?.[0])).toContain('app_password_id IS NOT NULL AND revoked_at IS NULL');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO drizzle.__drizzle_migrations'), [
      APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.hash,
      String(APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.folderMillis),
    ]);
    expect(state.ledger).toContainEqual({
      id: 1000,
      hash: APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.hash,
      createdAt: String(APP_PASSWORD_MIGRATION_IDENTITIES.baseline0141.folderMillis),
    });
  });

  it('is idempotent after recording the baseline', async () => {
    const fake = createPool({
      ledger: [...legacyLedger('prepared'), ...upstreamRows()],
      schema: 'baseline',
      activeLegacyRefreshTokens: 3,
    });

    await finalizeLegacyAppPasswordMigration(fake.pool, migrations);
    await expect(finalizeLegacyAppPasswordMigration(fake.pool, migrations)).resolves.toEqual({
      status: 'already-recorded',
      revokedRefreshTokens: 0,
    });
  });

  it('recognizes an already finalized database without querying removed legacy rows', async () => {
    const { pool, query } = createPool({ ledger: finalLedger(), schema: 'final', activeLegacyRefreshTokens: 3 });

    await expect(finalizeLegacyAppPasswordMigration(pool, migrations)).resolves.toEqual({ status: 'finalized', revokedRefreshTokens: 0 });
    expect(query.mock.calls.some(([statement]) => String(statement).trim().startsWith('UPDATE refresh_tokens'))).toBe(false);
  });

  it('refuses cross-user attribution before revoking or recording anything', async () => {
    const { pool, query } = createPool({
      ledger: [...legacyLedger('prepared'), ...upstreamRows()],
      schema: 'baseline',
      ownershipMismatches: 1,
      activeLegacyRefreshTokens: 2,
    });

    await expect(finalizeLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('cross-user rows');
    expect(query.mock.calls.some(([statement]) => String(statement).trim().startsWith('UPDATE refresh_tokens'))).toBe(false);
    expect(query.mock.calls.some(([statement]) => String(statement).trim().startsWith('INSERT INTO drizzle'))).toBe(false);
  });

  it('refuses raw legacy timestamps and missing upstream migrations', async () => {
    const raw = createPool({ ledger: legacyLedger('original'), schema: 'legacy' });
    await expect(finalizeLegacyAppPasswordMigration(raw.pool, migrations)).rejects.toThrow('timestamps have not been prepared');

    const missingUpstream = createPool({ ledger: legacyLedger('prepared'), schema: 'legacy' });
    await expect(finalizeLegacyAppPasswordMigration(missingUpstream.pool, migrations)).rejects.toThrow('not fully applied');
  });

  it('keeps timestamp validation strict in the explicit finalize phase', async () => {
    const ledger = [...legacyLedger('prepared'), ...upstreamRows()];
    ledger.find((row) => row.hash === upstreamMigrations[20].hash)!.createdAt = String(
      APP_PASSWORD_MIGRATION_IDENTITIES.final0142.folderMillis + 100,
    );
    const { pool } = createPool({ ledger, schema: 'baseline' });

    await expect(finalizeLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('unexpected ledger timestamp');
  });

  it('refuses a final marker without a baseline marker', async () => {
    const fake = createPool({
      ledger: [...legacyLedger('prepared'), ...upstreamRows(), migrationRow(901, APP_PASSWORD_MIGRATION_IDENTITIES.final0142)],
      schema: 'final',
    });

    await expect(finalizeLegacyAppPasswordMigration(fake.pool, migrations)).rejects.toThrow('final migration is recorded without the baseline');
  });

  it('rolls back and releases the client on a schema validation failure', async () => {
    const { pool, query, release } = createPool({ ledger: [...legacyLedger('prepared'), ...upstreamRows()], schema: 'legacy' });

    await expect(finalizeLegacyAppPasswordMigration(pool, migrations)).rejects.toThrow('auth_sessions_authentication_method_chk');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a packaged manifest with a changed generated migration hash before connecting', async () => {
    const { pool } = createPool();
    const changed = migrations.map((migration) =>
      migration.hash === APP_PASSWORD_MIGRATION_IDENTITIES.final0142.hash ? { ...migration, hash: 'changed' } : migration,
    );

    await expect(finalizeLegacyAppPasswordMigration(pool, changed)).rejects.toThrow('packaged migration manifest');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
