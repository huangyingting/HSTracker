import type {
  BrowserLabTrialInput,
  PerformanceMeasurementIdentity,
} from "./performance-gates";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "./acceptance-fixture";
import {
  browserLaunchMatrixContextKey,
  REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS,
  type BrowserLaunchMatrixLocale,
  type BrowserLaunchMatrixViewport,
} from "./browser-launch-matrix";
import {
  attestRuntimeIdentity,
  type RuntimeIdentityAttestation,
  type RuntimeIdentityAttestor,
} from "./runtime-identity-attestation";
import { validateMeasurementOrigin } from "./measurement-origin";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BrowserLabPlanError extends Error {
  readonly code = "BROWSER_LAB_PLAN_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "BrowserLabPlanError";
  }
}

// ---------------------------------------------------------------------------
// Fixed mobile lab profile, applied through CDP before every trial navigates.
// ---------------------------------------------------------------------------

export type MobileLabProfile = {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
  readonly userAgent: string;
  readonly rttMs: number;
  readonly downloadThroughputBytesPerSecond: number;
  readonly uploadThroughputBytesPerSecond: number;
  readonly cpuThrottlingRate: number;
};

export const MOBILE_LAB_PROFILE: MobileLabProfile = {
  viewportWidth: 390,
  viewportHeight: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; HSTracker Mobile Lab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  rttMs: 150,
  downloadThroughputBytesPerSecond: (1_600_000) / 8,
  uploadThroughputBytesPerSecond: (750_000) / 8,
  cpuThrottlingRate: 4,
} as const;

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type BrowserLabMeasurementClass = "candidate" | "local-smoke";
export type BrowserLabProductRole = "median" | "maximum-row";
export type BrowserLabRole =
  | "button"
  | "combobox"
  | "link"
  | "list"
  | "option"
  | "region";

export type BrowserLabLocator =
  | { readonly by: "role"; readonly role: BrowserLabRole; readonly name: string }
  | { readonly by: "text"; readonly text: string; readonly exact?: boolean }
  | { readonly by: "testId"; readonly testId: string }
  | { readonly by: "css"; readonly selector: string };

export type BrowserLabSelectContextAction = {
  readonly kind: "select-context";
  readonly label: string;
  readonly exporterComboboxLocator: BrowserLabLocator;
  readonly exporterQuery: string;
  readonly exporterOptionLocator: BrowserLabLocator;
  readonly productComboboxLocator: BrowserLabLocator;
  readonly productQuery: string;
  readonly productOptionLocator: BrowserLabLocator;
};

export type BrowserLabAnalyzeAction = {
  readonly kind: "analyze";
  readonly label: string;
  readonly analyzeButtonLocator: BrowserLabLocator;
  readonly completeListLocator: BrowserLabLocator;
};

export type BrowserLabOpenMarketAnalysisAction = {
  readonly kind: "open-market-analysis";
  readonly label: string;
  readonly marketLinkLocator: BrowserLabLocator;
  readonly completeAnalysisLocator: BrowserLabLocator;
};

export type BrowserLabOpenScoreDetailAction = {
  readonly kind: "open-score-detail";
  readonly label: string;
  readonly openTriggerLocator: BrowserLabLocator;
  readonly detailLocator: BrowserLabLocator;
};

export type BrowserLabCloseScoreDetailAction = {
  readonly kind: "close-score-detail";
  readonly label: string;
  readonly closeTriggerLocator: BrowserLabLocator;
};

export type BrowserLabJourneyAction =
  | BrowserLabSelectContextAction
  | BrowserLabAnalyzeAction
  | BrowserLabOpenMarketAnalysisAction
  | BrowserLabOpenScoreDetailAction
  | BrowserLabCloseScoreDetailAction;

export type BrowserLabJourneyActions = readonly [
  BrowserLabSelectContextAction,
  BrowserLabAnalyzeAction,
  BrowserLabOpenMarketAnalysisAction,
  BrowserLabOpenScoreDetailAction,
  BrowserLabCloseScoreDetailAction,
];

export type BrowserLabJourney = {
  readonly productRole: BrowserLabProductRole;
  readonly trialCount: number;
  readonly actions: BrowserLabJourneyActions;
};

export type BrowserLabLaunchMatrixPlan = {
  readonly productRole: BrowserLabProductRole;
  readonly locales: readonly BrowserLaunchMatrixLocale[];
  readonly viewports: readonly BrowserLaunchMatrixViewport[];
};

export type BrowserLabPlan = {
  readonly schemaVersion: "browser-lab-plan-v1";
  readonly measurementClass: BrowserLabMeasurementClass;
  readonly identity: PerformanceMeasurementIdentity;
  readonly origin: string;
  readonly journeys: readonly [BrowserLabJourney, BrowserLabJourney];
  readonly launchMatrix: BrowserLabLaunchMatrixPlan;
};

const MINIMUM_CANDIDATE_TRIALS = 5;
const REQUIRED_ACTION_KINDS = [
  "select-context",
  "analyze",
  "open-market-analysis",
  "open-score-detail",
  "close-score-detail",
] as const;

export function validateBrowserLabPlan(value: unknown): BrowserLabPlan {
  const plan = record(value, "browser-lab plan");
  if (plan.schemaVersion !== "browser-lab-plan-v1") {
    throw new BrowserLabPlanError(
      "Browser-lab plan schemaVersion must be browser-lab-plan-v1.",
    );
  }
  const measurementClass = measurementClassOf(plan.measurementClass);
  const identity = validateIdentity(plan.identity);
  const origin = validateOrigin(plan.origin, measurementClass);
  const journeysInput = plan.journeys;
  if (!Array.isArray(journeysInput) || journeysInput.length !== 2) {
    throw new BrowserLabPlanError(
      "Browser-lab plan must declare exactly two journeys.",
    );
  }
  const median = validateJourney(
    requiredJourney(journeysInput, "median"),
    measurementClass,
  );
  const maximumRow = validateJourney(
    requiredJourney(journeysInput, "maximum-row"),
    measurementClass,
  );
  const launchMatrix = validateLaunchMatrix(
    plan.launchMatrix,
    measurementClass,
  );

  return {
    schemaVersion: "browser-lab-plan-v1",
    measurementClass,
    identity,
    origin,
    journeys: [median, maximumRow],
    launchMatrix,
  };
}

function validateLaunchMatrix(
  value: unknown,
  measurementClass: BrowserLabMeasurementClass,
): BrowserLabLaunchMatrixPlan {
  if (value === undefined && measurementClass === "local-smoke") {
    return {
      productRole: "median",
      locales: ["en"],
      viewports: [{ width: 390, height: 844 }],
    };
  }
  if (value === undefined) {
    throw new BrowserLabPlanError(
      "Candidate browser-lab evidence requires the complete launch matrix.",
    );
  }
  const matrix = record(value, "browser launch matrix");
  const productRole = matrix.productRole;
  if (productRole !== "median" && productRole !== "maximum-row") {
    throw new BrowserLabPlanError(
      "Browser launch matrix productRole must be median or maximum-row.",
    );
  }
  if (!Array.isArray(matrix.locales) || matrix.locales.length === 0) {
    throw new BrowserLabPlanError(
      "Browser launch matrix locales must be a nonempty array.",
    );
  }
  const locales = matrix.locales.map((locale) => {
    if (locale !== "en" && locale !== "zh-Hans") {
      throw new BrowserLabPlanError(
        "Browser launch matrix locale must be en or zh-Hans.",
      );
    }
    return locale;
  });
  if (!Array.isArray(matrix.viewports) || matrix.viewports.length === 0) {
    throw new BrowserLabPlanError(
      "Browser launch matrix viewports must be a nonempty array.",
    );
  }
  const viewports = matrix.viewports.map((value, index) => {
    const viewport = record(value, `browser launch matrix viewport ${index + 1}`);
    return {
      width: positiveInteger(
        viewport.width,
        `browser launch matrix viewport ${index + 1} width`,
      ),
      height: positiveInteger(
        viewport.height,
        `browser launch matrix viewport ${index + 1} height`,
      ),
    };
  });
  if (measurementClass === "candidate") {
    const actualContexts = locales
      .flatMap((locale) =>
        viewports.map((viewport) =>
          browserLaunchMatrixContextKey(locale, viewport),
        ),
      )
      .sort();
    const requiredContexts = [...REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS].sort();
    if (
      actualContexts.length !== requiredContexts.length ||
      actualContexts.some(
        (context, index) => context !== requiredContexts[index],
      )
    ) {
      throw new BrowserLabPlanError(
        "Candidate browser-lab evidence requires both locales at 1440x900, 1024x768, 768x1024, 390x844, and 320x568.",
      );
    }
  }
  return { productRole, locales, viewports };
}

function requiredJourney(
  journeys: readonly unknown[],
  productRole: BrowserLabProductRole,
): Record<string, unknown> {
  const matches = journeys
    .map((journey) => record(journey, `${productRole} journey`))
    .filter((journey) => journey.productRole === productRole);
  if (matches.length !== 1) {
    throw new BrowserLabPlanError(
      `Browser-lab plan requires exactly one ${productRole} journey.`,
    );
  }
  return matches[0];
}

function validateJourney(
  journey: Record<string, unknown>,
  measurementClass: BrowserLabMeasurementClass,
): BrowserLabJourney {
  const productRole = journey.productRole;
  if (productRole !== "median" && productRole !== "maximum-row") {
    throw new BrowserLabPlanError(
      "Browser-lab journey productRole must be median or maximum-row.",
    );
  }
  const trialCount = positiveInteger(
    journey.trialCount,
    `${productRole} journey trial count`,
  );
  const minimumTrials =
    measurementClass === "candidate" ? MINIMUM_CANDIDATE_TRIALS : 1;
  if (trialCount < minimumTrials) {
    throw new BrowserLabPlanError(
      `${productRole} journey requires at least ${minimumTrials} trials for ${measurementClass} evidence.`,
    );
  }
  const actionsInput = journey.actions;
  if (!Array.isArray(actionsInput) || actionsInput.length !== REQUIRED_ACTION_KINDS.length) {
    throw new BrowserLabPlanError(
      `${productRole} journey must declare exactly the select-context, analyze, open-market-analysis, open-score-detail, and close-score-detail actions in order.`,
    );
  }
  return {
    productRole,
    trialCount,
    actions: [
      validateAction(
        record(actionsInput[0], `${productRole} journey action 1`),
        "select-context",
        productRole,
      ),
      validateAction(
        record(actionsInput[1], `${productRole} journey action 2`),
        "analyze",
        productRole,
      ),
      validateAction(
        record(actionsInput[2], `${productRole} journey action 3`),
        "open-market-analysis",
        productRole,
      ),
      validateAction(
        record(actionsInput[3], `${productRole} journey action 4`),
        "open-score-detail",
        productRole,
      ),
      validateAction(
        record(actionsInput[4], `${productRole} journey action 5`),
        "close-score-detail",
        productRole,
      ),
    ],
  };
}

function validateAction(
  action: Record<string, unknown>,
  expectedKind: "select-context",
  productRole: BrowserLabProductRole,
): BrowserLabSelectContextAction;
function validateAction(
  action: Record<string, unknown>,
  expectedKind: "analyze",
  productRole: BrowserLabProductRole,
): BrowserLabAnalyzeAction;
function validateAction(
  action: Record<string, unknown>,
  expectedKind: "open-market-analysis",
  productRole: BrowserLabProductRole,
): BrowserLabOpenMarketAnalysisAction;
function validateAction(
  action: Record<string, unknown>,
  expectedKind: "open-score-detail",
  productRole: BrowserLabProductRole,
): BrowserLabOpenScoreDetailAction;
function validateAction(
  action: Record<string, unknown>,
  expectedKind: "close-score-detail",
  productRole: BrowserLabProductRole,
): BrowserLabCloseScoreDetailAction;
function validateAction(
  action: Record<string, unknown>,
  expectedKind: (typeof REQUIRED_ACTION_KINDS)[number],
  productRole: BrowserLabProductRole,
): BrowserLabJourneyAction {
  if (action.kind !== expectedKind) {
    throw new BrowserLabPlanError(
      `${productRole} journey action must be ${expectedKind} in that position.`,
    );
  }
  const label = nonemptyString(
    action.label,
    `${productRole} ${expectedKind} action label`,
  );
  switch (expectedKind) {
    case "select-context":
      return {
        kind: "select-context",
        label,
        exporterComboboxLocator: validateLocator(
          action.exporterComboboxLocator,
          `${productRole} select-context exporter combobox locator`,
        ),
        exporterQuery: nonemptyString(
          action.exporterQuery,
          `${productRole} select-context exporter query`,
        ),
        exporterOptionLocator: validateLocator(
          action.exporterOptionLocator,
          `${productRole} select-context exporter option locator`,
        ),
        productComboboxLocator: validateLocator(
          action.productComboboxLocator,
          `${productRole} select-context product combobox locator`,
        ),
        productQuery: nonemptyString(
          action.productQuery,
          `${productRole} select-context product query`,
        ),
        productOptionLocator: validateLocator(
          action.productOptionLocator,
          `${productRole} select-context product option locator`,
        ),
      };
    case "analyze":
      return {
        kind: "analyze",
        label,
        analyzeButtonLocator: validateLocator(
          action.analyzeButtonLocator,
          `${productRole} analyze button locator`,
        ),
        completeListLocator: validateLocator(
          action.completeListLocator,
          `${productRole} analyze complete-list locator`,
        ),
      };
    case "open-market-analysis":
      return {
        kind: "open-market-analysis",
        label,
        marketLinkLocator: validateLocator(
          action.marketLinkLocator,
          `${productRole} open-market-analysis link locator`,
        ),
        completeAnalysisLocator: validateLocator(
          action.completeAnalysisLocator,
          `${productRole} open-market-analysis complete locator`,
        ),
      };
    case "open-score-detail":
      return {
        kind: "open-score-detail",
        label,
        openTriggerLocator: validateLocator(
          action.openTriggerLocator,
          `${productRole} open-score-detail trigger locator`,
        ),
        detailLocator: validateLocator(
          action.detailLocator,
          `${productRole} open-score-detail detail locator`,
        ),
      };
    case "close-score-detail":
      return {
        kind: "close-score-detail",
        label,
        closeTriggerLocator: validateLocator(
          action.closeTriggerLocator,
          `${productRole} close-score-detail trigger locator`,
        ),
      };
    default:
      throw new BrowserLabPlanError(
        `${productRole} journey action kind is unsupported.`,
      );
  }
}

function validateLocator(value: unknown, label: string): BrowserLabLocator {
  const locator = record(value, label);
  switch (locator.by) {
    case "role":
      return {
        by: "role",
        role: browserLabRole(locator.role, `${label} role`),
        name: nonemptyString(locator.name, `${label} name`),
      };
    case "text":
      return {
        by: "text",
        text: nonemptyString(locator.text, `${label} text`),
        exact: optionalBoolean(locator.exact, `${label} exact`),
      };
    case "testId":
      return {
        by: "testId",
        testId: nonemptyString(locator.testId, `${label} testId`),
      };
    case "css":
      return {
        by: "css",
        selector: nonemptyString(locator.selector, `${label} selector`),
      };
    default:
      throw new BrowserLabPlanError(
        `${label} must select by role, text, testId, or css.`,
      );
  }
}

function browserLabRole(value: unknown, label: string): BrowserLabRole {
  if (
    value === "button" ||
    value === "combobox" ||
    value === "list" ||
    value === "option" ||
    value === "region"
  ) {
    return value;
  }
  throw new BrowserLabPlanError(
    `${label} must be button, combobox, list, option, or region.`,
  );
}

function measurementClassOf(value: unknown): BrowserLabMeasurementClass {
  if (value === "candidate" || value === "local-smoke") {
    return value;
  }
  throw new BrowserLabPlanError(
    "Browser-lab plan measurementClass must be candidate or local-smoke.",
  );
}

function validateOrigin(
  value: unknown,
  measurementClass: BrowserLabMeasurementClass,
): string {
  return validateMeasurementOrigin(
    value,
    measurementClass,
    "Browser-lab plan origin",
    (message) => new BrowserLabPlanError(message),
  );
}

function validateIdentity(value: unknown): PerformanceMeasurementIdentity {
  const identity = record(value, "browser-lab plan identity");
  const fixtureManifestSha256 = sha256(
    identity.fixtureManifestSha256,
    "browser-lab plan identity fixture manifest SHA-256",
  );
  if (fixtureManifestSha256 !== ACCEPTANCE_FIXTURE_CONTENT_SHA256) {
    throw new BrowserLabPlanError(
      "Browser-lab plan fixture manifest SHA-256 must match the canonical acceptance fixture.",
    );
  }
  const buildId = nonemptyString(
    identity.buildId,
    "browser-lab plan identity build ID",
  );
  const baciRelease = identity.baciRelease;
  if (typeof baciRelease !== "string" || !/^V\d{6}$/u.test(baciRelease)) {
    throw new BrowserLabPlanError(
      "Browser-lab plan identity BACI Release must use the VYYYYMM format.",
    );
  }
  const analysisBuildId = nonemptyString(
    identity.analysisBuildId,
    "browser-lab plan identity analysis build ID",
  );
  const productSearchBuildId = nonemptyString(
    identity.productSearchBuildId,
    "browser-lab plan identity product-search build ID",
  );
  const artifactSha256 = sha256(
    identity.artifactSha256,
    "browser-lab plan identity artifact SHA-256",
  );
  const machineId = nonemptyString(
    identity.machineId,
    "browser-lab plan identity Machine ID",
  );
  const machineClass = nonemptyString(
    identity.machineClass,
    "browser-lab plan identity Machine class",
  );
  const region = identity.region;
  if (typeof region !== "string" || !/^[a-z]{3}$/u.test(region)) {
    throw new BrowserLabPlanError(
      "Browser-lab plan identity region must be a three-letter provider region.",
    );
  }
  return {
    fixtureManifestSha256,
    buildId,
    baciRelease,
    analysisBuildId,
    productSearchBuildId,
    artifactSha256,
    machineId,
    machineClass,
    region,
  };
}

// ---------------------------------------------------------------------------
// Small local validators (mirrors the duplicated-per-module convention used
// by src/promotion/performance-gates.ts and src/promotion/promotion-report.ts).
// ---------------------------------------------------------------------------

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrowserLabPlanError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BrowserLabPlanError(`${label} must be a nonempty string.`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new BrowserLabPlanError(`${label} must be a boolean.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BrowserLabPlanError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new BrowserLabPlanError(
      `${label} must be a lowercase hex SHA-256 digest.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Execution error (raised only for setup/config failures outside a trial,
// e.g. the driver itself could not be created). Per-trial failures never
// throw; they are captured as BrowserLabTrialFailure records instead.
// ---------------------------------------------------------------------------

export class BrowserLabExecutionError extends Error {
  readonly code = "BROWSER_LAB_EXECUTION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "BrowserLabExecutionError";
  }
}

// ---------------------------------------------------------------------------
// Driver seam: real Chromium/CDP execution lives behind this interface so
// trial orchestration and byte/timing aggregation stay testable without
// launching a browser.
// ---------------------------------------------------------------------------

export type BrowserLabActionOutcome = {
  readonly interactionToNextPaintMs: number | null;
  readonly networkRequestUrls: readonly string[];
};

export function resolveInteractionToNextPaintMs(
  eventDurations: readonly number[],
  fallbackMs: number,
): number {
  return eventDurations.length === 0
    ? fallbackMs
    : Math.max(...eventDurations);
}

export type BrowserLabCandidateResponseBytes = {
  readonly encodedBytes: number;
  readonly decodedBytes: number;
};

export type BrowserLabAnalyzeOutcome = {
  readonly analyzeToCompleteListMs: number | null;
  readonly candidateResponseBytes: BrowserLabCandidateResponseBytes | null;
};

export type BrowserLabOpenMarketAnalysisOutcome = BrowserLabActionOutcome & {
  readonly marketAnalysisToCompleteMs: number | null;
};

export type BrowserLabPerformanceSnapshot = {
  readonly lcpMs: number | null;
  readonly cls: number | null;
  readonly longestTaskMs: number | null;
};

export type BrowserLabByteSummary = {
  readonly firstPartyEncodedBytesBeforeLcp: number | null;
  readonly totalFirstPartyEncodedBytes: number | null;
  readonly firstPartyJavaScriptEncodedBytes: number | null;
};

export interface BrowserLabTrialSession {
  navigate(origin: string): Promise<void>;
  selectContext(action: BrowserLabSelectContextAction): Promise<void>;
  analyze(action: BrowserLabAnalyzeAction): Promise<BrowserLabAnalyzeOutcome>;
  openMarketAnalysis(
    action: BrowserLabOpenMarketAnalysisAction,
  ): Promise<BrowserLabOpenMarketAnalysisOutcome>;
  openScoreDetail(
    action: BrowserLabOpenScoreDetailAction,
  ): Promise<BrowserLabActionOutcome>;
  closeScoreDetail(
    action: BrowserLabCloseScoreDetailAction,
  ): Promise<BrowserLabActionOutcome>;
  performanceSnapshot(): Promise<BrowserLabPerformanceSnapshot>;
  byteSummary(): Promise<BrowserLabByteSummary>;
  close(): Promise<void>;
}

export interface BrowserLabDriver {
  openTrialSession(
    measurementClass: BrowserLabMeasurementClass,
    profile?: MobileLabProfile,
  ): Promise<BrowserLabTrialSession>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Trial execution + aggregation
// ---------------------------------------------------------------------------

export type BrowserLabViolation =
  | {
      readonly kind: "client-local-network-request";
      readonly interaction: "open-score-detail" | "close-score-detail";
      readonly requestUrl: string;
    }
  | {
      readonly kind: "unsupported-measurement";
      readonly measurement: string;
      readonly reason: string;
    };

export type BrowserLabTrialDiagnostics = {
  readonly analyzeToCompleteListMs: number;
  readonly marketAnalysisToCompleteMs: number;
  readonly marketAnalysisOpenInteractionToNextPaintMs: number;
  readonly scoreDetailOpenInteractionToNextPaintMs: number;
  readonly scoreDetailCloseInteractionToNextPaintMs: number;
};

export type BrowserLabTrialFailure = {
  readonly trialIndex: number;
  readonly productRole: BrowserLabProductRole;
  readonly status: "failed";
  readonly code: string;
  readonly reason: string;
  readonly violations: readonly BrowserLabViolation[];
};

export type BrowserLabTrialMeasurement = {
  readonly trialIndex: number;
  readonly productRole: BrowserLabProductRole;
  readonly status: "measured";
  readonly metrics: BrowserLabTrialInput;
  readonly diagnostics: BrowserLabTrialDiagnostics;
  readonly violations: readonly BrowserLabViolation[];
};

export type BrowserLabTrialOutcome =
  | BrowserLabTrialMeasurement
  | BrowserLabTrialFailure;

export async function runBrowserLabTrial(
  driver: BrowserLabDriver,
  measurementClass: BrowserLabMeasurementClass,
  origin: string,
  journey: BrowserLabJourney,
  trialIndex: number,
  options: {
    readonly locale?: BrowserLaunchMatrixLocale;
    readonly profile?: MobileLabProfile;
  } = {},
): Promise<BrowserLabTrialOutcome> {
  const [
    selectContextAction,
    analyzeAction,
    openMarketAnalysisAction,
    openAction,
    closeAction,
  ] = journey.actions;
  let session: BrowserLabTrialSession | null = null;
  try {
    session = await driver.openTrialSession(measurementClass, options.profile);
    await session.navigate(candidateMarketEntryUrl(origin, options.locale));
    await session.selectContext(selectContextAction);
    const analyzeOutcome = await session.analyze(analyzeAction);
    const marketAnalysisOutcome = await session.openMarketAnalysis(
      openMarketAnalysisAction,
    );
    const openOutcome = await session.openScoreDetail(openAction);
    const closeOutcome = await session.closeScoreDetail(closeAction);
    const snapshot = await session.performanceSnapshot();
    const bytes = await session.byteSummary();

    const violations: BrowserLabViolation[] = [];
    for (const [interaction, outcome] of [
      ["open-score-detail", openOutcome],
      ["close-score-detail", closeOutcome],
    ] as const) {
      for (const requestUrl of outcome.networkRequestUrls) {
        violations.push({
          kind: "client-local-network-request",
          interaction,
          requestUrl,
        });
      }
    }

    const unsupported = firstUnsupportedMeasurement({
      analyzeOutcome,
      marketAnalysisOutcome,
      openOutcome,
      closeOutcome,
      snapshot,
      bytes,
    });
    if (unsupported !== null) {
      violations.push(unsupported);
    }

    if (violations.length > 0) {
      return {
        trialIndex,
        productRole: journey.productRole,
        status: "failed",
        code: "BROWSER_LAB_TRIAL_VIOLATION",
        reason: violations
          .map((violation) => describeViolation(violation))
          .join(" "),
        violations,
      };
    }

    // Fail-closed guards above guarantee these are non-null at this point.
    const metrics: BrowserLabTrialInput = {
      analyzeToCompleteListMs: nonNull(
        analyzeOutcome.analyzeToCompleteListMs,
      ),
      marketAnalysisToCompleteMs: nonNull(
        marketAnalysisOutcome.marketAnalysisToCompleteMs,
      ),
      lcpMs: nonNull(snapshot.lcpMs),
      cls: nonNull(snapshot.cls),
      interactionToNextPaintMs: Math.max(
        nonNull(marketAnalysisOutcome.interactionToNextPaintMs),
        nonNull(openOutcome.interactionToNextPaintMs),
        nonNull(closeOutcome.interactionToNextPaintMs),
      ),
      longestTaskMs: nonNull(snapshot.longestTaskMs),
      criticalCompressedBytes: nonNull(bytes.firstPartyEncodedBytesBeforeLcp),
      totalFirstPartyCompressedBytes: nonNull(bytes.totalFirstPartyEncodedBytes),
      firstPartyJavaScriptCompressedBytes: nonNull(
        bytes.firstPartyJavaScriptEncodedBytes,
      ),
      candidateResultBytes: nonNull(analyzeOutcome.candidateResponseBytes)
        .decodedBytes,
      candidateResultCompressedBytes: nonNull(
        analyzeOutcome.candidateResponseBytes,
      ).encodedBytes,
    };
    const diagnostics: BrowserLabTrialDiagnostics = {
      analyzeToCompleteListMs: nonNull(analyzeOutcome.analyzeToCompleteListMs),
      marketAnalysisToCompleteMs: nonNull(
        marketAnalysisOutcome.marketAnalysisToCompleteMs,
      ),
      marketAnalysisOpenInteractionToNextPaintMs: nonNull(
        marketAnalysisOutcome.interactionToNextPaintMs,
      ),
      scoreDetailOpenInteractionToNextPaintMs: nonNull(
        openOutcome.interactionToNextPaintMs,
      ),
      scoreDetailCloseInteractionToNextPaintMs: nonNull(
        closeOutcome.interactionToNextPaintMs,
      ),
    };

    return {
      trialIndex,
      productRole: journey.productRole,
      status: "measured",
      metrics,
      diagnostics,
      violations: [],
    };
  } catch (error) {
    return {
      trialIndex,
      productRole: journey.productRole,
      status: "failed",
      code: "BROWSER_LAB_TRIAL_ERROR",
      reason:
        error instanceof Error
          ? error.message
          : "Browser-lab trial failed with an unknown error.",
      violations: [],
    };
  } finally {
    if (session !== null) {
      await session.close();
    }
  }
}

function firstUnsupportedMeasurement(measurements: {
  analyzeOutcome: BrowserLabAnalyzeOutcome;
  marketAnalysisOutcome: BrowserLabOpenMarketAnalysisOutcome;
  openOutcome: BrowserLabActionOutcome;
  closeOutcome: BrowserLabActionOutcome;
  snapshot: BrowserLabPerformanceSnapshot;
  bytes: BrowserLabByteSummary;
}): BrowserLabViolation | null {
  const checks: ReadonlyArray<readonly [string, unknown]> = [
    ["analyze-to-complete-list duration", measurements.analyzeOutcome.analyzeToCompleteListMs],
    ["Candidate Market response bytes", measurements.analyzeOutcome.candidateResponseBytes],
    [
      "Market Analysis-to-complete duration",
      measurements.marketAnalysisOutcome.marketAnalysisToCompleteMs,
    ],
    [
      "open-market-analysis interaction-to-next-paint",
      measurements.marketAnalysisOutcome.interactionToNextPaintMs,
    ],
    [
      "open-score-detail interaction-to-next-paint",
      measurements.openOutcome.interactionToNextPaintMs,
    ],
    [
      "close-score-detail interaction-to-next-paint",
      measurements.closeOutcome.interactionToNextPaintMs,
    ],
    ["largest contentful paint", measurements.snapshot.lcpMs],
    ["cumulative layout shift", measurements.snapshot.cls],
    ["longest task duration", measurements.snapshot.longestTaskMs],
    [
      "first-party encoded bytes before LCP",
      measurements.bytes.firstPartyEncodedBytesBeforeLcp,
    ],
    [
      "total first-party encoded bytes",
      measurements.bytes.totalFirstPartyEncodedBytes,
    ],
    [
      "first-party JavaScript encoded bytes",
      measurements.bytes.firstPartyJavaScriptEncodedBytes,
    ],
  ];
  for (const [measurement, value] of checks) {
    if (value === null) {
      return {
        kind: "unsupported-measurement",
        measurement,
        reason: `${measurement} could not be measured accurately with the available CDP evidence.`,
      };
    }
  }
  return null;
}

function describeViolation(violation: BrowserLabViolation): string {
  if (violation.kind === "client-local-network-request") {
    return `${violation.interaction} triggered a network request to ${violation.requestUrl}, which must be client-local.`;
  }
  return violation.reason;
}

function nonNull<Value>(value: Value | null): Value {
  if (value === null) {
    throw new BrowserLabExecutionError(
      "A required measurement was unexpectedly null after fail-closed validation.",
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Full-plan execution report
// ---------------------------------------------------------------------------

export type BrowserLabProductReport = {
  readonly productRole: BrowserLabProductRole;
  readonly trials: readonly BrowserLabTrialOutcome[];
  readonly measuredTrialCount: number;
  readonly failedTrialCount: number;
};

export type BrowserLabLaunchMatrixTrial = {
  readonly locale: BrowserLaunchMatrixLocale;
  readonly viewport: BrowserLaunchMatrixViewport;
  readonly outcome: BrowserLabTrialOutcome;
};

export type BrowserLabLaunchMatrixReport = {
  readonly productRole: BrowserLabProductRole;
  readonly trials: readonly BrowserLabLaunchMatrixTrial[];
  readonly measuredTrialCount: number;
  readonly failedTrialCount: number;
};

export type BrowserLabReport = {
  readonly schemaVersion: "browser-lab-report-v1";
  readonly measurementClass: BrowserLabMeasurementClass;
  readonly identity: PerformanceMeasurementIdentity;
  readonly origin: string;
  readonly generatedAt: string;
  readonly attestation: RuntimeIdentityAttestation;
  readonly products: {
    readonly median: BrowserLabProductReport;
    readonly "maximum-row": BrowserLabProductReport;
  };
  readonly launchMatrix: BrowserLabLaunchMatrixReport;
};

export async function runBrowserLab(
  driver: BrowserLabDriver,
  plan: BrowserLabPlan,
  now: () => string = () => new Date().toISOString(),
  attestIdentity: RuntimeIdentityAttestor = attestRuntimeIdentity,
): Promise<BrowserLabReport> {
  const attestation = await attestIdentity(plan.origin, plan.identity);
  assertAttestedJourneys(plan, attestation);
  const [median, maximumRow] = plan.journeys;
  const medianReport = await runJourney(driver, plan, median);
  const maximumRowReport = await runJourney(driver, plan, maximumRow);
  const launchMatrix = await runLaunchMatrix(driver, plan);

  return {
    schemaVersion: "browser-lab-report-v1",
    measurementClass: plan.measurementClass,
    identity: plan.identity,
    origin: plan.origin,
    generatedAt: now(),
    attestation,
    products: {
      median: medianReport,
      "maximum-row": maximumRowReport,
    },
    launchMatrix,
  };
}

function assertAttestedJourneys(
  plan: BrowserLabPlan,
  attestation: RuntimeIdentityAttestation,
): void {
  for (const journey of plan.journeys) {
    const benchmark = attestation.benchmarkQueries.find(
      (query) => query.role === journey.productRole,
    );
    if (benchmark === undefined) {
      throw new BrowserLabPlanError(
        `The deployed artifact does not attest a ${journey.productRole} benchmark query.`,
      );
    }
    const context = journey.actions[0];
    if (
      context.exporterQuery !== benchmark.exporterCode ||
      context.productQuery !== benchmark.productCode
    ) {
      throw new BrowserLabPlanError(
        `The ${journey.productRole} journey does not match the deployed artifact benchmark query.`,
      );
    }
  }
}

async function runJourney(
  driver: BrowserLabDriver,
  plan: BrowserLabPlan,
  journey: BrowserLabJourney,
): Promise<BrowserLabProductReport> {
  const trials: BrowserLabTrialOutcome[] = [];
  for (let trialIndex = 0; trialIndex < journey.trialCount; trialIndex += 1) {
    // Every trial navigates fresh and is preserved in order; a failed trial
    // is never retried or dropped.
    const trial = await runBrowserLabTrial(
      driver,
      plan.measurementClass,
      plan.origin,
      journey,
      trialIndex,
    );
    trials.push(trial);
  }
  return {
    productRole: journey.productRole,
    trials,
    measuredTrialCount: trials.filter((trial) => trial.status === "measured")
      .length,
    failedTrialCount: trials.filter((trial) => trial.status === "failed")
      .length,
  };
}

async function runLaunchMatrix(
  driver: BrowserLabDriver,
  plan: BrowserLabPlan,
): Promise<BrowserLabLaunchMatrixReport> {
  const journey = plan.journeys.find(
    (candidate) => candidate.productRole === plan.launchMatrix.productRole,
  );
  if (journey === undefined) {
    throw new BrowserLabPlanError(
      "Browser launch matrix does not reference a declared journey.",
    );
  }
  const trials: BrowserLabLaunchMatrixTrial[] = [];
  for (const locale of plan.launchMatrix.locales) {
    for (const viewport of plan.launchMatrix.viewports) {
      const outcome = await runBrowserLabTrial(
        driver,
        plan.measurementClass,
        plan.origin,
        journey,
        trials.length,
        {
          locale,
          profile: launchMatrixProfile(viewport),
        },
      );
      trials.push({ locale, viewport, outcome });
    }
  }
  return {
    productRole: journey.productRole,
    trials,
    measuredTrialCount: trials.filter(
      (trial) => trial.outcome.status === "measured",
    ).length,
    failedTrialCount: trials.filter(
      (trial) => trial.outcome.status === "failed",
    ).length,
  };
}

function candidateMarketEntryUrl(
  origin: string,
  locale: BrowserLaunchMatrixLocale | undefined,
): string {
  const url = new URL(origin);
  url.searchParams.set("recipe", "candidate-market-v1");
  if (locale !== undefined && locale !== "en") {
    url.searchParams.set("locale", locale);
  }
  return url.href;
}

function launchMatrixProfile(
  viewport: BrowserLaunchMatrixViewport,
): MobileLabProfile {
  const isMobile = viewport.width <= 390;
  return {
    ...MOBILE_LAB_PROFILE,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    deviceScaleFactor: isMobile ? 3 : 1,
    isMobile,
    hasTouch: isMobile,
    userAgent: isMobile
      ? MOBILE_LAB_PROFILE.userAgent
      : "Mozilla/5.0 (X11; Linux x86_64; HSTracker Browser Lab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
}

// ---------------------------------------------------------------------------
// Real Chromium/CDP driver. Not exercised by unit tests; the orchestration
// above is what is covered by injected fake drivers.
// ---------------------------------------------------------------------------

const CANDIDATE_MARKET_RESPONSE_PATTERN =
  /\/api\/v1\/analyses\/[^/?#]+\/candidate-markets(?:[/?#]|$)/u;
const CLIENT_LOCAL_NETWORK_QUIET_WINDOW_MS = 500;

type TrackedRequest = {
  readonly url: string;
  readonly resourceType: string;
  readonly wallTimeMs: number;
  readonly timestamp: number;
};

type CompletedFirstPartyResource = {
  readonly encodedBytes: number;
  readonly finishedWallClockMs: number;
};

type LabInstrumentationBuffer = {
  lcpMs: number | null;
  lcpWallClockMs: number | null;
  layoutShiftScore: number;
  longTaskEntries: Array<{
    readonly startTime: number;
    readonly duration: number;
  }>;
  eventTimingEntries: Array<{
    readonly startTime: number;
    readonly duration: number;
  }>;
  observers: PerformanceObserver[];
  observerErrors: string[];
};

declare global {
  interface Window {
    __hsTrackerBrowserLab?: LabInstrumentationBuffer;
  }
}

/**
 * Installed via page.addInitScript so it runs before any first-party script,
 * satisfying "install PerformanceObserver instrumentation before
 * navigation". Deliberately does not read/report a page-level INP metric;
 * per-interaction next-paint durations are read from Event Timing entries.
 */
function installLabInstrumentation(): void {
  const buffer: LabInstrumentationBuffer = {
    lcpMs: null,
    lcpWallClockMs: null,
    layoutShiftScore: 0,
    longTaskEntries: [],
    eventTimingEntries: [],
    observers: [],
    observerErrors: [],
  };
  window.__hsTrackerBrowserLab = buffer;

  const observerDefinitions: ReadonlyArray<
    readonly [
      type: string,
      handler: (entries: readonly PerformanceEntry[]) => void,
    ]
  > = [
    [
      "largest-contentful-paint",
      (entries) => {
        for (const entry of entries) {
          buffer.lcpMs = entry.startTime;
          buffer.lcpWallClockMs =
            Date.now() - (performance.now() - entry.startTime);
        }
      },
    ],
    [
      "layout-shift",
      (entries) => {
        for (const entry of entries) {
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!layoutShift.hadRecentInput) {
            buffer.layoutShiftScore += layoutShift.value;
          }
        }
      },
    ],
    [
      "longtask",
      (entries) => {
        for (const entry of entries) {
          buffer.longTaskEntries.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      },
    ],
    [
      "event",
      (entries) => {
        for (const entry of entries) {
          buffer.eventTimingEntries.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      },
    ],
  ];

  for (const [type, handler] of observerDefinitions) {
    try {
      const options: PerformanceObserverInit & {
        durationThreshold?: number;
      } = {
        type,
        buffered: true,
      };
      if (type === "event") {
        options.durationThreshold = 0;
      }
      const observer = new PerformanceObserver((list) =>
        handler(list.getEntries()),
      );
      observer.observe(options);
      buffer.observers.push(observer);
    } catch (error) {
      buffer.observerErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function createBrowserLabInstrumentationScript(): string {
  return `((__name) => { (${installLabInstrumentation.toString()})(); })((target) => target);`;
}

export function resolveLongestScriptedTaskMs(
  entries: ReadonlyArray<{
    readonly startTime: number;
    readonly duration: number;
  }>,
  scriptedInteractionStartMs: number,
): number {
  return entries
    .filter((entry) => entry.startTime >= scriptedInteractionStartMs)
    .reduce(
      (longestTaskMs, entry) => Math.max(longestTaskMs, entry.duration),
      0,
    );
}

export function createPlaywrightBrowserLabDriver(
  profile: MobileLabProfile = MOBILE_LAB_PROFILE,
): BrowserLabDriver {
  let browserPromise: Promise<import("@playwright/test").Browser> | null =
    null;

  const openBrowser = async (): Promise<import("@playwright/test").Browser> => {
    if (browserPromise === null) {
      const { chromium } = await import("@playwright/test");
      browserPromise = chromium.launch({ headless: true });
    }
    return browserPromise;
  };

  return {
    async openTrialSession(
      _measurementClass,
      trialProfile = profile,
    ): Promise<BrowserLabTrialSession> {
      const browser = await openBrowser();
      const context = await browser.newContext({
        viewport: {
          width: trialProfile.viewportWidth,
          height: trialProfile.viewportHeight,
        },
        extraHTTPHeaders: {
          "Cache-Control": "no-cache",
          "X-HS-Tracker-Probe": "external-v1",
        },
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      return new PlaywrightBrowserLabSession(
        context,
        page,
        cdp,
        trialProfile,
      );
    },
    async dispose(): Promise<void> {
      if (browserPromise !== null) {
        const browser = await browserPromise;
        await browser.close();
        browserPromise = null;
      }
    },
  };
}

class PlaywrightBrowserLabSession implements BrowserLabTrialSession {
  private readonly requests = new Map<string, TrackedRequest>();
  private readonly completedFirstPartyResources: CompletedFirstPartyResource[] =
    [];
  private readonly pendingNetworkRecords = new Set<Promise<void>>();
  private networkRecordError: unknown = null;
  private totalFirstPartyEncodedBytes = 0;
  private firstPartyJavaScriptEncodedBytes = 0;
  private candidateResponseBytes: BrowserLabCandidateResponseBytes | null =
    null;
  private pendingInteractionRequestUrls: string[] | null = null;
  private pageOrigin = "";
  private scriptedInteractionStartMs: number | null = null;

  constructor(
    private readonly context: import("@playwright/test").BrowserContext,
    private readonly page: import("@playwright/test").Page,
    private readonly cdp: import("@playwright/test").CDPSession,
    private readonly profile: MobileLabProfile,
  ) {
    this.cdp.on("Network.requestWillBeSent", (event) => {
      this.requests.set(event.requestId, {
        url: event.request.url,
        resourceType: event.type ?? "Other",
        wallTimeMs: event.wallTime * 1_000,
        timestamp: event.timestamp,
      });
      if (this.pendingInteractionRequestUrls !== null) {
        this.pendingInteractionRequestUrls.push(event.request.url);
      }
    });
    this.cdp.on("Network.loadingFinished", (event) => {
      const pending = this.recordLoadingFinished(
        event.requestId,
        event.timestamp,
        event.encodedDataLength,
      ).catch((error: unknown) => {
        this.networkRecordError ??= error;
      });
      this.pendingNetworkRecords.add(pending);
      void pending.then(() => {
        this.pendingNetworkRecords.delete(pending);
      });
    });
    this.cdp.on("Network.loadingFailed", (event) => {
      const tracked = this.requests.get(event.requestId);
      this.requests.delete(event.requestId);
      if (
        tracked !== undefined &&
        this.pageOrigin !== "" &&
        this.isSameOrigin(tracked.url, this.pageOrigin) &&
        !event.canceled
      ) {
        this.networkRecordError ??= new Error(
          `First-party request failed: ${tracked.url}`,
        );
      }
    });
  }

  async navigate(origin: string): Promise<void> {
    this.pageOrigin = origin;
    await this.cdp.send("Network.enable", {});
    await this.cdp.send("Page.enable", {});
    await this.cdp.send("Emulation.setCPUThrottlingRate", {
      rate: this.profile.cpuThrottlingRate,
    });
    await this.cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: this.profile.rttMs,
      downloadThroughput: this.profile.downloadThroughputBytesPerSecond,
      uploadThroughput: this.profile.uploadThroughputBytesPerSecond,
    });
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: this.profile.viewportWidth,
      height: this.profile.viewportHeight,
      deviceScaleFactor: this.profile.deviceScaleFactor,
      mobile: this.profile.isMobile,
    });
    await this.cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: this.profile.hasTouch,
    });
    await this.cdp.send("Emulation.setUserAgentOverride", {
      userAgent: this.profile.userAgent,
    });
    await this.page.addInitScript({
      content: createBrowserLabInstrumentationScript(),
    });
    await this.page.goto(origin, { waitUntil: "load" });
    // Lighthouse owns page-load responsiveness. Start the separately scripted
    // interaction window only after the loaded page has painted and settled.
    this.scriptedInteractionStartMs = await this.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(performance.now())),
          );
        }),
    );
  }

  async selectContext(action: BrowserLabSelectContextAction): Promise<void> {
    const exporterCombobox = this.locatorFor(action.exporterComboboxLocator);
    await exporterCombobox.click();
    await exporterCombobox.fill(action.exporterQuery);
    await this.locatorFor(action.exporterOptionLocator).click();
    const productCombobox = this.locatorFor(action.productComboboxLocator);
    await productCombobox.click();
    await productCombobox.fill(action.productQuery);
    await this.locatorFor(action.productOptionLocator).click();
  }

  async analyze(
    action: BrowserLabAnalyzeAction,
  ): Promise<BrowserLabAnalyzeOutcome> {
    const startedAtMs = await this.page.evaluate(() => performance.now());
    await this.locatorFor(action.analyzeButtonLocator).click();
    await this.locatorFor(action.completeListLocator).waitFor({
      state: "visible",
    });
    const finishedAtMs = await this.page.evaluate(() => performance.now());
    await this.page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});
    await this.flushNetworkRecords();
    return {
      analyzeToCompleteListMs: finishedAtMs - startedAtMs,
      candidateResponseBytes: this.candidateResponseBytes,
    };
  }

  async openMarketAnalysis(
    action: BrowserLabOpenMarketAnalysisAction,
  ): Promise<BrowserLabOpenMarketAnalysisOutcome> {
    const startedAtMs = await this.page.evaluate(() => performance.now());
    const outcome = await this.measureInteraction(async () => {
      await this.locatorFor(action.marketLinkLocator).click();
      await this.locatorFor(action.completeAnalysisLocator).waitFor({
        state: "visible",
      });
    });
    const finishedAtMs = await this.page.evaluate(() => performance.now());
    return {
      ...outcome,
      marketAnalysisToCompleteMs: finishedAtMs - startedAtMs,
    };
  }

  async openScoreDetail(
    action: BrowserLabOpenScoreDetailAction,
  ): Promise<BrowserLabActionOutcome> {
    const openTrigger = this.locatorFor(action.openTriggerLocator);
    await openTrigger.scrollIntoViewIfNeeded();
    return this.measureInteraction(async () => {
      await openTrigger.click();
      await this.locatorFor(action.detailLocator).waitFor({ state: "visible" });
    });
  }

  async closeScoreDetail(
    action: BrowserLabCloseScoreDetailAction,
  ): Promise<BrowserLabActionOutcome> {
    const closeTrigger = this.locatorFor(action.closeTriggerLocator);
    await closeTrigger.scrollIntoViewIfNeeded();
    return this.measureInteraction(async () => {
      await closeTrigger.click();
    });
  }

  async performanceSnapshot(): Promise<BrowserLabPerformanceSnapshot> {
    const snapshot = await this.page.evaluate(() => {
      const buffer = window.__hsTrackerBrowserLab;
      return {
        lcpMs: buffer?.lcpMs ?? null,
        cls: buffer?.layoutShiftScore ?? null,
        longTaskEntries: buffer?.longTaskEntries ?? null,
      };
    });
    return {
      lcpMs: snapshot.lcpMs,
      cls: snapshot.cls,
      longestTaskMs:
        snapshot.longTaskEntries === null ||
        this.scriptedInteractionStartMs === null
          ? null
          : resolveLongestScriptedTaskMs(
              snapshot.longTaskEntries,
              this.scriptedInteractionStartMs,
            ),
    };
  }

  async byteSummary(): Promise<BrowserLabByteSummary> {
    await this.page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});
    await this.flushNetworkRecords();
    const lcpWallClockMs = await this.page.evaluate(() => {
      const buffer = window.__hsTrackerBrowserLab;
      return buffer?.lcpWallClockMs ?? null;
    });
    if (lcpWallClockMs === null) {
      return {
        firstPartyEncodedBytesBeforeLcp: null,
        totalFirstPartyEncodedBytes: this.totalFirstPartyEncodedBytes,
        firstPartyJavaScriptEncodedBytes: this.firstPartyJavaScriptEncodedBytes,
      };
    }
    return {
      firstPartyEncodedBytesBeforeLcp: this.completedFirstPartyResources
        .filter(
          (resource) => resource.finishedWallClockMs <= lcpWallClockMs,
        )
        .reduce((total, resource) => total + resource.encodedBytes, 0),
      totalFirstPartyEncodedBytes: this.totalFirstPartyEncodedBytes,
      firstPartyJavaScriptEncodedBytes: this.firstPartyJavaScriptEncodedBytes,
    };
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  private async measureInteraction(
    perform: () => Promise<void>,
  ): Promise<BrowserLabActionOutcome> {
    this.pendingInteractionRequestUrls = [];
    const startedAtMs = await this.page.evaluate(() => performance.now());
    await perform();
    // Give the browser two frames to flush Event Timing entries for the
    // interaction that just completed.
    const nextPaintAtMs = await this.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(performance.now())),
          );
        }),
    );
    await this.page.waitForTimeout(CLIENT_LOCAL_NETWORK_QUIET_WINDOW_MS);
    const newDurations = await this.page.evaluate((startedAt: number) => {
      const buffer = window.__hsTrackerBrowserLab;
      return buffer === undefined
        ? []
        : buffer.eventTimingEntries
            .filter((entry) => entry.startTime >= startedAt)
            .map((entry) => entry.duration);
    }, startedAtMs);
    const networkRequestUrls = this.pendingInteractionRequestUrls;
    this.pendingInteractionRequestUrls = null;
    // The direct click-to-paint window is a conservative fallback when
    // Chromium omits a fast interaction from the Event Timing buffer.
    return {
      interactionToNextPaintMs: resolveInteractionToNextPaintMs(
        newDurations,
        nextPaintAtMs - startedAtMs,
      ),
      networkRequestUrls,
    };
  }

  private async recordLoadingFinished(
    requestId: string,
    timestamp: number,
    encodedDataLength: number,
  ): Promise<void> {
    const tracked = this.requests.get(requestId);
    if (tracked === undefined || this.pageOrigin === "") {
      this.requests.delete(requestId);
      return;
    }
    const isFirstParty = this.isSameOrigin(tracked.url, this.pageOrigin);
    if (isFirstParty) {
      this.totalFirstPartyEncodedBytes += encodedDataLength;
      const finishedWallClockMs =
        tracked.wallTimeMs + (timestamp - tracked.timestamp) * 1_000;
      this.completedFirstPartyResources.push({
        encodedBytes: encodedDataLength,
        finishedWallClockMs,
      });
      if (tracked.resourceType === "Script") {
        this.firstPartyJavaScriptEncodedBytes += encodedDataLength;
      }
    }
    if (
      this.candidateResponseBytes === null &&
      CANDIDATE_MARKET_RESPONSE_PATTERN.test(tracked.url)
    ) {
      try {
        const body = await this.cdp.send("Network.getResponseBody", {
          requestId,
        });
        const decodedBytes = body.base64Encoded
          ? Buffer.from(body.body, "base64").length
          : Buffer.byteLength(body.body, "utf8");
        this.candidateResponseBytes = {
          encodedBytes: encodedDataLength,
          decodedBytes,
        };
      } catch {
        // The response body was evicted before it could be read; leave
        // candidateResponseBytes unset so the trial fails closed instead of
        // inventing a value.
      }
    }
    this.requests.delete(requestId);
  }

  private async flushNetworkRecords(): Promise<void> {
    while (this.pendingNetworkRecords.size > 0) {
      await Promise.all([...this.pendingNetworkRecords]);
    }
    if (this.networkRecordError !== null) {
      const detail =
        this.networkRecordError instanceof Error
          ? `: ${this.networkRecordError.message}`
          : "";
      throw new BrowserLabExecutionError(
        `Browser-lab network measurement failed${detail}.`,
      );
    }
  }

  private isSameOrigin(url: string, origin: string): boolean {
    try {
      return new URL(url).origin === new URL(origin).origin;
    } catch {
      return false;
    }
  }

  private locatorFor(
    locator: BrowserLabLocator,
  ): import("@playwright/test").Locator {
    switch (locator.by) {
      case "role":
        return this.page.getByRole(locator.role, { name: locator.name });
      case "text":
        return this.page.getByText(locator.text, { exact: locator.exact });
      case "testId":
        return this.page.getByTestId(locator.testId);
      case "css":
        return this.page.locator(locator.selector);
      default:
        throw new BrowserLabExecutionError(
          "Browser-lab locator must select by role, text, testId, or css.",
        );
    }
  }
}
