import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  fixtureContentSha256:
    "c9441e1142bcb8592eb1292b2302983856127068fc59111a8c8065f808d4491a",
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
        "4305ddee39ee06bca4e701c8ec2d06ef31994f941494e53ac1e0d925a5ab75ec",
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
        "f9017cbd4a37a5c09c1e6b3dc5acf41a6c9afd454518f4af4cbb42efc23163a1",
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
        "f9017cbd4a37a5c09c1e6b3dc5acf41a6c9afd454518f4af4cbb42efc23163a1",
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
