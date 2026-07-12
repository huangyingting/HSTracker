import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import { compareCodeUnits } from "../../src/catalog/deterministic-order";
import { convertTraditionalToSimplified } from "../../src/catalog/traditional-to-simplified";
import {
  preserveSourceScopeQualifiers,
  preserveSourceTechnicalTerms,
} from "./product-translation-structure";

const TRANSLATION_SCHEMA_VERSION = "hs12-product-translations-v1";
const REPORT_SCHEMA_VERSION = "hs12-translation-build-report-v1";
const TRANSLATION_ALGORITHM =
  "official-hierarchy-with-reviewed-corrections-v4";

type SourceProduct = {
  code: string;
  sourceDescriptionEn: string;
};

type StagingManifest = {
  baciRelease: string;
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

type TerminologyRow = {
  level: 4 | 5 | 6;
  code: string;
  descriptionZhHant: string;
};

type TerminologyCatalog = {
  terminologyVersion: string;
  source: {
    name: string;
    url: string;
    license: string;
    sha256: string;
  };
  rows: TerminologyRow[];
};

type CorrectionRow = {
  code: string;
  description: string;
  reasons: string[];
  reviewer: string;
  reviewedAt: string;
  sourceDescriptionSha256: string;
};

type CorrectionCatalog = {
  correctionVersion: string;
  generator:
    | {
        method: "manual";
        name: string;
        version: string;
        evidenceSha256: string;
      }
    | {
        method: "model-assisted";
        name: string;
        version: string;
        modelSha256: string;
        promptVersion: string;
      };
  rows: CorrectionRow[];
};

type CombinedCorrectionCatalog = {
  correctionVersions: string[];
  generators: CorrectionCatalog["generator"][];
  rows: CorrectionRow[];
};

type ConversionCatalog = {
  dataVersion: string;
  source: {
    name: string;
    url: string;
    license: string;
  };
  mappings: Record<string, string>;
};

type FileIdentity = {
  bytes: number;
  sha256: string;
};

export type BuildProductTranslationsOptions = {
  stagingManifestPath: string;
  terminologyPath: string;
  correctionsPaths: readonly string[];
  traditionalToSimplifiedPath: string;
  outputPath: string;
  reportPath: string;
};

export type BuildProductTranslationsOutcome = {
  status: "accepted";
  translationsPath: string;
  reportPath: string;
};

export type ProductTranslationBuildErrorCode =
  | "CLI_ARGUMENT_INVALID"
  | "TRANSLATION_INPUT_INVALID"
  | "TRANSLATION_PUBLICATION_FAILED";

export class ProductTranslationBuildError extends Error {
  constructor(
    readonly code: ProductTranslationBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductTranslationBuildError";
  }
}

export async function buildProductTranslations(
  options: BuildProductTranslationsOptions,
): Promise<BuildProductTranslationsOutcome> {
  const paths = {
    stagingManifest: resolve(options.stagingManifestPath),
    terminology: resolve(options.terminologyPath),
    corrections: options.correctionsPaths.map((path) => resolve(path)),
    conversion: resolve(options.traditionalToSimplifiedPath),
    output: resolve(options.outputPath),
    report: resolve(options.reportPath),
  };
  if (paths.corrections.length === 0) {
    throw inputError("At least one correction catalog is required.");
  }
  let inputBytes: {
    staging: Buffer;
    terminology: Buffer;
    corrections: Buffer[];
    conversion: Buffer;
  };
  try {
    const [staging, terminology, corrections, conversion] = await Promise.all([
      readFile(paths.stagingManifest),
      readFile(paths.terminology),
      Promise.all(paths.corrections.map((path) => readFile(path))),
      readFile(paths.conversion),
    ]);
    inputBytes = { staging, terminology, corrections, conversion };
  } catch (error) {
    throw inputError(
      `Translation input could not be read: ${errorMessage(error)}`,
    );
  }
  const {
    staging: stagingBytes,
    terminology: terminologyBytes,
    corrections: correctionBytes,
    conversion: conversionBytes,
  } = inputBytes;
  const staging = parseStagingManifest(stagingBytes);
  const terminology = parseTerminologyCatalog(terminologyBytes);
  const corrections = combineCorrectionCatalogs(
    correctionBytes.map((bytes) => parseCorrectionCatalog(bytes)),
  );
  const conversion = parseConversionCatalog(conversionBytes);
  const sourceProductsPath = join(
    dirname(paths.stagingManifest),
    staging.dimensionFiles.products.relativePath,
  );
  await verifyFile(
    sourceProductsPath,
    staging.dimensionFiles.products,
    "staged product catalog",
  );
  const products = await readSourceProducts(sourceProductsPath);
  if (products.length !== staging.dimensionFiles.products.rowCount) {
    throw inputError("Staged product row count does not match its manifest.");
  }

  const rows = translateProducts(
    products,
    terminology,
    corrections,
    conversion,
  );
  const attribution =
    "HS Tracker project auxiliary Simplified-Chinese translation of CEPII BACI " +
    `source descriptions; terminology adapted from ${terminology.source.name} ` +
    `(${terminology.source.license}).`;
  const translationVersion = `hs12-zh-hans-v1-${sha256(
    jsonBytes({
      algorithm: TRANSLATION_ALGORITHM,
      baciRelease: staging.baciRelease,
      sourceProductsSha256: staging.dimensionFiles.products.sha256,
      terminologySha256: sha256(terminologyBytes),
      correctionsSha256: correctionBytes.map((bytes) => sha256(bytes)),
      conversionSha256: sha256(conversionBytes),
    }),
  ).slice(0, 16)}`;
  const translationsBytes = jsonBytes({
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
    baciRelease: staging.baciRelease,
    hsRevision: "HS12",
    locale: "zh-Hans",
    attribution,
    translationVersion,
    generator: {
      algorithm: TRANSLATION_ALGORITHM,
      terminologyVersion: terminology.terminologyVersion,
      correctionVersions: corrections.correctionVersions,
      conversionVersion: conversion.dataVersion,
    },
    provenance: {
      terminology: terminology.source,
      correctionGenerators: corrections.generators,
      traditionalToSimplified: conversion.source,
    },
    rows,
  });
  const translationsIdentity = identity(translationsBytes);
  const reportBytes = jsonBytes({
    schemaVersion: REPORT_SCHEMA_VERSION,
    status: "accepted",
    baciRelease: staging.baciRelease,
    translationVersion,
    attribution,
    inputs: {
      sourceProducts: {
        bytes: staging.dimensionFiles.products.bytes,
        sha256: staging.dimensionFiles.products.sha256,
      },
      terminology: identity(terminologyBytes),
      corrections: correctionBytes.map((bytes, index) => ({
        correctionVersion: corrections.correctionVersions[index],
        ...identity(bytes),
      })),
      traditionalToSimplified: identity(conversionBytes),
    },
    validation: {
      sourceProducts: products.length,
      translations: rows.length,
      reviewedCorrections: corrections.rows.length,
      terminologyRows: terminology.rows.length,
      missingTranslations: 0,
      staleCorrections: 0,
      legacyGlyphs: 0,
    },
    outputs: {
      translations: translationsIdentity,
    },
  });

  await publishPair(
    paths.output,
    translationsBytes,
    paths.report,
    reportBytes,
  );
  return {
    status: "accepted",
    translationsPath: paths.output,
    reportPath: paths.report,
  };
}

function translateProducts(
  products: SourceProduct[],
  terminology: TerminologyCatalog,
  corrections: CombinedCorrectionCatalog,
  conversion: ConversionCatalog,
): {
  code: string;
  description: string;
  translationStatus: "machine-assisted" | "reviewed";
  sourceDescriptionSha256: string;
}[] {
  const sourceByCode = uniqueMap(products, "source product");
  const terminologyByCode = new Map<string, TerminologyRow>();
  for (const row of terminology.rows) {
    const key = `${row.level}:${row.code}`;
    if (terminologyByCode.has(key)) {
      throw inputError(`Duplicate terminology row ${key}.`);
    }
    terminologyByCode.set(key, row);
  }
  const correctionsByCode = uniqueMap(corrections.rows, "correction");
  const staleCorrections = corrections.rows.filter(
    ({ code }) => !sourceByCode.has(code),
  );
  if (staleCorrections.length > 0) {
    throw inputError(
      `Corrections contain ${staleCorrections.length} stale product code(s).`,
    );
  }
  const convert = (value: string): string =>
    convertTraditionalToSimplified(value, conversion.mappings);

  return products.map((product) => {
    const sourceDescriptionSha256 = sha256Text(product.sourceDescriptionEn);
    const correction = correctionsByCode.get(product.code);
    if (correction !== undefined) {
      if (correction.sourceDescriptionSha256 !== sourceDescriptionSha256) {
        throw inputError(
          `Correction ${product.code} does not identify its source description.`,
        );
      }
      return {
        code: product.code,
        description: validateTranslation(
          preserveSourceScopeQualifiers(
            product.sourceDescriptionEn,
            preserveSourceTechnicalTerms(
              product.sourceDescriptionEn,
              correction.description,
            ),
          ),
          product.code,
        ),
        translationStatus: "reviewed" as const,
        sourceDescriptionSha256,
      };
    }

    const leaf = terminologyByCode.get(`6:${product.code}`);
    if (leaf === undefined) {
      throw inputError(
        `Product ${product.code} has no HS6 terminology or reviewed correction.`,
      );
    }
    const hierarchy = [
      terminologyByCode.get(`4:${product.code.slice(0, 4)}`),
      terminologyByCode.get(`5:${product.code.slice(0, 5)}`),
      leaf,
    ]
      .filter((row): row is TerminologyRow => row !== undefined)
      .map(({ descriptionZhHant }) =>
        normalizeHierarchyPart(convert(descriptionZhHant)),
      )
      .filter(
        (part, index, all) =>
          part.length > 0 && (index === 0 || part !== all[index - 1]),
      );
    return {
      code: product.code,
      description: validateTranslation(
        preserveSourceScopeQualifiers(
          product.sourceDescriptionEn,
          preserveSourceTechnicalTerms(
            product.sourceDescriptionEn,
            hierarchy.join("："),
          ),
        ),
        product.code,
      ),
      translationStatus: "machine-assisted" as const,
      sourceDescriptionSha256,
    };
  });
}

function parseStagingManifest(bytes: Buffer): StagingManifest {
  const root = parseRecord(bytes, "staging manifest");
  const dimensionFiles = record(root.dimensionFiles, "staging dimensionFiles");
  const products = record(dimensionFiles.products, "staging products");
  if (root.hsRevision !== "HS12") {
    throw inputError("Product source must use HS12.");
  }
  return {
    baciRelease: requireString(root.baciRelease, "staging baciRelease"),
    hsRevision: "HS12",
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

function parseTerminologyCatalog(bytes: Buffer): TerminologyCatalog {
  const root = parseRecord(bytes, "terminology");
  if (root.schemaVersion !== "hs12-zh-terminology-v1") {
    throw inputError("Terminology schema is incompatible.");
  }
  const source = record(root.source, "terminology source");
  return {
    terminologyVersion: requireString(
      root.terminologyVersion,
      "terminology version",
    ),
    source: {
      name: requireString(source.name, "terminology source name"),
      url: requireString(source.url, "terminology source URL"),
      license: requireString(source.license, "terminology source license"),
      sha256: requireSha256(source.sha256, "terminology source sha256"),
    },
    rows: array(root.rows, "terminology rows").map((entry) => {
      const row = record(entry, "terminology row");
      const level = requireCount(row.level, "terminology level");
      if (level !== 4 && level !== 5 && level !== 6) {
        throw inputError("Terminology level must be 4, 5, or 6.");
      }
      const code = requireString(row.code, "terminology code");
      if (!new RegExp(`^\\d{${level}}$`, "u").test(code)) {
        throw inputError(
          `Terminology code must contain exactly ${level} digits.`,
        );
      }
      return {
        level,
        code,
        descriptionZhHant: requireString(
          row.descriptionZhHant,
          "terminology description",
        ),
      };
    }),
  };
}

function parseCorrectionCatalog(bytes: Buffer): CorrectionCatalog {
  const root = parseRecord(bytes, "corrections");
  if (root.schemaVersion !== "hs12-zh-translation-corrections-v1") {
    throw inputError("Correction schema is incompatible.");
  }
  const generator = record(root.generator, "correction generator");
  const generatorMethod = requireString(
    generator.method,
    "correction generator method",
  );
  const generatorIdentity = {
    name: requireString(generator.name, "correction generator name"),
    version: requireString(generator.version, "correction generator version"),
  };
  let parsedGenerator: CorrectionCatalog["generator"];
  if (generatorMethod === "manual") {
    parsedGenerator = {
      method: "manual",
      ...generatorIdentity,
      evidenceSha256: requireSha256(
        generator.evidenceSha256,
        "correction evidence sha256",
      ),
    };
  } else if (generatorMethod === "model-assisted") {
    parsedGenerator = {
      method: "model-assisted",
      ...generatorIdentity,
      modelSha256: requireSha256(
        generator.modelSha256,
        "correction model sha256",
      ),
      promptVersion: requireString(
        generator.promptVersion,
        "correction prompt version",
      ),
    };
  } else {
    throw inputError(
      "Correction generator method must be manual or model-assisted.",
    );
  }
  return {
    correctionVersion: requireString(
      root.correctionVersion,
      "correction version",
    ),
    generator: parsedGenerator,
    rows: array(root.rows, "correction rows").map((entry) => {
      const row = record(entry, "correction row");
      return {
        code: requireHs12Code(row.code, "correction code"),
        description: requireString(
          row.description,
          "correction description",
        ),
        reasons: stringArray(row.reasons, "correction reasons"),
        reviewer: requireString(row.reviewer, "correction reviewer"),
        reviewedAt: requireTimestamp(row.reviewedAt, "correction reviewedAt"),
        sourceDescriptionSha256: requireSha256(
          row.sourceDescriptionSha256,
          "correction source description sha256",
        ),
      };
    }),
  };
}

function combineCorrectionCatalogs(
  catalogs: CorrectionCatalog[],
): CombinedCorrectionCatalog {
  const correctionVersions = catalogs.map(
    ({ correctionVersion }) => correctionVersion,
  );
  if (new Set(correctionVersions).size !== correctionVersions.length) {
    throw inputError("Correction catalog versions must be unique.");
  }
  return {
    correctionVersions,
    generators: catalogs.map(({ generator }) => generator),
    rows: catalogs.flatMap(({ rows }) => rows),
  };
}

function parseConversionCatalog(bytes: Buffer): ConversionCatalog {
  const root = parseRecord(bytes, "traditional-to-simplified data");
  if (root.schemaVersion !== "traditional-to-simplified-map-v1") {
    throw inputError("Traditional-to-Simplified schema is incompatible.");
  }
  const source = record(root.source, "conversion source");
  const rawMappings = record(root.mappings, "conversion mappings");
  const mappings = Object.fromEntries(
    Object.entries(rawMappings)
      .map(([from, to]) => [
        requireString(from, "conversion source text"),
        requireString(to, "conversion target text"),
      ])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  );
  if (Object.keys(mappings).length === 0) {
    throw inputError("Traditional-to-Simplified mappings cannot be empty.");
  }
  return {
    dataVersion: requireString(root.dataVersion, "conversion data version"),
    source: {
      name: requireString(source.name, "conversion source name"),
      url: requireString(source.url, "conversion source URL"),
      license: requireString(source.license, "conversion source license"),
    },
    mappings,
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

function normalizeHierarchyPart(value: string): string {
  return value
    .replaceAll("︰", "：")
    .normalize("NFKC")
    .replace(/(?<=\d)‧(?=\d)/gu, ".")
    .replace(/^[\s\-—–:：;；、,，]+/u, "")
    .replace(/[\s:：;；]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function validateTranslation(value: string, code: string): string {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0 || !/\p{Script=Han}/u.test(normalized)) {
    throw inputError(`Translation ${code} must contain Chinese text.`);
  }
  if (/\p{Co}/u.test(normalized)) {
    throw inputError(`Translation ${code} contains a legacy private-use glyph.`);
  }
  if (
    /[\uFFFD\p{Cc}]|#{3,}|<\/?think>|```|(?:^|\s)(?:英文原文|官方中文术语提示|修正后的中文|assistant|system)\s*[:：]/iu.test(
      normalized,
    )
  ) {
    throw inputError(`Translation ${code} contains invalid generated text.`);
  }
  return normalized;
}

function uniqueMap<T extends { code: string }>(
  rows: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (result.has(row.code)) {
      throw inputError(`Duplicate ${label} code ${row.code}.`);
    }
    result.set(row.code, row);
  }
  return result;
}

async function verifyFile(
  path: string,
  expected: FileIdentity,
  label: string,
): Promise<void> {
  const actual = await fileIdentity(path);
  if (
    actual.bytes !== expected.bytes ||
    actual.sha256 !== expected.sha256
  ) {
    throw inputError(`${label} identity does not match its manifest.`);
  }
}

async function fileIdentity(path: string): Promise<FileIdentity> {
  const details = await stat(path);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return { bytes: details.size, sha256: digest.digest("hex") };
}

async function publishPair(
  firstPath: string,
  firstBytes: Buffer,
  secondPath: string,
  secondBytes: Buffer,
): Promise<void> {
  const token = `${process.pid}-${randomUUID()}`;
  const firstTemporary = join(
    dirname(firstPath),
    `.${token}-${firstPath.split("/").at(-1)}.partial`,
  );
  const secondTemporary = join(
    dirname(secondPath),
    `.${token}-${secondPath.split("/").at(-1)}.partial`,
  );
  let firstPublished = false;
  try {
    await Promise.all([
      mkdir(dirname(firstPath), { recursive: true }),
      mkdir(dirname(secondPath), { recursive: true }),
    ]);
    await Promise.all([ensureAbsent(firstPath), ensureAbsent(secondPath)]);
    await Promise.all([
      writeFile(firstTemporary, firstBytes, { flag: "wx" }),
      writeFile(secondTemporary, secondBytes, { flag: "wx" }),
    ]);
    await rename(firstTemporary, firstPath);
    firstPublished = true;
    await rename(secondTemporary, secondPath);
  } catch (error) {
    await Promise.all([
      rm(firstTemporary, { force: true }),
      rm(secondTemporary, { force: true }),
      firstPublished ? rm(firstPath, { force: true }) : Promise.resolve(),
    ]);
    throw new ProductTranslationBuildError(
      "TRANSLATION_PUBLICATION_FAILED",
      `Could not publish translation artifacts: ${errorMessage(error)}`,
    );
  }
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`immutable output already exists: ${path}`);
}

function parseRecord(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return record(JSON.parse(bytes.toString("utf8")), label);
  } catch (error) {
    if (error instanceof ProductTranslationBuildError) {
      throw error;
    }
    throw inputError(`${label} is not valid JSON.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
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
  const values = array(value, label).map((entry) =>
    requireString(entry, label),
  );
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw inputError(`${label} must contain unique values.`);
  }
  return values;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw inputError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw inputError(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function requireHs12Code(value: unknown, label: string): string {
  const code = requireString(value, label);
  if (!/^\d{6}$/u.test(code)) {
    throw inputError(`${label} must contain six digits.`);
  }
  return code;
}

function requireSha256(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw inputError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return hash;
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      timestamp,
    ) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw inputError(`${label} must be a UTC ISO-8601 timestamp.`);
  }
  return timestamp;
}

function identity(bytes: Buffer): FileIdentity {
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function inputError(message: string): ProductTranslationBuildError {
  return new ProductTranslationBuildError(
    "TRANSLATION_INPUT_INVALID",
    message,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
