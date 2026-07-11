export const ACCEPTANCE_FIXTURE_SCHEMA_VERSION = "acceptance-fixtures-v1";

export const ACCEPTANCE_FIXTURE_BUILD_IDS = {
  core: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  discontinuity: "acceptance-fixtures-v1-discontinuity",
  quantityZero: "acceptance-fixtures-v1-quantity-zero",
  provisionalMutation: "acceptance-fixtures-v1-provisional-mutation",
} as const;

export const FIXTURE_ADAPTER_TEST_BUILD_IDS = {
  failing: "failing-fixture-build",
  unavailable: "unavailable-fixture-build",
} as const;

export const ACCEPTANCE_FIXTURE_RELEASE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12",
  ingestedYears: { start: 2012, end: 2024 },
  finalizedCutoffYear: 2023,
  provisionalYear: 2024,
} as const;

export const ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256 =
  "3b1ff899c301d11a2bb5c29e3040e9261a68633b54a7d94f4b15338129d4fcff";

export const ACCEPTANCE_FIXTURE_ARTIFACT = {
  schemaVersion: "candidate-market-artifact-v1",
  sha256:
    "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
} as const;
