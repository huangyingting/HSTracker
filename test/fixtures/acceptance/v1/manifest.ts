import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_FIXTURE_RELEASE,
} from "./metadata";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  fixtureContentSha256:
    "070942431df4d4619a56137ac5b092a2d3da74d3697f3d05080d06cf7b59dfb4",
  fixtureOnly: true,
  scoreVersion: "cms-v1",
  exportSchemaVersion: "candidate-markets-csv-v1",
  artifactSchemaVersion: ACCEPTANCE_FIXTURE_ARTIFACT.schemaVersion,
  analysisResultSchemaVersion: "candidate-market-result-v1",
  productSearchSchemaVersion: "product-search-result-v1",
  sourceStatusSchemaVersion: "source-status-v1",
  release: {
    ...ACCEPTANCE_FIXTURE_RELEASE,
    primaryWindow: { start: 2019, end: 2023 },
    shortWindow: { start: 2021, end: 2023 },
    longWindow: { start: 2014, end: 2023 },
  },
  contentDigestAlgorithm:
    "sha256 of UTF-8 path:sha256-newline entries in contentFiles order",
  contentFiles: [
    {
      path: "metadata.ts",
      sha256:
        "1b337b04e73b06bd8141d2c9197238d79183c346acf6a99b7b384a0488f88c07",
    },
    {
      path: "evidence/core-current.ts",
      sha256:
        "62d6755c7908d89a2f88b8768cc1611c24d40cc4800a4f224413edd079fc8329",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "93c79af255f2d4244925c5c49decd5ddd8f67dfcc8f64d4ae97a749d4baf32f8",
    },
    {
      path: "expected/core-analysis.ts",
      sha256:
        "0dd37e9b16a599c5d5fa452dfa65b33420621164d2b3a657a4937d86895251b8",
    },
    {
      path: "expected/error-cases.ts",
      sha256:
        "52ea70d91495578eb4470ff545a460c86a2729d3a1f67d96f700b7f7195c0907",
    },
  ],
  expectedFiles: [
    {
      path: "expected/core-analysis.ts",
      sha256:
        "0dd37e9b16a599c5d5fa452dfa65b33420621164d2b3a657a4937d86895251b8",
    },
    {
      path: "expected/error-cases.ts",
      sha256:
        "52ea70d91495578eb4470ff545a460c86a2729d3a1f67d96f700b7f7195c0907",
    },
  ],
  fixtureIds: [
    "core-current",
    "empty",
    "discontinuity",
    "component-pool-one",
    "component-all-equal",
    "component-half-display",
    "growth-both-neutral-reasons",
    "diversity-zero",
    "diversity-neutral",
    "extreme-growth",
    "dominant-size",
    "stability-low",
    "stability-threshold",
    "stability-small",
    "one-candidate",
    "no-exporter-history",
    "confidence-floor",
    "invalid-world-zero",
    "invalid-recorded-bilateral-zero",
    "quantity-zero-mutation",
    "provisional-mutation",
  ],
} as const;
