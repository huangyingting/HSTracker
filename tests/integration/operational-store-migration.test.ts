import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isOperationalStoreError } from "../../src/operations/store/errors";
import { migrateSqliteToPostgres } from "../../src/operations/store/migration";
import { PostgresOperationalStore } from "../../src/operations/store/postgres-operational-store";
import { SqliteOperationalStore } from "../../src/operations/store/sqlite-operational-store";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import {
  createScopedPostgresSchema,
  makeTempStoreDir,
  postgresTestUrl,
  removeTempStoreDir,
} from "../support/operational-store-env";

const pgUrl = postgresTestUrl();
const pgSchema =
  pgUrl === null ? null : createScopedPostgresSchema(pgUrl, "migration");
const tempDir = makeTempStoreDir();

afterAll(async () => {
  await pgSchema?.drop();
  removeTempStoreDir(tempDir);
});

async function seedSqlite(filePath: string): Promise<{
  accountId: string;
  eventId: string;
}> {
  const store = new SqliteOperationalStore({ filePath });
  const account = await store.createAccount({
    displayName: "Migrating Co",
    primaryExportEconomy: "076",
  });
  await store.confirmPortfolio(account.id, [
    { hsRevision: "HS12", code: "010101" },
    { hsRevision: "HS12", code: "020202" },
  ]);
  const watch = await store.openWatch(account.id, {
    product: { hsRevision: "HS12", code: "010101" },
    marketEconomy: "156",
  });
  const { event } = await store.recordAlertEvent({
    watchId: watch.id,
    kind: "MOMENTUM_SIGNAL",
    dedupeKey: "P1:up",
    detail: { direction: "up" },
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  await store.markDelivered(event.id, "email");
  await store.createCredential({
    accountId: account.id,
    identity: "migrating@example.com",
    verifier: "scrypt$16384$8$1$salt$hash",
  });
  await store.requestDeliveryConsent({
    accountId: account.id,
    channel: "email",
    target: "migrating@example.com",
    verificationToken: "verify-migration",
    unsubscribeToken: "unsubscribe-migration",
  });
  await store.verifyDeliveryConsent({
    accountId: account.id,
    channel: "email",
    target: "migrating@example.com",
    verificationToken: "verify-migration",
  });
  await store.recordDeliverySuppression({
    accountId: account.id,
    channel: "email",
    target: "bounce@example.com",
    reason: "BOUNCE",
    providerReceipt: "migration-bounce",
  });
  await store.appendAuditEvent({
    accountId: account.id,
    kind: "ACCOUNT_CREATED",
    detail: { source: "sqlite" },
  });
  await store.createSession({
    accountId: account.id,
    tokenDigest:
      "9999999999999999999999999999999999999999999999999999999999999999",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  await store.issueRecoveryToken({
    accountId: account.id,
    tokenDigest:
      "8888888888888888888888888888888888888888888888888888888888888888",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  // Model an offline, quiesced source: reject further writes, then release the
  // file so the one-way migration can read it.
  store.enterMaintenance();
  await expect(
    store.createAccount({ displayName: "late", primaryExportEconomy: "999" }),
  ).rejects.toSatisfy(
    (error) =>
      isOperationalStoreError(error) && error.code === "STORE_IN_MAINTENANCE",
  );
  await store.close();
  return { accountId: account.id, eventId: event.id };
}

describe.skipIf(pgUrl === null)("SQLite to PostgreSQL migration", () => {
  const url = pgSchema?.connectionString ?? "";

  beforeEach(async () => {
    await pgSchema!.reset();
  });

  it("dry-runs without writing to the target", async () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    await seedSqlite(filePath);

    const report = await migrateSqliteToPostgres({
      sqliteFilePath: filePath,
      postgresConnectionString: url,
      dryRun: true,
    });
    expect(report.committed).toBe(false);
    expect(report.sourceArchived).toBe(false);
    const accounts = report.tables.find(
      (table) => table.table === "operational_account",
    )!;
    expect(accounts.rowCount).toBe(1);

    // Nothing was persisted, so a real store finds no accounts.
    const target = await PostgresOperationalStore.create({
      connectionString: url,
    });
    try {
      expect(await target.listWatches(randomUUID())).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it("migrates every record and relationship exactly once, then seals the source", async () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    const { accountId, eventId } = await seedSqlite(filePath);

    const report = await migrateSqliteToPostgres({
      sqliteFilePath: filePath,
      postgresConnectionString: url,
    });
    expect(report.committed).toBe(true);
    expect(report.sourceArchived).toBe(true);

    const target: OperationalStore = await PostgresOperationalStore.create({
      connectionString: url,
    });
    try {
      const account = await target.findAccount(accountId);
      expect(account?.displayName).toBe("Migrating Co");
      expect(
        (await target.listConfirmedProducts(accountId)).map((p) => p.product.code),
      ).toEqual(["010101", "020202"]);
      const watches = await target.listWatches(accountId);
      expect(watches).toHaveLength(1);
      const events = await target.listAlertEvents(accountId);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toEqual({ direction: "up" });
      const delivery = await target.getDeliveryState(eventId, "email");
      expect(delivery).toMatchObject({ status: "SENT", attempts: 1 });
      expect(
        await target.findCredentialByIdentity("MIGRATING@example.com"),
      ).toMatchObject({
        accountId,
        normalizedIdentity: "migrating@example.com",
      });
      expect(
        await target.findDeliveryConsent(accountId, "email", "migrating@example.com"),
      ).toMatchObject({
        accountId,
        target: "migrating@example.com",
        verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
        unsubscribedAt: null,
      });
      expect(
        await target.getDeliverySuppression(accountId, "email", "bounce@example.com"),
      ).toMatchObject({
        accountId,
        reason: "BOUNCE",
        providerReceipt: "migration-bounce",
      });
      expect(await target.listAuditEvents(accountId)).toEqual([
        expect.objectContaining({
          accountId,
          kind: "ACCOUNT_CREATED",
          detail: { source: "sqlite" },
        }),
      ]);
      expect(
        await target.findSession(
          "9999999999999999999999999999999999999999999999999999999999999999",
        ),
      ).toBeNull();
      expect(
        await target.consumeRecoveryToken(
          "8888888888888888888888888888888888888888888888888888888888888888",
        ),
      ).toBeNull();
    } finally {
      await target.close();
    }

    // Source is sealed read-only as an archive.
    expect(existsSync(filePath)).toBe(true);
    expect(statSync(filePath).mode & 0o222).toBe(0);
  });

  it("refuses to dual-write into a non-empty target", async () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    await seedSqlite(filePath);
    await migrateSqliteToPostgres({
      sqliteFilePath: filePath,
      postgresConnectionString: url,
    });

    const second = join(tempDir, `${randomUUID()}.db`);
    await seedSqlite(second);
    await expect(
      migrateSqliteToPostgres({
        sqliteFilePath: second,
        postgresConnectionString: url,
      }),
    ).rejects.toSatisfy(
      (error) =>
        isOperationalStoreError(error) &&
        error.code === "MIGRATION_VALIDATION_FAILED",
    );
  });
});
