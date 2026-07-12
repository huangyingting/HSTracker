import {
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
  ACCEPTANCE_FIXTURE_SCHEMA_VERSION,
} from "./metadata";
import { ACCEPTANCE_FIXTURE_CONTENT_SHA256 } from "../../../../src/promotion/acceptance-fixture";

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
        "fb689a9eebe52305cc680f484447c2fb23260d956c5be15ed96ab137e6ad9145",
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
      path: "evidence/alternative-suppliers.ts",
      sha256:
        "01a871ff2cbfa0c3f10c96f9d1fe69808992ba9c62c0d53608b3f6875426c0b8",
    },
    {
      path: "evidence/core-current.ts",
      sha256:
        "1058fd187e4b86c60764fc3c971646ca556be4a395a81b8af6e461d7899ac444",
    },
    {
      path: "evidence/microfixtures.ts",
      sha256:
        "677d348e4008c4cab5bf98ac407c7966f22a0e04fdc3b680620372a892fce3ba",
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
        "64cb9c701183e67b106fac8839de997e88c38954b007476c4ab542a8e1d4c559",
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
        "64cb9c701183e67b106fac8839de997e88c38954b007476c4ab542a8e1d4c559",
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
