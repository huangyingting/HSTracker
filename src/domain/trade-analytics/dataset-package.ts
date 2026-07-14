import { createHash } from "node:crypto";

declare const datasetPackageIdentityBrand: unique symbol;

export type DatasetPackageIdentity =
  `dataset-package-v1-${string}` & {
    readonly [datasetPackageIdentityBrand]: true;
  };

export type DatasetCapabilityDeclaration = Readonly<{
  id: string;
  version: string;
}>;

const CANDIDATE_MARKET_V1_STABILITY_WINDOW_YEARS = 10;

export const CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS = [
  {
    id: "candidate-market/bilateral-annual-value",
    version: "1",
  },
  {
    id: "candidate-market/economy-identity",
    version: "1",
  },
  {
    id: "candidate-market/hs-product-identity",
    version: "1",
  },
  {
    id: "candidate-market/market-annual-value",
    version: "1",
  },
  {
    id: "candidate-market/product-annual-value",
    version: "1",
  },
  {
    id: "candidate-market/quantity-coverage",
    version: "1",
  },
  {
    id: "candidate-market/supplier-structure",
    version: "1",
  },
] as const satisfies readonly DatasetCapabilityDeclaration[];

export const CANDIDATE_MARKET_V1_DATASET_DECLARATION = {
  schemaVersion: "candidate-market-dataset-capabilities-v1",
  finalizedTreatment: "SCORE_INPUT",
  provisionalTreatment: "SUPPORTING_EVIDENCE_ONLY",
  missingObservationTreatment: "PRESERVE_MISSINGNESS",
  capabilities: CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS,
} as const;

export type CandidateMarketDatasetCapabilityDeclaration = Readonly<{
  schemaVersion: "candidate-market-dataset-capabilities-v1";
  finalizedTreatment: string;
  provisionalTreatment: string;
  missingObservationTreatment: string;
  capabilities: readonly DatasetCapabilityDeclaration[];
}>;

export type DatasetSourceReconciliationEvidence = Readonly<{
  kind: "SOURCE_REPORT" | "EMBEDDED_ANNUAL_SOURCE_CHECKS";
  sha256: string;
}>;

type DatasetPackageSource = Readonly<{
  dataset: "CEPII_BACI";
  release: string;
  updateDate: string;
  archive: Readonly<{
    url: string;
    bytes: number;
    sha256: string;
  }>;
}>;

type DatasetPackageCoverage = Readonly<{
  ingestedYears: YearRange;
  finalized: Readonly<{
    years: YearRange;
    cutoffYear: number;
    scoreWindow: YearRange;
    treatment: string;
  }>;
  provisional: Readonly<{
    years: readonly number[];
    treatment: string;
  }>;
}>;

type DatasetPackageEvidenceContent = Readonly<{
  stagingManifestSha256: string;
  coverageApprovalSha256: string;
  sourceReconciliationEvidence: DatasetSourceReconciliationEvidence;
}>;

type DatasetPackageQuality = Readonly<{
  status: "accepted";
  evidence: readonly Readonly<{
    kind:
      | DatasetSourceReconciliationEvidence["kind"]
      | "COVERAGE_APPROVAL";
    sha256: string;
  }>[];
}>;

type DatasetPackageAttribution = Readonly<{
  statement: string;
  license: Readonly<{
    name: string;
    url: string;
  }>;
}>;

type DatasetPackageEvidence<
  Content extends DatasetPackageEvidenceContent =
    DatasetPackageEvidenceContent,
> = Readonly<{
  source: DatasetPackageSource;
  packageSchemaVersion: string;
  hsRevision: string;
  missingObservationTreatment: string;
  coverage: DatasetPackageCoverage;
  capabilities: readonly DatasetCapabilityDeclaration[];
  content: Content;
  quality: DatasetPackageQuality;
  attribution: DatasetPackageAttribution;
}>;

type YearRange = Readonly<{
  start: number;
  end: number;
}>;

type DatasetPackagePhysicalObject<
  Role extends
    | "ANALYSIS_ARTIFACT"
    | "PREVIOUS_ANALYSIS_ARTIFACT",
> = Readonly<{
  role: Role;
  objectId: string;
  relativePath: string;
  schemaVersion: string;
  bytes: number;
  sha256: string;
}>;

export type CandidateMarketComparisonEvidence =
  DatasetPackageEvidence &
    Readonly<{
      physicalObject: DatasetPackagePhysicalObject<"PREVIOUS_ANALYSIS_ARTIFACT">;
    }>;

export type CandidateMarketDatasetPackageManifest =
  DatasetPackageEvidence<
    DatasetPackageEvidenceContent &
      Readonly<{ releaseCatalogSha256: string }>
  > &
    Readonly<{
      schemaVersion: "candidate-market-dataset-package-manifest-v1";
      physicalObjects: readonly DatasetPackagePhysicalObject<"ANALYSIS_ARTIFACT">[];
      comparisonEvidence: CandidateMarketComparisonEvidence | null;
    }>;

export type CandidateMarketDatasetPackage = Readonly<{
  identity: DatasetPackageIdentity;
  manifest: CandidateMarketDatasetPackageManifest;
  serializedManifest: string;
}>;

export type CandidateMarketDatasetPackageCompatibility =
  | Readonly<{ compatible: true }>
  | Readonly<{
      compatible: false;
      reason:
        | "MISSING_REQUIRED_CAPABILITY"
        | "CAPABILITY_VERSION_MISMATCH"
        | "PACKAGE_IDENTITY_MISMATCH";
    }>;

export function createCandidateMarketDatasetPackage(
  value: unknown,
): CandidateMarketDatasetPackage {
  const manifest = parseCandidateMarketDatasetPackageManifest(value);
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const digest = createHash("sha256")
    .update(serializedManifest)
    .digest("hex");
  return {
    identity:
      `dataset-package-v1-${digest}` as DatasetPackageIdentity,
    manifest,
    serializedManifest,
  };
}

export function parseCandidateMarketDatasetCapabilityDeclaration(
  value: unknown,
): CandidateMarketDatasetCapabilityDeclaration {
  const declaration = object(
    value,
    "Dataset Package capability declaration",
  );
  if (
    declaration.schemaVersion !==
    "candidate-market-dataset-capabilities-v1"
  ) {
    throw new TypeError(
      "Dataset Package capability declaration schema is incompatible.",
    );
  }
  return {
    schemaVersion: "candidate-market-dataset-capabilities-v1",
    finalizedTreatment: nonemptyString(
      declaration.finalizedTreatment,
      "finalized treatment",
    ),
    provisionalTreatment: nonemptyString(
      declaration.provisionalTreatment,
      "provisional treatment",
    ),
    missingObservationTreatment: nonemptyString(
      declaration.missingObservationTreatment,
      "missing-observation treatment",
    ),
    capabilities: capabilityDeclarations(declaration.capabilities),
  };
}

export function evaluateCandidateMarketV1DatasetPackage(
  datasetPackage: CandidateMarketDatasetPackage,
): CandidateMarketDatasetPackageCompatibility {
  const manifest = datasetPackage.manifest;
  const currentCompatibility =
    evaluateCandidateMarketEvidence(manifest);
  if (!currentCompatibility.compatible) {
    return currentCompatibility;
  }
  if (manifest.comparisonEvidence !== null) {
    return evaluateCandidateMarketEvidence(
      manifest.comparisonEvidence,
    );
  }
  return { compatible: true };
}

function evaluateCandidateMarketEvidence(
  evidence: DatasetPackageEvidence,
): CandidateMarketDatasetPackageCompatibility {
  if (
    evidence.packageSchemaVersion !==
      "candidate-market-artifact-v1" ||
    evidence.hsRevision !== "HS12" ||
    evidence.coverage.finalized.treatment !== "SCORE_INPUT" ||
    evidence.coverage.provisional.treatment !==
      "SUPPORTING_EVIDENCE_ONLY" ||
    evidence.missingObservationTreatment !==
      "PRESERVE_MISSINGNESS" ||
    evidence.coverage.finalized.scoreWindow.end -
      evidence.coverage.finalized.scoreWindow.start !==
      4 ||
    evidence.coverage.finalized.scoreWindow.start <
      evidence.coverage.finalized.years.start ||
    evidence.coverage.finalized.scoreWindow.end >
      evidence.coverage.finalized.years.end ||
    evidence.coverage.finalized.years.start >
      evidence.coverage.finalized.cutoffYear -
        (CANDIDATE_MARKET_V1_STABILITY_WINDOW_YEARS - 1) ||
    evidence.coverage.finalized.years.end <
      evidence.coverage.finalized.cutoffYear
  ) {
    return {
      compatible: false,
      reason: "PACKAGE_IDENTITY_MISMATCH",
    };
  }
  const declared = new Map(
    evidence.capabilities.map(({ id, version }) => [id, version]),
  );
  for (const requirement of CANDIDATE_MARKET_V1_CAPABILITY_REQUIREMENTS) {
    const version = declared.get(requirement.id);
    if (version === undefined) {
      return {
        compatible: false,
        reason: "MISSING_REQUIRED_CAPABILITY",
      };
    }
    if (version !== requirement.version) {
      return {
        compatible: false,
        reason: "CAPABILITY_VERSION_MISMATCH",
      };
    }
  }
  return { compatible: true };
}

function parseCandidateMarketDatasetPackageManifest(
  value: unknown,
): CandidateMarketDatasetPackageManifest {
  const manifest = object(value, "Dataset Package manifest");
  if (
    manifest.schemaVersion !==
    "candidate-market-dataset-package-manifest-v1"
  ) {
    throw new TypeError("Dataset Package manifest schema is incompatible.");
  }
  const evidence = parseDatasetPackageEvidence(
    manifest,
    "Dataset Package",
  );
  const content = object(manifest.content, "Dataset Package content");
  const physicalObjects = packageObjects(manifest.physicalObjects);
  const comparisonEvidence =
    manifest.comparisonEvidence === null
      ? null
      : parseComparisonEvidence(manifest.comparisonEvidence);

  return {
    schemaVersion: "candidate-market-dataset-package-manifest-v1",
    ...evidence,
    content: {
      releaseCatalogSha256: sha256(
        content.releaseCatalogSha256,
        "release catalog SHA-256",
      ),
      ...evidence.content,
    },
    physicalObjects,
    comparisonEvidence,
  };
}

function parseDatasetPackageEvidence(
  value: unknown,
  label: string,
): DatasetPackageEvidence {
  const evidenceValue = object(value, `${label} evidence`);
  const source = object(evidenceValue.source, `${label} source`);
  if (source.dataset !== "CEPII_BACI") {
    throw new TypeError(`${label} source must be CEPII BACI.`);
  }
  const archive = object(source.archive, `${label} source archive`);
  const coverage = object(evidenceValue.coverage, `${label} coverage`);
  const finalized = object(
    coverage.finalized,
    `${label} finalized coverage`,
  );
  const provisional = object(
    coverage.provisional,
    `${label} provisional coverage`,
  );
  const ingestedYears = yearRange(
    coverage.ingestedYears,
    `${label} ingested years`,
  );
  const finalizedYears = yearRange(
    finalized.years,
    `${label} finalized years`,
  );
  const scoreWindow = yearRange(
    finalized.scoreWindow,
    `${label} score window`,
  );
  const cutoffYear = year(
    finalized.cutoffYear,
    `${label} finalized cutoff year`,
  );
  const provisionalYears = yearArray(
    provisional.years,
    `${label} provisional years`,
  );
  if (
    finalizedYears.end !== cutoffYear ||
    scoreWindow.end !== cutoffYear ||
    scoreWindow.start < finalizedYears.start ||
    scoreWindow.end > finalizedYears.end ||
    ingestedYears.start > finalizedYears.start ||
    ingestedYears.end < provisionalYears.at(-1)! ||
    provisionalYears.some((entry) => entry <= cutoffYear)
  ) {
    throw new TypeError(`${label} year treatment is inconsistent.`);
  }

  const content = object(evidenceValue.content, `${label} content`);
  const quality = object(evidenceValue.quality, `${label} quality`);
  if (quality.status !== "accepted") {
    throw new TypeError(`${label} quality is not accepted.`);
  }
  const evidence = qualityEvidence(quality.evidence);
  const coverageApprovalSha256 = sha256(
    content.coverageApprovalSha256,
    `${label} coverage approval SHA-256`,
  );
  const sourceReconciliation = sourceReconciliationEvidence(
    content.sourceReconciliationEvidence,
  );
  if (
    evidence.find(({ kind }) => kind === "COVERAGE_APPROVAL")?.sha256 !==
      coverageApprovalSha256 ||
    evidence.find(
      ({ kind }) => kind === sourceReconciliation.kind,
    )?.sha256 !== sourceReconciliation.sha256
  ) {
    throw new TypeError(
      `${label} quality evidence does not match its content.`,
    );
  }

  const attribution = object(
    evidenceValue.attribution,
    `${label} attribution`,
  );
  const license = object(
    attribution.license,
    `${label} license`,
  );
  const capabilities = capabilityDeclarations(
    evidenceValue.capabilities,
  );

  return {
    source: {
      dataset: "CEPII_BACI",
      release: nonemptyString(source.release, `${label} source release`),
      updateDate: isoDate(
        source.updateDate,
        `${label} source update date`,
      ),
      archive: {
        url: absoluteUrl(archive.url, `${label} source archive URL`),
        bytes: nonnegativeInteger(
          archive.bytes,
          `${label} source archive bytes`,
        ),
        sha256: sha256(
          archive.sha256,
          `${label} source archive SHA-256`,
        ),
      },
    },
    packageSchemaVersion: nonemptyString(
      evidenceValue.packageSchemaVersion,
      `${label} package schema version`,
    ),
    hsRevision: nonemptyString(
      evidenceValue.hsRevision,
      `${label} HS revision`,
    ),
    missingObservationTreatment: nonemptyString(
      evidenceValue.missingObservationTreatment,
      `${label} missing-observation treatment`,
    ),
    coverage: {
      ingestedYears,
      finalized: {
        years: finalizedYears,
        cutoffYear,
        scoreWindow,
        treatment: nonemptyString(
          finalized.treatment,
          `${label} finalized treatment`,
        ),
      },
      provisional: {
        years: provisionalYears,
        treatment: nonemptyString(
          provisional.treatment,
          `${label} provisional treatment`,
        ),
      },
    },
    capabilities,
    content: {
      stagingManifestSha256: sha256(
        content.stagingManifestSha256,
        `${label} staging manifest SHA-256`,
      ),
      coverageApprovalSha256,
      sourceReconciliationEvidence: sourceReconciliation,
    },
    quality: {
      status: "accepted",
      evidence,
    },
    attribution: {
      statement: nonemptyString(
        attribution.statement,
        `${label} attribution statement`,
      ),
      license: {
        name: nonemptyString(
          license.name,
          `${label} license name`,
        ),
        url: absoluteUrl(license.url, `${label} license URL`),
      },
    },
  };
}

function parseComparisonEvidence(
  value: unknown,
): CandidateMarketComparisonEvidence {
  const comparison = object(
    value,
    "Dataset Package comparison evidence",
  );
  return {
    ...parseDatasetPackageEvidence(
      comparison,
      "Dataset Package comparison",
    ),
    physicalObject: previousPackageObject(
      comparison.physicalObject,
    ),
  };
}

function capabilityDeclarations(
  value: unknown,
): readonly DatasetCapabilityDeclaration[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Dataset Package capabilities must be an array.");
  }
  const capabilities = value.map((entry, index) => {
    const capability = object(entry, `capability ${index}`);
    return {
      id: nonemptyString(capability.id, `capability ${index} ID`),
      version: nonemptyString(
        capability.version,
        `capability ${index} version`,
      ),
    };
  });
  if (
    new Set(capabilities.map(({ id }) => id)).size !== capabilities.length
  ) {
    throw new TypeError("Dataset Package capability IDs must be unique.");
  }
  return capabilities.sort(
    (left, right) =>
      compareText(left.id, right.id) ||
      compareText(left.version, right.version),
  );
}

function qualityEvidence(
  value: unknown,
): CandidateMarketDatasetPackageManifest["quality"]["evidence"] {
  if (!Array.isArray(value)) {
    throw new TypeError("Dataset Package quality evidence must be an array.");
  }
  const evidence: Array<{
    kind:
      | DatasetSourceReconciliationEvidence["kind"]
      | "COVERAGE_APPROVAL";
    sha256: string;
  }> = value.map((entry, index) => {
    const item = object(entry, `quality evidence ${index}`);
    if (
      item.kind !== "SOURCE_REPORT" &&
      item.kind !== "EMBEDDED_ANNUAL_SOURCE_CHECKS" &&
      item.kind !== "COVERAGE_APPROVAL"
    ) {
      throw new TypeError(
        `Dataset Package quality evidence ${index} is unsupported.`,
      );
    }
    return {
      kind: item.kind,
      sha256: sha256(item.sha256, `quality evidence ${index} SHA-256`),
    };
  });
  if (
    evidence.length !== 2 ||
    evidence.filter(({ kind }) => kind === "COVERAGE_APPROVAL")
      .length !== 1 ||
    evidence.filter(({ kind }) => kind !== "COVERAGE_APPROVAL")
      .length !== 1
  ) {
    throw new TypeError(
      "Dataset Package quality evidence must be complete and unique.",
    );
  }

  return evidence.sort((left, right) =>
    compareText(left.kind, right.kind),
  );
}

function sourceReconciliationEvidence(
  value: unknown,
): DatasetSourceReconciliationEvidence {
  const evidence = object(
    value,
    "Dataset Package source reconciliation evidence",
  );
  if (
    evidence.kind !== "SOURCE_REPORT" &&
    evidence.kind !== "EMBEDDED_ANNUAL_SOURCE_CHECKS"
  ) {
    throw new TypeError(
      "Dataset Package source reconciliation evidence kind is unsupported.",
    );
  }
  return {
    kind: evidence.kind,
    sha256: sha256(
      evidence.sha256,
      "source reconciliation evidence SHA-256",
    ),
  };
}

function packageObjects(
  value: unknown,
): readonly DatasetPackagePhysicalObject<"ANALYSIS_ARTIFACT">[] {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new TypeError(
      "Dataset Package must identify exactly one analysis artifact.",
    );
  }
  return value.map((entry) =>
    packageObject(
      entry,
      "Dataset Package analysis artifact",
      "ANALYSIS_ARTIFACT",
    ),
  );
}

function previousPackageObject(
  value: unknown,
): DatasetPackagePhysicalObject<"PREVIOUS_ANALYSIS_ARTIFACT"> {
  return packageObject(
    value,
    "Dataset Package previous analysis artifact",
    "PREVIOUS_ANALYSIS_ARTIFACT",
  );
}

function packageObject<
  Role extends
    | "ANALYSIS_ARTIFACT"
    | "PREVIOUS_ANALYSIS_ARTIFACT",
>(
  value: unknown,
  label: string,
  role: Role,
): DatasetPackagePhysicalObject<Role> {
  const candidate = object(value, label);
  if (candidate.role !== role) {
    throw new TypeError(
      `${label} role is invalid.`,
    );
  }
  return {
    role,
    objectId: nonemptyString(candidate.objectId, `${label} ID`),
    relativePath: nonemptyString(
      candidate.relativePath,
      `${label} path`,
    ),
    schemaVersion: nonemptyString(
      candidate.schemaVersion,
      `${label} schema`,
    ),
    bytes: nonnegativeInteger(candidate.bytes, `${label} bytes`),
    sha256: sha256(candidate.sha256, `${label} SHA-256`),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function yearRange(value: unknown, label: string): YearRange {
  const range = object(value, label);
  const start = year(range.start, `${label} start`);
  const end = year(range.end, `${label} end`);
  if (start > end) {
    throw new TypeError(`${label} start must not exceed its end.`);
  }
  return { start, end };
}

function yearArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty array.`);
  }
  const years = value.map((entry) => year(entry, `${label} entry`));
  if (
    years.some(
      (entry, index) =>
        index > 0 && entry !== years[index - 1]! + 1,
    )
  ) {
    throw new TypeError(`${label} must be contiguous and ordered.`);
  }
  return years;
}

function year(value: unknown, label: string): number {
  const candidate = nonnegativeInteger(value, label);
  if (candidate < 1900 || candidate > 9999) {
    throw new TypeError(`${label} is outside the supported range.`);
  }
  return candidate;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const candidate = nonemptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return candidate;
}

function isoDate(value: unknown, label: string): string {
  const candidate = nonemptyString(value, label);
  const date = new Date(`${candidate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(candidate) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== candidate
  ) {
    throw new TypeError(`${label} must be an ISO date.`);
  }
  return candidate;
}

function absoluteUrl(value: unknown, label: string): string {
  const candidate = nonemptyString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${label} must use HTTP or HTTPS.`);
  }
  return candidate;
}
