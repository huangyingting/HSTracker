import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
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

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("offline HS12 translation catalog CLI", () => {
  it("joins pinned terminology and reviewed corrections to exact BACI source rows", async () => {
    const root = await temporaryWorkspace();
    const staging = await stageSafeFixture(join(root, "staging-work"));
    const technicalSourceDescription =
      "Horses: live, pure-bred breeding animals (Equus caballus), evaluated as Fe2o3";
    await rewriteStagedProducts(staging.stagingManifestPath, [
      {
        code: "010121",
        description: technicalSourceDescription,
      },
      {
        code: "851712",
        description:
          "Telephones for cellular networks or for other wireless networks",
      },
    ]);
    const terminologyPath = join(root, "terminology.json");
    const correctionsPath = join(root, "corrections.json");
    const modelCorrectionsPath = join(root, "model-corrections.json");
    const conversionPath = join(root, "traditional-to-simplified.json");
    const outputPath = join(root, "translations.json");
    const reportPath = join(root, "translation-report.json");

    await Promise.all([
      writeFile(
        terminologyPath,
        jsonBytes({
          schemaVersion: "hs12-zh-terminology-v1",
          terminologyVersion: "fixture-taiwan-hs2012-v1",
          source: {
            name: "Fixture HS2012 terminology",
            url: "https://example.invalid/hs2012.ods",
            license: "OGDL-Taiwan-1.0",
            sha256: "1".repeat(64),
          },
          rows: [
            { level: 4, code: "0101", descriptionZhHant: "馬、驢及騾" },
            { level: 5, code: "01012", descriptionZhHant: "－馬：" },
            { level: 6, code: "010121", descriptionZhHant: "純種繁殖用" },
            {
              level: 4,
              code: "8517",
              descriptionZhHant: "電話機及其他通訊器具",
            },
            {
              level: 5,
              code: "85171",
              descriptionZhHant: "－電話機︰",
            },
            {
              level: 6,
              code: "851712",
              descriptionZhHant: "蜂巢式網路或其他無線網路電話（1‧5伏）",
            },
          ],
        }),
      ),
      writeFile(
        correctionsPath,
        jsonBytes({
          schemaVersion: "hs12-zh-translation-corrections-v1",
          correctionVersion: "fixture-reviewed-v1",
          generator: {
            method: "manual",
            name: "fixture-review",
            version: "1",
            evidenceSha256: "2".repeat(64),
          },
          rows: [],
        }),
      ),
      writeFile(
        modelCorrectionsPath,
        jsonBytes({
          schemaVersion: "hs12-zh-translation-corrections-v1",
          correctionVersion: "fixture-model-reviewed-v1",
          generator: {
            method: "model-assisted",
            name: "fixture-model",
            version: "1",
            modelSha256: "3".repeat(64),
            promptVersion: "fixture-prompt-v1",
          },
          rows: [
            {
              code: "010121",
              description: "纯种繁殖用活马",
              reasons: ["reviewed-word-order"],
              reviewer: "fixture-reviewer",
              reviewedAt: "2026-01-22T00:00:00Z",
              sourceDescriptionSha256: sha256Text(technicalSourceDescription),
            },
          ],
        }),
      ),
      writeFile(
        conversionPath,
        jsonBytes({
          schemaVersion: "traditional-to-simplified-map-v1",
          dataVersion: "fixture-opencc-v1",
          source: {
            name: "Fixture OpenCC map",
            url: "https://example.invalid/opencc",
            license: "Apache-2.0",
          },
          mappings: {
            馬: "马",
            驢: "驴",
            騾: "骡",
            純: "纯",
            種: "种",
            電: "电",
            話: "话",
            機: "机",
            訊: "讯",
            網路: "网络",
            網: "网",
            絡: "络",
            無: "无",
            線: "线",
          },
        }),
      ),
    ]);

    const { stdout } = await execFileAsync(
      "npm",
      [
        "run",
        "--silent",
        "build:product-translations",
        "--",
        "--staging-manifest",
        staging.stagingManifestPath,
        "--terminology",
        terminologyPath,
        "--corrections",
        correctionsPath,
        "--corrections",
        modelCorrectionsPath,
        "--traditional-to-simplified",
        conversionPath,
        "--output",
        outputPath,
        "--report",
        reportPath,
      ],
      { timeout: 60_000 },
    );

    const outcome = JSON.parse(stdout);
    const translations = JSON.parse(await readFile(outputPath, "utf8"));
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    expect(outcome).toEqual({
      status: "accepted",
      translationsPath: outputPath,
      reportPath,
    });
    expect(translations).toMatchObject({
      schemaVersion: "hs12-product-translations-v1",
      baciRelease: "VTEST001",
      locale: "zh-Hans",
      attribution:
        "HS Tracker project auxiliary Simplified-Chinese translation of CEPII BACI source descriptions; terminology adapted from Fixture HS2012 terminology (OGDL-Taiwan-1.0).",
      translationVersion: expect.stringMatching(
        /^hs12-zh-hans-v1-[a-f0-9]{16}$/,
      ),
      generator: {
        algorithm: "official-hierarchy-with-reviewed-corrections-v4",
        terminologyVersion: "fixture-taiwan-hs2012-v1",
        correctionVersions: [
          "fixture-reviewed-v1",
          "fixture-model-reviewed-v1",
        ],
        conversionVersion: "fixture-opencc-v1",
      },
      rows: [
        {
          code: "010121",
          description: "纯种繁殖用活马 (Equus caballus; Fe2o3)",
          translationStatus: "reviewed",
          sourceDescriptionSha256: sha256Text(technicalSourceDescription),
        },
        {
          code: "851712",
          description:
            "电话机及其他通讯器具：电话机：蜂巢式网络或其他无线网络电话(1.5伏)",
          translationStatus: "machine-assisted",
          sourceDescriptionSha256: sha256Text(
            "Telephones for cellular networks or for other wireless networks",
          ),
        },
      ],
    });
    expect(report).toMatchObject({
      schemaVersion: "hs12-translation-build-report-v1",
      status: "accepted",
      validation: {
        sourceProducts: 2,
        translations: 2,
        reviewedCorrections: 1,
        terminologyRows: 6,
        missingTranslations: 0,
        staleCorrections: 0,
        legacyGlyphs: 0,
      },
      outputs: {
        translations: {
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });

    const malformedCorrections = JSON.parse(
      await readFile(modelCorrectionsPath, "utf8"),
    );
    malformedCorrections.rows[0].description =
      "修正后的中文：纯种繁殖用活马�";
    await writeFile(modelCorrectionsPath, jsonBytes(malformedCorrections));
    const malformedError = await expectCommandFailure([
      "run",
      "--silent",
      "build:product-translations",
      "--",
      "--staging-manifest",
      staging.stagingManifestPath,
      "--terminology",
      terminologyPath,
      "--corrections",
      correctionsPath,
      "--corrections",
      modelCorrectionsPath,
      "--traditional-to-simplified",
      conversionPath,
      "--output",
      join(root, "malformed-translations.json"),
      "--report",
      join(root, "malformed-translation-report.json"),
    ]);
    expect(JSON.parse(malformedError.stderr)).toMatchObject({
      error: {
        code: "TRANSLATION_INPUT_INVALID",
        message: expect.stringContaining(
          "Translation 010121 contains invalid generated text",
        ),
      },
    });

    malformedCorrections.rows[0].description =
      "纯种繁殖用活马################################";
    await writeFile(modelCorrectionsPath, jsonBytes(malformedCorrections));
    const placeholderError = await expectCommandFailure([
      "run",
      "--silent",
      "build:product-translations",
      "--",
      "--staging-manifest",
      staging.stagingManifestPath,
      "--terminology",
      terminologyPath,
      "--corrections",
      correctionsPath,
      "--corrections",
      modelCorrectionsPath,
      "--traditional-to-simplified",
      conversionPath,
      "--output",
      join(root, "placeholder-translations.json"),
      "--report",
      join(root, "placeholder-translation-report.json"),
    ]);
    expect(JSON.parse(placeholderError.stderr)).toMatchObject({
      error: {
        code: "TRANSLATION_INPUT_INVALID",
        message: expect.stringContaining(
          "Translation 010121 contains invalid generated text",
        ),
      },
    });
  }, 20_000);

  it("rejects a missing pinned input without publishing outputs", async () => {
    const root = await temporaryWorkspace();
    const outputPath = join(root, "translations.json");
    const reportPath = join(root, "translation-report.json");

    const error = await expectCommandFailure([
      "run",
      "--silent",
      "build:product-translations",
      "--",
      "--staging-manifest",
      join(root, "missing-staging-manifest.json"),
      "--terminology",
      join(root, "missing-terminology.json"),
      "--corrections",
      join(root, "missing-corrections.json"),
      "--traditional-to-simplified",
      join(root, "missing-conversion.json"),
      "--output",
      outputPath,
      "--report",
      reportPath,
    ]);

    expect(JSON.parse(error.stderr)).toMatchObject({
      error: {
        code: "TRANSLATION_INPUT_INVALID",
        message: expect.stringContaining("could not be read"),
      },
    });
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hs-tracker-translations-"));
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
      resolve("fixtures/pipeline/v1/safe-source.json"),
      "--approval",
      resolve("fixtures/pipeline/v1/safe-coverage-approval.json"),
      "--archive",
      resolve("fixtures/pipeline/v1/archives/safe-baci.zip"),
      "--workspace",
      workspace,
      "--report",
      join(workspace, "source-report.json"),
    ],
    { timeout: 60_000 },
  );
  return JSON.parse(stdout);
}

async function rewriteStagedProducts(
  stagingManifestPath: string,
  rows: { code: string; description: string }[],
): Promise<void> {
  const manifest = JSON.parse(await readFile(stagingManifestPath, "utf8")) as {
    dimensionFiles: {
      products: {
        relativePath: string;
        rowCount: number;
        bytes: number;
        sha256: string;
      };
    };
  };
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
          `('${code.replaceAll("'", "''")}', '${description.replaceAll("'", "''")}')`,
      )
      .join(", ");
    await connection.run(`
      COPY (
        SELECT hs12_code, source_description
        FROM (VALUES ${values}) source(hs12_code, source_description)
        ORDER BY hs12_code
      ) TO '${temporaryPath.replaceAll("'", "''")}'
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
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(stagingManifestPath, jsonBytes(manifest));
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function expectCommandFailure(args: string[]): Promise<{
  stderr: string;
}> {
  try {
    await execFileAsync("npm", args, { timeout: 60_000 });
  } catch (error) {
    return error as { stderr: string };
  }
  throw new Error("Expected command to fail.");
}
