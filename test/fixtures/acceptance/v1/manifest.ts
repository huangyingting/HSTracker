import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  fixtureContentSha256:
    "e4747a35ad740eaa5146a23865e0a36bfe63ad16e8e693ffeb6dbfb1edbaa303",
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
        "c7389b8b119535b0fbd023088aaab19fd924692586799ecb6ee081bda6d39f83",
    },
    {
      path: "catalog/products.ts",
      sha256:
        "71e8903002bf177f9dbb524f39f6b933ccd8e662ace032c3d15c87b272705d2c",
    },
    {
      path: "catalog/translations.ts",
      sha256:
        "3e57a9116ffc0eec7a20e15bd5ac46687d5aac5223555052675d53f499e11213",
    },
    {
      path: "catalog/aliases.ts",
      sha256:
        "b4eb2d14791302a778a062ead5979f37675f4b5270c63cd207f73eb25fa91da2",
    },
    {
      path: "catalog/traditional-to-simplified.ts",
      sha256:
        "5572b5c38563901bae7c8c46f258b3f6d85cf41946b66fb4b34cf1664ae9e9bf",
    },
    {
      path: "evidence/core-current.ts",
      sha256:
        "62d6755c7908d89a2f88b8768cc1611c24d40cc4800a4f224413edd079fc8329",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "fa9db984a2b22a08b8c9a0adcce73c190da77513e1c1c3d2947722f9ae7dfab0",
    },
    {
      path: "expected/core-analysis.ts",
      sha256:
        "0dd37e9b16a599c5d5fa452dfa65b33420621164d2b3a657a4937d86895251b8",
    },
    {
      path: "expected/error-cases.ts",
      sha256:
        "08eb7b198e0aed03533ca2d98d4bac6baffbf9ebe86b7a6eb105e8241c3fe901",
    },
    {
      path: "expected/product-search-cases.ts",
      sha256:
        "7575f14e6629399615871788849c568d34d6143a4f4b8a2fd7374c4f0a0750a4",
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
        "08eb7b198e0aed03533ca2d98d4bac6baffbf9ebe86b7a6eb105e8241c3fe901",
    },
    {
      path: "expected/product-search-cases.ts",
      sha256:
        "7575f14e6629399615871788849c568d34d6143a4f4b8a2fd7374c4f0a0750a4",
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
    "invalid-recorded-bilateral-exceeds-world",
    "invalid-provisional-world-zero",
    "invalid-provisional-recorded-bilateral-zero",
    "invalid-provisional-recorded-bilateral-exceeds-world",
    "invalid-alternative-supplier-zero",
    "invalid-quantity-coverage",
    "quantity-zero-mutation",
    "provisional-mutation",
    "product-catalog-core",
    "product-catalog-cap",
    "product-search-golden",
  ],
} as const;
