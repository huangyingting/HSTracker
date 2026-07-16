import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isOperationalStoreError } from "../../src/operations/store/errors";
import type { OperationalStore } from "../../src/operations/store/operational-store";

const HS12 = "HS12";
const prod = (code: string) => ({ hsRevision: HS12, code });

/**
 * The single behavioral contract every operational-store adapter must satisfy.
 * Both PostgreSQL and SQLite run this identical suite; nothing here branches on
 * the underlying database.
 */
export function runOperationalStoreContract(
  label: string,
  makeStore: () => Promise<OperationalStore>,
): void {
  describe(`OperationalStore contract: ${label}`, () => {
    let store: OperationalStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it("creates and reads an account with one primary export economy", async () => {
      const account = await store.createAccount({
        displayName: "Acme Exports",
        primaryExportEconomy: "076",
      });
      expect(account.id).toMatch(/[0-9a-f-]{36}/u);
      expect(account.primaryExportEconomy).toBe("076");
      const found = await store.findAccount(account.id);
      expect(found).toEqual(account);
      expect(await store.findAccount("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("replaces the whole portfolio atomically and dedupes references", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const first = await store.confirmPortfolio(account.id, [
        prod("010101"),
        prod("020202"),
        prod("010101"),
      ]);
      expect(first.map((entry) => entry.product.code)).toEqual([
        "010101",
        "020202",
      ]);
      const replaced = await store.confirmPortfolio(account.id, [prod("030303")]);
      expect(replaced.map((entry) => entry.product.code)).toEqual(["030303"]);
      expect(await store.listConfirmedProducts(account.id)).toEqual(replaced);
    });

    it("rejects portfolio confirmation for an unknown account", async () => {
      await expect(
        store.confirmPortfolio("00000000-0000-0000-0000-000000000000", [
          prod("010101"),
        ]),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) && error.code === "UNKNOWN_ENTITY",
      );
    });

    it("opens a watch idempotently for the same product and market", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const again = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      expect(again.id).toBe(watch.id);
      expect(await store.listWatches(account.id)).toHaveLength(1);
    });

    it("claims active watches without double-claiming across packages and completion", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const w1 = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      await store.openWatch(account.id, {
        product: prod("020202"),
        marketEconomy: "156",
      });
      await store.openWatch(account.id, {
        product: prod("030303"),
        marketEconomy: "156",
      });

      const firstBatch = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 2,
        leaseSeconds: 300,
      });
      expect(firstBatch).toHaveLength(2);

      const secondBatch = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(secondBatch).toHaveLength(1);

      const w1Lease = [...firstBatch, ...secondBatch].find(
        (claim) => claim.watch.id === w1.id,
      )!;
      await store.completeEvaluation(w1Lease.leaseId, "P1");

      const noneLeft = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(noneLeft).toHaveLength(0);

      const nextPackage = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P2",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(nextPackage).toHaveLength(3);
    });

    it("appends alert events idempotently on (watch, dedupeKey)", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const first = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: { direction: "up" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      expect(first.created).toBe(true);

      const duplicate = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: { direction: "DIFFERENT" },
        occurredAt: "2026-02-02T00:00:00.000Z",
      });
      expect(duplicate.created).toBe(false);
      expect(duplicate.event.id).toBe(first.event.id);
      expect(duplicate.event.detail).toEqual({ direction: "up" });

      const events = await store.listAlertEvents(account.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toEqual({ direction: "up" });
    });

    it("rejects an alert event for an unknown watch", async () => {
      await expect(
        store.recordAlertEvent({
          watchId: "00000000-0000-0000-0000-000000000000",
          kind: "MOMENTUM_SIGNAL",
          dedupeKey: "x",
          detail: {},
          occurredAt: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) && error.code === "UNKNOWN_ENTITY",
      );
    });

    it("tracks per-channel delivery state and counts attempts", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const { event } = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: {},
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      expect(await store.getDeliveryState(event.id, "email")).toBeNull();

      const first = await store.markDelivered(event.id, "email");
      expect(first).toMatchObject({ status: "SENT", attempts: 1 });
      const second = await store.markDelivered(event.id, "email");
      expect(second.attempts).toBe(2);
    });
  });
}
