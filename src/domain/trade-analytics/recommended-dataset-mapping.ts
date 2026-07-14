import { createHash } from "node:crypto";

import type {
  CandidateMarketDatasetPackage,
  DatasetPackageIdentity,
} from "./dataset-package";
import { evaluateCandidateMarketV1DatasetPackage } from "./dataset-package";

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

export type RecommendedDatasetMappingManifest = Readonly<{
  schemaVersion: "recommended-dataset-mapping-manifest-v1";
  recipe: "candidate-market-v1";
  datasetPackage: Readonly<{
    identity: DatasetPackageIdentity;
    manifest: RecommendedMappingObjectReference;
  }>;
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
