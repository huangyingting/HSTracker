import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../../src/promotion/acceptance-fixture";

export const ACCEPTANCE_FIXTURES_V1_MANIFEST = {
  fixtureSchemaVersion: ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
  fixtureContentSha256: ACCEPTANCE_FIXTURE_CONTENT_SHA256,
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
        "51246a3705c0aca66cd0f2d9e3b86822c7def04d1212695a0ec2d36d00ce3265",
    },
    {
      path: "catalog/cap-codes.ts",
      sha256:
        "3d49036c5c44248b5871a166b0d7c246b679fde3327e6ba664bdf47187ea070b",
    },
    {
      path: "catalog/products.ts",
      sha256:
        "d90745560bcc0132facc16bf24c4c87f8c37af157386e2f61bca4a82efdb4ac8",
    },
    {
      path: "catalog/translations.ts",
      sha256:
        "834c38b9ed4a9551948a41a229e6326babbc6ff106e77ea73e9bd1e07f3bcd6c",
    },
    {
      path: "catalog/aliases.ts",
      sha256:
        "66ee705b6821a8bce2e7d805a920beaac5d831fd3923a0adb2eb181361fe52e2",
    },
    {
      path: "catalog/traditional-to-simplified.ts",
      sha256:
        "fb689a9eebe52305cc680f484447c2fb23260d956c5be15ed96ab137e6ad9145",
    },
    {
      path: "economies/core.ts",
      sha256:
        "fe93eeaff38273e46008c4ae74468ef4ee414cf73b07179821f7b0e16d56aac9",
    },
    {
      path: "economies/cap.ts",
      sha256:
        "58f4e59e2739148cd98bcf2e4f2ae957231343fb5342c6c1ecbfbc052fd51a3f",
    },
    {
      path: "evidence/alternative-suppliers.ts",
      sha256:
        "7da437484b1fdafc941e8538dcebc4da9757a965f1ddef60a23409dc2ebdaf39",
    },
    {
      path: "evidence/core-current.ts",
      sha256:
        "b4f32139533791cd12a13feb1a9ee92a171dbb372d75a8f97c6d7503993edd04",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "cdad126053c27168891691ac166cd0a1413b868b9abb044f5bf3067825d6a71d",
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
        "abc667eb6a74124ca0be38943cc2c27e2d8969c25c773f286ef5b7811a7df618",
    },
    {
      path: "expected/candidate-markets-core.csv",
      sha256:
        "309c135c17e8d1d8bd4956fbdf773d4ec62833ce859843f992f820c6d6405db7",
    },
    {
      path: "expected/candidate-markets-empty.csv",
      sha256:
        "e7db5732abc1d940610e6ccc89386388438c3ac4e2935a20926aa45d0ce85372",
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
        "abc667eb6a74124ca0be38943cc2c27e2d8969c25c773f286ef5b7811a7df618",
    },
    {
      path: "expected/candidate-markets-core.csv",
      sha256:
        "309c135c17e8d1d8bd4956fbdf773d4ec62833ce859843f992f820c6d6405db7",
    },
    {
      path: "expected/candidate-markets-empty.csv",
      sha256:
        "e7db5732abc1d940610e6ccc89386388438c3ac4e2935a20926aa45d0ce85372",
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
