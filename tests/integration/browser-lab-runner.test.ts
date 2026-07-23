import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../src/promotion/acceptance-fixture";
import {
  BrowserLabPlanError,
  createBrowserLabInstrumentationScript,
  resolveInteractionToNextPaintMs,
  resolveLongestScriptedTaskMs,
  runBrowserLab,
  runBrowserLabTrial,
  validateBrowserLabPlan,
  type BrowserLabActionOutcome,
  type BrowserLabAnalyzeOutcome,
  type BrowserLabByteSummary,
  type BrowserLabDriver,
  type BrowserLabJourney,
  type BrowserLabJourneyAction,
  type BrowserLabOpenMarketAnalysisOutcome,
  type BrowserLabPerformanceSnapshot,
  type BrowserLabPlan,
  type BrowserLabTrialSession,
} from "../../src/promotion/browser-lab-runner";
import type { RuntimeIdentityAttestor } from "../../src/promotion/runtime-identity-attestation";

describe("browser-lab instrumentation", () => {
  it("serializes without depending on transpiler helpers from the Node module", () => {
    const windowObject: {
      __hsTrackerBrowserLab?: {
        observers: unknown[];
        observerErrors: string[];
      };
    } = {};

    runInNewContext(createBrowserLabInstrumentationScript(), {
      window: windowObject,
      PerformanceObserver: class {
        constructor() {}

        observe(): void {}
      },
    });

    expect(windowObject.__hsTrackerBrowserLab?.observers).toHaveLength(4);
    expect(windowObject.__hsTrackerBrowserLab?.observerErrors).toEqual([]);
  });

  it("uses Event Timing when Chromium reports the measured interaction", () => {
    expect(resolveInteractionToNextPaintMs([16], 288)).toBe(16);
    expect(resolveInteractionToNextPaintMs([], 288)).toBe(288);
  });

  it("selects long tasks only from the scripted interaction window", () => {
    expect(
      resolveLongestScriptedTaskMs(
        [
          { startTime: 120, duration: 244 },
          { startTime: 380, duration: 52 },
          { startTime: 510, duration: 181 },
        ],
        300,
      ),
    ).toBe(181);
  });
});

describe("browser-lab plan validation", () => {
  it("accepts a strict candidate plan with median and maximum-row journeys", () => {
    const plan: BrowserLabPlan = validateBrowserLabPlan(candidatePlanInput());

    expect(plan).toMatchObject({
      schemaVersion: "browser-lab-plan-v1",
      measurementClass: "candidate",
      origin: "https://candidate.example.com",
    });
    expect(plan.journeys[0].productRole).toBe("median");
    expect(plan.journeys[1].productRole).toBe("maximum-row");
    expect(plan.journeys[0].trialCount).toBe(5);
    expect(plan.journeys[0].actions.map((action) => action.kind)).toEqual([
      "select-context",
      "analyze",
      "open-market-analysis",
      "open-score-detail",
      "close-score-detail",
    ]);
  });

  it("accepts a local-smoke plan on a loopback HTTP origin with fewer trials", () => {
    const input = candidatePlanInput();
    input.measurementClass = "local-smoke";
    input.origin = "http://127.0.0.1:3100";
    input.journeys[0].trialCount = 1;
    input.journeys[1].trialCount = 1;

    const plan = validateBrowserLabPlan(input);

    expect(plan.measurementClass).toBe("local-smoke");
    expect(plan.origin).toBe("http://127.0.0.1:3100");
  });

  it("rejects a candidate origin that is not HTTPS", () => {
    const input = candidatePlanInput();
    input.origin = "http://candidate.example.com";

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "Candidate browser-lab evidence requires an HTTPS origin.",
      ),
    );
  });

  it("rejects a local-smoke origin that is not loopback", () => {
    const input = candidatePlanInput();
    input.measurementClass = "local-smoke";
    input.origin = "http://example.com";

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "Local-smoke browser-lab evidence requires a loopback HTTP origin.",
      ),
    );
  });

  it("rejects an origin that embeds credentials", () => {
    const input = candidatePlanInput();
    input.origin = "https://user:pass@candidate.example.com";

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "Browser-lab plan origin must not embed credentials.",
      ),
    );
  });

  it("rejects an origin that encodes a cross-origin path", () => {
    const input = candidatePlanInput();
    input.origin = "https://candidate.example.com/proxy?to=evil.example.com";

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "Browser-lab plan origin must not encode a cross-origin path, query, or fragment.",
      ),
    );
  });

  it("rejects a candidate plan with fewer than five trials", () => {
    const input = candidatePlanInput();
    input.journeys[0].trialCount = 4;

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "median journey requires at least 5 trials for candidate evidence.",
      ),
    );
  });

  it("rejects a plan missing the identity", () => {
    const input = candidatePlanInput();
    delete input.identity;

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      BrowserLabPlanError,
    );
  });

  it("rejects a journey missing the required actions", () => {
    const input = candidatePlanInput();
    input.journeys[0].actions = input.journeys[0].actions.slice(0, 3) as never;

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "median journey must declare exactly the select-context, analyze, open-market-analysis, open-score-detail, and close-score-detail actions in order.",
      ),
    );
  });

  it("rejects a duplicated median journey with no maximum-row journey", () => {
    const input = candidatePlanInput();
    input.journeys[1] = { ...input.journeys[0] };

    expect(() => validateBrowserLabPlan(input)).toThrowError(
      new BrowserLabPlanError(
        "Browser-lab plan requires exactly one median journey.",
      ),
    );
  });
});

describe("browser-lab trial execution", () => {
  it("maps a successful trial into BrowserLabTrialInput-compatible metrics and diagnostics", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const session = fakeSession();
    const driver = fakeDriver([session]);

    const outcome = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      0,
    );

    expect(outcome).toMatchObject({
      trialIndex: 0,
      productRole: "median",
      status: "measured",
      metrics: {
        marketAnalysisToCompleteMs: 1_200,
        lcpMs: 1_800,
        cls: 0.05,
        interactionToNextPaintMs: 120,
        longestTaskMs: 40,
        criticalCompressedBytes: 150_000,
        totalFirstPartyCompressedBytes: 300_000,
        firstPartyJavaScriptCompressedBytes: 120_000,
        candidateResultBytes: 420_000,
        candidateResultCompressedBytes: 90_000,
      },
      diagnostics: {
        analyzeToCompleteListMs: 850,
        marketAnalysisToCompleteMs: 1_200,
        marketAnalysisOpenInteractionToNextPaintMs: 120,
        scoreDetailOpenInteractionToNextPaintMs: 90,
        scoreDetailCloseInteractionToNextPaintMs: 60,
      },
      violations: [],
    });
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("takes the maximum of the three next-paint interactions as interactionToNextPaintMs", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const session = fakeSession({
      openMarketAnalysis: async () => marketAnalysisOutcome(1_200, 120),
      openScoreDetail: async () => actionOutcome(310),
      closeScoreDetail: async () => actionOutcome(75),
    });
    const driver = fakeDriver([session]);

    const outcome = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      0,
    );

    expect(outcome.status).toBe("measured");
    if (outcome.status === "measured") {
      expect(outcome.metrics.interactionToNextPaintMs).toBe(310);
    }
  });

  it("allows the Market Analysis navigation requests while retaining its timing", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const session = fakeSession({
      openMarketAnalysis: async () =>
        marketAnalysisOutcome(1_200, 120, [
          "https://candidate.example.com/api/v1/analyses/analysis-1/candidate-markets",
        ]),
    });
    const driver = fakeDriver([session]);

    const outcome = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      2,
    );

    expect(outcome).toMatchObject({
      trialIndex: 2,
      productRole: "median",
      status: "measured",
      metrics: {
        marketAnalysisToCompleteMs: 1_200,
      },
      violations: [],
    });
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a client-local interaction reports a delayed network request", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const session = fakeSession({
      openScoreDetail: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return actionOutcome(90, [
          "https://candidate.example.com/api/v1/analyses/current",
        ]);
      },
    });

    const outcome = await runBrowserLabTrial(
      fakeDriver([session]),
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      0,
    );

    expect(outcome).toMatchObject({
      status: "failed",
      violations: [
        {
          kind: "client-local-network-request",
          interaction: "open-score-detail",
          requestUrl:
            "https://candidate.example.com/api/v1/analyses/current",
        },
      ],
    });
  });

  it("fails closed with an explicit unsupported-measurement violation instead of inventing a value", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const session = fakeSession({
      performanceSnapshot: async () => ({
        lcpMs: null,
        cls: 0.05,
        longestTaskMs: 40,
      }),
    });
    const driver = fakeDriver([session]);

    const outcome = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      0,
    );

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.violations).toEqual([
        {
          kind: "unsupported-measurement",
          measurement: "largest contentful paint",
          reason:
            "largest contentful paint could not be measured accurately with the available CDP evidence.",
        },
      ]);
    }
  });

  it("preserves a trial failure without retrying it when the driver throws", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const driver: BrowserLabDriver = {
      openTrialSession: vi.fn(async () => {
        throw new Error("Chromium crashed mid-navigation.");
      }),
      dispose: vi.fn(async () => {}),
    };

    const outcome = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      plan.journeys[0],
      1,
    );

    expect(outcome).toMatchObject({
      trialIndex: 1,
      productRole: "median",
      status: "failed",
      code: "BROWSER_LAB_TRIAL_ERROR",
      reason: "Chromium crashed mid-navigation.",
    });
    expect(driver.openTrialSession).toHaveBeenCalledTimes(1);
  });
});

describe("browser-lab full-plan report", () => {
  it("retains every failed trial in order alongside measured trials with no retry", async () => {
    const input = candidatePlanInput();
    input.measurementClass = "local-smoke";
    input.origin = "http://127.0.0.1:3100";
    input.journeys[0].trialCount = 3;
    input.journeys[1].trialCount = 1;
    const plan = validateBrowserLabPlan(input);

    let medianCall = 0;
    const driver: BrowserLabDriver = {
      openTrialSession: vi.fn(async () => {
        medianCall += 1;
        if (medianCall === 2) {
          return fakeSession({
            analyze: async () => ({
              analyzeToCompleteListMs: 900,
              candidateResponseBytes: null,
            }),
          });
        }
        return fakeSession();
      }),
      dispose: vi.fn(async () => {}),
    };

    const report = await runBrowserLab(
      driver,
      plan,
      () => "2026-07-12T00:00:00Z",
      fakeIdentityAttestor,
    );

    expect(report).toMatchObject({
      schemaVersion: "browser-lab-report-v1",
      measurementClass: "local-smoke",
      generatedAt: "2026-07-12T00:00:00Z",
      attestation: {
        schemaVersion: "runtime-identity-attestation-v1",
        identity: plan.identity,
      },
    });
    expect(report.products.median.trials.map((trial) => trial.status)).toEqual(
      ["measured", "failed", "measured"],
    );
    expect(report.products.median.measuredTrialCount).toBe(2);
    expect(report.products.median.failedTrialCount).toBe(1);
    expect(report.products["maximum-row"].trials).toHaveLength(1);
    expect(driver.openTrialSession).toHaveBeenCalledTimes(4);
  });

  it("does not start a trial when candidate identity attestation fails", async () => {
    const plan = validateBrowserLabPlan(candidatePlanInput());
    const driver = fakeDriver([fakeSession()]);

    await expect(
      runBrowserLab(
        driver,
        plan,
        () => "2026-07-12T00:00:00Z",
        async () => {
          throw new Error("Candidate build does not match.");
        },
      ),
    ).rejects.toThrow("Candidate build does not match.");
    expect(driver.openTrialSession).not.toHaveBeenCalled();
  });

  it("does not start a trial when a journey substitutes another product", async () => {
    const input = candidatePlanInput();
    (
      input.journeys[0].actions[0] as { productQuery: string }
    ).productQuery = "000001";
    const plan = validateBrowserLabPlan(input);
    const driver = fakeDriver([fakeSession()]);

    await expect(
      runBrowserLab(
        driver,
        plan,
        () => "2026-07-12T00:00:00Z",
        fakeIdentityAttestor,
      ),
    ).rejects.toThrow(
      "median journey does not match the deployed artifact benchmark query",
    );
    expect(driver.openTrialSession).not.toHaveBeenCalled();
  });
});

const fakeIdentityAttestor: RuntimeIdentityAttestor = async (
  origin,
  identity,
) => ({
  schemaVersion: "runtime-identity-attestation-v1",
  origin,
  identity,
  capabilities: {
    recentTradeMomentum: true,
    opportunityDiscovery: true,
  },
  benchmarkQueries: [
    {
      role: "sparse",
      productCode: "090100",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "median",
      productCode: "090100",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "upper-quartile",
      productCode: "090100",
      exporterCode: "156",
      candidateCount: 1,
    },
    {
      role: "maximum-row",
      productCode: "090100",
      exporterCode: "156",
      candidateCount: 1,
    },
  ],
  tradeExplorerBenchmarkQueries: [],
  health: {
    path: "/healthz",
    bodySha256: "c".repeat(64),
  },
  currentManifest: {
    path: "/api/v1/analyses/current",
    etag: 'W/"manifest"',
    bodySha256: "d".repeat(64),
    schemaVersion: "current-analysis-manifest-v1",
  },
});

function actionOutcome(
  interactionToNextPaintMs: number | null,
  networkRequestUrls: readonly string[] = [],
): BrowserLabActionOutcome {
  return { interactionToNextPaintMs, networkRequestUrls };
}

function marketAnalysisOutcome(
  marketAnalysisToCompleteMs: number | null,
  interactionToNextPaintMs: number | null,
  networkRequestUrls: readonly string[] = [],
): BrowserLabOpenMarketAnalysisOutcome {
  return {
    marketAnalysisToCompleteMs,
    interactionToNextPaintMs,
    networkRequestUrls,
  };
}

function fakeSession(
  overrides: Partial<{
    navigate: BrowserLabTrialSession["navigate"];
    selectContext: BrowserLabTrialSession["selectContext"];
    analyze: () => Promise<BrowserLabAnalyzeOutcome>;
    openMarketAnalysis: () => Promise<BrowserLabOpenMarketAnalysisOutcome>;
    openScoreDetail: () => Promise<BrowserLabActionOutcome>;
    closeScoreDetail: () => Promise<BrowserLabActionOutcome>;
    performanceSnapshot: () => Promise<BrowserLabPerformanceSnapshot>;
    byteSummary: () => Promise<BrowserLabByteSummary>;
  }> = {},
): BrowserLabTrialSession & { close: ReturnType<typeof vi.fn> } {
  return {
    navigate: overrides.navigate ?? (async () => {}),
    selectContext: overrides.selectContext ?? (async () => {}),
    analyze:
      overrides.analyze ??
      (async () => ({
        analyzeToCompleteListMs: 850,
        candidateResponseBytes: { encodedBytes: 90_000, decodedBytes: 420_000 },
      })),
    openMarketAnalysis:
      overrides.openMarketAnalysis ??
      (async () => marketAnalysisOutcome(1_200, 120)),
    openScoreDetail:
      overrides.openScoreDetail ?? (async () => actionOutcome(90)),
    closeScoreDetail:
      overrides.closeScoreDetail ?? (async () => actionOutcome(60)),
    performanceSnapshot:
      overrides.performanceSnapshot ??
      (async () => ({ lcpMs: 1_800, cls: 0.05, longestTaskMs: 40 })),
    byteSummary:
      overrides.byteSummary ??
      (async () => ({
        firstPartyEncodedBytesBeforeLcp: 150_000,
        totalFirstPartyEncodedBytes: 300_000,
        firstPartyJavaScriptEncodedBytes: 120_000,
      })),
    close: vi.fn(async () => {}),
  };
}

function fakeDriver(
  sessions: readonly BrowserLabTrialSession[],
): BrowserLabDriver {
  let nextIndex = 0;
  return {
    openTrialSession: vi.fn(async () => {
      const session = sessions[nextIndex] ?? sessions[sessions.length - 1];
      nextIndex += 1;
      return session;
    }),
    dispose: vi.fn(async () => {}),
  };
}


type MutablePlan = {
  schemaVersion: "browser-lab-plan-v1";
  measurementClass: string;
  identity?: Record<string, unknown>;
  origin: string;
  journeys: MutableJourney[];
};

type MutableJourney = {
  productRole: string;
  trialCount: number;
  actions: readonly BrowserLabJourneyAction[];
};

export function candidatePlanInput(): MutablePlan {
  return {
    schemaVersion: "browser-lab-plan-v1",
    measurementClass: "candidate",
    origin: "https://candidate.example.com",
    identity: {
      fixtureManifestSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
      buildId: "build-1",
      baciRelease: "V202501",
      analysisBuildId: "analysis-1",
      productSearchBuildId: "product-search-1",
      artifactSha256: "b".repeat(64),
      machineId: "machine-1",
      machineClass: "lab-mobile",
      region: "usw",
    },
    journeys: [journey("median"), journey("maximum-row")],
  };
}

function journey(productRole: "median" | "maximum-row"): MutableJourney {
  return {
    productRole,
    trialCount: 5,
    actions: [
      {
        kind: "select-context",
        label: "Select exporter and product",
        exporterComboboxLocator: { by: "role", role: "combobox", name: "Export economy" },
        exporterQuery: "156",
        exporterOptionLocator: { by: "text", text: "United States" },
        productComboboxLocator: { by: "role", role: "combobox", name: "HS 2012 Product" },
        productQuery: "090100",
        productOptionLocator: { by: "text", text: "0901" },
      },
      {
        kind: "analyze",
        label: "Discover Candidate Markets",
        analyzeButtonLocator: {
          by: "role",
          role: "button",
          name: "Discover Candidate Markets",
        },
        completeListLocator: { by: "testId", testId: "candidate-market-list" },
      },
      {
        kind: "open-market-analysis",
        label: "Analyze the second-ranked Candidate Market",
        marketLinkLocator: { by: "testId", testId: "candidate-market-row-2" },
        completeAnalysisLocator: {
          by: "testId",
          testId: "market-analysis",
        },
      },
      {
        kind: "open-score-detail",
        label: "Open the Candidate Market Score detail",
        openTriggerLocator: { by: "testId", testId: "candidate-market-score-open" },
        detailLocator: { by: "testId", testId: "candidate-market-score-detail" },
      },
      {
        kind: "close-score-detail",
        label: "Close the Candidate Market Score detail",
        closeTriggerLocator: { by: "testId", testId: "candidate-market-score-close" },
      },
    ] as unknown as BrowserLabJourney["actions"],
  };
}
