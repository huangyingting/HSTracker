import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  fixtureContentSha256:
    "0cf89e792ee1dedbd564c25655eeb01497e2ad1be120712981e66adb8bd0cb5a",
  fixtureOnly: true,
  scoreVersion: "cms-v1",
  exportSchemaVersion: "candidate-markets-csv-v1",
  artifactSchemaVersion: ACCEPTANCE_FIXTURE_ARTIFACT.schemaVersion,
  analysisResultSchemaVersion: "candidate-market-result-v1",
  productSearchSchemaVersion: "product-search-result-v1",
  economySearchSchemaVersion: "economy-search-result-v1",
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
        "e7ae62a03074feb078852479dc45d60661bc67a458a6947f372aa194b30c042e",
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
      path: "economies/core.ts",
      sha256:
        "c654ac879b893c0dec7a1a16e35cc17dc9fea69c6469d2c0b19be1e39c67295d",
    },
    {
      path: "economies/cap.ts",
      sha256:
        "e984eb890b4401c7b2ab5c99fce5c6860b5d1037f26c8837f3d198489d8c10e8",
    },
    {
      path: "evidence/core-current.ts",
      sha256:
        "fce217a6e684161e1630f366bc9f069f2cb29785b305594bc6df9aae04df62e7",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "b5395f8f5a548747079d51471d16fd2323e65ae3338aa4ca584f02acd529dd64",
    },
    {
      path: "expected/core-analysis.ts",
      sha256:
        "0dd37e9b16a599c5d5fa452dfa65b33420621164d2b3a657a4937d86895251b8",
    },
    {
      path: "expected/error-cases.ts",
      sha256:
        "5b7bf98426aea3065ccd2f5e84a93b604a6972b1e60c041599d073069d1eda03",
    },
    {
      path: "expected/product-search-cases.ts",
      sha256:
        "0eadb2418242cc664d2f4eb75dff5a7ddb9736b72a27fabb8135b108d21113e3",
    },
    {
      path: "expected/candidate-markets-core.csv",
      sha256:
        "128c0696b800ed2cb685cb4d0a8a29df9a4441a5db029380e36a4d9276c309b3",
    },
    {
      path: "expected/candidate-markets-empty.csv",
      sha256:
        "3e82127c219a6b8af7b0f91ad23de90dd25c03e5fa297f2698dc00a46ee8d5af",
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
        "5b7bf98426aea3065ccd2f5e84a93b604a6972b1e60c041599d073069d1eda03",
    },
    {
      path: "expected/product-search-cases.ts",
      sha256:
        "0eadb2418242cc664d2f4eb75dff5a7ddb9736b72a27fabb8135b108d21113e3",
    },
    {
      path: "expected/candidate-markets-core.csv",
      sha256:
        "128c0696b800ed2cb685cb4d0a8a29df9a4441a5db029380e36a4d9276c309b3",
    },
    {
      path: "expected/candidate-markets-empty.csv",
      sha256:
        "3e82127c219a6b8af7b0f91ad23de90dd25c03e5fa297f2698dc00a46ee8d5af",
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
    "economy-directory-core",
    "economy-directory-cap",
    "candidate-markets-csv-core",
    "candidate-markets-csv-empty",
  ],
} as const;
