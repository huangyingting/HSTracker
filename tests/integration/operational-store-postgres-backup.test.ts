import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  backupPostgresSchema,
  restorePostgresSchema,
} from "../../src/operations/store/postgres-backup";
import { PostgresOperationalStore } from "../../src/operations/store/postgres-operational-store";
import {
  createScopedPostgresSchema,
  makeTempStoreDir,
  postgresTestUrl,
  removeTempStoreDir,
} from "../support/operational-store-env";

const pgUrl = postgresTestUrl();
const pgSchema =
  pgUrl === null ? null : createScopedPostgresSchema(pgUrl, "pgbackup");
const tempDir = makeTempStoreDir();

afterAll(async () => {
  await pgSchema?.drop();
  removeTempStoreDir(tempDir);
});

describe.skipIf(pgUrl === null)(
  "PostgresOperationalStore backup and restore",
  () => {
    const base = pgUrl ?? "";
    const schema = pgSchema?.schema ?? "";
    const scoped = pgSchema?.connectionString ?? "";

    beforeEach(async () => {
      await pgSchema!.reset();
    });

    it("produces a consistent backup that restores every record while stripping ephemeral leases", async () => {
      const store = await PostgresOperationalStore.create({
        connectionString: scoped,
      });
      const account = await store.createAccount({
        displayName: "Backup Co",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: { hsRevision: "HS12", code: "010101" },
        marketEconomy: "156",
      });
      // Ephemeral evaluation-lease state that a clean restore must drop.
      const claims = await store.claimWatchesForEvaluation({
        evaluatorId: "evaluator-a",
        packageId: "pkg-1",
        limit: 10,
        leaseSeconds: 3600,
      });
      expect(claims).toHaveLength(1);
      await store.close();

      const backupPath = join(tempDir, `${randomUUID()}.pg.dump`);
      await backupPostgresSchema({
        connectionString: base,
        schema,
        destinationPath: backupPath,
      });
      expect(existsSync(backupPath)).toBe(true);
      expect(statSync(backupPath).size).toBeGreaterThan(0);

      // Simulate operational-store loss.
      await pgSchema!.reset();
      const wiped = await PostgresOperationalStore.create({
        connectionString: scoped,
      });
      expect(await wiped.findAccount(account.id)).toBeNull();
      await wiped.close();

      await restorePostgresSchema({
        connectionString: base,
        schema,
        backupPath,
      });

      const restored = await PostgresOperationalStore.create({
        connectionString: scoped,
      });
      const found = await restored.findAccount(account.id);
      expect(found?.displayName).toBe("Backup Co");
      expect(await restored.listWatches(account.id)).toHaveLength(1);
      // Clean restore: the pre-backup evaluation lease is not carried over, so
      // the restored watch is immediately claimable again.
      const reclaim = await restored.claimWatchesForEvaluation({
        evaluatorId: "evaluator-b",
        packageId: "pkg-1",
        limit: 10,
        leaseSeconds: 3600,
      });
      expect(reclaim.map((claim) => claim.watch.id)).toEqual([watch.id]);
      await restored.close();
    });
  },
);
