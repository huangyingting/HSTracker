import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { Pool } from "pg";

/**
 * The PostgreSQL connection string for adapter tests, or null when none is
 * configured. CI has no PostgreSQL service, so PostgreSQL-specific suites skip
 * unless `HSTRACKER_TEST_PG_URL` (or `DATABASE_URL`) points at a test database.
 */
export function postgresTestUrl(): string | null {
  return (
    process.env.HSTRACKER_TEST_PG_URL ??
    process.env.DATABASE_URL ??
    null
  );
}

export interface ScopedPostgresSchema {
  readonly schema: string;
  readonly connectionString: string;
  reset(): Promise<void>;
  drop(): Promise<void>;
}

/**
 * Create a per-test-file PostgreSQL schema scope. The returned connection
 * string sets `search_path` through the startup `options` parameter, so the
 * production adapter creates and queries its operational tables inside this
 * isolated schema instead of sharing `public` across parallel Vitest files.
 */
export function createScopedPostgresSchema(
  connectionString: string,
  label: string,
): ScopedPostgresSchema {
  const schema = `ops_${sanitizeSchemaLabel(label)}_${randomBytes(8).toString("hex")}`;
  const scoped = new URL(connectionString);
  const existingOptions = scoped.searchParams.get("options");
  const searchPathOption = `-c search_path=${schema}`;
  scoped.searchParams.set(
    "options",
    existingOptions === null
      ? searchPathOption
      : `${existingOptions} ${searchPathOption}`,
  );

  return {
    schema,
    connectionString: scoped.toString(),
    async reset() {
      await resetPostgresSchema(connectionString, schema);
    },
    async drop() {
      await dropPostgresSchema(connectionString, schema);
    },
  };
}

/** Drop every operational table so a suite starts from an empty schema. */
export async function resetPostgres(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'operational_%'",
    );
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS ${row.tablename} CASCADE`);
    }
  } finally {
    await pool.end();
  }
}

async function resetPostgresSchema(
  connectionString: string,
  schema: string,
): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await pool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
  } finally {
    await pool.end();
  }
}

async function dropPostgresSchema(
  connectionString: string,
  schema: string,
): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
  } finally {
    await pool.end();
  }
}

/** Create a throwaway directory for SQLite test files. */
export function makeTempStoreDir(): string {
  const root = join(process.cwd(), "data", "work", "test-stores");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "hstracker-ops-"));
}

export function removeTempStoreDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function sanitizeSchemaLabel(label: string): string {
  return label
    .toLocaleLowerCase("und")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 24) || "test";
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
