import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";

import { compareCodeUnits } from "../../src/catalog/deterministic-order";
import {
  normalizeProductSearchText,
  PRODUCT_SEARCH_ALGORITHM_VERSION,
} from "../../src/catalog/product-search-normalization";
import { missingSourceTechnicalTerms } from "./product-translation-structure";

const execFileAsync = promisify(execFile);
const CATALOG_ARTIFACT_SCHEMA_VERSION = "product-catalog-artifact-v1";
const CATALOG_MANIFEST_SCHEMA_VERSION = "product-catalog-manifest-v1";
const CATALOG_REPORT_SCHEMA_VERSION = "product-catalog-build-report-v1";
const SEARCH_RESPONSE_SCHEMA_VERSION = "product-search-result-v1";
const RESIDENT_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;
const RESIDENT_SIZE_MEASUREMENT = "isolated-v8-heap-used-delta-v1";
const REVIEW_RISK_RULE_VERSION = "hs12-catalog-risk-flags-v1";
const REVIEW_SAMPLE_STRATEGY =
  "first-sorted-distinct-code-per-available-risk-stratum-and-chapter-v1";
const REVIEW_RISK_STRATA = [
  "quantitative",
  "scope-language",
  "nomenclature",
  "baseline",
] as const;
const REQUIRED_AUTOMATIC_CHECKS = [
  "nonempty-zh-hans-v1",
  "source-description-sha256-v1",
  "numeric-and-unit-preservation-v1",
  "formula-and-latin-name-preservation-v1",
  "risk-term-review-v1",
  "chapter-sample-coverage-v1",
] as const;
const MATERIAL_UNIT_SPECS: readonly {
  canonical: string;
  source: RegExp;
  translation: RegExp;
}[] = [
  {
    canonical: "g/m2",
    source: /^\s*(?:g)?\/m2\b/iu,
    translation: /^\s*(?:g\/m2|克\/平方米|公克\/平方公尺)/iu,
  },
  {
    canonical: "g/cm3",
    source: /^\s*g\/cm3\b/iu,
    translation: /^\s*(?:g\/cm3|克\/立方厘米|公克\/立方公分)/iu,
  },
  {
    canonical: "%",
    source: /^\s*%/u,
    translation: /^\s*%/u,
  },
  {
    canonical: "kg",
    source: /^\s*kg\b/iu,
    translation: /^\s*(?:kg\b|千克|公斤)/iu,
  },
  {
    canonical: "mm",
    source: /^\s*mm\b/iu,
    translation: /^\s*(?:mm\b|毫米|公厘)/iu,
  },
  {
    canonical: "cm2",
    source: /^\s*cm2\b/iu,
    translation: /^\s*(?:cm2\b|平方厘米|平方公分)/iu,
  },
  {
    canonical: "cm3",
    source: /^\s*cm3\b/iu,
    translation: /^\s*(?:cm3\b|立方厘米|立方公分)/iu,
  },
  {
    canonical: "cm",
    source: /^\s*cm\b/iu,
    translation: /^\s*(?:cm\b|厘米|公分)/iu,
  },
  {
    canonical: "m2",
    source: /^\s*m2\b/iu,
    translation: /^\s*(?:m2\b|平方米|平方公尺)/iu,
  },
  {
    canonical: "MPa",
    source: /^\s*mpa\b/iu,
    translation: /^\s*(?:mpa\b|兆帕)/iu,
  },
  {
    canonical: "MW",
    source: /^\s*mw\b/iu,
    translation: /^\s*(?:mw\b|兆瓦)/iu,
  },
  {
    canonical: "kVA",
    source: /^\s*kva\b/iu,
    translation: /^\s*(?:kva\b|千伏安)/iu,
  },
  {
    canonical: "kvar",
    source: /^\s*kvar\b/iu,
    translation: /^\s*(?:kvar\b|千乏)/iu,
  },
  {
    canonical: "kW",
    source: /^\s*kw\b/iu,
    translation: /^\s*(?:kw\b|千瓦)/iu,
  },
  {
    canonical: "kV",
    source: /^\s*kv\b/iu,
    translation: /^\s*(?:kv\b|千伏)/iu,
  },
  {
    canonical: "kN",
    source: /^\s*kn\b/iu,
    translation: /^\s*(?:kn\b|千牛)/iu,
  },
  {
    canonical: "W",
    source: /^\s*w\b/iu,
    translation: /^\s*(?:w\b|瓦)/iu,
  },
  {
    canonical: "V",
    source: /^\s*volts?\b/iu,
    translation: /^\s*(?:v\b|伏特|伏)/iu,
  },
  {
    canonical: "Hz",
    source: /^\s*hz\b/iu,
    translation: /^\s*(?:hz\b|赫兹)/iu,
  },
  {
    canonical: "cc",
    source: /^\s*cc\b/iu,
    translation: /^\s*(?:cc\b|立方厘米|立方公分)/iu,
  },
  {
    canonical: "litre",
    source: /^\s*(?:l\b|litres?\b|liters?\b)/iu,
    translation: /^\s*(?:l\b|升|公升)/iu,
  },
  {
    canonical: "tonne",
    source: /^\s*(?:t\b|tonnes?\b|tons?\b)/iu,
    translation: /^\s*(?:t\b|吨|公吨)/iu,
  },
  {
    canonical: "decitex",
    source: /^\s*decitex\b/iu,
    translation: /^\s*(?:decitex\b|分特|分德士)/iu,
  },
  {
    canonical: "tex",
    source: /^\s*tex\b/iu,
    translation: /^\s*(?:tex\b|特|德士)/iu,
  },
  {
    canonical: "turns",
    source: /^\s*turns?\b/iu,
    translation: /^\s*(?:turns?\b|转|捻)/iu,
  },
  {
    canonical: "degree",
    source: /^\s*degrees?\b/iu,
    translation: /^\s*(?:degrees?\b|度)/iu,
  },
  {
    canonical: "m",
    source: /^\s*m\b/iu,
    translation: /^\s*(?:m\b|米|公尺)/iu,
  },
  {
    canonical: "cg",
    source: /^\s*cg\b/iu,
    translation: /^\s*(?:cg\b|厘克)/iu,
  },
  {
    canonical: "g",
    source: /^\s*g\b/iu,
    translation: /^\s*(?:g\b|克|公克)/iu,
  },
];

type StagingManifest = {
  baciRelease: string;
  sourceSha256: string;
  hsRevision: "HS12";
  dimensionFiles: {
    products: {
      relativePath: string;
      rowCount: number;
      bytes: number;
      sha256: string;
    };
  };
};

type SourceProduct = {
  code: string;
  sourceDescriptionEn: string;
};

type TranslationRow = {
  code: string;
  description: string;
  translationStatus: "machine-assisted" | "reviewed";
  sourceDescriptionSha256: string;
};

type TranslationCatalog = {
  translationVersion: string;
  attribution: string;
  rows: TranslationRow[];
};

type AliasRow = {
  code: string;
  locale: "en" | "zh-Hans";
  alias: string;
  normalizedSearchText: string;
  aliasKind: string;
  reviewStatus: "reviewed";
  reviewer: string;
};

type AliasCatalog = {
  aliasVersion: string;
  rows: AliasRow[];
};

type ConversionCatalog = {
  dataVersion: string;
  source: { name: string; url: string; license: string };
  mappings: Record<string, string>;
};

type ReviewManifest = {
  glossaryVersion: string;
  automaticChecks: string[];
  methodology: {
    riskRuleVersion: typeof REVIEW_RISK_RULE_VERSION;
    sampleStrategy: typeof REVIEW_SAMPLE_STRATEGY;
    representedChapters: string[];
  };
  identities: {
    sourceProductsSha256: string;
    translationsSha256: string;
    aliasesSha256: string;
    traditionalToSimplifiedSha256: string;
  };
  flaggedCodes: string[];
  reviewedCodes: string[];
  chapterSamples: {
    chapter: string;
    risk: (typeof REVIEW_RISK_STRATA)[number];
    codes: string[];
  }[];
  reviewer: string;
  reviewedAt: string;
  disposition: "accepted";
};

type ProductCatalogArtifact = {
  schemaVersion: typeof CATALOG_ARTIFACT_SCHEMA_VERSION;
  productSearchBuildId: string;
  baciRelease: string;
  hsRevision: "HS12";
  searchAlgorithmVersion: typeof PRODUCT_SEARCH_ALGORITHM_VERSION;
  searchResponseSchemaVersion: typeof SEARCH_RESPONSE_SCHEMA_VERSION;
  translationVersion: string;
  translationAttribution: string;
  aliasVersion: string;
  traditionalToSimplifiedVersion: string;
  products: {
    hsRevision: "HS12";
    code: string;
    sourceDescriptionEn: string;
    sourceDescriptionSha256: string;
    auxiliaryDescriptionZhHans: string;
    normalizedSourceDescriptionEn: string;
    normalizedAuxiliaryDescriptionZhHans: string;
    translationStatus: TranslationRow["translationStatus"];
    translationVersion: string;
  }[];
  aliases: {
    hsRevision: "HS12";
    code: string;
    locale: AliasRow["locale"];
    alias: string;
    normalizedSearchText: string;
    reviewStatus: "reviewed";
  }[];
  traditionalToSimplified: Record<string, string>;
};

export type BuildProductCatalogOptions = {
  stagingManifestPath: string;
  translationsPath: string;
  aliasesPath: string;
  traditionalToSimplifiedPath: string;
  reviewManifestPath: string;
  workspacePath: string;
  reportPath: string;
  pipelineGitSha: string;
  builtAt: string;
};

export type BuildProductCatalogOutcome = {
  status: "accepted";
  catalogPath: string;
  catalogManifestPath: string;
  reportPath: string;
};

export type ProductCatalogBuildErrorCode =
  | "CATALOG_BUILD_FAILED"
  | "CATALOG_INPUT_INVALID"
  | "CATALOG_PUBLICATION_FAILED"
  | "CATALOG_RESIDENT_SIZE_EXCEEDED"
  | "CLI_ARGUMENT_INVALID";

export class ProductCatalogBuildError extends Error {
  constructor(
    readonly code: ProductCatalogBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductCatalogBuildError";
  }
}

export async function buildProductCatalogArtifact(
  options: BuildProductCatalogOptions,
): Promise<BuildProductCatalogOutcome> {
  validateBuildIdentity(options.pipelineGitSha, options.builtAt);
  const started = performance.now();
  const paths = {
    stagingManifest: resolve(options.stagingManifestPath),
    translations: resolve(options.translationsPath),
    aliases: resolve(options.aliasesPath),
    conversion: resolve(options.traditionalToSimplifiedPath),
    review: resolve(options.reviewManifestPath),
    workspace: resolve(options.workspacePath),
    report: resolve(options.reportPath),
  };
  const [
    stagingManifestBytes,
    translationBytes,
    aliasBytes,
    conversionBytes,
    reviewBytes,
  ] = await Promise.all([
    readFile(paths.stagingManifest),
    readFile(paths.translations),
    readFile(paths.aliases),
    readFile(paths.conversion),
    readFile(paths.review),
  ]);
  const staging = parseStagingManifest(stagingManifestBytes);
  const sourceProductsPath = join(
    dirname(paths.stagingManifest),
    staging.dimensionFiles.products.relativePath,
  );
  await verifyFile(
    sourceProductsPath,
    staging.dimensionFiles.products.bytes,
    staging.dimensionFiles.products.sha256,
    "staged product catalog",
  );
  const products = await readSourceProducts(sourceProductsPath);
  const translations = parseTranslationCatalog(
    translationBytes,
    staging.baciRelease,
  );
  const aliases = parseAliasCatalog(aliasBytes);
  const conversion = parseConversionCatalog(conversionBytes);
  const review = parseReviewManifest(reviewBytes);
  const validation = validateCatalogInputs({
    staging,
    products,
    translations,
    aliases,
    conversion,
    review,
    identities: {
      translationsSha256: sha256(translationBytes),
      aliasesSha256: sha256(aliasBytes),
      traditionalToSimplifiedSha256: sha256(conversionBytes),
    },
  });

  const reviewManifestSha256 = sha256(reviewBytes);
  const identity = {
    schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
    baciRelease: staging.baciRelease,
    sourceProductsSha256: staging.dimensionFiles.products.sha256,
    translationsSha256: sha256(translationBytes),
    aliasesSha256: sha256(aliasBytes),
    traditionalToSimplifiedSha256: sha256(conversionBytes),
    searchAlgorithmVersion: PRODUCT_SEARCH_ALGORITHM_VERSION,
    searchResponseSchemaVersion: SEARCH_RESPONSE_SCHEMA_VERSION,
  };
  const identitySha256 = sha256(jsonBytes(identity));
  const productSearchBuildId = `product-search-v1-${identitySha256.slice(0, 16)}`;
  const translationsByCode = new Map(
    translations.rows.map((translation) => [translation.code, translation]),
  );
  const reviewedTranslationCodes = new Set(review.reviewedCodes);
  const artifact: ProductCatalogArtifact = {
    schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
    productSearchBuildId,
    baciRelease: staging.baciRelease,
    hsRevision: "HS12",
    searchAlgorithmVersion: PRODUCT_SEARCH_ALGORITHM_VERSION,
    searchResponseSchemaVersion: SEARCH_RESPONSE_SCHEMA_VERSION,
    translationVersion: translations.translationVersion,
    translationAttribution: translations.attribution,
    aliasVersion: aliases.aliasVersion,
    traditionalToSimplifiedVersion: conversion.dataVersion,
    products: products.map((product) => {
      const translation = translationsByCode.get(product.code)!;
      return {
        hsRevision: "HS12",
        code: product.code,
        sourceDescriptionEn: product.sourceDescriptionEn,
        sourceDescriptionSha256: translation.sourceDescriptionSha256,
        auxiliaryDescriptionZhHans: translation.description,
        normalizedSourceDescriptionEn: normalizeProductSearchText(
          product.sourceDescriptionEn,
        ),
        normalizedAuxiliaryDescriptionZhHans: normalizeProductSearchText(
          translation.description,
        ),
        translationStatus:
          translation.translationStatus === "reviewed" ||
          reviewedTranslationCodes.has(product.code)
            ? "reviewed"
            : "machine-assisted",
        translationVersion: translations.translationVersion,
      };
    }),
    aliases: aliases.rows.map((alias) => ({
      hsRevision: "HS12",
      code: alias.code,
      locale: alias.locale,
      alias: alias.alias,
      normalizedSearchText: alias.normalizedSearchText,
      reviewStatus: alias.reviewStatus,
    })),
    traditionalToSimplified: conversion.mappings,
  };
  const artifactBytes = jsonBytes(artifact);
  const residentBytes = await measureResidentCatalogBytes(artifactBytes);
  if (residentBytes > RESIDENT_SIZE_LIMIT_BYTES) {
    throw new ProductCatalogBuildError(
      "CATALOG_RESIDENT_SIZE_EXCEEDED",
      `Catalog resident size ${residentBytes} exceeds ${RESIDENT_SIZE_LIMIT_BYTES} bytes.`,
    );
  }
  const artifactSha256 = sha256(artifactBytes);
  const catalogManifest = {
    schemaVersion: CATALOG_MANIFEST_SCHEMA_VERSION,
    baciRelease: staging.baciRelease,
    hsRevision: staging.hsRevision,
    productSearchBuildId,
    identitySha256,
    sourceArchiveSha256: staging.sourceSha256,
    stagingManifestSha256: sha256(stagingManifestBytes),
    sourceProducts: {
      rowCount: products.length,
      bytes: staging.dimensionFiles.products.bytes,
      sha256: staging.dimensionFiles.products.sha256,
    },
    attribution: {
      translation: translations.attribution,
    },
    inputs: {
      translationsSha256: identity.translationsSha256,
      aliasesSha256: identity.aliasesSha256,
      traditionalToSimplifiedSha256:
        identity.traditionalToSimplifiedSha256,
      reviewManifestSha256,
    },
    versions: {
      translation: translations.translationVersion,
      aliases: aliases.aliasVersion,
      traditionalToSimplified: conversion.dataVersion,
      searchAlgorithm: PRODUCT_SEARCH_ALGORITHM_VERSION,
      searchResponseSchema: SEARCH_RESPONSE_SCHEMA_VERSION,
      glossary: review.glossaryVersion,
    },
    counts: {
      products: products.length,
      acceptedTranslations: translations.rows.length,
      aliases: aliases.rows.length,
      traditionalMappings: Object.keys(conversion.mappings).length,
      chapters: validation.coveredChapters,
    },
    residentSizeGate: {
      measurement: RESIDENT_SIZE_MEASUREMENT,
      limitBytes: RESIDENT_SIZE_LIMIT_BYTES,
      status: "accepted",
    },
    catalog: {
      schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
      relativePath: "product-catalog.json",
      bytes: artifactBytes.length,
      sha256: artifactSha256,
    },
    pipelineGitSha: options.pipelineGitSha,
    builtAt: options.builtAt,
  };
  const manifestBytes = jsonBytes(catalogManifest);
  const report = {
    schemaVersion: CATALOG_REPORT_SCHEMA_VERSION,
    status: "accepted",
    catalogManifestSha256: sha256(manifestBytes),
    catalogManifest,
    validation: {
      sourceProducts: products.length,
      acceptedTranslations: translations.rows.length,
      staleTranslations: 0,
      missingTranslations: 0,
      flaggedCodes: validation.flaggedCodes,
      reviewedFlaggedCodes: validation.reviewedFlaggedCodes,
      coveredChapters: validation.coveredChapters,
      residentSizeGate: {
        measurement: RESIDENT_SIZE_MEASUREMENT,
        measuredBytes: residentBytes,
        limitBytes: RESIDENT_SIZE_LIMIT_BYTES,
        status: "accepted",
      },
    },
    timingsMs: {
      total: elapsedMilliseconds(started),
    },
    builtAt: options.builtAt,
  };
  const reportBytes = jsonBytes(report);
  const publicationPath = join(
    paths.workspace,
    "catalogs",
    productSearchBuildId,
  );
  const partialPath = join(
    paths.workspace,
    "catalogs",
    `.${productSearchBuildId}-${process.pid}.partial`,
  );
  const preparedReport = await prepareExternalFile(paths.report, reportBytes);
  let publicationCreated = false;
  try {
    await rm(partialPath, { force: true, recursive: true });
    await mkdir(partialPath, { recursive: true });
    await Promise.all([
      writeFile(join(partialPath, "product-catalog.json"), artifactBytes, {
        flag: "wx",
      }),
      writeFile(join(partialPath, "catalog-manifest.json"), manifestBytes, {
        flag: "wx",
      }),
      writeFile(join(partialPath, "catalog-build-report.json"), reportBytes, {
        flag: "wx",
      }),
    ]);
    publicationCreated = await publishCatalog(
      partialPath,
      publicationPath,
      artifactSha256,
      manifestBytes,
    );
    await rename(preparedReport.temporaryPath, preparedReport.targetPath);
  } catch (error) {
    await rm(preparedReport.temporaryPath, { force: true });
    await rm(partialPath, { force: true, recursive: true });
    if (publicationCreated) {
      await rm(publicationPath, { force: true, recursive: true });
    }
    if (error instanceof ProductCatalogBuildError) {
      throw error;
    }
    throw new ProductCatalogBuildError(
      "CATALOG_PUBLICATION_FAILED",
      `Catalog publication failed: ${errorMessage(error)}`,
    );
  }

  return {
    status: "accepted",
    catalogPath: join(publicationPath, "product-catalog.json"),
    catalogManifestPath: join(publicationPath, "catalog-manifest.json"),
    reportPath: paths.report,
  };
}

function validateCatalogInputs({
  staging,
  products,
  translations,
  aliases,
  conversion,
  review,
  identities,
}: {
  staging: StagingManifest;
  products: SourceProduct[];
  translations: TranslationCatalog;
  aliases: AliasCatalog;
  conversion: ConversionCatalog;
  review: ReviewManifest;
  identities: {
    translationsSha256: string;
    aliasesSha256: string;
    traditionalToSimplifiedSha256: string;
  };
}): {
  flaggedCodes: number;
  reviewedFlaggedCodes: number;
  coveredChapters: number;
} {
  if (
    products.length !== staging.dimensionFiles.products.rowCount ||
    translations.rows.length !== products.length
  ) {
    throw inputError(
      "Source product and accepted translation coverage must be complete.",
    );
  }
  assertUnique(products.map(({ code }) => code), "source product code");
  assertUnique(
    translations.rows.map(({ code }) => code),
    "translation code",
  );
  const sourceByCode = new Map(products.map((row) => [row.code, row]));
  for (const translation of translations.rows) {
    const source = sourceByCode.get(translation.code);
    if (source === undefined) {
      throw inputError(
        `Translation ${translation.code} has no source product.`,
      );
    }
    if (
      translation.sourceDescriptionSha256 !==
      sha256(Buffer.from(source.sourceDescriptionEn, "utf8"))
    ) {
      throw inputError(
        `Translation ${translation.code} has a stale source-description checksum.`,
      );
    }
    if (!/\p{Script=Han}/u.test(translation.description)) {
      throw inputError(
        `Translation ${translation.code} has no Simplified-Chinese text.`,
      );
    }
    const missingTechnicalTerms = missingSourceTechnicalTerms(
      source.sourceDescriptionEn,
      translation.description,
    );
    if (missingTechnicalTerms.chemicalFormulas.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve chemical formulas: ${missingTechnicalTerms.chemicalFormulas.join(", ")}.`,
      );
    }
    if (missingTechnicalTerms.latinNames.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve Latin names: ${missingTechnicalTerms.latinNames.join(", ")}.`,
      );
    }
    const missingNumbers = missingMaterialNumericTokens(
      source.sourceDescriptionEn,
      translation.description,
    );
    if (missingNumbers.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve material numeric tokens: ${missingNumbers.join(", ")}.`,
      );
    }
    const missingUnits = missingMaterialUnits(
      source.sourceDescriptionEn,
      translation.description,
    );
    if (missingUnits.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve material units: ${missingUnits.join(", ")}.`,
      );
    }
    const missingDirections = missingInequalityDirections(
      source.sourceDescriptionEn,
      translation.description,
    );
    if (missingDirections.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve inequality direction: ${missingDirections.join(", ")}.`,
      );
    }
    const missingScope = missingScopeQualifiers(
      source.sourceDescriptionEn,
      translation.description,
    );
    if (missingScope.length > 0) {
      throw inputError(
        `Translation ${translation.code} does not preserve scope qualifiers: ${missingScope.join(", ")}.`,
      );
    }
  }
  for (const alias of aliases.rows) {
    if (!sourceByCode.has(alias.code)) {
      throw inputError(`Alias ${alias.code} has no source product.`);
    }
  }
  assertUnique(
    aliases.rows.map(
      ({ code, locale, alias }) => `${code}\u0000${locale}\u0000${alias}`,
    ),
    "alias",
  );
  if (Object.keys(conversion.mappings).length === 0) {
    throw inputError("Traditional-to-Simplified conversion data is empty.");
  }

  const flaggedCodes = products
    .filter(({ sourceDescriptionEn }) => isRiskFlagged(sourceDescriptionEn))
    .map(({ code }) => code)
    .sort(compareCodeUnits);
  assertUnique(review.reviewedCodes, "reviewed code");
  const reviewedCodes = new Set(review.reviewedCodes);
  if (
    review.identities.sourceProductsSha256 !==
      staging.dimensionFiles.products.sha256 ||
    review.identities.translationsSha256 !== identities.translationsSha256 ||
    review.identities.aliasesSha256 !== identities.aliasesSha256 ||
    review.identities.traditionalToSimplifiedSha256 !==
      identities.traditionalToSimplifiedSha256
  ) {
    throw inputError("Review manifest identities do not match catalog inputs.");
  }
  if (
    [...review.automaticChecks].sort().join("\u0000") !==
    [...REQUIRED_AUTOMATIC_CHECKS].sort().join("\u0000")
  ) {
    throw inputError("Review manifest automatic checks are incomplete.");
  }
  if (review.flaggedCodes.join("\u0000") !== flaggedCodes.join("\u0000")) {
    throw inputError("Review manifest flagged codes are incomplete.");
  }
  if (flaggedCodes.some((code) => !reviewedCodes.has(code))) {
    throw inputError("Every flagged translation must be reviewed.");
  }
  const chapters = [...new Set(products.map(({ code }) => code.slice(0, 2)))].sort(
    compareCodeUnits,
  );
  if (
    review.methodology.representedChapters.join("\u0000") !==
    chapters.join("\u0000")
  ) {
    throw inputError(
      "Review methodology does not identify every represented HS chapter.",
    );
  }
  const expectedSamples = expectedReviewSamples(products);
  if (
    JSON.stringify(review.chapterSamples) !== JSON.stringify(expectedSamples)
  ) {
    throw inputError(
      "Review manifest risk-stratified samples do not match the required strategy.",
    );
  }
  const expectedReviewedCodes = [
    ...new Set([
      ...flaggedCodes,
      ...expectedSamples.flatMap(({ codes }) => codes),
    ]),
  ].sort(compareCodeUnits);
  if (
    review.reviewedCodes.join("\u0000") !==
    expectedReviewedCodes.join("\u0000")
  ) {
    throw inputError(
      "Review manifest reviewed codes do not match the required review set.",
    );
  }
  for (const sample of expectedSamples) {
    for (const code of sample.codes) {
      if (!reviewedCodes.has(code)) {
        throw inputError(
          `Review sample ${code} is not a reviewed product in chapter ${sample.chapter}.`,
        );
      }
    }
  }
  return {
    flaggedCodes: flaggedCodes.length,
    reviewedFlaggedCodes: flaggedCodes.length,
    coveredChapters: chapters.length,
  };
}

async function readSourceProducts(path: string): Promise<SourceProduct[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(`
      SELECT hs12_code, source_description
      FROM read_parquet(${sqlString(path)})
      ORDER BY hs12_code
    `);
    return result.getRowObjectsJson().map((row) => ({
      code: requireHs12Code(row.hs12_code, "source product code"),
      sourceDescriptionEn: requireString(
        row.source_description,
        "source product description",
      ),
    }));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function parseStagingManifest(bytes: Buffer): StagingManifest {
  const root = record(JSON.parse(bytes.toString("utf8")), "staging manifest");
  const dimensions = record(root.dimensionFiles, "staging dimensionFiles");
  const products = record(dimensions.products, "staging products");
  const hsRevision = requireString(root.hsRevision, "staging hsRevision");
  if (hsRevision !== "HS12") {
    throw inputError("Product catalog source must use HS12.");
  }
  return {
    baciRelease: requireString(root.baciRelease, "staging baciRelease"),
    sourceSha256: requireSha256(
      root.sourceSha256,
      "staging sourceSha256",
    ),
    hsRevision,
    dimensionFiles: {
      products: {
        relativePath: requireString(
          products.relativePath,
          "staging products relativePath",
        ),
        rowCount: requireCount(products.rowCount, "staging products rowCount"),
        bytes: requireCount(products.bytes, "staging products bytes"),
        sha256: requireSha256(
          products.sha256,
          "staging products sha256",
        ),
      },
    },
  };
}

function parseTranslationCatalog(
  bytes: Buffer,
  baciRelease: string,
): TranslationCatalog {
  const root = record(JSON.parse(bytes.toString("utf8")), "translations");
  if (
    root.schemaVersion !== "hs12-product-translations-v1" ||
    root.baciRelease !== baciRelease ||
    root.locale !== "zh-Hans"
  ) {
    throw inputError("Translation catalog identity is incompatible.");
  }
  const rows = array(root.rows, "translation rows").map((entry): TranslationRow => {
    const row = record(entry, "translation row");
    const status = requireString(
      row.translationStatus,
      "translation status",
    );
    if (status !== "machine-assisted" && status !== "reviewed") {
      throw inputError("Translation status is invalid.");
    }
    return {
      code: requireHs12Code(row.code, "translation code"),
      description: requireString(
        row.description,
        "translation description",
      ),
      translationStatus: status,
      sourceDescriptionSha256: requireSha256(
        row.sourceDescriptionSha256,
        "translation sourceDescriptionSha256",
      ),
    };
  });
  return {
    translationVersion: requireString(
      root.translationVersion,
      "translationVersion",
    ),
    attribution: requireString(
      root.attribution,
      "translation attribution",
    ),
    rows,
  };
}

function parseAliasCatalog(bytes: Buffer): AliasCatalog {
  const root = record(JSON.parse(bytes.toString("utf8")), "aliases");
  if (root.schemaVersion !== "hs12-product-aliases-v1") {
    throw inputError("Alias catalog schema is incompatible.");
  }
  return {
    aliasVersion: requireString(root.aliasVersion, "aliasVersion"),
    rows: array(root.rows, "alias rows").map((entry) => {
      const row = record(entry, "alias row");
      const locale = requireString(row.locale, "alias locale");
      if (locale !== "en" && locale !== "zh-Hans") {
        throw inputError("Alias locale is invalid.");
      }
      if (row.reviewStatus !== "reviewed") {
        throw inputError("Every published alias must be reviewed.");
      }
      const alias = requireString(row.alias, "alias text");
      const normalizedSearchText = requireString(
        row.normalizedSearchText,
        "alias normalizedSearchText",
      );
      if (normalizedSearchText !== normalizeProductSearchText(alias)) {
        throw inputError(
          "Alias normalized search text does not match its display text.",
        );
      }
      return {
        code: requireHs12Code(row.code, "alias code"),
        locale,
        alias,
        normalizedSearchText,
        aliasKind: requireString(row.aliasKind, "alias kind"),
        reviewStatus: "reviewed",
        reviewer: requireString(row.reviewer, "alias reviewer"),
      };
    }),
  };
}

function parseConversionCatalog(bytes: Buffer): ConversionCatalog {
  const root = record(JSON.parse(bytes.toString("utf8")), "conversion data");
  if (root.schemaVersion !== "traditional-to-simplified-map-v1") {
    throw inputError("Traditional conversion schema is incompatible.");
  }
  const source = record(root.source, "conversion source");
  const mappings = record(root.mappings, "conversion mappings");
  return {
    dataVersion: requireString(root.dataVersion, "conversion dataVersion"),
    source: {
      name: requireString(source.name, "conversion source name"),
      url: requireString(source.url, "conversion source URL"),
      license: requireString(source.license, "conversion source license"),
    },
    mappings: Object.fromEntries(
      Object.entries(mappings)
        .map(([traditional, simplified]) => [
          requireString(traditional, "traditional mapping"),
          requireString(simplified, "simplified mapping"),
        ])
        .sort(([left], [right]) => compareCodeUnits(left, right)),
    ),
  };
}

function parseReviewManifest(bytes: Buffer): ReviewManifest {
  const root = record(JSON.parse(bytes.toString("utf8")), "review manifest");
  if (
    root.schemaVersion !== "hs12-product-catalog-review-v1" ||
    root.status !== "accepted" ||
    root.disposition !== "accepted"
  ) {
    throw inputError("Catalog review manifest is not accepted.");
  }
  const identities = record(root.identities, "review identities");
  const methodology = record(root.methodology, "review methodology");
  if (
    methodology.riskRuleVersion !== REVIEW_RISK_RULE_VERSION ||
    methodology.sampleStrategy !== REVIEW_SAMPLE_STRATEGY
  ) {
    throw inputError("Catalog review methodology is incompatible.");
  }
  return {
    glossaryVersion: requireString(
      root.glossaryVersion,
      "review glossaryVersion",
    ),
    automaticChecks: stringArray(
      root.automaticChecks,
      "review automaticChecks",
    ),
    methodology: {
      riskRuleVersion: REVIEW_RISK_RULE_VERSION,
      sampleStrategy: REVIEW_SAMPLE_STRATEGY,
      representedChapters: stringArray(
        methodology.representedChapters,
        "review representedChapters",
      ).map((chapter) => {
        if (!/^\d{2}$/u.test(chapter)) {
          throw inputError("Represented review chapter must contain two digits.");
        }
        return chapter;
      }),
    },
    identities: {
      sourceProductsSha256: requireSha256(
        identities.sourceProductsSha256,
        "review sourceProductsSha256",
      ),
      translationsSha256: requireSha256(
        identities.translationsSha256,
        "review translationsSha256",
      ),
      aliasesSha256: requireSha256(
        identities.aliasesSha256,
        "review aliasesSha256",
      ),
      traditionalToSimplifiedSha256: requireSha256(
        identities.traditionalToSimplifiedSha256,
        "review traditionalToSimplifiedSha256",
      ),
    },
    flaggedCodes: stringArray(root.flaggedCodes, "review flaggedCodes").map(
      (code) => requireHs12Code(code, "review flagged code"),
    ),
    reviewedCodes: stringArray(root.reviewedCodes, "review reviewedCodes").map(
      (code) => requireHs12Code(code, "review reviewed code"),
    ),
    chapterSamples: array(root.chapterSamples, "review chapterSamples").map(
      (entry) => {
        const sample = record(entry, "review chapter sample");
        const chapter = requireString(sample.chapter, "review chapter");
        if (!/^\d{2}$/u.test(chapter)) {
          throw inputError("Review chapter must contain two digits.");
        }
        const risk = requireString(sample.risk, "review sample risk");
        if (!isReviewRiskStratum(risk)) {
          throw inputError(`Review sample risk ${risk} is invalid.`);
        }
        return {
          chapter,
          risk,
          codes: stringArray(sample.codes, "review sample codes").map((code) =>
            requireHs12Code(code, "review sample code"),
          ),
        };
      },
    ),
    reviewer: requireString(root.reviewer, "review reviewer"),
    reviewedAt: requireString(root.reviewedAt, "review reviewedAt"),
    disposition: "accepted",
  };
}

function isRiskFlagged(sourceDescription: string): boolean {
  return reviewRiskStrata(sourceDescription).some(
    (risk) => risk !== "baseline",
  );
}

function expectedReviewSamples(
  products: SourceProduct[],
): ReviewManifest["chapterSamples"] {
  const samples: ReviewManifest["chapterSamples"] = [];
  const chapters = [...new Set(products.map(({ code }) => code.slice(0, 2)))].sort(
    compareCodeUnits,
  );
  for (const chapter of chapters) {
    const chapterProducts = products
      .filter(({ code }) => code.startsWith(chapter))
      .sort((left, right) => compareCodeUnits(left.code, right.code));
    const selectedCodes = new Set<string>();
    for (const risk of REVIEW_RISK_STRATA) {
      const selected = chapterProducts.find(
        ({ code, sourceDescriptionEn }) =>
          !selectedCodes.has(code) &&
          reviewRiskStrata(sourceDescriptionEn).includes(risk),
      );
      if (selected !== undefined) {
        selectedCodes.add(selected.code);
        samples.push({ chapter, risk, codes: [selected.code] });
      }
    }
  }
  return samples;
}

function reviewRiskStrata(
  sourceDescription: string,
): (typeof REVIEW_RISK_STRATA)[number][] {
  const risks: (typeof REVIEW_RISK_STRATA)[number][] = [];
  if (/[\d<>=%]/u.test(sourceDescription)) {
    risks.push("quantitative");
  }
  if (
    /\b(?:other|excluding|except|not|whether|less|more|exceeding|n\.e\.s)\b/iu.test(
      sourceDescription,
    )
  ) {
    risks.push("scope-language");
  }
  if (/\([A-Z][a-z]+(?:\s+[a-z]+)+\)/u.test(sourceDescription)) {
    risks.push("nomenclature");
  }
  return risks.length === 0 ? ["baseline"] : risks;
}

function isReviewRiskStratum(
  value: string,
): value is (typeof REVIEW_RISK_STRATA)[number] {
  return (REVIEW_RISK_STRATA as readonly string[]).includes(value);
}

function missingMaterialNumericTokens(
  source: string,
  translation: string,
): string[] {
  const available = numericTokens(translation.normalize("NFKC")).map(
    normalizeNumericToken,
  );
  const missing: string[] = [];
  for (const token of numericTokensWithOffsets(source)) {
    if (isTariffReference(source, token.index)) {
      continue;
    }
    if (
      isStructuralNumericIdentifier(source, token.index, token.value.length)
    ) {
      continue;
    }
    if (isEquivalentNumericRestatement(source, token.index, token.value)) {
      continue;
    }
    const normalized = normalizeNumericToken(token.value);
    const matchIndex = available.indexOf(normalized);
    if (matchIndex === -1) {
      missing.push(token.value);
    } else {
      available.splice(matchIndex, 1);
    }
  }
  return missing;
}

function missingMaterialUnits(
  source: string,
  translation: string,
): string[] {
  const normalizedTranslation = translation
    .normalize("NFKC")
    .replaceAll("‧", ".");
  const translationNumbers = numericTokensWithOffsets(normalizedTranslation);
  const missing = new Set<string>();
  for (const token of numericTokensWithOffsets(source)) {
    if (
      isTariffReference(source, token.index) ||
      isEquivalentNumericRestatement(source, token.index, token.value)
    ) {
      continue;
    }
    const sourceSuffix = source.slice(token.index + token.value.length);
    const unit = MATERIAL_UNIT_SPECS.find(({ source: pattern }) =>
      pattern.test(sourceSuffix),
    );
    if (unit === undefined) {
      continue;
    }
    const normalizedNumber = normalizeNumericToken(token.value);
    const preserved = translationNumbers.some((candidate) => {
      if (normalizeNumericToken(candidate.value) !== normalizedNumber) {
        return false;
      }
      const suffix = normalizedTranslation.slice(
        candidate.index + candidate.value.length,
      );
      if (unit.translation.test(suffix)) {
        return true;
      }
      if (
        unit.canonical !== "g/m2" ||
        !/^\s*(?:g\b|克|公克)/iu.test(suffix)
      ) {
        return false;
      }
      const prefix = normalizedTranslation.slice(
        Math.max(0, candidate.index - 32),
        candidate.index,
      );
      return /每平方(?:米|公尺|公分|厘米)[^,，;；]{0,24}$/u.test(prefix);
    });
    if (!preserved) {
      missing.add(unit.canonical);
    }
  }
  return [...missing];
}

type InequalityDirection = "less-than" | "more-than";

function missingInequalityDirections(
  source: string,
  translation: string,
): InequalityDirection[] {
  const normalizedTranslation = translation
    .normalize("NFKC")
    .replaceAll("‧", ".");
  const translationNumbers = numericTokensWithOffsets(normalizedTranslation);
  const missing = new Set<InequalityDirection>();

  for (const token of numericTokensWithOffsets(source)) {
    if (
      isTariffReference(source, token.index) ||
      isEquivalentNumericRestatement(source, token.index, token.value)
    ) {
      continue;
    }
    const direction = inequalityDirectionAt(
      source,
      token.index,
      token.value.length,
    );
    if (direction === undefined) {
      continue;
    }
    const normalizedNumber = normalizeNumericToken(token.value);
    const preserved = translationNumbers.some(
      (candidate) =>
        normalizeNumericToken(candidate.value) === normalizedNumber &&
        inequalityDirectionAt(
          normalizedTranslation,
          candidate.index,
          candidate.value.length,
        ) === direction,
    );
    if (!preserved) {
      missing.add(direction);
    }
  }

  return [...missing];
}

function inequalityDirectionAt(
  description: string,
  tokenIndex: number,
  tokenLength: number,
): InequalityDirection | undefined {
  const before = description
    .slice(Math.max(0, tokenIndex - 56), tokenIndex)
    .toLowerCase();
  const after = description
    .slice(tokenIndex + tokenLength, tokenIndex + tokenLength + 32)
    .toLowerCase();

  if (
    /(?:not|no)\s+less\s+than\s*$|(?:不少于|不低于|不小于|至少)\s*$/u.test(
      before,
    ) ||
    /(?:>=|≥)\s*$/u.test(before)
  ) {
    return "more-than";
  }
  if (
    /(?:not|no)\s+more\s+than\s*$|not\s+(?:exceeding|over)\s*$|(?:不超过|未超过|不大于|不高于|至多)\s*$/u.test(
      before,
    ) ||
    /(?:<=|≤)\s*$/u.test(before)
  ) {
    return "less-than";
  }
  if (
    /(?:more\s+than|greater\s+than|in\s+excess\s+of|exceeding|above|over)\s*$|(?:超过|超出|大于|高于|多于|逾)\s*$/u.test(
      before,
    ) ||
    />\s*$/u.test(before)
  ) {
    return "more-than";
  }
  if (
    /(?:less\s+than|lower\s+than|below|under|up\s+to|at\s+most)\s*$|(?:少于|小于|低于|未满)\s*$/u.test(
      before,
    ) ||
    /<\s*$/u.test(before)
  ) {
    return "less-than";
  }
  if (
    /^[^,;，；]{0,20}(?:\bor\s+more\b|\band\s+over\b|以上|及以上)/u.test(
      after,
    )
  ) {
    return "more-than";
  }
  if (
    /^[^,;，；]{0,20}(?:\bor\s+less\b|\band\s+under\b|以下|及以下|以内)/u.test(
      after,
    )
  ) {
    return "less-than";
  }

  return undefined;
}

export function missingScopeQualifiers(
  source: string,
  translation: string,
): string[] {
  const missing: string[] = [];
  if (
    hasMaterialOtherQualifier(source) &&
    !/(?:其他|其它|其余|另外|剩余|\bother\b)/iu.test(translation)
  ) {
    missing.push("other");
  }
  if (
    /\b(?:excluding|except)\b/iu.test(source) &&
    !/(?:除外|以外|不包括|不含|不在内|其他|其它|其余|非|\bexcluding\b)/iu.test(
      translation,
    )
  ) {
    missing.push("exclusion");
  }
  if (
    hasMaterialNotQualifier(source) &&
    !/(?:其他|其它|其余|非|未|无(?!论)|不得|毋|不(?!论|管)|仅|除外|以外|\bnot\b)/iu.test(
      translation,
    )
  ) {
    missing.push("not");
  }
  if (
    hasMaterialWhetherQualifier(source) &&
    !/(?:不论|无论|不管|是否|与否|有无|否|或|未|除|\bwhether\b)/iu.test(
      translation,
    )
  ) {
    missing.push("whether-or-not");
  }
  if (
    hasNotElsewhereSpecifiedQualifier(source) &&
    !/(?:未(?:另|在)?列名|未另行规定|未包括在其他|其他|其它|其余|not elsewhere|n\.e\.[sc])/iu.test(
      translation,
    )
  ) {
    missing.push("not-elsewhere-specified");
  }
  return missing;
}

function hasMaterialOtherQualifier(source: string): boolean {
  return /(?:^|:)\s*other(?:\s*[,;:]|\s*$)/iu.test(source);
}

function hasMaterialNotQualifier(source: string): boolean {
  return [...source.matchAll(/\bnot\b/giu)].some((match) => {
    const before = source.slice(Math.max(0, match.index - 80), match.index);
    const after = source.slice(match.index + match[0].length);
    return (
      !/(?:whether(?:\s+or)?|or)\s*$/iu.test(before) &&
      !/^\s+elsewhere\s+(?:specified|included)\b/iu.test(after) &&
      !/^\s+(?:less|more)\s+than\b|^\s+(?:exceeding|over)\b/iu.test(after) &&
      !isTariffScopeReference(source, match.index, match[0].length)
    );
  });
}

function hasMaterialWhetherQualifier(source: string): boolean {
  return [
    ...source.matchAll(
      /\bwhether(?:\s+or)?\s+not\b|\bwhether\b[^,;:]{0,80}\bor\s+not\b/giu,
    ),
  ].some((match) => {
    const before = source.slice(0, match.index);
    return !/\bother\s+than\b[^)]*$/iu.test(before);
  });
}

function hasNotElsewhereSpecifiedQualifier(source: string): boolean {
  return /\bnot elsewhere (?:specified|included)\b/iu.test(source);
}

function isTariffScopeReference(
  source: string,
  tokenIndex: number,
  tokenLength: number,
): boolean {
  const before = source.slice(Math.max(0, tokenIndex - 2), tokenIndex);
  const after = source.slice(tokenIndex + tokenLength, tokenIndex + tokenLength + 96);
  if (/^\s*(?:in\s+)?\d{2,6}(?:\.\d+)?\b/iu.test(after)) {
    return before.includes("(") || /^\s+in\b/iu.test(after);
  }
  return /^\s+than\s+(?:in\s+\d|(?:articles?|apparatus|goods|products?)\s+(?:of|in)\s+(?:headings?|chapters?|items?|subheadings?))/iu.test(
    after,
  );
}

function numericTokens(value: string): string[] {
  return numericTokensWithOffsets(value).map(({ value: token }) => token);
}

function numericTokensWithOffsets(
  value: string,
): { value: string; index: number }[] {
  return [...value.matchAll(/\d+(?:[.,‧]\d+)*/gu)].map((match) => ({
    value: match[0],
    index: match.index,
  }));
}

function isTariffReference(source: string, tokenIndex: number): boolean {
  const prefix = source.slice(Math.max(0, tokenIndex - 120), tokenIndex);
  const references = [
    ...prefix.matchAll(
      /\b(?:chapters?|headings?|items?|subheadings?|sections?|notes?)\b|\bn\.e\.c\.?\s+in\b|\bcovered\s+(?:in|by)\b|\bother\s+than\s+in\b|\(\s*not\b/giu,
    ),
  ];
  const reference = references.at(-1);
  if (reference === undefined) {
    return false;
  }
  const suffix = prefix.slice(reference.index + reference[0].length);
  return /^(?:\s+|nos?\.?|numbers?|\d+(?:\.\d+)?|[,.()/-]|and|or|to|through)*$/iu.test(
    suffix,
  );
}

function isStructuralNumericIdentifier(
  source: string,
  tokenIndex: number,
  tokenLength: number,
): boolean {
  const token = source.slice(tokenIndex, tokenIndex + tokenLength);
  const before = source.slice(Math.max(0, tokenIndex - 16), tokenIndex);
  const after = source.slice(tokenIndex + tokenLength, tokenIndex + tokenLength + 16);

  if (/^-[A-Za-z(]/u.test(after)) {
    return true;
  }
  if (
    /[A-Za-z]-$/u.test(before) &&
    /^,\s*\d+(?:,\s*\d+)*-[A-Za-z]/u.test(after)
  ) {
    return true;
  }
  if (
    /^[23]$/u.test(token) &&
    /(?:g\/m|g\/cm|kg\/m|\/m|\/cm|cm|m)$/iu.test(before)
  ) {
    return true;
  }

  let start = tokenIndex;
  while (start > 0 && /[A-Za-z0-9]/u.test(source[start - 1])) {
    start -= 1;
  }
  let end = tokenIndex + tokenLength;
  while (end < source.length && /[A-Za-z0-9]/u.test(source[end])) {
    end += 1;
  }
  const identifier = source.slice(start, end);
  return (
    /^[A-Za-z][A-Za-z0-9]*$/u.test(identifier) &&
    /\d/u.test(identifier) &&
    (identifier.match(/[A-Za-z]/gu)?.length ?? 0) >= 2
  );
}

function isEquivalentNumericRestatement(
  source: string,
  tokenIndex: number,
  token: string,
): boolean {
  if (!/^0\.\d+$/u.test(token)) {
    return false;
  }
  const prefix = source.slice(Math.max(0, tokenIndex - 100), tokenIndex);
  const exponent = prefix.match(
    /(\d+(?:\.\d+)?)\s*(?:x|×)\s*10\s*\(to the minus\s+(\d+)\).*?\bor\s*$/iu,
  );
  if (exponent === null) {
    return false;
  }
  const expanded = Number(exponent[1]) * 10 ** -Number(exponent[2]);
  return Math.abs(expanded - Number(token)) <= Number.EPSILON;
}

function normalizeNumericToken(value: string): string {
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(value)) {
    return value.replaceAll(",", "");
  }
  return value.replaceAll("‧", ".").replace(",", ".");
}

async function measureResidentCatalogBytes(
  artifactBytes: Buffer,
): Promise<number> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "hs-product-catalog-resident-"),
  );
  const artifactPath = join(temporaryDirectory, "product-catalog.json");
  const measurementScript = `
    const { readFileSync } = require("node:fs");
    if (typeof global.gc !== "function") {
      throw new Error("V8 garbage collection is unavailable.");
    }
    global.gc();
    const baseline = process.memoryUsage().heapUsed;
    let serialized = readFileSync(process.argv[1], "utf8");
    const copies = Number(process.argv[2]);
    const catalogs = [];
    for (let copy = 0; copy < copies; copy += 1) {
      const parsed = JSON.parse(serialized);
      const products = parsed.products.map((entry) => {
        const {
           sourceDescriptionSha256,
           normalizedSourceDescriptionEn,
           normalizedAuxiliaryDescriptionZhHans,
           ...product
        } = entry;
        return {
          product,
          normalizedSourceDescriptionEn,
          normalizedAuxiliaryDescriptionZhHans,
        };
      });
      const aliasesByProduct = new Map();
      for (const entry of parsed.aliases) {
        const { normalizedSearchText, ...alias } = entry;
        const key = alias.hsRevision + "\\u0000" + alias.code;
        const aliases = aliasesByProduct.get(key) || [];
        aliases.push({ alias, normalizedSearchText });
        aliasesByProduct.set(key, aliases);
      }
      const traditionalToSimplified = Object.fromEntries(
        Object.entries(parsed.traditionalToSimplified),
      );
      const conversionIndex = new Map();
      for (const [traditional, simplified] of Object.entries(
        traditionalToSimplified,
      )) {
        const first = Array.from(traditional)[0];
        const entries = conversionIndex.get(first) || [];
        entries.push([traditional, simplified]);
        conversionIndex.set(first, entries);
      }
      catalogs.push({
        products,
        aliasesByProduct,
        traditionalToSimplified,
        conversionIndex,
      });
    }
    serialized = "";
    global.__residentCatalogs = catalogs;
    global.gc();
    const bytes = Math.ceil(
      Math.max(0, process.memoryUsage().heapUsed - baseline) / copies,
    );
    process.stdout.write(JSON.stringify({ bytes }));
  `;
  try {
    await writeFile(artifactPath, artifactBytes, { flag: "wx" });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--expose-gc",
        "-e",
        measurementScript,
        artifactPath,
        String(
          Math.min(
            1024,
            Math.max(1, Math.ceil((16 * 1024 * 1024) / artifactBytes.length)),
          ),
        ),
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    const measurement = record(
      JSON.parse(stdout),
      "catalog resident-size measurement",
    );
    const bytes = requireCount(measurement.bytes, "catalog resident bytes");
    if (bytes === 0) {
      throw new Error("Catalog resident-size measurement returned zero.");
    }
    return bytes;
  } catch (error) {
    throw new ProductCatalogBuildError(
      "CATALOG_BUILD_FAILED",
      `Catalog resident size could not be measured: ${errorMessage(error)}`,
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function publishCatalog(
  partialPath: string,
  acceptedPath: string,
  artifactSha256: string,
  manifestBytes: Buffer,
): Promise<boolean> {
  await mkdir(dirname(acceptedPath), { recursive: true });
  if (!(await exists(acceptedPath))) {
    await rename(partialPath, acceptedPath);
    return true;
  }
  const [acceptedArtifact, acceptedManifest] = await Promise.all([
    fileIdentity(join(acceptedPath, "product-catalog.json")),
    readFile(join(acceptedPath, "catalog-manifest.json")),
  ]);
  if (
    acceptedArtifact.sha256 !== artifactSha256 ||
    !acceptedManifest.equals(manifestBytes)
  ) {
    throw new ProductCatalogBuildError(
      "CATALOG_PUBLICATION_FAILED",
      "An incompatible catalog publication already exists.",
    );
  }
  await rm(partialPath, { force: true, recursive: true });
  return false;
}

async function prepareExternalFile(
  path: string,
  bytes: Buffer,
): Promise<{ targetPath: string; temporaryPath: string }> {
  const temporaryPath = `${path}.${process.pid}.partial`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    return { targetPath: path, temporaryPath };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new ProductCatalogBuildError(
      "CATALOG_PUBLICATION_FAILED",
      `Catalog report could not be prepared: ${errorMessage(error)}`,
    );
  }
}

async function verifyFile(
  path: string,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): Promise<void> {
  const identity = await fileIdentity(path);
  if (
    identity.bytes !== expectedBytes ||
    identity.sha256 !== expectedSha256
  ) {
    throw inputError(`${label} identity does not match staging.`);
  }
}

async function fileIdentity(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return { bytes: (await stat(path)).size, sha256: digest.digest("hex") };
}

function validateBuildIdentity(pipelineGitSha: string, builtAt: string): void {
  if (
    !/^[a-f0-9]{40}$/u.test(pipelineGitSha) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(builtAt)
  ) {
    throw new ProductCatalogBuildError(
      "CLI_ARGUMENT_INVALID",
      "Pipeline Git SHA or build timestamp is malformed.",
    );
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw inputError(`${label} values must be unique.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw inputError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw inputError(`${label} must be an array.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry) => requireString(entry, label));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw inputError(`${label} must be a nonempty string.`);
  }
  return value;
}

function requireHs12Code(value: unknown, label: string): string {
  const code = requireString(value, label);
  if (!/^\d{6}$/u.test(code)) {
    throw inputError(`${label} must contain six digits.`);
  }
  return code;
}

function requireSha256(value: unknown, label: string): string {
  const sha256Value = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(sha256Value)) {
    throw inputError(`${label} must be a lowercase SHA-256.`);
  }
  return sha256Value;
}

function requireCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw inputError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function inputError(message: string): ProductCatalogBuildError {
  return new ProductCatalogBuildError("CATALOG_INPUT_INVALID", message);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function elapsedMilliseconds(started: number): number {
  return Math.round((performance.now() - started) * 1000) / 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
