import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Create a throwaway directory for SQLite test files. */
export function makeTempStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "hstracker-ops-"));
}

export function removeTempStoreDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
