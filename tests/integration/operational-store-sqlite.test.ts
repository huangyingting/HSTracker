import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { isOperationalStoreError } from "../../src/operations/store/errors";
import { OPERATIONAL_TABLES } from "../../src/operations/store/internal";
import {
  restoreSqliteBackup,
  SqliteOperationalStore,
} from "../../src/operations/store/sqlite-operational-store";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();
const open: SqliteOperationalStore[] = [];

function newStore(
  overrides: Partial<{ filePath: string; holder: string }> = {},
): SqliteOperationalStore {
  const store = new SqliteOperationalStore({
    filePath: overrides.filePath ?? join(tempDir, `${randomUUID()}.db`),
    holder: overrides.holder,
  });
  open.push(store);
  return store;
}

afterEach(async () => {
  while (open.length > 0) {
    await open.pop()!.close();
  }
});

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("SqliteOperationalStore operational guarantees", () => {
  it("rejects a non-local target such as :memory: or a URI", () => {
    expect(() => new SqliteOperationalStore({ filePath: ":memory:" })).toSatisfy(
      throwsStoreCode("NON_LOCAL_SQLITE_VOLUME"),
    );
    expect(
      () =>
        new SqliteOperationalStore({
          filePath: "postgres://host/db",
        }),
    ).toSatisfy(throwsStoreCode("NON_LOCAL_SQLITE_VOLUME"));
  });

  it("runs in WAL journal mode", () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    newStore({ filePath });
    const probe = new Database(filePath, { readonly: true });
    const mode = probe.pragma("journal_mode", { simple: true });
    probe.close();
    expect(mode).toBe("wal");
  });

  it("refuses a second live application lease on the same file", () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    newStore({ filePath, holder: "instance-a" });
    expect(
      () => new SqliteOperationalStore({ filePath, holder: "instance-b" }),
    ).toSatisfy(throwsStoreCode("APPLICATION_LEASE_UNAVAILABLE"));
  });

  it("frees the lease on close so a later instance can open", async () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    const first = new SqliteOperationalStore({ filePath, holder: "a" });
    await first.close();
    const second = new SqliteOperationalStore({ filePath, holder: "b" });
    open.push(second);
    expect(await second.findAccount(randomUUID())).toBeNull();
  });

  it("is a single evaluator: one instance claims all eligible work", async () => {
    const store = newStore();
    const account = await store.createAccount({
      displayName: "A",
      primaryExportEconomy: "076",
    });
    await store.openWatch(account.id, {
      product: { hsRevision: "HS12", code: "010101" },
      marketEconomy: "156",
    });
    const claimed = await store.claimWatchesForEvaluation({
      evaluatorId: "only",
      packageId: "P1",
      limit: 10,
      leaseSeconds: 300,
    });
    expect(claimed).toHaveLength(1);
  });

  it("produces a consistent backup that restores every record", async () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    const store = newStore({ filePath });
    const account = await store.createAccount({
      displayName: "Backup Co",
      primaryExportEconomy: "076",
    });
    await store.openWatch(account.id, {
      product: { hsRevision: "HS12", code: "010101" },
      marketEconomy: "156",
    });
    const backupPath = join(tempDir, `${randomUUID()}.backup.db`);
    await store.backup(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(statSync(backupPath).size).toBeGreaterThan(0);
    await store.close();

    const restorePath = join(tempDir, `${randomUUID()}.restored.db`);
    restoreSqliteBackup(backupPath, restorePath);
    const restored = new SqliteOperationalStore({ filePath: restorePath });
    open.push(restored);
    const found = await restored.findAccount(account.id);
    expect(found?.displayName).toBe("Backup Co");
    expect(await restored.listWatches(account.id)).toHaveLength(1);
  });

  it("holds only operational tables — no analytical facts", () => {
    const filePath = join(tempDir, `${randomUUID()}.db`);
    newStore({ filePath });
    const probe = new Database(filePath, { readonly: true });
    const tables = (
      probe
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    probe.close();
    expect(new Set(tables)).toEqual(new Set(OPERATIONAL_TABLES));
    for (const forbidden of [
      "baci",
      "opportunity_index",
      "momentum",
      "product_mapping",
      "analysis_result",
    ]) {
      expect(tables.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});

function throwsStoreCode(code: string) {
  return (thunk: unknown): boolean => {
    try {
      (thunk as () => unknown)();
      return false;
    } catch (error) {
      return isOperationalStoreError(error) && error.code === code;
    }
  };
}
