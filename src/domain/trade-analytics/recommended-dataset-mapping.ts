import { createHash } from "node:crypto";

import type {
  CandidateMarketDatasetPackage,
  DatasetPackageIdentity,
} from "./dataset-package";
import { evaluateCandidateMarketV1DatasetPackage } from "./dataset-package";
import { evaluateSupplierCompetitionV1DatasetPackage } from "./supplier-competition-v1-dataset-package";
import type { SupplierCompetitionDatasetPackage } from "./supplier-competition-v1-dataset-package";
import { evaluateTradeExplorerV1DatasetPackage } from "./trade-explorer-v1-dataset-package";
import type { TradeExplorerDatasetPackage } from "./trade-explorer-v1-dataset-package";
import { evaluateTradeTrendV1DatasetPackage } from "./trade-trend-v1-dataset-package";
import type { TradeTrendDatasetPackage } from "./trade-trend-v1-dataset-package";

declare const recommendedDatasetMappingIdentityBrand: unique symbol;
declare const recommendedProductCatalogIdentityBrand: unique symbol;
declare const recommendedEconomyCatalogIdentityBrand: unique symbol;

export type RecommendedDatasetMappingIdentity =
  `recommended-dataset-mapping-v1-${string}` & {
    readonly [recommendedDatasetMappingIdentityBrand]: true;
  };

export type RecommendedProductCatalogIdentity =
  `recommended-product-catalog-v1-${string}` & {
    readonly [recommendedProductCatalogIdentityBrand]: true;
  };

export type RecommendedEconomyCatalogIdentity =
  `recommended-economy-catalog-v1-${string}` & {
    readonly [recommendedEconomyCatalogIdentityBrand]: true;
  };

export type RecommendedMappingObjectReference = Readonly<{
  key: string;
  bytes: number;
  sha256: string;
}>;

// Declares that this closed mapping also gates trade-trend-v1 on the SAME
// analysis artifact already pinned by economyCatalog below. Trade Trend has
// no separately published Dataset Package object: evidenceSha256 binds this
// declaration to economyCatalog.artifact.sha256, so its capabilities are
// derived from the one already-verified, already-published artifact rather
// than a second immutable object family.
export type RecommendedTradeTrendMappingDeclaration = Readonly<{
  recipe: "trade-trend-v1";
  evidenceSha256: string;
}>;

// Declares that this closed mapping also gates supplier-competition-v1 on
// the SAME analysis artifact already pinned by economyCatalog below.
// Supplier Competition has no separately published Dataset Package object
// either: evidenceSha256 binds this declaration to
// economyCatalog.artifact.sha256, exactly like RecommendedTradeTrendMapping
// Declaration above.
export type RecommendedSupplierCompetitionMappingDeclaration = Readonly<{
  recipe: "supplier-competition-v1";
  evidenceSha256: string;
}>;

// Declares that this closed mapping also gates trade-explorer-v1 on the
// SAME analysis artifact already pinned by economyCatalog below. Trade
// Explorer's own published Dataset Package (see
// trade-explorer-v1-dataset-package.ts) still independently pins its
// evidenceSha256 to that identical artifact SHA-256, so this declaration
// and the package it names bind to one and the same verified evidence,
// exactly like RecommendedTradeTrendMappingDeclaration and
// RecommendedSupplierCompetitionMappingDeclaration above.
export type RecommendedTradeExplorerMappingDeclaration = Readonly<{
  recipe: "trade-explorer-v1";
  evidenceSha256: string;
}>;

export type RecommendedDatasetMappingManifest = Readonly<{
  schemaVersion: "recommended-dataset-mapping-manifest-v1";
  recipe: "candidate-market-v1";
  datasetPackage: Readonly<{
    identity: DatasetPackageIdentity;
    manifest: RecommendedMappingObjectReference;
  }>;
  tradeTrend: RecommendedTradeTrendMappingDeclaration | null;
  supplierCompetition: RecommendedSupplierCompetitionMappingDeclaration | null;
  tradeExplorer: RecommendedTradeExplorerMappingDeclaration | null;
  productCatalog: Readonly<{
    identity: RecommendedProductCatalogIdentity;
    productSearchBuildId: string;
    schemaVersion: "product-catalog-artifact-v1";
    catalog: RecommendedMappingObjectReference;
    manifest: RecommendedMappingObjectReference;
  }>;
  economyCatalog: Readonly<{
    identity: RecommendedEconomyCatalogIdentity;
    analysisBuildId: string;
    schemaVersion: "candidate-market-artifact-v1";
    artifact: RecommendedMappingObjectReference;
    manifest: RecommendedMappingObjectReference;
  }>;
}>;

export type RecommendedDatasetMapping = Readonly<{
  identity: RecommendedDatasetMappingIdentity;
  manifest: RecommendedDatasetMappingManifest;
  serializedManifest: string;
}>;

export function createRecommendedDatasetMapping(
  value: unknown,
): RecommendedDatasetMapping {
  const manifest = parseRecommendedDatasetMappingManifest(value);
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    identity: digestIdentity(
      "recommended-dataset-mapping-v1",
      serializedManifest,
    ) as RecommendedDatasetMappingIdentity,
    manifest,
    serializedManifest,
  };
}

export function recommendedProductCatalogIdentity(input: {
  productSearchBuildId: string;
  schemaVersion: string;
  catalog: RecommendedMappingObjectReference;
  manifest: RecommendedMappingObjectReference;
}): RecommendedProductCatalogIdentity {
  return digestIdentity(
    "recommended-product-catalog-v1",
    JSON.stringify([
      input.productSearchBuildId,
      input.schemaVersion,
      input.catalog.bytes,
      input.catalog.sha256,
      input.manifest.bytes,
      input.manifest.sha256,
    ]),
  ) as RecommendedProductCatalogIdentity;
}

export function recommendedEconomyCatalogIdentity(input: {
  analysisBuildId: string;
  schemaVersion: string;
  artifact: RecommendedMappingObjectReference;
  manifest: RecommendedMappingObjectReference;
}): RecommendedEconomyCatalogIdentity {
  return digestIdentity(
    "recommended-economy-catalog-v1",
    JSON.stringify([
      input.analysisBuildId,
      input.schemaVersion,
      input.artifact.bytes,
      input.artifact.sha256,
      input.manifest.bytes,
      input.manifest.sha256,
    ]),
  ) as RecommendedEconomyCatalogIdentity;
}

export function validateRecommendedDatasetMapping(input: {
  mapping: RecommendedDatasetMapping;
  datasetPackage: CandidateMarketDatasetPackage;
  tradeTrendDatasetPackage: TradeTrendDatasetPackage | null;
  supplierCompetitionDatasetPackage: SupplierCompetitionDatasetPackage | null;
  tradeExplorerDatasetPackage: TradeExplorerDatasetPackage | null;
  productCatalog: Readonly<{
    productSearchBuildId: string;
    schemaVersion: "product-catalog-artifact-v1";
    catalog: RecommendedMappingObjectReference;
    manifest: RecommendedMappingObjectReference;
  }>;
  economyCatalog: Readonly<{
    analysisBuildId: string;
    schemaVersion: "candidate-market-artifact-v1";
    artifact: RecommendedMappingObjectReference;
    manifest: RecommendedMappingObjectReference;
  }>;
}): void {
  const manifest = input.mapping.manifest;
  if (
    manifest.datasetPackage.identity !==
      input.datasetPackage.identity ||
    manifest.economyCatalog.analysisBuildId !==
      input.economyCatalog.analysisBuildId ||
    manifest.productCatalog.productSearchBuildId !==
      input.productCatalog.productSearchBuildId ||
    manifest.economyCatalog.schemaVersion !==
      input.economyCatalog.schemaVersion ||
    manifest.productCatalog.schemaVersion !==
      input.productCatalog.schemaVersion ||
    !sameReference(
      manifest.productCatalog.catalog,
      input.productCatalog.catalog,
    ) ||
    !sameReference(
      manifest.productCatalog.manifest,
      input.productCatalog.manifest,
    ) ||
    !sameReference(
      manifest.economyCatalog.artifact,
      input.economyCatalog.artifact,
    ) ||
    !sameReference(
      manifest.economyCatalog.manifest,
      input.economyCatalog.manifest,
    )
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping identities are incompatible.",
    );
  }

  function sameReference(
    left: RecommendedMappingObjectReference,
    right: RecommendedMappingObjectReference,
  ): boolean {
    return (
      left.key === right.key &&
      left.bytes === right.bytes &&
      left.sha256 === right.sha256
    );
  }
  const compatibility =
    evaluateCandidateMarketV1DatasetPackage(input.datasetPackage);
  if (!compatibility.compatible) {
    throw new TypeError(
      `Recommended Dataset Mapping package is incompatible: ${compatibility.reason}.`,
    );
  }
  const packageBytes = Buffer.from(
    input.datasetPackage.serializedManifest,
    "utf8",
  );
  if (
    packageBytes.byteLength !==
      manifest.datasetPackage.manifest.bytes ||
    createHash("sha256").update(packageBytes).digest("hex") !==
      manifest.datasetPackage.manifest.sha256
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping package reference is incompatible.",
    );
  }

  // Trade Trend has no separately published Dataset Package object: this
  // mapping either declares trade-trend-v1 (manifest.tradeTrend non-null)
  // with a compatible package derived from the SAME already-pinned
  // economyCatalog artifact bytes, or it declares nothing at all. A caller
  // cannot smuggle an unvalidated Trade Trend package past a legacy or
  // Candidate-Market-only mapping, and a mapping cannot claim Trade Trend
  // support without a compatible package to prove it.
  if (manifest.tradeTrend === null) {
    if (input.tradeTrendDatasetPackage !== null) {
      throw new TypeError(
        "Recommended Dataset Mapping does not declare trade-trend-v1.",
      );
    }
  } else {
    if (input.tradeTrendDatasetPackage === null) {
      throw new TypeError(
        "Recommended Dataset Mapping declares trade-trend-v1 without a package.",
      );
    }
    if (
      manifest.tradeTrend.evidenceSha256 !==
        input.tradeTrendDatasetPackage.manifest.evidenceSha256 ||
      manifest.tradeTrend.evidenceSha256 !==
        manifest.economyCatalog.artifact.sha256
    ) {
      throw new TypeError(
        "Recommended Dataset Mapping Trade Trend evidence is incompatible.",
      );
    }
    const tradeTrendCompatibility = evaluateTradeTrendV1DatasetPackage(
      input.tradeTrendDatasetPackage,
    );
    if (!tradeTrendCompatibility.compatible) {
      throw new TypeError(
        `Recommended Dataset Mapping Trade Trend package is incompatible: ${tradeTrendCompatibility.reason}.`,
      );
    }
  }

  // Supplier Competition follows the identical no-separate-package pattern
  // as Trade Trend above, validated independently so a mapping may declare
  // either recipe, both, or neither.
  if (manifest.supplierCompetition === null) {
    if (input.supplierCompetitionDatasetPackage !== null) {
      throw new TypeError(
        "Recommended Dataset Mapping does not declare supplier-competition-v1.",
      );
    }
  } else {
    if (input.supplierCompetitionDatasetPackage === null) {
      throw new TypeError(
        "Recommended Dataset Mapping declares supplier-competition-v1 without a package.",
      );
    }
    if (
      manifest.supplierCompetition.evidenceSha256 !==
        input.supplierCompetitionDatasetPackage.manifest.evidenceSha256 ||
      manifest.supplierCompetition.evidenceSha256 !==
        manifest.economyCatalog.artifact.sha256
    ) {
      throw new TypeError(
        "Recommended Dataset Mapping Supplier Competition evidence is incompatible.",
      );
    }
    const supplierCompetitionCompatibility =
      evaluateSupplierCompetitionV1DatasetPackage(
        input.supplierCompetitionDatasetPackage,
      );
    if (!supplierCompetitionCompatibility.compatible) {
      throw new TypeError(
        `Recommended Dataset Mapping Supplier Competition package is incompatible: ${supplierCompetitionCompatibility.reason}.`,
      );
    }
  }

  // Trade Explorer follows the identical no-separate-package-object,
  // same-economyCatalog-artifact-SHA-256 pattern as Trade Trend and
  // Supplier Competition above, validated independently so a mapping may
  // declare any combination of the three recipes.
  if (manifest.tradeExplorer === null) {
    if (input.tradeExplorerDatasetPackage !== null) {
      throw new TypeError(
        "Recommended Dataset Mapping does not declare trade-explorer-v1.",
      );
    }
    return;
  }
  if (input.tradeExplorerDatasetPackage === null) {
    throw new TypeError(
      "Recommended Dataset Mapping declares trade-explorer-v1 without a package.",
    );
  }
  if (
    manifest.tradeExplorer.evidenceSha256 !==
      input.tradeExplorerDatasetPackage.manifest.evidenceSha256 ||
    manifest.tradeExplorer.evidenceSha256 !==
      manifest.economyCatalog.artifact.sha256
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping Trade Explorer evidence is incompatible.",
    );
  }
  const tradeExplorerCompatibility = evaluateTradeExplorerV1DatasetPackage(
    input.tradeExplorerDatasetPackage,
  );
  if (!tradeExplorerCompatibility.compatible) {
    throw new TypeError(
      `Recommended Dataset Mapping Trade Explorer package is incompatible: ${tradeExplorerCompatibility.reason}.`,
    );
  }
}

function parseRecommendedDatasetMappingManifest(
  value: unknown,
): RecommendedDatasetMappingManifest {
  const mapping = object(value, "Recommended Dataset Mapping");
  if (
    mapping.schemaVersion !==
      "recommended-dataset-mapping-manifest-v1" ||
    mapping.recipe !== "candidate-market-v1"
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping schema or recipe is incompatible.",
    );
  }
  const datasetPackage = object(
    mapping.datasetPackage,
    "Recommended Dataset Mapping package",
  );
  const productCatalog = object(
    mapping.productCatalog,
    "Recommended Dataset Mapping product catalog",
  );
  const economyCatalog = object(
    mapping.economyCatalog,
    "Recommended Dataset Mapping economy catalog",
  );
  if (
    productCatalog.schemaVersion !==
      "product-catalog-artifact-v1" ||
    economyCatalog.schemaVersion !==
      "candidate-market-artifact-v1"
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping catalog schema is incompatible.",
    );
  }
  const parsedProductCatalog = {
    productSearchBuildId: nonemptyString(
      productCatalog.productSearchBuildId,
      "product-search build ID",
    ),
    schemaVersion: "product-catalog-artifact-v1" as const,
    catalog: objectReference(
      productCatalog.catalog,
      "product catalog object",
    ),
    manifest: objectReference(
      productCatalog.manifest,
      "product catalog manifest",
    ),
  };
  const parsedEconomyCatalog = {
    analysisBuildId: nonemptyString(
      economyCatalog.analysisBuildId,
      "economy catalog analysis build ID",
    ),
    schemaVersion: "candidate-market-artifact-v1" as const,
    artifact: objectReference(
      economyCatalog.artifact,
      "economy catalog artifact",
    ),
    manifest: objectReference(
      economyCatalog.manifest,
      "economy catalog manifest",
    ),
  };
  const productIdentity = recommendedProductCatalogIdentity(
    parsedProductCatalog,
  );
  const economyIdentity = recommendedEconomyCatalogIdentity(
    parsedEconomyCatalog,
  );
  if (
    productCatalog.identity !== productIdentity ||
    economyCatalog.identity !== economyIdentity
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping catalog identity is inconsistent.",
    );
  }
  const datasetPackageIdentity = nonemptyString(
    datasetPackage.identity,
    "Dataset Package identity",
  );
  if (
    !/^dataset-package-v1-[a-f0-9]{64}$/u.test(
      datasetPackageIdentity,
    )
  ) {
    throw new TypeError(
      "Recommended Dataset Mapping package identity is malformed.",
    );
  }
  const tradeTrend = parseTradeTrendMappingDeclaration(
    mapping.tradeTrend,
  );
  const supplierCompetition = parseSupplierCompetitionMappingDeclaration(
    mapping.supplierCompetition,
  );
  const tradeExplorer = parseTradeExplorerMappingDeclaration(
    mapping.tradeExplorer,
  );

  return {
    schemaVersion: "recommended-dataset-mapping-manifest-v1",
    recipe: "candidate-market-v1",
    datasetPackage: {
      identity: datasetPackageIdentity as DatasetPackageIdentity,
      manifest: objectReference(
        datasetPackage.manifest,
        "Dataset Package manifest",
      ),
    },
    tradeTrend,
    supplierCompetition,
    tradeExplorer,
    productCatalog: {
      identity: productIdentity,
      ...parsedProductCatalog,
    },
    economyCatalog: {
      identity: economyIdentity,
      ...parsedEconomyCatalog,
    },
  };
}

function parseTradeTrendMappingDeclaration(
  value: unknown,
): RecommendedTradeTrendMappingDeclaration | null {
  // Absent/null is the legacy and Candidate-Market-only shape: this mapping
  // does not declare or gate trade-trend-v1 at all.
  if (value === undefined || value === null) {
    return null;
  }
  const declaration = object(
    value,
    "Recommended Dataset Mapping Trade Trend declaration",
  );
  if (declaration.recipe !== "trade-trend-v1") {
    throw new TypeError(
      "Recommended Dataset Mapping Trade Trend declaration recipe is incompatible.",
    );
  }
  return {
    recipe: "trade-trend-v1",
    evidenceSha256: sha256(
      declaration.evidenceSha256,
      "Trade Trend declaration evidence SHA-256",
    ),
  };
}

function parseSupplierCompetitionMappingDeclaration(
  value: unknown,
): RecommendedSupplierCompetitionMappingDeclaration | null {
  // Absent/null is the legacy and Candidate-Market-only shape: this mapping
  // does not declare or gate supplier-competition-v1 at all.
  if (value === undefined || value === null) {
    return null;
  }
  const declaration = object(
    value,
    "Recommended Dataset Mapping Supplier Competition declaration",
  );
  if (declaration.recipe !== "supplier-competition-v1") {
    throw new TypeError(
      "Recommended Dataset Mapping Supplier Competition declaration recipe is incompatible.",
    );
  }
  return {
    recipe: "supplier-competition-v1",
    evidenceSha256: sha256(
      declaration.evidenceSha256,
      "Supplier Competition declaration evidence SHA-256",
    ),
  };
}

function parseTradeExplorerMappingDeclaration(
  value: unknown,
): RecommendedTradeExplorerMappingDeclaration | null {
  // Absent/null is the legacy and Candidate-Market-only shape (and matches
  // a mapping written before #47 activated Trade Explorer): this mapping
  // does not declare or gate trade-explorer-v1 at all.
  if (value === undefined || value === null) {
    return null;
  }
  const declaration = object(
    value,
    "Recommended Dataset Mapping Trade Explorer declaration",
  );
  if (declaration.recipe !== "trade-explorer-v1") {
    throw new TypeError(
      "Recommended Dataset Mapping Trade Explorer declaration recipe is incompatible.",
    );
  }
  return {
    recipe: "trade-explorer-v1",
    evidenceSha256: sha256(
      declaration.evidenceSha256,
      "Trade Explorer declaration evidence SHA-256",
    ),
  };
}

function objectReference(
  value: unknown,
  label: string,
): RecommendedMappingObjectReference {
  const reference = object(value, label);
  return {
    key: nonemptyString(reference.key, `${label} key`),
    bytes: nonnegativeInteger(reference.bytes, `${label} bytes`),
    sha256: sha256(reference.sha256, `${label} SHA-256`),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const candidate = nonemptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return candidate;
}

function digestIdentity(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex")}`;
}
