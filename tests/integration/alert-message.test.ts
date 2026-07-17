import { describe, expect, it } from "vitest";

import type { AlertEvent } from "../../src/operations/store/model";
import { FixtureAlertDeliveryProvider } from "../../src/operations/delivery/fixture-alert-delivery-provider";
import {
  COVERAGE_STATE_COPY_EN,
  renderAlertMessage,
} from "../../src/operations/delivery/alert-message";

const forbiddenPhrases = [
  "live",
  "real-time",
  "worldwide",
  "demand is growing",
  "sales opportunity",
  "market will grow",
  "no trade",
  "zero imports",
  "recommended market",
];

describe("Opportunity Watch alert messages", () => {
  it("AC3 renders revision update, retraction, and reinstatement messages with original alert and both package identities", async () => {
    const provider = new FixtureAlertDeliveryProvider({ supportsIdempotency: true });
    const originalAlertId = "alert-original-010121";
    const oldPackageId = "eurostat-monthly-package-2026-05";
    const newPackageId = "eurostat-monthly-package-2026-06-revision";

    for (const kind of [
      "REVISION_UPDATE",
      "REVISION_RETRACTION",
      "REVISION_REINSTATEMENT",
    ] as const) {
      const message = renderAlertMessage(
        revisionEvent(kind, originalAlertId, oldPackageId, newPackageId),
      );
      await provider.send(message, `idempotency-${kind}`);

      for (const locale of ["en", "zh-Hans"] as const) {
        const text = `${message.subject[locale]}\n${message.body[locale]}`;
        expect(text).toContain(originalAlertId);
        expect(text).toContain(oldPackageId);
        expect(text).toContain(newPackageId);
      }
    }

    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.every((call) => call.accepted)).toBe(true);
  });

  it("AC4 renders success, coverage-state, and revision copy without forbidden claims", async () => {
    const provider = new FixtureAlertDeliveryProvider({ supportsIdempotency: true });
    const messages = [
      renderAlertMessage(signalEvent("SUPPORTED", "RISING", "+14.2%")),
      ...Object.keys(COVERAGE_STATE_COPY_EN)
        .filter((state) => state !== "SUPPORTED")
        .map((state) => renderAlertMessage(signalEvent(state, null, null))),
      renderAlertMessage(
        revisionEvent(
          "REVISION_UPDATE",
          "alert-original-010121",
          "pkg-old",
          "pkg-new",
        ),
      ),
      renderAlertMessage(
        revisionEvent(
          "REVISION_RETRACTION",
          "alert-original-020202",
          "pkg-old",
          "pkg-new",
        ),
      ),
      renderAlertMessage(
        revisionEvent(
          "REVISION_REINSTATEMENT",
          "alert-original-030303",
          "pkg-old",
          "pkg-new",
        ),
      ),
    ];

    for (const [index, message] of messages.entries()) {
      await provider.send(message, `copy-check-${index}`);
      const text = [
        message.subject.en,
        message.subject["zh-Hans"],
        message.body.en,
        message.body["zh-Hans"],
      ].join("\n");
      const normalized = text.toLocaleLowerCase("und");
      for (const phrase of forbiddenPhrases) {
        expect(normalized).not.toContain(phrase);
      }
      expect(text).not.toMatch(/EUR\s*\d[\s\S]*USD\s*\d|USD\s*\d[\s\S]*EUR\s*\d/u);
      expect(text).not.toMatch(/monthly\s+(?:badge\s+)?(?:score|rank)|(?:score|rank)\s+(?:badge\s+)?monthly/iu);
    }

    for (const expected of Object.values(COVERAGE_STATE_COPY_EN)) {
      expect(messages.map((message) => message.body.en).join("\n")).toContain(
        expected,
      );
    }
    expect(provider.calls).toHaveLength(messages.length);
  });
});

function signalEvent(
  coverageState: string,
  signalState: string | null,
  growthPercentDisplay: string | null,
): AlertEvent {
  return {
    id: `event-${coverageState}`,
    watchId: "watch-010121",
    accountId: "account-alerts",
    kind: "MOMENTUM_SIGNAL",
    dedupeKey: `dedupe-${coverageState}`,
    recipeId: "recent-trade-momentum-v1",
    packageId: "eurostat-monthly-package-2026-06",
    supersededPackageId: null,
    cutoffMonth: "2026-05",
    priorEventId: null,
    detail: {
      messageSchemaVersion: "opportunity-watch-alert-message-v1",
      coverageState,
      signalState,
      growthPercentDisplay,
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
      packageIdentity: "eurostat-monthly-package-2026-06",
      recipeIdentity: "recent-trade-momentum-v1",
      attribution: "Eurostat Comext",
      candidateContextUrl: "https://example.test/candidates/de/010121",
      annualBaciContextUrl: "https://example.test/baci/de/010121",
    },
    occurredAt: "2026-06-20T00:00:00.000Z",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function revisionEvent(
  kind: "REVISION_UPDATE" | "REVISION_RETRACTION" | "REVISION_REINSTATEMENT",
  originalAlertId: string,
  oldPackageId: string,
  newPackageId: string,
): AlertEvent {
  return {
    id: `event-${kind}`,
    watchId: "watch-revision",
    accountId: "account-alerts",
    kind,
    dedupeKey: `dedupe-${kind}`,
    recipeId: "recent-trade-momentum-v1",
    packageId: newPackageId,
    supersededPackageId: oldPackageId,
    cutoffMonth: "2026-05",
    priorEventId: originalAlertId,
    detail: {
      revisionKind: kind,
      originalAlertEventId: originalAlertId,
      oldPackageId,
      newPackageId,
      oldState: "RISING",
      newState: kind === "REVISION_RETRACTION" ? "SUPPORTED_NO_SIGNAL" : "RISING_FAST",
      oldGrowthRateDecimal: "0.120000000000",
      newGrowthRateDecimal:
        kind === "REVISION_RETRACTION" ? null : "0.270000000000",
      affectedPeriods: {
        recentMonths: ["2026-03", "2026-04", "2026-05"],
        baselineMonths: ["2025-03", "2025-04", "2025-05"],
        cutoffMonth: "2026-05",
      },
      revisionReportSha256: "c".repeat(64),
    },
    occurredAt: "2026-06-21T00:00:00.000Z",
    createdAt: "2026-06-21T00:00:00.000Z",
  };
}
