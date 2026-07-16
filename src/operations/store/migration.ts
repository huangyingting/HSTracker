import { copyFileSync } from "node:fs";

import Database from "better-sqlite3";
import { Pool, type PoolClient } from "pg";

import { migrationValidationFailed } from "./errors";
import {
  digestRows,
  MIGRATED_TABLES,
  requireNonEmpty,
  type MigratedTable,
} from "./internal";
import { sealSqliteArchive } from "./sqlite-operational-store";

/** Ordered column list per migrated table, shared by both read and write. */
const TABLE_COLUMNS: Record<MigratedTable, readonly string[]> = {
  operational_account: [
    "id",
    "display_name",
    "primary_export_economy",
    "created_at",
    "updated_at",
  ],
  operational_confirmed_product: [
    "account_id",
    "hs_revision",
    "code",
    "confirmed_at",
  ],
  operational_watch: [
    "id",
    "account_id",
    "hs_revision",
    "code",
    "market_economy",
    "status",
    "created_at",
    "updated_at",
    "last_evaluated_package_id",
  ],
  operational_alert_event: [
    "id",
    "watch_id",
    "account_id",
    "kind",
    "dedupe_key",
    "detail",
    "occurred_at",
    "created_at",
  ],
  operational_delivery_state: [
    "event_id",
    "channel",
    "status",
    "attempts",
    "updated_at",
  ],
};

const TARGET_SCHEMA = `
CREATE TABLE IF NOT EXISTS operational_account (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  primary_export_economy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operational_confirmed_product (
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  hs_revision TEXT NOT NULL,
  code TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, hs_revision, code)
);
CREATE TABLE IF NOT EXISTS operational_watch (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  hs_revision TEXT NOT NULL,
  code TEXT NOT NULL,
  market_economy TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_evaluated_package_id TEXT,
  UNIQUE (account_id, hs_revision, code, market_economy)
);
CREATE TABLE IF NOT EXISTS operational_alert_event (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES operational_watch(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (watch_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS operational_delivery_state (
  event_id TEXT NOT NULL REFERENCES operational_alert_event(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, channel)
);
`;

export interface MigrateSqliteToPostgresInput {
  readonly sqliteFilePath: string;
  readonly postgresConnectionString: string;
  /** When true, import and validate inside a transaction, then roll back. */
  readonly dryRun?: boolean;
  /** When set, the sealed read-only source is also copied here after success. */
  readonly archivePath?: string;
}

export interface MigratedTableReport {
  readonly table: MigratedTable;
  readonly rowCount: number;
  readonly digest: string;
}

export interface MigrationReport {
  readonly dryRun: boolean;
  readonly committed: boolean;
  readonly sourceArchived: boolean;
  readonly tables: readonly MigratedTableReport[];
}

/**
 * Migrate every business record from a single-instance SQLite deployment into
 * an empty PostgreSQL store, exactly once. The whole import runs in one
 * PostgreSQL transaction; per-table counts and content digests are validated
 * against the source before commit, and any mismatch rolls the transaction
 * back. On a real (non-dry) run the source file is sealed read-only as an
 * archive. Nothing is ever written back to SQLite, so the two stores are never
 * dual-written.
 */
export async function migrateSqliteToPostgres(
  input: MigrateSqliteToPostgresInput,
): Promise<MigrationReport> {
  const sqliteFilePath = requireNonEmpty(input.sqliteFilePath, "sqliteFilePath");
  const connectionString = requireNonEmpty(
    input.postgresConnectionString,
    "postgresConnectionString",
  );
  const dryRun = input.dryRun ?? false;

  const source = new Database(sqliteFilePath, { readonly: true });
  const sourceTables = readSource(source);
  source.close();

  const pool = new Pool({ connectionString });
  let committed = false;
  try {
    await pool.query(TARGET_SCHEMA);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertTargetEmpty(client);
      await importRows(client, sourceTables);
      const targetTables = await readTarget(client);
      validateParity(sourceTables, targetTables);
      if (dryRun) {
        await client.query("ROLLBACK");
      } else {
        await client.query("COMMIT");
        committed = true;
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  let sourceArchived = false;
  if (committed) {
    sealSqliteArchive(sqliteFilePath);
    if (input.archivePath) {
      copyFileSync(sqliteFilePath, requireNonEmpty(input.archivePath, "archivePath"));
    }
    sourceArchived = true;
  }

  return {
    dryRun,
    committed,
    sourceArchived,
    tables: MIGRATED_TABLES.map((table) => ({
      table,
      rowCount: sourceTables[table].length,
      digest: digestRows(sourceTables[table]),
    })),
  };
}

type TableRows = Record<MigratedTable, Readonly<Record<string, unknown>>[]>;

function readSource(db: InstanceType<typeof Database>): TableRows {
  const result = {} as TableRows;
  for (const table of MIGRATED_TABLES) {
    const columns = TABLE_COLUMNS[table].join(", ");
    result[table] = db
      .prepare(`SELECT ${columns} FROM ${table}`)
      .all() as Record<string, unknown>[];
  }
  return result;
}

async function assertTargetEmpty(client: PoolClient): Promise<void> {
  for (const table of MIGRATED_TABLES) {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    if (Number(rows[0]?.count ?? "0") !== 0) {
      throw migrationValidationFailed(
        `Target table ${table} is not empty; refusing to dual-write.`,
      );
    }
  }
}

async function importRows(
  client: PoolClient,
  tables: TableRows,
): Promise<void> {
  for (const table of MIGRATED_TABLES) {
    const columns = TABLE_COLUMNS[table];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const statement = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
    for (const row of tables[table]) {
      await client.query(
        statement,
        columns.map((column) => row[column] ?? null),
      );
    }
  }
}

async function readTarget(client: PoolClient): Promise<TableRows> {
  const result = {} as TableRows;
  for (const table of MIGRATED_TABLES) {
    const columns = TABLE_COLUMNS[table].join(", ");
    const { rows } = await client.query(`SELECT ${columns} FROM ${table}`);
    result[table] = rows as Record<string, unknown>[];
  }
  return result;
}

function validateParity(source: TableRows, target: TableRows): void {
  for (const table of MIGRATED_TABLES) {
    const sourceRows = source[table];
    const targetRows = target[table];
    if (sourceRows.length !== targetRows.length) {
      throw migrationValidationFailed(
        `Row count mismatch for ${table}: source ${sourceRows.length}, target ${targetRows.length}.`,
      );
    }
    const sourceDigest = digestRows(sourceRows);
    const targetDigest = digestRows(targetRows);
    if (sourceDigest !== targetDigest) {
      throw migrationValidationFailed(
        `Content digest mismatch for ${table}.`,
      );
    }
  }
}
