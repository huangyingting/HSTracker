import { beforeEach, describe, expect, it } from "vitest";

import { PostgresOperationalStore } from "../../src/operations/store/postgres-operational-store";
import {
  postgresTestUrl,
  resetPostgres,
} from "../support/operational-store-env";

const pgUrl = postgresTestUrl();

describe.skipIf(pgUrl === null)("PostgresOperationalStore concurrency", () => {
  const url = pgUrl!;

  beforeEach(async () => {
    await resetPostgres(url);
  });

  async function seedWatches(count: number): Promise<{
    store: PostgresOperationalStore;
    accountId: string;
  }> {
    const store = await PostgresOperationalStore.create({
      connectionString: url,
    });
    const account = await store.createAccount({
      displayName: "Fleet",
      primaryExportEconomy: "076",
    });
    for (let index = 0; index < count; index += 1) {
      await store.openWatch(account.id, {
        product: { hsRevision: "HS12", code: `01${String(index).padStart(4, "0")}` },
        marketEconomy: "156",
      });
    }
    return { store, accountId: account.id };
  }

  it("claims every watch exactly once across concurrent evaluators", async () => {
    const watchCount = 30;
    const { store, accountId } = await seedWatches(watchCount);

    const evaluators = await Promise.all(
      Array.from({ length: 5 }, () =>
        PostgresOperationalStore.create({ connectionString: url }),
      ),
    );
    try {
      const batches = await Promise.all(
        evaluators.map((evaluator, index) =>
          evaluator.claimWatchesForEvaluation({
            evaluatorId: `e${index}`,
            packageId: "P1",
            limit: 10,
            leaseSeconds: 300,
          }),
        ),
      );

      const claimedIds = batches.flatMap((batch) =>
        batch.map((claim) => claim.watch.id),
      );
      // No watch is claimed by two evaluators, and all are claimed.
      expect(new Set(claimedIds).size).toBe(claimedIds.length);
      expect(claimedIds.length).toBe(watchCount);

      // Each evaluator records one event per claimed watch; a Watch evaluated
      // once produces exactly one event.
      await Promise.all(
        batches.map((batch, index) =>
          Promise.all(
            batch.map((claim) =>
              evaluators[index]!.recordAlertEvent({
                watchId: claim.watch.id,
                kind: "MOMENTUM_SIGNAL",
                dedupeKey: "P1",
                detail: { evaluator: index },
                occurredAt: "2026-01-01T00:00:00.000Z",
              }),
            ),
          ),
        ),
      );
      const events = await store.listAlertEvents(accountId);
      expect(events).toHaveLength(watchCount);
    } finally {
      await Promise.all(evaluators.map((evaluator) => evaluator.close()));
      await store.close();
    }
  });

  it("records a duplicate (watch, dedupeKey) exactly once under concurrency", async () => {
    const { store, accountId } = await seedWatches(1);
    const [watch] = await store.listWatches(accountId);

    const writers = await Promise.all(
      Array.from({ length: 8 }, () =>
        PostgresOperationalStore.create({ connectionString: url }),
      ),
    );
    try {
      const results = await Promise.all(
        writers.map((writer) =>
          writer.recordAlertEvent({
            watchId: watch!.id,
            kind: "MOMENTUM_SIGNAL",
            dedupeKey: "same-signal",
            detail: {},
            occurredAt: "2026-01-01T00:00:00.000Z",
          }),
        ),
      );
      const createdCount = results.filter((result) => result.created).length;
      expect(createdCount).toBe(1);
      expect(await store.listAlertEvents(accountId)).toHaveLength(1);
    } finally {
      await Promise.all(writers.map((writer) => writer.close()));
      await store.close();
    }
  });
});
