import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { ImmutableProductCatalog } from "../../src/catalog/immutable-product-catalog";
import { ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";
import { missingScopeQualifiers } from "../../scripts/catalog/product-catalog-artifact";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

type MutableStagingManifest = Record<string, unknown> & {
  dimensionFiles: {
    products: {
      relativePath: string;
      rowCount: number;
      bytes: number;
      sha256: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("immutable bilingual product catalog CLI", () => {
  it("builds an accepted content-derived catalog from reviewed inputs", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const stagingManifest = JSON.parse(
      await readFile(staging.stagingManifestPath, "utf8"),
    );
    const translationsPath = join(root, "translations.json");
    const aliasesPath = join(root, "aliases.json");
    const conversionPath = join(root, "traditional-to-simplified.json");
    const reviewPath = join(root, "review-manifest.json");
    const translations = {
      schemaVersion: "hs12-product-translations-v1",
      baciRelease: "VTEST001",
      locale: "zh-Hans",
      attribution: "Fixture auxiliary translation attribution.",
      translationVersion: "fixture-zh-hans-v1",
      generator: {
        name: "fixture-reviewed",
        version: "1",
      },
      rows: [
        {
          code: "010121",
          description: "纯种繁殖用活马",
          translationStatus: "machine-assisted",
          sourceDescriptionSha256: sha256Text(
            "Horses: live, pure-bred breeding animals",
          ),
        },
        {
          code: "851712",
          description: "蜂窝网络或其他无线网络用电话机",
          translationStatus: "reviewed",
          sourceDescriptionSha256: sha256Text(
            "Telephones for cellular networks or for other wireless networks",
          ),
        },
      ],
    };
    const aliases = {
      schemaVersion: "hs12-product-aliases-v1",
      aliasVersion: "fixture-aliases-v1",
      rows: [
        {
          code: "851712",
          locale: "en",
          alias: "wireless phone",
          normalizedSearchText: "wireless phone",
          aliasKind: "common-language",
          reviewStatus: "reviewed",
          reviewer: "fixture-reviewer",
        },
      ],
    };
    const conversion = {
      schemaVersion: "traditional-to-simplified-map-v1",
      dataVersion: "fixture-opencc-v1",
      source: {
        name: "fixture conversion data",
        url: "https://example.invalid/opencc",
        license: "Apache-2.0",
      },
      mappings: {
        純: "纯",
        種: "种",
        馬: "马",
        蜂窩: "蜂窝",
        網路: "网络",
        無: "无",
        線: "线",
        電: "电",
        話: "话",
        機: "机",
      },
    };
    const translationBytes = jsonBytes(translations);
    const aliasBytes = jsonBytes(aliases);
    const conversionBytes = jsonBytes(conversion);
    await Promise.all([
      writeFile(translationsPath, translationBytes),
      writeFile(aliasesPath, aliasBytes),
      writeFile(conversionPath, conversionBytes),
    ]);
    const reviewManifest = {
      schemaVersion: "hs12-product-catalog-review-v1",
      status: "accepted",
      glossaryVersion: "fixture-glossary-v1",
      automaticChecks: [
        "nonempty-zh-hans-v1",
        "source-description-sha256-v1",
        "numeric-and-unit-preservation-v1",
        "formula-and-latin-name-preservation-v1",
        "risk-term-review-v1",
        "chapter-sample-coverage-v1",
      ],
      identities: {
        sourceProductsSha256:
          stagingManifest.dimensionFiles.products.sha256,
        translationsSha256: sha256(translationBytes),
        aliasesSha256: sha256(aliasBytes),
        traditionalToSimplifiedSha256: sha256(conversionBytes),
      },
      methodology: {
        riskRuleVersion: "hs12-catalog-risk-flags-v1",
        sampleStrategy:
          "first-sorted-distinct-code-per-available-risk-stratum-and-chapter-v1",
        representedChapters: ["01", "85"],
      },
      flaggedCodes: ["851712"],
      reviewedCodes: ["010121", "851712"],
      chapterSamples: [
        { chapter: "01", risk: "baseline", codes: ["010121"] },
        { chapter: "85", risk: "scope-language", codes: ["851712"] },
      ],
      reviewer: "fixture-reviewer",
      reviewedAt: "2026-01-22T00:00:00Z",
      disposition: "accepted",
    };
    await writeFile(reviewPath, jsonBytes(reviewManifest));

    const outcome = await runCatalogCli({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "catalog-work"),
      reportPath: join(root, "catalog-report.json"),
    });
    const manifest = JSON.parse(
      await readFile(outcome.catalogManifestPath, "utf8"),
    );
    const report = JSON.parse(await readFile(outcome.reportPath, "utf8"));
    const catalog = JSON.parse(await readFile(outcome.catalogPath, "utf8"));

    expect(outcome.status).toBe("accepted");
    expect(manifest).toMatchObject({
      schemaVersion: "product-catalog-manifest-v1",
      baciRelease: "VTEST001",
      productSearchBuildId: expect.stringMatching(
        /^product-search-v1-[a-f0-9]{16}$/,
      ),
      sourceProducts: {
        rowCount: 2,
        sha256: stagingManifest.dimensionFiles.products.sha256,
      },
      attribution: {
        translation: "Fixture auxiliary translation attribution.",
      },
      counts: {
        products: 2,
        acceptedTranslations: 2,
        aliases: 1,
        traditionalMappings: 10,
        chapters: 2,
      },
      residentSizeGate: {
        measurement: "isolated-v8-heap-used-delta-v1",
        limitBytes: 32 * 1024 * 1024,
        status: "accepted",
      },
      catalog: {
        relativePath: "product-catalog.json",
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(report).toMatchObject({
      schemaVersion: "product-catalog-build-report-v1",
      status: "accepted",
      catalogManifest: manifest,
      validation: {
        sourceProducts: 2,
        acceptedTranslations: 2,
        staleTranslations: 0,
        missingTranslations: 0,
        flaggedCodes: 1,
        reviewedFlaggedCodes: 1,
        coveredChapters: 2,
        residentSizeGate: {
          measurement: "isolated-v8-heap-used-delta-v1",
          measuredBytes: expect.any(Number),
          limitBytes: 32 * 1024 * 1024,
          status: "accepted",
        },
      },
    });
    expect(catalog).toMatchObject({
      schemaVersion: "product-catalog-artifact-v1",
      productSearchBuildId: manifest.productSearchBuildId,
      searchAlgorithmVersion: "deterministic-lexical-product-search-v3",
      searchResponseSchemaVersion: "product-search-result-v1",
      translationAttribution: "Fixture auxiliary translation attribution.",
      products: [
        {
          hsRevision: "HS12",
          code: "010121",
          sourceDescriptionEn:
            "Horses: live, pure-bred breeding animals",
          sourceDescriptionSha256: sha256Text(
            "Horses: live, pure-bred breeding animals",
          ),
          auxiliaryDescriptionZhHans: "纯种繁殖用活马",
          normalizedSourceDescriptionEn:
            "horses live pure bred breeding animals",
          normalizedAuxiliaryDescriptionZhHans: "纯种繁殖用活马",
          translationStatus: "reviewed",
          translationVersion: "fixture-zh-hans-v1",
        },
        {
          hsRevision: "HS12",
          code: "851712",
          sourceDescriptionEn:
            "Telephones for cellular networks or for other wireless networks",
          sourceDescriptionSha256: sha256Text(
            "Telephones for cellular networks or for other wireless networks",
          ),
          auxiliaryDescriptionZhHans: "蜂窝网络或其他无线网络用电话机",
          normalizedSourceDescriptionEn:
            "telephones for cellular networks or for other wireless networks",
          normalizedAuxiliaryDescriptionZhHans: "蜂窝网络或其他无线网络用电话机",
          translationStatus: "reviewed",
          translationVersion: "fixture-zh-hans-v1",
        },
      ],
      aliases: [
        {
          code: "851712",
          alias: "wireless phone",
          normalizedSearchText: "wireless phone",
        },
      ],
    });
    expect(Object.keys(catalog.traditionalToSimplified)).toEqual(
      Object.keys(conversion.mappings).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );

    const productionCatalog = await ImmutableProductCatalog.open({
      catalogPath: outcome.catalogPath,
      catalogManifestPath: outcome.catalogManifestPath,
    });
    await expect(
      productionCatalog.search({
        productSearchBuildId: manifest.productSearchBuildId,
        query: "wireless phone",
        locale: "en",
        limit: 20,
      }),
    ).resolves.toMatchObject({
      schemaVersion: "product-search-result-v1",
      productSearchBuildId: manifest.productSearchBuildId,
      state: "RESULTS",
      totalMatches: 1,
      matches: [
        {
          product: {
            code: "851712",
            sourceDescriptionEn:
              "Telephones for cellular networks or for other wireless networks",
            auxiliaryDescriptionZhHans: "蜂窝网络或其他无线网络用电话机",
          },
          match: {
            class: "EXACT_ALIAS",
            field: "ALIAS_EN",
            matchedText: "wireless phone",
          },
        },
      ],
    });
    for (const parityQuery of [
      { query: "010121", locale: "en" as const },
      { query: "０１０１２１", locale: "en" as const },
      {
        query:
          "Telephones for cellular networks or for other wireless networks",
        locale: "en" as const,
      },
      {
        query: "蜂窩網路或其他無線網路用電話機",
        locale: "zh-Hans" as const,
      },
      { query: "wireless phone", locale: "en" as const },
    ]) {
      const [fixtureParity, productionParity] = await Promise.all([
        createFixtureProductCatalog().search({
          ...parityQuery,
          productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
          limit: 20,
        }),
        productionCatalog.search({
          ...parityQuery,
          productSearchBuildId: manifest.productSearchBuildId,
          limit: 20,
        }),
      ]);
      expect({
        normalized: productionParity.query.normalized,
        state: productionParity.state,
        totalMatches: productionParity.totalMatches,
        truncated: productionParity.truncated,
        matches: productionParity.matches.map(({ product, match }) => ({
          code: product.code,
          match,
        })),
      }).toEqual({
        normalized: fixtureParity.query.normalized,
        state: fixtureParity.state,
        totalMatches: fixtureParity.totalMatches,
        truncated: fixtureParity.truncated,
        matches: fixtureParity.matches.map(({ product, match }) => ({
          code: product.code,
          match,
        })),
      });
    }
    await expect(
      productionCatalog.search({
        productSearchBuildId: "retired-product-search",
        query: "010121",
        locale: "en",
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_SEARCH_BUILD_RETIRED" });

    const staleChecksumCatalog = {
      ...catalog,
      products: [
        {
          ...catalog.products[0],
          sourceDescriptionSha256: "0".repeat(64),
        },
        ...catalog.products.slice(1),
      ],
    };
    const staleChecksumBytes = jsonBytes(staleChecksumCatalog);
    const staleChecksumCatalogPath = join(root, "stale-checksum-catalog.json");
    const staleChecksumManifestPath = join(root, "stale-checksum-manifest.json");
    await Promise.all([
      writeFile(staleChecksumCatalogPath, staleChecksumBytes),
      writeFile(
        staleChecksumManifestPath,
        jsonBytes({
          ...manifest,
          catalog: {
            ...manifest.catalog,
            bytes: staleChecksumBytes.length,
            sha256: sha256(staleChecksumBytes),
          },
        }),
      ),
    ]);
    await expect(
      ImmutableProductCatalog.open({
        catalogPath: staleChecksumCatalogPath,
        catalogManifestPath: staleChecksumManifestPath,
      }),
    ).rejects.toThrow(
      "Catalog source-description checksum does not match its source text.",
    );

    const staleAliasBytes = jsonBytes({
      ...aliases,
      rows: [{ ...aliases.rows[0], normalizedSearchText: "stale alias" }],
    });
    await Promise.all([
      writeFile(aliasesPath, staleAliasBytes),
      writeFile(
        reviewPath,
        jsonBytes({
          ...reviewManifest,
          identities: {
            ...reviewManifest.identities,
            aliasesSha256: sha256(staleAliasBytes),
          },
        }),
      ),
    ]);
    const aliasError = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "stale-alias-work"),
      reportPath: join(root, "stale-alias-report.json"),
    });
    expect(JSON.parse(aliasError.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "Alias normalized search text does not match",
        ),
      },
    });
  }, 20_000);

  it("preserves material quantities and scope while allowing tariff references to be omitted", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const quantitativeSource =
      "Machines: whether or not painted, not electric; weighing more than 185.5g, with a surface weight of 300g/m2 and tolerance 5 x 10 (to the minus 6), or 0.000005, made with Fe2O3, propan-1-ol, propane-1, 2-diol, and horse (Equus caballus)";
    const scopeSource =
      "Telephones: other, not elsewhere specified (excluding wired apparatus), other than apparatus of headings 8471, 8517, and 8525, n.e.c. in 2934.1, 2934.2 and 2934.3 (not 4801 or 4803), item number 2907.2, other than in 2939.11, n.e.c in 84.30";
    const stagingManifest = await rewriteStagedProducts(
      staging.stagingManifestPath,
      [
        {
          code: "010121",
          description: quantitativeSource,
        },
        {
          code: "851712",
          description: scopeSource,
        },
      ],
    );
    const translationsPath = join(root, "translations.json");
    const aliasesPath = join(root, "aliases.json");
    const conversionPath = join(root, "traditional-to-simplified.json");
    const reviewPath = join(root, "review-manifest.json");
    const acceptedTranslations = {
      schemaVersion: "hs12-product-translations-v1",
      baciRelease: "VTEST001",
      locale: "zh-Hans",
      attribution: "Fixture auxiliary translation attribution.",
      translationVersion: "fixture-numeric-review-v1",
      rows: [
        {
          code: "010121",
          description:
            "机器：不论是否涂漆，非电动；重量超过185‧5g，每平方米重量300克，公差5×10⁻⁶，由三氧化二铁(Fe2O3)、正丙醇、丙二醇及马(Equus caballus)制成",
          translationStatus: "reviewed",
          sourceDescriptionSha256: sha256Text(quantitativeSource),
        },
        {
          code: "851712",
          description: "其他未列名电话机（有线设备除外）",
          translationStatus: "reviewed",
          sourceDescriptionSha256: sha256Text(scopeSource),
        },
      ],
    };
    const aliases = {
      schemaVersion: "hs12-product-aliases-v1",
      aliasVersion: "fixture-empty-aliases-v1",
      rows: [],
    };
    const conversion = {
      schemaVersion: "traditional-to-simplified-map-v1",
      dataVersion: "fixture-opencc-v1",
      source: {
        name: "fixture conversion data",
        url: "https://example.invalid/opencc",
        license: "Apache-2.0",
      },
      mappings: { 機: "机" },
    };
    const translationBytes = jsonBytes(acceptedTranslations);
    const aliasBytes = jsonBytes(aliases);
    const conversionBytes = jsonBytes(conversion);
    await Promise.all([
      writeFile(translationsPath, translationBytes),
      writeFile(aliasesPath, aliasBytes),
      writeFile(conversionPath, conversionBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          translationBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);

    await expect(
      runCatalogCli({
        stagingManifestPath: staging.stagingManifestPath,
        translationsPath,
        aliasesPath,
        conversionPath,
        reviewPath,
        workspacePath: join(root, "accepted-work"),
        reportPath: join(root, "accepted-report.json"),
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    const missingFormulaTranslations = {
      ...acceptedTranslations,
      rows: [
        {
          ...acceptedTranslations.rows[0],
          description:
            "其他机器：不论是否涂漆，非电动；重量超过185‧5g，每平方米重量300克，公差5×10⁻⁶，由三氧化二铁、正丙醇、丙二醇及马(Equus caballus)制成",
        },
        acceptedTranslations.rows[1],
      ],
    };
    const missingFormulaBytes = jsonBytes(missingFormulaTranslations);
    await Promise.all([
      writeFile(translationsPath, missingFormulaBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          missingFormulaBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);
    const formulaError = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "missing-formula-work"),
      reportPath: join(root, "missing-formula-report.json"),
    });
    expect(JSON.parse(formulaError.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "010121 does not preserve chemical formulas: Fe2O3",
        ),
      },
    });

    const missingLatinNameTranslations = {
      ...acceptedTranslations,
      rows: [
        {
          ...acceptedTranslations.rows[0],
          description:
            "其他机器：不论是否涂漆，非电动；重量超过185‧5g，每平方米重量300克，公差5×10⁻⁶，由三氧化二铁(Fe2O3)、正丙醇、丙二醇及马制成",
        },
        acceptedTranslations.rows[1],
      ],
    };
    const missingLatinNameBytes = jsonBytes(missingLatinNameTranslations);
    await Promise.all([
      writeFile(translationsPath, missingLatinNameBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          missingLatinNameBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);
    const latinNameError = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "missing-latin-name-work"),
      reportPath: join(root, "missing-latin-name-report.json"),
    });
    expect(JSON.parse(latinNameError.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "010121 does not preserve Latin names: Equus caballus",
        ),
      },
    });

    const missingMaterialTranslations = {
      ...acceptedTranslations,
      rows: [
        {
          ...acceptedTranslations.rows[0],
          description:
            "其他机器：不论是否涂漆，非电动(Fe2O3; Equus caballus)",
        },
        acceptedTranslations.rows[1],
      ],
    };
    const missingMaterialBytes = jsonBytes(missingMaterialTranslations);
    await Promise.all([
      writeFile(translationsPath, missingMaterialBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          missingMaterialBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);

    const error = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "rejected-work"),
      reportPath: join(root, "rejected-report.json"),
    });
    expect(JSON.parse(error.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "010121 does not preserve material numeric tokens: 185.5",
        ),
      },
    });

    const wrongUnitTranslations = {
      ...acceptedTranslations,
      rows: [
        {
          ...acceptedTranslations.rows[0],
          description:
            "其他机器：不论是否涂漆，非电动；重量超过185‧5kg，每平方米重量300克，公差5×10^-6，由Fe2O3及Equus caballus制成",
        },
        acceptedTranslations.rows[1],
      ],
    };
    const wrongUnitBytes = jsonBytes(wrongUnitTranslations);
    await Promise.all([
      writeFile(translationsPath, wrongUnitBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          wrongUnitBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);

    const unitError = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "wrong-unit-work"),
      reportPath: join(root, "wrong-unit-report.json"),
    });
    expect(JSON.parse(unitError.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "010121 does not preserve material units: g",
        ),
      },
    });

    const reversedDirectionTranslations = {
      ...acceptedTranslations,
      rows: [
        {
          ...acceptedTranslations.rows[0],
          description:
            "其他机器：不论是否涂漆，非电动；重量不超过185‧5g，每平方米重量300克，公差5×10^-6，由Fe2O3及Equus caballus制成",
        },
        acceptedTranslations.rows[1],
      ],
    };
    const reversedDirectionBytes = jsonBytes(reversedDirectionTranslations);
    await Promise.all([
      writeFile(translationsPath, reversedDirectionBytes),
      writeFile(
        reviewPath,
        reviewBytes(
          stagingManifest.dimensionFiles.products.sha256,
          reversedDirectionBytes,
          aliasBytes,
          conversionBytes,
          ["010121", "851712"],
        ),
      ),
    ]);

    const directionError = await runCatalogCliFailure({
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
      workspacePath: join(root, "reversed-direction-work"),
      reportPath: join(root, "reversed-direction-report.json"),
    });
    expect(JSON.parse(directionError.stderr)).toMatchObject({
      error: {
        code: "CATALOG_INPUT_INVALID",
        message: expect.stringContaining(
          "010121 does not preserve inequality direction: more-than",
        ),
      },
    });

    const scopeCases = [
      {
        name: "missing-other",
        row: acceptedTranslations.rows[0],
        otherRow: {
          ...acceptedTranslations.rows[1],
          description: "未列名电话机（有线设备除外）",
        },
        message: "851712 does not preserve scope qualifiers: other",
      },
      {
        name: "missing-whether",
        row: {
          ...acceptedTranslations.rows[0],
          description:
            "机器：已涂漆，非电动；重量超过185‧5g，每平方米重量300克，公差5×10⁻⁶，由三氧化二铁(Fe2O3)、正丙醇、丙二醇及马(Equus caballus)制成",
        },
        otherRow: acceptedTranslations.rows[1],
        message: "010121 does not preserve scope qualifiers: whether-or-not",
      },
      {
        name: "missing-not",
        row: {
          ...acceptedTranslations.rows[0],
          description:
            "机器：不论是否涂漆，电动；重量超过185‧5g，每平方米重量300克，公差5×10⁻⁶，由三氧化二铁(Fe2O3)、正丙醇、丙二醇及马(Equus caballus)制成",
        },
        otherRow: acceptedTranslations.rows[1],
        message: "010121 does not preserve scope qualifiers: not",
      },
    ];
    for (const testCase of scopeCases) {
      const translations = {
        ...acceptedTranslations,
        rows: [testCase.row, testCase.otherRow],
      };
      const bytes = jsonBytes(translations);
      await Promise.all([
        writeFile(translationsPath, bytes),
        writeFile(
          reviewPath,
          reviewBytes(
            stagingManifest.dimensionFiles.products.sha256,
            bytes,
            aliasBytes,
            conversionBytes,
            ["010121", "851712"],
          ),
        ),
      ]);
      const scopeError = await runCatalogCliFailure({
        stagingManifestPath: staging.stagingManifestPath,
        translationsPath,
        aliasesPath,
        conversionPath,
        reviewPath,
        workspacePath: join(root, `${testCase.name}-work`),
        reportPath: join(root, `${testCase.name}-report.json`),
      });
      expect(JSON.parse(scopeError.stderr)).toMatchObject({
        error: {
          code: "CATALOG_INPUT_INVALID",
          message: expect.stringContaining(testCase.message),
        },
      });
    }
  }, 70_000);

  it("detects omitted exclusion and not-elsewhere-specified qualifiers", () => {
    expect(
      missingScopeQualifiers(
        "Telephones excluding wired apparatus",
        "电话机",
      ),
    ).toEqual(["exclusion"]);
    expect(
      missingScopeQualifiers(
        "Telephones, not elsewhere specified",
        "电话机",
      ),
    ).toEqual(["not-elsewhere-specified"]);
  });

  it("rolls back a new catalog when report publication fails", async () => {
    const root = await temporaryWorkspace();
    const fixture = await prepareValidCatalogFixture(root);
    const workspacePath = join(root, "catalog-work");
    const reportPath = join(root, "report-target");
    await mkdir(reportPath);

    const error = await runCatalogCliFailure({
      ...fixture.paths,
      workspacePath,
      reportPath,
    });

    expect(JSON.parse(error.stderr)).toMatchObject({
      error: {
        code: "CATALOG_PUBLICATION_FAILED",
        message: expect.stringContaining("Catalog publication failed"),
      },
    });
    await expect(readdir(join(workspacePath, "catalogs"))).resolves.toEqual([]);
  }, 20_000);

  it("rejects missing, duplicate, and stale translation rows", async () => {
    const root = await temporaryWorkspace();
    const fixture = await prepareValidCatalogFixture(root);
    const stagingManifest = JSON.parse(
      await readFile(fixture.paths.stagingManifestPath, "utf8"),
    ) as MutableStagingManifest;
    const translations = JSON.parse(
      await readFile(fixture.paths.translationsPath, "utf8"),
    ) as { rows: Record<string, unknown>[] };
    const [aliasBytes, conversionBytes] = await Promise.all([
      readFile(fixture.paths.aliasesPath),
      readFile(fixture.paths.conversionPath),
    ]);
    const cases = [
      {
        name: "missing",
        rows: translations.rows.slice(0, 1),
        message: "coverage must be complete",
      },
      {
        name: "duplicate",
        rows: [translations.rows[0], translations.rows[0]],
        message: "translation code values must be unique",
      },
      {
        name: "stale",
        rows: [
          {
            ...translations.rows[0],
            sourceDescriptionSha256: "0".repeat(64),
          },
          translations.rows[1],
        ],
        message: "stale source-description checksum",
      },
    ];

    for (const testCase of cases) {
      const translationsPath = join(
        root,
        `${testCase.name}-translations.json`,
      );
      const reviewPath = join(root, `${testCase.name}-review.json`);
      const translationBytes = jsonBytes({
        ...translations,
        rows: testCase.rows,
      });
      await Promise.all([
        writeFile(translationsPath, translationBytes),
        writeFile(
          reviewPath,
          reviewBytes(
            stagingManifest.dimensionFiles.products.sha256,
            translationBytes,
            aliasBytes,
            conversionBytes,
            ["851712"],
          ),
        ),
      ]);

      const error = await runCatalogCliFailure({
        ...fixture.paths,
        translationsPath,
        reviewPath,
        workspacePath: join(root, `${testCase.name}-work`),
        reportPath: join(root, `${testCase.name}-report.json`),
      });
      expect(JSON.parse(error.stderr)).toMatchObject({
        error: {
          code: "CATALOG_INPUT_INVALID",
          message: expect.stringContaining(testCase.message),
        },
      });
    }
  }, 20_000);

  it("rejects mismatched, incomplete, and under-sampled reviews", async () => {
    const root = await temporaryWorkspace();
    const fixture = await prepareValidCatalogFixture(root);
    const baseReview = JSON.parse(
      await readFile(fixture.paths.reviewPath, "utf8"),
    ) as Record<string, unknown>;
    const baseIdentities = baseReview.identities as Record<string, unknown>;
    const baseSamples = baseReview.chapterSamples as Record<string, unknown>[];
    const cases = [
      {
        name: "identity",
        review: {
          ...baseReview,
          identities: {
            ...baseIdentities,
            translationsSha256: "0".repeat(64),
          },
        },
        message: "identities do not match",
      },
      {
        name: "flagged",
        review: { ...baseReview, reviewedCodes: ["010121"] },
        message: "Every flagged translation must be reviewed",
      },
      {
        name: "chapter",
        review: {
          ...baseReview,
          chapterSamples: baseSamples.filter(
            (sample) => sample.chapter !== "85",
          ),
        },
        message: "risk-stratified samples do not match",
      },
      {
        name: "risk-label",
        review: {
          ...baseReview,
          chapterSamples: baseSamples.map((sample, index) =>
            index === 0 ? { ...sample, risk: "scope-language" } : sample,
          ),
        },
        message: "risk-stratified samples do not match",
      },
    ];

    for (const testCase of cases) {
      const reviewPath = join(root, `${testCase.name}-review.json`);
      await writeFile(reviewPath, jsonBytes(testCase.review));
      const error = await runCatalogCliFailure({
        ...fixture.paths,
        reviewPath,
        workspacePath: join(root, `${testCase.name}-work`),
        reportPath: join(root, `${testCase.name}-report.json`),
      });
      expect(JSON.parse(error.stderr)).toMatchObject({
        error: {
          code: "CATALOG_INPUT_INVALID",
          message: expect.stringContaining(testCase.message),
        },
      });
    }
  }, 20_000);

  it("keeps product-search identity stable across review-evidence-only changes", async () => {
    const root = await temporaryWorkspace();
    const fixture = await prepareValidCatalogFixture(root);
    const before = await runCatalogCli({
      ...fixture.paths,
      workspacePath: join(root, "before-work"),
      reportPath: join(root, "before-report.json"),
    });
    const review = JSON.parse(
      await readFile(fixture.paths.reviewPath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      fixture.paths.reviewPath,
      jsonBytes({
        ...review,
        reviewer: "second-fixture-reviewer",
        reviewedAt: "2026-01-23T00:00:00Z",
      }),
    );
    const after = await runCatalogCli({
      ...fixture.paths,
      workspacePath: join(root, "after-work"),
      reportPath: join(root, "after-report.json"),
    });
    const [beforeManifest, afterManifest, beforeCatalog, afterCatalog] =
      await Promise.all([
        readFile(before.catalogManifestPath, "utf8").then(JSON.parse),
        readFile(after.catalogManifestPath, "utf8").then(JSON.parse),
        readFile(before.catalogPath),
        readFile(after.catalogPath),
      ]);

    expect(afterManifest.productSearchBuildId).toBe(
      beforeManifest.productSearchBuildId,
    );
    expect(afterManifest.inputs.reviewManifestSha256).not.toBe(
      beforeManifest.inputs.reviewManifestSha256,
    );
    expect(afterCatalog).toEqual(beforeCatalog);
  }, 20_000);

  it(
    "changes only product-search identity for translation- and alias-only edits",
    async () => {
      const root = await temporaryWorkspace();
      const fixture = await prepareValidCatalogFixture(root);
      const analysis = await runAnalysisArtifactCli({
        stagingManifestPath: fixture.paths.stagingManifestPath,
        workspacePath: join(root, "analysis-work"),
        reportPath: join(root, "analysis-report.json"),
      });
      const [analysisManifestBefore, analysisBytesBefore] = await Promise.all([
        readFile(analysis.artifactManifestPath),
        readFile(analysis.artifactPath),
      ]);
      const catalogBefore = await runCatalogCli({
        ...fixture.paths,
        workspacePath: join(root, "catalog-work"),
        reportPath: join(root, "catalog-before-report.json"),
      });
      const manifestBefore = JSON.parse(
        await readFile(catalogBefore.catalogManifestPath, "utf8"),
      );
      const translations = JSON.parse(
        await readFile(fixture.paths.translationsPath, "utf8"),
      ) as { translationVersion: string; rows: Record<string, unknown>[] };
      const originalTranslationBytes = jsonBytes(translations);
      const changedTranslationBytes = jsonBytes({
        ...translations,
        translationVersion: "fixture-zh-hans-v2",
        rows: [
          {
            ...translations.rows[0],
            description: "经审校的纯种繁殖用活马",
          },
          translations.rows[1],
        ],
      });
      const stagingManifest = JSON.parse(
        await readFile(fixture.paths.stagingManifestPath, "utf8"),
      ) as MutableStagingManifest;
      const [aliasBytes, conversionBytes] = await Promise.all([
        readFile(fixture.paths.aliasesPath),
        readFile(fixture.paths.conversionPath),
      ]);
      await Promise.all([
        writeFile(fixture.paths.translationsPath, changedTranslationBytes),
        writeFile(
          fixture.paths.reviewPath,
          reviewBytes(
            stagingManifest.dimensionFiles.products.sha256,
            changedTranslationBytes,
            aliasBytes,
            conversionBytes,
            ["851712"],
          ),
        ),
      ]);

      const catalogAfter = await runCatalogCli({
        ...fixture.paths,
        workspacePath: join(root, "catalog-work"),
        reportPath: join(root, "catalog-after-report.json"),
      });
      const manifestAfter = JSON.parse(
        await readFile(catalogAfter.catalogManifestPath, "utf8"),
      );
      const [analysisManifestAfter, analysisBytesAfter] = await Promise.all([
        readFile(analysis.artifactManifestPath),
        readFile(analysis.artifactPath),
      ]);

      expect(manifestAfter.productSearchBuildId).not.toBe(
        manifestBefore.productSearchBuildId,
      );
      expect(manifestAfter.sourceProducts.sha256).toBe(
        manifestBefore.sourceProducts.sha256,
      );
      expect(analysisManifestAfter).toEqual(analysisManifestBefore);
      expect(sha256(analysisBytesAfter)).toBe(sha256(analysisBytesBefore));

      const aliases = JSON.parse(aliasBytes.toString("utf8")) as {
        aliasVersion: string;
        rows: Record<string, unknown>[];
      };
      const changedAliasBytes = jsonBytes({
        ...aliases,
        aliasVersion: "fixture-aliases-v2",
        rows: [
          ...aliases.rows,
          {
            code: "010121",
            locale: "en",
            alias: "breeding horse",
            normalizedSearchText: "breeding horse",
            aliasKind: "common-language",
            reviewStatus: "reviewed",
            reviewer: "fixture-reviewer",
          },
        ],
      });
      await Promise.all([
        writeFile(fixture.paths.translationsPath, originalTranslationBytes),
        writeFile(fixture.paths.aliasesPath, changedAliasBytes),
        writeFile(
          fixture.paths.reviewPath,
          reviewBytes(
            stagingManifest.dimensionFiles.products.sha256,
            originalTranslationBytes,
            changedAliasBytes,
            conversionBytes,
            ["851712"],
          ),
        ),
      ]);
      const aliasCatalog = await runCatalogCli({
        ...fixture.paths,
        workspacePath: join(root, "catalog-work"),
        reportPath: join(root, "catalog-alias-report.json"),
      });
      const aliasManifest = JSON.parse(
        await readFile(aliasCatalog.catalogManifestPath, "utf8"),
      );
      expect(aliasManifest.productSearchBuildId).not.toBe(
        manifestBefore.productSearchBuildId,
      );
      expect(aliasManifest.sourceProducts.sha256).toBe(
        manifestBefore.sourceProducts.sha256,
      );
      expect(await readFile(analysis.artifactManifestPath)).toEqual(
        analysisManifestBefore,
      );
      expect(sha256(await readFile(analysis.artifactPath))).toBe(
        sha256(analysisBytesBefore),
      );
    },
    40_000,
  );
});

async function temporaryWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hs-tracker-product-catalog-"));
  temporaryDirectories.push(path);
  return path;
}

async function stageSafeFixture(
  workspace: string,
): Promise<{ stagingManifestPath: string }> {
  const { stdout } = await execFileAsync(
    "npm",
    [
      "run",
      "--silent",
      "stage:baci",
      "--",
      "--descriptor",
      resolve("test/fixtures/pipeline/v1/safe-source.json"),
      "--approval",
      resolve("test/fixtures/pipeline/v1/safe-coverage-approval.json"),
      "--archive",
      resolve("test/fixtures/pipeline/v1/archives/safe-baci.zip"),
      "--workspace",
      workspace,
      "--report",
      join(workspace, "source-report.json"),
    ],
    { timeout: 60_000 },
  );
  return JSON.parse(stdout);
}

async function runCatalogCli({
  stagingManifestPath,
  translationsPath,
  aliasesPath,
  conversionPath,
  reviewPath,
  workspacePath,
  reportPath,
}: {
  stagingManifestPath: string;
  translationsPath: string;
  aliasesPath: string;
  conversionPath: string;
  reviewPath: string;
  workspacePath: string;
  reportPath: string;
}): Promise<{
  status: string;
  catalogPath: string;
  catalogManifestPath: string;
  reportPath: string;
}> {
  const { stdout } = await execFileAsync(
    "npm",
    [
      "run",
      "--silent",
      "build:product-catalog",
      "--",
      "--staging-manifest",
      stagingManifestPath,
      "--translations",
      translationsPath,
      "--aliases",
      aliasesPath,
      "--traditional-to-simplified",
      conversionPath,
      "--review-manifest",
      reviewPath,
      "--workspace",
      workspacePath,
      "--report",
      reportPath,
      "--pipeline-git-sha",
      "0".repeat(40),
      "--built-at",
      "2026-01-22T00:00:00Z",
    ],
    { timeout: 120_000 },
  );
  return JSON.parse(stdout);
}

async function runCatalogCliFailure(
  options: Parameters<typeof runCatalogCli>[0],
): Promise<{ stderr: string }> {
  try {
    await runCatalogCli(options);
  } catch (error) {
    return error as { stderr: string };
  }
  throw new Error("Expected catalog build to fail.");
}

async function runAnalysisArtifactCli({
  stagingManifestPath,
  workspacePath,
  reportPath,
}: {
  stagingManifestPath: string;
  workspacePath: string;
  reportPath: string;
}): Promise<{ artifactPath: string; artifactManifestPath: string }> {
  const { stdout } = await execFileAsync(
    "npm",
    [
      "run",
      "--silent",
      "build:analysis-artifact",
      "--",
      "--staging-manifest",
      stagingManifestPath,
      "--workspace",
      workspacePath,
      "--report",
      reportPath,
      "--pipeline-git-sha",
      "0".repeat(40),
      "--built-at",
      "2026-01-22T00:00:00Z",
    ],
    { timeout: 120_000 },
  );
  return JSON.parse(stdout);
}

async function rewriteStagedProducts(
  stagingManifestPath: string,
  rows: { code: string; description: string }[],
): Promise<MutableStagingManifest> {
  const manifest = JSON.parse(
    await readFile(stagingManifestPath, "utf8"),
  ) as MutableStagingManifest;
  const productsPath = join(
    dirname(stagingManifestPath),
    manifest.dimensionFiles.products.relativePath,
  );
  const temporaryPath = `${productsPath}.replacement`;
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const values = rows
      .map(
        ({ code, description }) =>
          `(${sqlString(code)}, ${sqlString(description)})`,
      )
      .join(", ");
    await connection.run(`
      COPY (
        SELECT hs12_code, source_description
        FROM (VALUES ${values}) source(hs12_code, source_description)
        ORDER BY hs12_code
      ) TO ${sqlString(temporaryPath)}
      (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  await rename(temporaryPath, productsPath);
  const bytes = await readFile(productsPath);
  manifest.dimensionFiles.products = {
    ...manifest.dimensionFiles.products,
    rowCount: rows.length,
    bytes: (await stat(productsPath)).size,
    sha256: sha256(bytes),
  };
  await writeFile(stagingManifestPath, jsonBytes(manifest));
  return manifest;
}

async function prepareValidCatalogFixture(root: string): Promise<{
  paths: {
    stagingManifestPath: string;
    translationsPath: string;
    aliasesPath: string;
    conversionPath: string;
    reviewPath: string;
  };
}> {
  const staging = await stageSafeFixture(join(root, "staging-work"));
  const stagingManifest = JSON.parse(
    await readFile(staging.stagingManifestPath, "utf8"),
  ) as MutableStagingManifest;
  const translationsPath = join(root, "translations.json");
  const aliasesPath = join(root, "aliases.json");
  const conversionPath = join(root, "traditional-to-simplified.json");
  const reviewPath = join(root, "review-manifest.json");
  const translationBytes = jsonBytes({
    schemaVersion: "hs12-product-translations-v1",
    baciRelease: "VTEST001",
    locale: "zh-Hans",
    attribution: "Fixture auxiliary translation attribution.",
    translationVersion: "fixture-zh-hans-v1",
    rows: [
      {
        code: "010121",
        description: "纯种繁殖用活马",
        translationStatus: "reviewed",
        sourceDescriptionSha256: sha256Text(
          "Horses: live, pure-bred breeding animals",
        ),
      },
      {
        code: "851712",
        description: "蜂窝网络或其他无线网络用电话机",
        translationStatus: "reviewed",
        sourceDescriptionSha256: sha256Text(
          "Telephones for cellular networks or for other wireless networks",
        ),
      },
    ],
  });
  const aliasBytes = jsonBytes({
    schemaVersion: "hs12-product-aliases-v1",
    aliasVersion: "fixture-aliases-v1",
    rows: [],
  });
  const conversionBytes = jsonBytes({
    schemaVersion: "traditional-to-simplified-map-v1",
    dataVersion: "fixture-opencc-v1",
    source: {
      name: "fixture conversion data",
      url: "https://example.invalid/opencc",
      license: "Apache-2.0",
    },
    mappings: { 馬: "马" },
  });
  await Promise.all([
    writeFile(translationsPath, translationBytes),
    writeFile(aliasesPath, aliasBytes),
    writeFile(conversionPath, conversionBytes),
    writeFile(
      reviewPath,
      reviewBytes(
        stagingManifest.dimensionFiles.products.sha256,
        translationBytes,
        aliasBytes,
        conversionBytes,
        ["851712"],
      ),
    ),
  ]);
  return {
    paths: {
      stagingManifestPath: staging.stagingManifestPath,
      translationsPath,
      aliasesPath,
      conversionPath,
      reviewPath,
    },
  };
}

function reviewBytes(
  sourceProductsSha256: string,
  translations: Buffer,
  aliases: Buffer,
  conversion: Buffer,
  flaggedCodes: string[],
): Buffer {
  return jsonBytes({
    schemaVersion: "hs12-product-catalog-review-v1",
    status: "accepted",
    glossaryVersion: "fixture-glossary-v1",
    automaticChecks: [
      "nonempty-zh-hans-v1",
      "source-description-sha256-v1",
      "numeric-and-unit-preservation-v1",
      "formula-and-latin-name-preservation-v1",
      "risk-term-review-v1",
      "chapter-sample-coverage-v1",
    ],
    identities: {
      sourceProductsSha256,
      translationsSha256: sha256(translations),
      aliasesSha256: sha256(aliases),
      traditionalToSimplifiedSha256: sha256(conversion),
    },
    methodology: {
      riskRuleVersion: "hs12-catalog-risk-flags-v1",
      sampleStrategy:
        "first-sorted-distinct-code-per-available-risk-stratum-and-chapter-v1",
      representedChapters: ["01", "85"],
    },
    flaggedCodes,
    reviewedCodes: ["010121", "851712"],
    chapterSamples: flaggedCodes.includes("010121")
      ? [
          { chapter: "01", risk: "quantitative", codes: ["010121"] },
          { chapter: "85", risk: "quantitative", codes: ["851712"] },
        ]
      : [
          { chapter: "01", risk: "baseline", codes: ["010121"] },
          { chapter: "85", risk: "scope-language", codes: ["851712"] },
        ],
    reviewer: "fixture-reviewer",
    reviewedAt: "2026-01-22T00:00:00Z",
    disposition: "accepted",
  });
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Text(value: string): string {
  return sha256(Buffer.from(value, "utf8"));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
