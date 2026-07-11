export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: "acceptance-fixtures-v1",
  fixtureContentSha256:
    "8793fbdc6eb4216f748947c52e2c4d8ea67da660b70fd6368f7c5d9bde89ef2e",
  fixtureOnly: true,
  scoreVersion: "cms-v1",
  exportSchemaVersion: "candidate-markets-csv-v1",
  artifactSchemaVersion: "candidate-market-artifact-v1",
  analysisResultSchemaVersion: "candidate-market-result-v1",
  productSearchSchemaVersion: "product-search-result-v1",
  sourceStatusSchemaVersion: "source-status-v1",
  release: {
    baciRelease: "V202601",
    sourceUpdateDate: "2026-01-22",
    hsRevision: "HS12",
    ingestedYears: { start: 2012, end: 2024 },
    finalizedCutoffYear: 2023,
    primaryWindow: { start: 2019, end: 2023 },
    shortWindow: { start: 2021, end: 2023 },
    longWindow: { start: 2014, end: 2023 },
    provisionalYear: 2024,
  },
  contentDigestAlgorithm:
    "sha256 of UTF-8 path:sha256-newline entries in contentFiles order",
  contentFiles: [
    {
      path: "evidence/core-current.ts",
      sha256:
        "2747e8c92a1250462598cb206511b336a800f00719703a49281e2643390a3732",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "fcdc50a5d660f4316ea88ba581ce7940d2cb15630a97067c618b01fe46b5c910",
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
    "quantity-zero-mutation",
    "provisional-mutation",
  ],
} as const;
