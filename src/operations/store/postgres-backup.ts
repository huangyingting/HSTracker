import { spawn } from "node:child_process";

/**
 * Backup and restore for the locally-managed PostgreSQL operational store
 * (ADR-0004). The SQLite driver ships an in-process `backup`/`restoreSqliteBackup`
 * pair; PostgreSQL is backed up with the standard `pg_dump`/`pg_restore` tools
 * the local runbook prescribes (docs/local-deployment.md). Both drivers share
 * the same clean-restore guarantee: ephemeral runtime state (application and
 * evaluation leases, sessions, and recovery tokens) is excluded from the copy so
 * a restore yields an unleased store ready for a single instance to resume.
 */

const EPHEMERAL_TABLES = [
  "operational_application_lease",
  "operational_evaluation_lease",
  "operational_session",
  "operational_recovery_token",
] as const;

const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export class PostgresBackupError extends Error {
  readonly code = "POSTGRES_BACKUP_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "PostgresBackupError";
  }
}

export interface PostgresSchemaBackupOptions {
  /** libpq connection string or URI for the locally-managed database. */
  readonly connectionString: string;
  /** The operational schema to capture. */
  readonly schema: string;
  /** Filesystem path for the resulting custom-format archive. */
  readonly destinationPath: string;
}

export interface PostgresSchemaRestoreOptions {
  /** libpq connection string or URI for the locally-managed database. */
  readonly connectionString: string;
  /** The operational schema the archive restores into. */
  readonly schema: string;
  /** Filesystem path of a custom-format archive produced by `backupPostgresSchema`. */
  readonly backupPath: string;
}

/**
 * Produce a consistent point-in-time backup of the operational schema at
 * `destinationPath`, safe to run while the store is open. Ephemeral runtime
 * state is excluded so the restore is clean and unleased.
 */
export async function backupPostgresSchema(
  options: PostgresSchemaBackupOptions,
): Promise<void> {
  const connectionString = requireNonEmpty(
    options.connectionString,
    "connectionString",
  );
  const schema = requireSchema(options.schema);
  const destinationPath = requireNonEmpty(
    options.destinationPath,
    "destinationPath",
  );

  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--schema=${schema}`,
    ...EPHEMERAL_TABLES.map(
      (table) => `--exclude-table-data=${schema}.${table}`,
    ),
    `--file=${destinationPath}`,
    connectionString,
  ]);
}

/**
 * Restore an operational-schema archive produced by `backupPostgresSchema`. The
 * target schema is dropped first so the restore is a clean recovery rather than
 * a merge, matching the SQLite restore that overwrites its target file.
 */
export async function restorePostgresSchema(
  options: PostgresSchemaRestoreOptions,
): Promise<void> {
  const connectionString = requireNonEmpty(
    options.connectionString,
    "connectionString",
  );
  const schema = requireSchema(options.schema);
  const backupPath = requireNonEmpty(options.backupPath, "backupPath");

  await run("psql", [
    connectionString,
    "--set=ON_ERROR_STOP=1",
    "--quiet",
    "--no-psqlrc",
    "--command",
    `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
  ]);
  await run("pg_restore", [
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--dbname",
    connectionString,
    backupPath,
  ]);
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args as string[], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(
        new PostgresBackupError(
          `Failed to spawn ${command}: ${error.message}. Install the PostgreSQL client tools.`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new PostgresBackupError(
          `${command} exited with code ${String(code)}: ${stderr.trim()}`,
        ),
      );
    });
  });
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PostgresBackupError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireSchema(value: string): string {
  const schema = requireNonEmpty(value, "schema");
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new PostgresBackupError(
      `schema must be a valid PostgreSQL identifier, received ${JSON.stringify(schema)}.`,
    );
  }
  return schema;
}
