import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { FixtureAlertDeliveryProvider } from "../../src/operations/delivery/fixture-alert-delivery-provider";
import {
  deliverAlertEvents,
  deliverOpportunityWatchAlerts,
} from "../../src/operations/delivery/alert-delivery-worker";
import { createOperationalStore } from "../../src/operations/store/composition";
import type { AlertEvent } from "../../src/operations/store/model";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("Opportunity Watch alert delivery worker", () => {
  let store: OperationalStore;

  beforeEach(async () => {
    store = await createOperationalStore({
      driver: "sqlite",
      filePath: join(tempDir, `${randomUUID()}.db`),
      clock: () => new Date("2026-07-17T12:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("AC1 accepts a replay only once with provider idempotency while auditing both attempts", async () => {
    const { accountId, event } = await seedDeliverableEvent(store);
    const provider = new FixtureAlertDeliveryProvider({
      supportsIdempotency: true,
    });
    provider.enqueue("ACCEPTED", "receipt-first");
    provider.enqueue("ACCEPTED", "receipt-replay");

    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });
    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.filter((call) => call.accepted)).toHaveLength(1);
    expect(provider.calls.map((call) => call.idempotencyKey)).toEqual([
      `${event.id}:email`,
      `${event.id}:email`,
    ]);
    expect(await store.getDeliveryState(event.id, "email")).toMatchObject({
      status: "SENT",
      attempts: 2,
      providerReceipt: "receipt-first",
      lastOutcome: "ACCEPTED",
    });
  });

  it("AC1 uses delivery-state idempotency when a provider cannot suppress duplicates", async () => {
    const { accountId, event } = await seedDeliverableEvent(store);
    const provider = new FixtureAlertDeliveryProvider({
      supportsIdempotency: false,
    });
    provider.enqueue("ACCEPTED", "receipt-first");
    provider.enqueue("ACCEPTED", "receipt-would-duplicate");

    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });
    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls.filter((call) => call.accepted)).toHaveLength(1);
    expect(await store.getDeliveryState(event.id, "email")).toMatchObject({
      status: "SENT",
      attempts: 2,
      providerReceipt: "receipt-first",
      lastOutcome: "DUPLICATE_SUPPRESSED",
    });
  });

  it("AC2 unsubscribe stops new delivery", async () => {
    const { accountId, consent } = await seedDeliverableEvent(store);
    await store.unsubscribeDeliveryTarget(consent.unsubscribeToken);
    const provider = acceptedProvider();

    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls).toHaveLength(0);
    expect(summary.suppressedByCause.unsubscribe).toBe(1);
  });

  it("AC2 account deletion stops new delivery", async () => {
    const { accountId, event } = await seedDeliverableEvent(store);
    await store.deleteAccount(accountId);
    const provider = acceptedProvider();

    const summary = await deliverAlertEvents({
      store,
      events: [event],
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls).toHaveLength(0);
    expect(summary.suppressedByCause.accountDeleted).toBe(1);
  });

  it("AC2 bounce suppression stops the next alert for that address", async () => {
    const { accountId } = await seedDeliverableEvent(store, "bounce-1");
    const provider = new FixtureAlertDeliveryProvider({
      supportsIdempotency: false,
    });
    provider.enqueue("BOUNCE", "bounce-receipt");
    provider.enqueue("ACCEPTED", "receipt-after-bounce");

    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });
    await appendEventForAccount(store, accountId, "bounce-2");
    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls.filter((call) => call.accepted)).toHaveLength(0);
    expect(provider.calls).toHaveLength(1);
    expect(summary.suppressedByCause.bounce).toBeGreaterThanOrEqual(1);
  });

  it("AC2 complaint suppression stops the next alert for that address", async () => {
    const { accountId } = await seedDeliverableEvent(store, "complaint-1");
    const provider = new FixtureAlertDeliveryProvider({
      supportsIdempotency: false,
    });
    provider.enqueue("COMPLAINT", "complaint-receipt");
    provider.enqueue("ACCEPTED", "receipt-after-complaint");

    await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });
    await appendEventForAccount(store, accountId, "complaint-2");
    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls.filter((call) => call.accepted)).toHaveLength(0);
    expect(provider.calls).toHaveLength(1);
    expect(summary.suppressedByCause.complaint).toBeGreaterThanOrEqual(1);
  });

  it("AC2 paused watch stops new delivery", async () => {
    const { accountId, watchId } = await seedDeliverableEvent(store);
    await store.pauseWatch(watchId);
    const provider = acceptedProvider();

    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
    });

    expect(provider.calls).toHaveLength(0);
    expect(summary.suppressedByCause.pausedWatch).toBe(1);
  });

  it("AC2 source delayed by seven days stops new delivery", async () => {
    const { accountId } = await seedDeliverableEvent(store);
    const provider = acceptedProvider();

    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: {
        ...activePolicy(),
        sourceRefreshDelayedSince: "2026-07-10T12:00:00.000Z",
        asOf: "2026-07-17T12:00:00.000Z",
      },
    });

    expect(provider.calls).toHaveLength(0);
    expect(summary.suppressedByCause.sourceDelayed).toBe(1);
  });

  it("AC2 disabled monthly capability stops new delivery", async () => {
    const { accountId } = await seedDeliverableEvent(store);
    const provider = acceptedProvider();

    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: { ...activePolicy(), monthlyCapabilityEnabled: false },
    });

    expect(provider.calls).toHaveLength(0);
    expect(summary.suppressedByCause.monthlyCapabilityDisabled).toBe(1);
  });

  it("retries transient failures and dead-letters a permanent failure deterministically", async () => {
    const { accountId, event } = await seedDeliverableEvent(store);
    const provider = new FixtureAlertDeliveryProvider({
      supportsIdempotency: false,
    });
    provider.enqueue("TRANSIENT_FAILURE", "transient-1");
    provider.enqueue("PERMANENT_FAILURE", "permanent-2");

    const summary = await deliverOpportunityWatchAlerts({
      store,
      accountId,
      provider,
      policy: activePolicy(),
      maxAttempts: 3,
    });

    expect(provider.calls).toHaveLength(2);
    expect(summary.deadLettered).toBe(1);
    expect(await store.getDeliveryState(event.id, "email")).toMatchObject({
      status: "DEAD_LETTER",
      attempts: 2,
      providerReceipt: "permanent-2",
      lastOutcome: "PERMANENT_FAILURE",
    });
  });
});

async function seedDeliverableEvent(
  store: OperationalStore,
  dedupeKey = "signal-1",
): Promise<{
  accountId: string;
  watchId: string;
  event: AlertEvent;
  consent: Awaited<ReturnType<OperationalStore["requestDeliveryConsent"]>>;
}> {
  const account = await store.createAccount({
    displayName: "Alert Co",
    primaryExportEconomy: "076",
  });
  const watch = await store.openWatch(account.id, {
    product: { hsRevision: "HS12", code: "010121" },
    marketEconomy: "DE",
    reportingEconomyIso2: "DE",
    hs12Code: "010121",
    cadence: "MONTHLY",
    deliveryPreferences: [
      { channel: "email", target: "Analyst@Example.COM", enabled: true },
    ],
  });
  const consent = await store.requestDeliveryConsent({
    accountId: account.id,
    channel: "email",
    target: "analyst@example.com",
    verificationToken: `verify-${dedupeKey}`,
    unsubscribeToken: `unsubscribe-${dedupeKey}`,
  });
  await store.verifyDeliveryConsent({
    accountId: account.id,
    channel: "email",
    target: "analyst@example.com",
    verificationToken: `verify-${dedupeKey}`,
  });
  const event = await appendEventForAccount(store, account.id, dedupeKey);
  return { accountId: account.id, watchId: watch.id, event, consent };
}

async function appendEventForAccount(
  store: OperationalStore,
  accountId: string,
  dedupeKey: string,
): Promise<AlertEvent> {
  const [watch] = await store.listWatches(accountId);
  const { event } = await store.recordAlertEvent({
    watchId: watch!.id,
    kind: "MOMENTUM_SIGNAL",
    dedupeKey,
    recipeId: "recent-trade-momentum-v1",
    packageId: `eurostat-monthly-package-${dedupeKey}`,
    cutoffMonth: "2026-05",
    detail: {
      messageSchemaVersion: "opportunity-watch-alert-message-v1",
      coverageState: "SUPPORTED",
      signalState: "RISING",
      growthPercentDisplay: "+14.2%",
      reportingEconomyName: { en: "Germany", "zh-Hans": "德国" },
      reportingEconomyIso2: "DE",
      hsRevisionLabel: "HS 2012",
      hs12Code: "010121",
      recentMonths: ["2026-03", "2026-04", "2026-05"],
      baselineMonths: ["2025-03", "2025-04", "2025-05"],
      valueCurrency: "EUR",
      updateState: "preliminary",
      recordedHistoryMonths: 24,
      expectedHistoryMonths: 24,
      source: "Eurostat Comext",
      sourceExtraction: "2026-06-15T00:00:00.000Z",
      newestEligibleMonth: "2026-05",
      cnEditions: "CN 2025 and CN 2026",
      mappingStatus: "exact HS 2012 mapping",
      borderValuation: "CIF imports, current EUR",
      revisionState: "initial package",
      coverage: "24/24 months recorded",
      excludedTreatment:
        "Confidential and special-treatment partner rows are excluded from this product signal.",
      packageIdentity: `eurostat-monthly-package-${dedupeKey}`,
      recipeIdentity: "recent-trade-momentum-v1",
      attribution: "Eurostat Comext",
      candidateContextUrl: "https://example.test/candidates/de/010121",
      annualBaciContextUrl: "https://example.test/baci/de/010121",
    },
    occurredAt: "2026-06-20T00:00:00.000Z",
  });
  return event;
}

function acceptedProvider(): FixtureAlertDeliveryProvider {
  const provider = new FixtureAlertDeliveryProvider({ supportsIdempotency: false });
  provider.enqueue("ACCEPTED", "accepted-receipt");
  return provider;
}

function activePolicy() {
  return {
    monthlyCapabilityEnabled: true,
    asOf: "2026-07-17T12:00:00.000Z",
  } as const;
}
