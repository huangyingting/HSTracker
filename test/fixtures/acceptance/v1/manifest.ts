import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  fixtureContentSha256:
    "988a6d35e300c5f12f900eaf9bbb43004edb2e60c1d5334afa25c22162c40176",
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
      path: "catalog/cap-codes.ts",
      sha256:
        "3d49036c5c44248b5871a166b0d7c246b679fde3327e6ba664bdf47187ea070b",
    },
    {
      path: "catalog/products.ts",
      sha256:
        "bae0d86fa9d2ac4693766ad42d06ef826f5d96cd2d74cc031910d3af77259fe8",
    },
    {
      path: "catalog/translations.ts",
      sha256:
        "37ed1f5e8cd037e8f6b34027a4b2acec53d40ec840042f33ba981c547a8d2ad9",
    },
    {
      path: "catalog/aliases.ts",
      sha256:
        "6022c4d1ccc2977ce2a875ac52744487ec150d6117429d5539aafa26602fb428",
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
        "69dd32e2944ba44784c9f8eff3035a2fec2783bd7af0be8bee6dd2a1e9e74767",
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
        "69dd32e2944ba44784c9f8eff3035a2fec2783bd7af0be8bee6dd2a1e9e74767",
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
