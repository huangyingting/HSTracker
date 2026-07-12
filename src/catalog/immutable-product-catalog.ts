import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  createRuntimeReadStream,
  readRuntimeFile,
  statRuntimePath,
} from "../runtime-file-access";
import type {
  ProductAliasRecord,
  ProductCatalog,
  ProductSearchProduct,
  ProductSearchResult,
} from "./product-catalog";
import { retiredProductSearchBuild } from "./product-catalog-errors";
import {
  createProductSearchIndex,
  searchProductIndex,
  type ProductSearchIndex,
  type ProductSearchIndexedAlias,
  type ProductSearchIndexedProduct,
} from "./product-search";
import {
  normalizeProductSearchText,
  PRODUCT_SEARCH_ALGORITHM_VERSION,
} from "./product-search-normalization";
import { validateProductSearchQuery } from "./validate-product-search-query";

type ImmutableProductCatalogOptions = {
  catalogPath: string;
  catalogManifestPath: string;
};

type CatalogArtifact = {
  productSearchBuildId: string;
  searchIndex: ProductSearchIndex;
  traditionalToSimplified: Record<string, string>;
};

export class ImmutableProductCatalog implements ProductCatalog {
  private constructor(private readonly artifact: CatalogArtifact) {}

  static async open(
    options: ImmutableProductCatalogOptions,
  ): Promise<ImmutableProductCatalog> {
    const catalogPath = resolve(
      /* turbopackIgnore: true */ options.catalogPath,
    );
    const manifest = object(
      JSON.parse(
        await readRuntimeFile(
          resolve(
            /* turbopackIgnore: true */ options.catalogManifestPath,
          ),
          "utf8",
        ),
      ),
      "catalog manifest",
    );
    if (manifest.schemaVersion !== "product-catalog-manifest-v1") {
      throw new Error("Product catalog manifest schema is incompatible.");
    }
    const catalogIdentity = object(
      manifest.catalog,
      "catalog artifact identity",
    );
    const expectedBytes = nonnegativeInteger(
      catalogIdentity.bytes,
      "catalog bytes",
    );
    const expectedSha256 = sha256String(
      catalogIdentity.sha256,
      "catalog SHA-256",
    );
    const actualIdentity = await fileIdentity(catalogPath);
    if (
      actualIdentity.bytes !== expectedBytes ||
      actualIdentity.sha256 !== expectedSha256
    ) {
      throw new Error("Product catalog artifact identity does not match.");
    }

    const artifact = parseCatalogArtifact(
      JSON.parse(await readRuntimeFile(catalogPath, "utf8")),
    );
    const manifestBuildId = string(
      manifest.productSearchBuildId,
      "manifest productSearchBuildId",
    );
    if (artifact.productSearchBuildId !== manifestBuildId) {
      throw new Error(
        "Product catalog build identity does not match its manifest.",
      );
    }
    return new ImmutableProductCatalog(artifact);
  }

  async search(
    query: Parameters<ProductCatalog["search"]>[0],
  ): Promise<ProductSearchResult> {
    validateProductSearchQuery(query);
    if (query.productSearchBuildId !== this.artifact.productSearchBuildId) {
      throw retiredProductSearchBuild(query.productSearchBuildId);
    }
    return searchProductIndex(
      query,
      this.artifact.searchIndex,
      this.artifact.traditionalToSimplified,
    );
  }
}

function parseCatalogArtifact(value: unknown): CatalogArtifact {
  const root = object(value, "product catalog artifact");
  if (
    root.schemaVersion !== "product-catalog-artifact-v1" ||
    root.searchAlgorithmVersion !== PRODUCT_SEARCH_ALGORITHM_VERSION ||
    root.searchResponseSchemaVersion !== "product-search-result-v1"
  ) {
    throw new Error("Product catalog artifact schema is incompatible.");
  }
  const products = array(root.products, "catalog products").map(
    (entry): ProductSearchIndexedProduct => {
      const product = object(entry, "catalog product");
      const status = string(
        product.translationStatus,
        "catalog translationStatus",
      );
      if (status !== "machine-assisted" && status !== "reviewed") {
        throw new Error("Catalog translation status is invalid.");
      }
      const record: ProductSearchProduct = {
        hsRevision: hs12(product.hsRevision, "catalog hsRevision"),
        code: hs12Code(product.code, "catalog product code"),
        sourceDescriptionEn: string(
          product.sourceDescriptionEn,
          "catalog sourceDescriptionEn",
        ),
        auxiliaryDescriptionZhHans: string(
          product.auxiliaryDescriptionZhHans,
          "catalog auxiliaryDescriptionZhHans",
        ),
        translationStatus: status,
        translationVersion: string(
          product.translationVersion,
          "catalog translationVersion",
        ),
      };
      const sourceDescriptionSha256 = sha256String(
        product.sourceDescriptionSha256,
        "catalog sourceDescriptionSha256",
      );
      if (
        sourceDescriptionSha256 !==
        createHash("sha256")
          .update(record.sourceDescriptionEn, "utf8")
          .digest("hex")
      ) {
        throw new Error(
          "Catalog source-description checksum does not match its source text.",
        );
      }
      const normalizedSourceDescriptionEn = normalizedSearchText(
        product.normalizedSourceDescriptionEn,
        record.sourceDescriptionEn,
        "catalog normalizedSourceDescriptionEn",
      );
      const normalizedAuxiliaryDescriptionZhHans = normalizedSearchText(
        product.normalizedAuxiliaryDescriptionZhHans,
        record.auxiliaryDescriptionZhHans,
        "catalog normalizedAuxiliaryDescriptionZhHans",
      );
      return {
        product: record,
        normalizedSourceDescriptionEn,
        normalizedAuxiliaryDescriptionZhHans,
      };
    },
  );
  const aliases = array(root.aliases, "catalog aliases").map(
    (entry): ProductSearchIndexedAlias => {
      const alias = object(entry, "catalog alias");
      const locale = string(alias.locale, "catalog alias locale");
      if (locale !== "en" && locale !== "zh-Hans") {
        throw new Error("Catalog alias locale is invalid.");
      }
      if (alias.reviewStatus !== "reviewed") {
        throw new Error("Catalog alias is not reviewed.");
      }
      const record: ProductAliasRecord = {
        hsRevision: hs12(alias.hsRevision, "catalog alias hsRevision"),
        code: hs12Code(alias.code, "catalog alias code"),
        locale,
        alias: string(alias.alias, "catalog alias text"),
        reviewStatus: "reviewed",
      };
      return {
        alias: record,
        normalizedSearchText: normalizedSearchText(
          alias.normalizedSearchText,
          record.alias,
          "catalog alias normalizedSearchText",
        ),
      };
    },
  );
  const mappings = object(
    root.traditionalToSimplified,
    "catalog traditional mappings",
  );
  return {
    productSearchBuildId: string(
      root.productSearchBuildId,
      "catalog productSearchBuildId",
    ),
    searchIndex: createProductSearchIndex(products, aliases),
    traditionalToSimplified: Object.fromEntries(
      Object.entries(mappings).map(([traditional, simplified]) => [
        traditional,
        string(simplified, "catalog simplified mapping"),
      ]),
    ),
  };
}

function normalizedSearchText(
  value: unknown,
  source: string,
  label: string,
): string {
  const normalized = string(value, label);
  if (normalized !== normalizeProductSearchText(source)) {
    throw new Error(`${label} does not match its source text.`);
  }
  return normalized;
}

async function fileIdentity(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const digest = createHash("sha256");
  for await (const chunk of createRuntimeReadStream(path)) {
    digest.update(chunk);
  }
  return {
    bytes: (await statRuntimePath(path)).size,
    sha256: digest.digest("hex"),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function hs12(value: unknown, label: string): "HS12" {
  if (value !== "HS12") {
    throw new Error(`${label} must be HS12.`);
  }
  return value;
}

function hs12Code(value: unknown, label: string): string {
  const code = string(value, label);
  if (!/^\d{6}$/u.test(code)) {
    throw new Error(`${label} must contain six digits.`);
  }
  return code;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function sha256String(value: unknown, label: string): string {
  const hash = string(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return hash;
}
