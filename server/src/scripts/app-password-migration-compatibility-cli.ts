import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';
import { createPostgresClientConfig } from '../db/postgres-connection-config';
import {
  finalizeLegacyAppPasswordMigration,
  parseAppPasswordMigrationCompatibilityPhase,
  prepareLegacyAppPasswordMigration,
} from './app-password-migration-compatibility';
import { resolveMigrationsFolder } from './migrations-folder';

const startedAt = Date.now();

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const phase = parseAppPasswordMigrationCompatibilityPhase(process.argv.slice(2));
  const migrations = readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() });
  const pool = new Pool(
    createPostgresClientConfig(connectionString, {
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  );
  try {
    if (phase === 'prepare') await prepareLegacyAppPasswordMigration(pool, migrations);
    else await finalizeLegacyAppPasswordMigration(pool, migrations);
  } finally {
    await pool.end();
  }
}

void run().catch((error) => {
  const errorClass = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[db.app-password-migration-compatibility-cli] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - compatibility command failed`,
  );
  process.exitCode = 1;
});
