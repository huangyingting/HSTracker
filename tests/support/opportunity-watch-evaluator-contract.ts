import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecentTradeMomentumOutcome } from "../../src/domain/recent-trade-momentum/recent-trade-momentum-v1";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import {
  evaluateOpportunityWatchesForPackage,
  type MomentumEvaluationRequest,
  type MomentumEvaluationSource,
} from "../../src/operations/watch/watch-evaluator";
import cadenceBoundaries from "../../fixtures/opportunity-watch/v1/cadence-boundaries.json";

const RECIPE = "recent-trade-momentum-v1";
const HS12 = "HS12";
const prod = (code: string) => ({ hsRevision: HS12, code });

export function runOpportunityWatchEvaluatorContract(
  label: string,
  makeStore: () => Promise<OperationalStore>,
): void {
  describe(`Opportunity Watch evaluator contract: ${label}`, () => {
    let store: OperationalStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it("evaluates monthly watches on every package and quarterly watches only at quarter endpoints", async () => {
      const account = await store.createAccount({
        displayName: "Cadence Co",
        primaryExportEconomy: "076",
      });
      const monthly = await store.openWatch(account.id, {
        product: prod("010121"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "010121",
        exportEconomyCode: "076",
        cadence: "MONTHLY",
        deliveryPreferences: [{ channel: "email", target: null, enabled: true }],
      });
      const quarterly = await store.openWatch(account.id, {
        product: prod("020202"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "020202",
        exportEconomyCode: "076",
        cadence: "QUARTERLY",
        deliveryPreferences: [{ channel: "email", target: null, enabled: true }],
      });
      const source = new LiteralMomentumSource();
      source.set("pkg-may", "DE", "010121", outcome("pkg-may", "DE", "010121", cadenceBoundaries.nonQuarterCutoffMonth, "RISING", "0.120000000000"));
      source.set("pkg-may", "DE", "020202", outcome("pkg-may", "DE", "020202", cadenceBoundaries.nonQuarterCutoffMonth, "FALLING", "-0.120000000000"));
      source.set("pkg-jun", "DE", "010121", outcome("pkg-jun", "DE", "010121", cadenceBoundaries.quarterCutoffMonth, "RISING", "0.121000000000"));
      source.set("pkg-jun", "DE", "020202", outcome("pkg-jun", "DE", "020202", cadenceBoundaries.quarterCutoffMonth, "FALLING", "-0.120000000000"));

      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-may",
        cutoffMonth: cadenceBoundaries.nonQuarterCutoffMonth,
        batchSize: 1,
        evaluatorId: "cadence-may",
        source,
      });
      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-jun",
        cutoffMonth: cadenceBoundaries.quarterCutoffMonth,
        batchSize: 1,
        evaluatorId: "cadence-jun",
        source,
      });

      const events = await store.listAlertEvents(account.id);
      expect(events.map((event) => [event.watchId, event.cutoffMonth])).toEqual([
        [monthly.id, cadenceBoundaries.nonQuarterCutoffMonth],
        [quarterly.id, cadenceBoundaries.quarterCutoffMonth],
      ]);
      expect(source.calls.map((call) => [call.packageIdentity, call.hs12Code]).sort()).toEqual([
        ["pkg-may", "010121"],
        ["pkg-jun", "010121"],
        ["pkg-jun", "020202"],
      ].sort());
      expect("exportEconomyCode" in source.calls[0]!).toBe(false);
    });

    it("allows a quarterly source revision to re-evaluate an already evaluated quarter endpoint", async () => {
      const account = await store.createAccount({
        displayName: "Quarter Revision Co",
        primaryExportEconomy: "076",
      });
      await store.openWatch(account.id, {
        product: prod("010121"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "010121",
        cadence: "QUARTERLY",
      });
      const source = new LiteralMomentumSource();
      source.set("pkg-jun", "DE", "010121", outcome("pkg-jun", "DE", "010121", "2026-06", "RISING", "0.120000000000"));
      source.set("pkg-rev", "DE", "010121", outcome("pkg-rev", "DE", "010121", "2026-06", "RISING_FAST", "0.270000000000"));

      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-jun",
        cutoffMonth: "2026-06",
        batchSize: 10,
        evaluatorId: "quarter-first",
        source,
      });
      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-rev",
        cutoffMonth: "2026-06",
        supersedesPackageIdentity: "pkg-jun",
        revisionReportSha256: "b".repeat(64),
        batchSize: 10,
        evaluatorId: "quarter-revision",
        source,
      });

      expect((await store.listAlertEvents(account.id)).map((event) => event.kind)).toEqual([
        "MOMENTUM_SIGNAL",
        "REVISION_UPDATE",
      ]);
    });

    it("retries reuse existing events and delivery rows", async () => {
      const account = await store.createAccount({
        displayName: "Retry Co",
        primaryExportEconomy: "076",
      });
      await store.openWatch(account.id, {
        product: prod("010121"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "010121",
        cadence: "MONTHLY",
        deliveryPreferences: [{ channel: "email", target: null, enabled: true }],
      });
      const source = new LiteralMomentumSource();
      source.set("pkg-retry", "DE", "010121", outcome("pkg-retry", "DE", "010121", "2026-06", "RISING", "0.120000000000"));

      const first = await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-retry",
        cutoffMonth: "2026-06",
        batchSize: 10,
        evaluatorId: "retry-first",
        source,
      });
      const second = await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-retry",
        cutoffMonth: "2026-06",
        batchSize: 10,
        evaluatorId: "retry-second",
        source,
      });

      const events = await store.listAlertEvents(account.id);
      expect(first.createdEventCount).toBe(1);
      expect(second.createdEventCount).toBe(0);
      expect(events).toHaveLength(1);
      const delivery = await store.getDeliveryState(events[0]!.id, "email");
      expect(delivery).toMatchObject({
        deliveryId: expect.stringMatching(/[0-9a-f-]{36}/u),
        idempotencyKey: `${events[0]!.id}:email`,
        status: "PENDING",
        attempts: 0,
      });
    });

    it("appends revision update, retraction, and reinstatement events without overwriting original evidence", async () => {
      const account = await store.createAccount({
        displayName: "Revision Co",
        primaryExportEconomy: "076",
      });
      await store.openWatch(account.id, {
        product: prod("010121"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "010121",
        cadence: "MONTHLY",
      });
      await store.openWatch(account.id, {
        product: prod("020202"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "020202",
        cadence: "MONTHLY",
      });
      await store.openWatch(account.id, {
        product: prod("030303"),
        marketEconomy: "DE",
        reportingEconomyIso2: "DE",
        hs12Code: "030303",
        cadence: "MONTHLY",
      });
      const source = new LiteralMomentumSource();
      source.set("pkg-original", "DE", "010121", outcome("pkg-original", "DE", "010121", "2026-06", "RISING", "0.120000000000"));
      source.set("pkg-original", "DE", "020202", outcome("pkg-original", "DE", "020202", "2026-06", "FALLING", "-0.120000000000"));
      source.set("pkg-original", "DE", "030303", outcome("pkg-original", "DE", "030303", "2026-06", "RISING", "0.120000000000"));
      source.set("pkg-revision", "DE", "010121", outcome("pkg-revision", "DE", "010121", "2026-06", "RISING_FAST", "0.270000000000"));
      source.set("pkg-revision", "DE", "020202", outcome("pkg-revision", "DE", "020202", "2026-06", null, null, "SUPPORTED_NO_SIGNAL"));
      source.set("pkg-revision", "DE", "030303", outcome("pkg-revision", "DE", "030303", "2026-06", null, null, "SUPPORTED_NO_SIGNAL"));
      source.set("pkg-reinstatement", "DE", "010121", outcome("pkg-reinstatement", "DE", "010121", "2026-06", "RISING_FAST", "0.270000000000"));
      source.set("pkg-reinstatement", "DE", "020202", outcome("pkg-reinstatement", "DE", "020202", "2026-06", null, null, "SUPPORTED_NO_SIGNAL"));
      source.set("pkg-reinstatement", "DE", "030303", outcome("pkg-reinstatement", "DE", "030303", "2026-06", "RISING_FAST", "0.270000000000"));

      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-original",
        cutoffMonth: "2026-06",
        batchSize: 2,
        evaluatorId: "revision-original",
        source,
      });
      const originalEvents = await store.listAlertEvents(account.id);
      expect(originalEvents.map((event) => event.kind)).toEqual([
        "MOMENTUM_SIGNAL",
        "MOMENTUM_SIGNAL",
        "MOMENTUM_SIGNAL",
      ]);

      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-revision",
        cutoffMonth: "2026-06",
        supersedesPackageIdentity: "pkg-original",
        revisionReportSha256: "c".repeat(64),
        batchSize: 2,
        evaluatorId: "revision-replay",
        source,
      });
      await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-reinstatement",
        cutoffMonth: "2026-06",
        supersedesPackageIdentity: "pkg-revision",
        revisionReportSha256: "d".repeat(64),
        batchSize: 2,
        evaluatorId: "revision-reinstatement",
        source,
      });

      const allEvents = await store.listAlertEvents(account.id);
      expect(allEvents.map((event) => event.kind).sort()).toEqual([
        "MOMENTUM_SIGNAL",
        "MOMENTUM_SIGNAL",
        "MOMENTUM_SIGNAL",
        "REVISION_REINSTATEMENT",
        "REVISION_RETRACTION",
        "REVISION_RETRACTION",
        "REVISION_UPDATE",
      ]);
      for (const original of originalEvents) {
        expect(allEvents).toContainEqual(original);
      }
      const revisionEvents = allEvents.filter((event) =>
        event.kind.toString().startsWith("REVISION_"),
      );
      const revisionDetails = Object.fromEntries(
        revisionEvents.map((event) => [event.kind, event.detail]),
      );
      expect(
        revisionEvents.every((event) => event.priorEventId !== null),
      ).toBe(true);
      expect(revisionDetails.REVISION_UPDATE).toEqual(
        expect.objectContaining({
          oldPackageId: "pkg-original",
          newPackageId: "pkg-revision",
          oldState: "RISING",
          newState: "RISING_FAST",
          revisionReportSha256: "c".repeat(64),
        }),
      );
      expect(revisionEvents.map((event) => event.detail)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            oldPackageId: "pkg-original",
            newPackageId: "pkg-revision",
            oldState: "FALLING",
            newState: "SUPPORTED_NO_SIGNAL",
            revisionReportSha256: "c".repeat(64),
          }),
          expect.objectContaining({
            oldPackageId: "pkg-original",
            newPackageId: "pkg-revision",
            oldState: "RISING",
            newState: "SUPPORTED_NO_SIGNAL",
            revisionReportSha256: "c".repeat(64),
          }),
        ]),
      );
      expect(revisionDetails.REVISION_REINSTATEMENT).toEqual(
        expect.objectContaining({
          oldPackageId: "pkg-revision",
          newPackageId: "pkg-reinstatement",
          oldState: "SUPPORTED_NO_SIGNAL",
          newState: "RISING_FAST",
          revisionReportSha256: "d".repeat(64),
        }),
      );
    });

    it("keeps batch size bounded and stores no monthly analytical fact copies", async () => {
      const account = await store.createAccount({
        displayName: "Throughput Co",
        primaryExportEconomy: "076",
      });
      const source = new LiteralMomentumSource();
      for (let index = 0; index < 125; index += 1) {
        const code = `01${String(index).padStart(4, "0")}`;
        await store.openWatch(account.id, {
          product: prod(code),
          marketEconomy: "DE",
          reportingEconomyIso2: "DE",
          hs12Code: code,
          cadence: "MONTHLY",
        });
        source.set("pkg-throughput", "DE", code, outcome("pkg-throughput", "DE", code, "2026-06", "RISING", "0.120000000000"));
      }

      const summary = await evaluateOpportunityWatchesForPackage({
        store,
        packageIdentity: "pkg-throughput",
        cutoffMonth: "2026-06",
        batchSize: 25,
        evaluatorId: "throughput",
        source,
      });

      expect(summary.evaluatedWatchCount).toBe(125);
      expect(summary.claimedBatchSizes).toEqual([25, 25, 25, 25, 25]);
      expect(summary.claimedBatchSizes.every((size) => size <= 25)).toBe(true);
      const serializedEvents = JSON.stringify(await store.listAlertEvents(account.id));
      expect(serializedEvents).not.toContain("recentValueEur");
      expect(serializedEvents).not.toContain("baselineValueEur");
      expect(serializedEvents).not.toContain("observations");
      expect(serializedEvents).not.toContain("valueEur");
    });
  });
}

class LiteralMomentumSource implements MomentumEvaluationSource {
  readonly calls: MomentumEvaluationRequest[] = [];
  private readonly outcomes = new Map<string, RecentTradeMomentumOutcome>();

  set(
    packageIdentity: string,
    reportingEconomyIso2: string,
    hs12Code: string,
    result: RecentTradeMomentumOutcome,
  ): void {
    this.outcomes.set(key(packageIdentity, reportingEconomyIso2, hs12Code), result);
  }

  async evaluate(
    request: MomentumEvaluationRequest,
  ): Promise<RecentTradeMomentumOutcome | null> {
    this.calls.push(request);
    return this.outcomes.get(
      key(request.packageIdentity, request.reportingEconomyIso2, request.hs12Code),
    ) ?? null;
  }
}

function key(
  packageIdentity: string,
  reportingEconomyIso2: string,
  hs12Code: string,
): string {
  return `${packageIdentity}|${reportingEconomyIso2}|${hs12Code}`;
}

function outcome(
  packageId: string,
  reporterIso2: string,
  hs12Code: string,
  cutoffMonth: string,
  signalState: RecentTradeMomentumOutcome["signalState"],
  growthRateDecimal: string | null,
  coverageState: RecentTradeMomentumOutcome["coverageState"] = "SUPPORTED",
): RecentTradeMomentumOutcome {
  return {
    schemaVersion: "recent-trade-momentum-result-v1",
    recipe: RECIPE,
    monthlyPackageId: packageId,
    sourceVintageId: `source-${packageId}`,
    reporterIso2,
    hs12Code,
    cutoffMonth,
    recentMonths: [`${cutoffMonth}-recent-a`, `${cutoffMonth}-recent-b`],
    baselineMonths: [`${cutoffMonth}-base-a`, `${cutoffMonth}-base-b`],
    coverageState,
    signalState,
    reasonCodes: coverageState === "SUPPORTED" ? [] : ["INSUFFICIENT_COMPLETE_HISTORY"],
    recentValueEur: signalState === null ? null : "1120000",
    baselineValueEur: signalState === null ? null : "1000000",
    growthRateDecimal,
    growthPercentDisplay: growthRateDecimal === null ? null : "+12.0%",
    confidence: signalState === null ? null : "HIGH",
    confidenceReasons: [],
    recordedHistoryMonths: 24,
    expectedHistoryMonths: 24,
  };
}
