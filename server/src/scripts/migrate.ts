import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { createPostgresClientConfig } from '../db/postgres-connection-config';
import { assertAppPasswordMigrationStateSafe } from './app-password-migration-compatibility';
import { dropUnreleasedMigrationRows, reconcileMigrationLedgerTimestamps } from './migration-ledger-compatibility';
import { resolveMigrationsFolder } from './migrations-folder';
import { installPostgresExtensions } from './postgres-extensions';
import { prepareLegacySeriesIndexColumns } from './series-index-migration-compatibility';

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool(
    createPostgresClientConfig(connectionString, {
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  );

  try {
    const migrationsFolder = resolveMigrationsFolder();
    const migrationFiles = readMigrationFiles({ migrationsFolder });
    await assertAppPasswordMigrationStateSafe(pool, migrationFiles);
    await installPostgresExtensions(pool);
    await dropUnreleasedMigrationRows(pool, migrationFiles);
    await reconcileMigrationLedgerTimestamps(pool, migrationFiles);
    await prepareLegacySeriesIndexColumns(pool);

    await migrate(drizzle(pool), { migrationsFolder });

    console.log(`Migrations applied successfully from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

void runMigrations();
