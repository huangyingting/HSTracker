import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  Readable,
  Transform,
  type TransformCallback,
} from "node:stream";
import { crc32 } from "node:zlib";

import {
  DuckDBInstance,
  type DuckDBConnection,
} from "@duckdb/node-api";
import {
  openPromise as openZip,
  type Entry as ZipEntry,
} from "yauzl";

const TRADE_HEADER = "t,i,j,k,v,q";
const SOURCE_MILL_PRECISION_TOLERANCE = "0.000001";
const MAX_EXTRACTED_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_DOCUMENTATION_BYTES = 1024 * 1024;
const PARQUET_SCHEMA = [
  ["year", "USMALLINT", false],
  ["exporter_code", "USMALLINT", false],
  ["importer_code", "USMALLINT", false],
  ["product_code", "VARCHAR", false],
  ["value_kusd", "DECIMAL(38,3)", false],
  ["quantity_tons", "DECIMAL(38,3)", true],
] as const;
const PRODUCT_DIMENSION_SCHEMA = [
  ["hs12_code", "VARCHAR", false],
  ["source_description", "VARCHAR", false],
] as const;
const ECONOMY_DIMENSION_SCHEMA = [
  ["economy_code", "USMALLINT", false],
  ["display_name", "VARCHAR", false],
  ["iso2", "VARCHAR", true],
  ["iso3", "VARCHAR", true],
] as const;

type TradeMember = {
  year: number;
  path: string;
};

type SourceDescriptor = {
  schemaVersion: "baci-source-descriptor-v1";
  baciRelease: string;
  sourceUrl: string;
  archiveFilename: string;
  expectedBytes: number;
  expectedSha256: string;
  sourceUpdateDate: string;
  hsRevision: "HS12";
  ingestedYears: number[];
  finalizedYears: number[];
  provisionalYears: number[];
  scoreWindow: {
    start: number;
    end: number;
  };
  members: {
    trade: TradeMember[];
    products: {
      path: string;
      header: string;
    };
    economies: {
      path: string;
      header: string;
    };
    documentation: {
      path: string;
    };
  };
  expectedDimensions: {
    products: number;
    economies: number;
  };
  license: {
    name: string;
    url: string;
  };
  attribution: string;
  pinApproval: {
    approvedBy: string;
    approvedAt: string;
    evidenceUrl: string;
  };
};

export type AnnualSourceCheck = {
  year: number;
  rowCount: number;
  exporterCount: number;
  importerCount: number;
  observedProductCount: number;
  quantityPresentCount: number;
  quantityNullCount: number;
  valueTotalKusd: string;
  quantityTotalTons: string;
};

type CoverageApproval = {
  schemaVersion: "baci-source-coverage-approval-v1";
  sourceSha256: string;
  annualChecks: AnnualSourceCheck[];
  approvedBy: string;
  approvedAt: string;
  rationale: string;
  evidenceUrl: string;
};

type ArchiveMemberCheck = {
  path: string;
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: string;
};

type StagingPartition = {
  year: number;
  relativePath: string;
  rowCount: number;
  bytes: number;
  sha256: string;
};

type StagingDimensionFile = {
  relativePath: string;
  rowCount: number;
  bytes: number;
  sha256: string;
  schema: {
    name: string;
    type: string;
    nullable: boolean;
  }[];
};

type StagingDimensionFiles = {
  products: StagingDimensionFile;
  economies: StagingDimensionFile;
};

export type StageBaciReleaseOptions = {
  descriptorPath: string;
  approvalPath: string;
  archivePath?: string;
  workspacePath: string;
  reportPath: string;
};

export type StageBaciReleaseOutcome = {
  status: "accepted";
  reportPath: string;
  stagingManifestPath: string;
};

export type BaciStagingErrorCode =
  | "CLI_ARGUMENT_INVALID"
  | "REPORT_PUBLICATION_FAILED"
  | "SOURCE_ARCHIVE_INVALID"
  | "SOURCE_ARCHIVE_MISMATCH"
  | "SOURCE_COVERAGE_APPROVAL_REQUIRED"
  | "SOURCE_DATA_INVALID"
  | "SOURCE_DESCRIPTOR_INVALID"
  | "SOURCE_DOWNLOAD_FAILED"
  | "STAGING_PUBLICATION_FAILED";

export class BaciStagingError extends Error {
  constructor(
    readonly code: BaciStagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BaciStagingError";
  }
}

export async function stageBaciRelease(
  options: StageBaciReleaseOptions,
): Promise<StageBaciReleaseOutcome> {
  const descriptorPath = resolve(options.descriptorPath);
  const approvalPath = resolve(options.approvalPath);
  const workspacePath = resolve(options.workspacePath);
  const reportPath = resolve(options.reportPath);
  const descriptorBytes = await readFile(descriptorPath);
  const approvalBytes = await readFile(approvalPath);
  const descriptor = parseSourceDescriptor(descriptorBytes, descriptorPath);
  const approval = parseCoverageApproval(approvalBytes, approvalPath);

  await mkdir(workspacePath, { recursive: true });
  const archivePath =
    options.archivePath === undefined
      ? await downloadPinnedArchive(descriptor, workspacePath)
      : resolve(options.archivePath);
  const archiveIdentity = await fileIdentity(archivePath);
  if (
    archiveIdentity.bytes !== descriptor.expectedBytes ||
    archiveIdentity.sha256 !== descriptor.expectedSha256
  ) {
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_MISMATCH",
      `Archive identity does not match ${descriptor.baciRelease}.`,
    );
  }
  if (approval.sourceSha256 !== archiveIdentity.sha256) {
    throw new BaciStagingError(
      "SOURCE_COVERAGE_APPROVAL_REQUIRED",
      "Coverage approval does not identify the pinned source archive.",
    );
  }

  const runIdentity = `${descriptor.expectedSha256}-${process.pid}`;
  const extractionPath = join(
    workspacePath,
    "temporary",
    `${runIdentity}.extracted`,
  );
  const partialStagingPath = join(
    workspacePath,
    "staging",
    `.${runIdentity}.partial`,
  );
  const acceptedStagingPath = join(
    workspacePath,
    "staging",
    descriptor.expectedSha256,
  );
  await rm(extractionPath, { force: true, recursive: true });
  await rm(partialStagingPath, { force: true, recursive: true });
  await mkdir(extractionPath, { recursive: true });
  await mkdir(partialStagingPath, { recursive: true });

  try {
    const memberChecks = await extractAndVerifyArchive(
      archivePath,
      extractionPath,
      expectedMemberPaths(descriptor),
    );
    await validateHeaders(descriptor, extractionPath);

    const staged = await validateAndStageWithDuckDb(
      descriptor,
      approval.annualChecks,
      extractionPath,
      partialStagingPath,
    );
    if (staged.coverageDifferences.length > 0) {
      await writeJsonAtomically(reportPath, {
        schemaVersion: "baci-source-staging-report-v1",
        status: "approval-required",
        source: sourceReportIdentity(
          descriptor,
          descriptorBytes,
          archiveIdentity,
        ),
        archiveMembers: memberChecks,
        dimensions: staged.dimensions,
        annualChecks: staged.annualChecks,
        coverageComparison: {
          approvedAnnualChecks: approval.annualChecks,
          differences: staged.coverageDifferences,
          approvalSha256: sha256(approvalBytes),
        },
        staging: null,
      });
      throw new BaciStagingError(
        "SOURCE_COVERAGE_APPROVAL_REQUIRED",
        "Annual source coverage differs from the explicit approval.",
      );
    }

    const manifest = {
      schemaVersion: "baci-parquet-staging-v1",
      sourceSha256: descriptor.expectedSha256,
      baciRelease: descriptor.baciRelease,
      hsRevision: descriptor.hsRevision,
      sourceUpdateDate: descriptor.sourceUpdateDate,
      ingestedYears: descriptor.ingestedYears,
      finalizedYears: descriptor.finalizedYears,
      provisionalYears: descriptor.provisionalYears,
      scoreWindow: descriptor.scoreWindow,
      parquetSchema: PARQUET_SCHEMA.map(([name, type, nullable]) => ({
        name,
        type,
        nullable,
      })),
      partitions: staged.partitions,
      dimensionFiles: staged.dimensionFiles,
      rowCount: staged.annualChecks.reduce(
        (sum, annual) => sum + annual.rowCount,
        0,
      ),
      dimensions: staged.dimensions,
      duckdbVersion: staged.duckdbVersion,
      coverageApprovalSha256: sha256(approvalBytes),
    };
    const manifestBytes = jsonBytes(manifest);
    const partialManifestPath = join(
      partialStagingPath,
      "staging-manifest.json",
    );
    await writeFile(partialManifestPath, manifestBytes, { flag: "wx" });

    const acceptedManifestPath = join(
      acceptedStagingPath,
      "staging-manifest.json",
    );
    const report = {
      schemaVersion: "baci-source-staging-report-v1",
      status: "accepted",
      source: sourceReportIdentity(
        descriptor,
        descriptorBytes,
        archiveIdentity,
      ),
      archiveMembers: memberChecks,
      dimensions: staged.dimensions,
      annualChecks: staged.annualChecks,
      coverageApproval: {
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        rationale: approval.rationale,
        evidenceUrl: approval.evidenceUrl,
        sha256: sha256(approvalBytes),
      },
      staging: {
        format: "parquet",
        schemaVersion: manifest.schemaVersion,
        relativePath: relative(workspacePath, acceptedStagingPath),
        manifestSha256: sha256(manifestBytes),
        partitionCount: staged.partitions.length,
        rowCount: manifest.rowCount,
        duckdbVersion: staged.duckdbVersion,
        bytes: staged.partitions.reduce(
          (sum, partition) => sum + partition.bytes,
          staged.dimensionFiles.products.bytes +
            staged.dimensionFiles.economies.bytes,
        ),
        parquetSchema: manifest.parquetSchema,
        partitions: staged.partitions,
        dimensionFiles: staged.dimensionFiles,
      },
    };
    const reportBytes = jsonBytes(report);
    await writeFile(
      join(partialStagingPath, "source-report.json"),
      reportBytes,
      { flag: "wx" },
    );
    const preparedReport = await prepareJsonPublication(
      reportPath,
      reportBytes,
    );
    try {
      await publishStaging(
        partialStagingPath,
        acceptedStagingPath,
        manifestBytes,
        reportBytes,
        [
          ...staged.partitions,
          staged.dimensionFiles.products,
          staged.dimensionFiles.economies,
        ],
      );
      await commitJsonPublication(preparedReport);
    } catch (error) {
      await discardJsonPublication(preparedReport.temporaryPath);
      throw error;
    }

    return {
      status: "accepted",
      reportPath,
      stagingManifestPath: acceptedManifestPath,
    };
  } catch (error) {
    await rm(partialStagingPath, { force: true, recursive: true });
    throw error;
  } finally {
    await rm(extractionPath, { force: true, recursive: true });
  }
}

async function downloadPinnedArchive(
  descriptor: SourceDescriptor,
  workspacePath: string,
): Promise<string> {
  const downloadsPath = join(workspacePath, "downloads");
  const archivePath = join(downloadsPath, descriptor.archiveFilename);
  const partialPath = `${archivePath}.partial`;
  await mkdir(downloadsPath, { recursive: true });
  if (await pathExists(archivePath)) {
    let identity: Awaited<ReturnType<typeof fileIdentity>>;
    try {
      identity = await fileIdentity(archivePath);
    } catch (error) {
      throw new BaciStagingError(
        "SOURCE_DOWNLOAD_FAILED",
        `Existing download cannot be verified: ${errorMessage(error)}`,
      );
    }
    if (
      identity.bytes === descriptor.expectedBytes &&
      identity.sha256 === descriptor.expectedSha256
    ) {
      return archivePath;
    }
    await rm(archivePath);
  }

  let offset = (await pathExists(partialPath))
    ? (await stat(partialPath)).size
    : 0;
  if (offset > descriptor.expectedBytes) {
    await rm(partialPath, { force: true });
    offset = 0;
  }
  if (offset === descriptor.expectedBytes) {
    await acceptCompletedDownload(partialPath, archivePath, descriptor);
    return archivePath;
  }

  const headers = new Headers({ "Accept-Encoding": "identity" });
  if (offset > 0) {
    headers.set("Range", `bytes=${offset}-`);
  }
  let response: Response;
  try {
    response = await fetch(descriptor.sourceUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
  } catch (error) {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      `Pinned source download failed: ${errorMessage(error)}`,
    );
  }
  if (!isAllowedSourceUrl(new URL(response.url))) {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      "Pinned source download redirected to an untrusted protocol.",
    );
  }

  let append = false;
  if (offset > 0 && response.status === 206) {
    validateContentRange(
      response.headers.get("content-range"),
      offset,
      descriptor.expectedBytes,
    );
    append = true;
  } else if (response.status === 200) {
    offset = 0;
  } else {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      `Pinned source returned HTTP ${response.status}.`,
    );
  }
  if (response.body === null) {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      "Pinned source returned no response body.",
    );
  }

  try {
    await pipeline(
      Readable.from(webStreamChunks(response.body)),
      createWriteStream(partialPath, { flags: append ? "a" : "w" }),
    );
  } catch (error) {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      `Pinned source transfer was interrupted: ${errorMessage(error)}`,
    );
  }

  function webStreamChunks(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    return {
      async *[Symbol.asyncIterator]() {
        const reader = stream.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
              return;
            }
            yield chunk.value;
          }
        } finally {
          reader.releaseLock();
        }
      },
    };
  }
  const downloadedBytes = (await stat(partialPath)).size;
  if (downloadedBytes !== descriptor.expectedBytes) {
    if (downloadedBytes > descriptor.expectedBytes) {
      await rm(partialPath, { force: true });
    }
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      `Pinned source transfer ended at ${downloadedBytes} of ${descriptor.expectedBytes} bytes.`,
    );
  }
  await acceptCompletedDownload(partialPath, archivePath, descriptor);
  return archivePath;
}

async function acceptCompletedDownload(
  partialPath: string,
  archivePath: string,
  descriptor: SourceDescriptor,
): Promise<void> {
  const identity = await fileIdentity(partialPath);
  if (
    identity.bytes !== descriptor.expectedBytes ||
    identity.sha256 !== descriptor.expectedSha256
  ) {
    await rm(partialPath, { force: true });
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_MISMATCH",
      `Downloaded archive identity does not match ${descriptor.baciRelease}.`,
    );
  }
  await rename(partialPath, archivePath);
}

function validateContentRange(
  value: string | null,
  offset: number,
  expectedBytes: number,
): void {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value ?? "");
  if (
    match === null ||
    Number(match[1]) !== offset ||
    Number(match[2]) < offset ||
    Number(match[2]) >= expectedBytes ||
    Number(match[3]) !== expectedBytes
  ) {
    throw new BaciStagingError(
      "SOURCE_DOWNLOAD_FAILED",
      "Pinned source returned an incompatible byte range.",
    );
  }
}

async function extractAndVerifyArchive(
  archivePath: string,
  extractionPath: string,
  expectedPaths: readonly string[],
): Promise<ArchiveMemberCheck[]> {
  const expected = new Set(expectedPaths);
  const seen = new Set<string>();
  const checks: ArchiveMemberCheck[] = [];
  let extractedBytes = 0;

  try {
    const archive = await openZip(archivePath, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    for await (const entry of archive.eachEntry()) {
      validateArchiveEntry(entry, expected, seen);
      extractedBytes += entry.uncompressedSize;
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new BaciStagingError(
          "SOURCE_ARCHIVE_INVALID",
          "Source archive exceeds the extraction limit.",
        );
      }

      const destinationPath = join(extractionPath, entry.fileName);
      await mkdir(dirname(destinationPath), { recursive: true });
      const verifier = new Crc32Verifier();
      const source = await archive.openReadStreamPromise(entry);
      await pipeline(
        source,
        verifier,
        createWriteStream(destinationPath, { flags: "wx" }),
      );
      if (verifier.value !== (entry.crc32 >>> 0)) {
        throw new BaciStagingError(
          "SOURCE_ARCHIVE_INVALID",
          `CRC mismatch for ${entry.fileName}.`,
        );
      }
      seen.add(entry.fileName);
      checks.push({
        path: entry.fileName,
        compressedBytes: entry.compressedSize,
        uncompressedBytes: entry.uncompressedSize,
        crc32: entry.crc32.toString(16).padStart(8, "0"),
      });
    }
  } catch (error) {
    if (error instanceof BaciStagingError) {
      throw error;
    }
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_INVALID",
      `Source archive could not be verified: ${errorMessage(error)}`,
    );
  }

  const missing = expectedPaths.filter((path) => !seen.has(path));
  if (missing.length > 0) {
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_INVALID",
      `Source archive is missing ${missing.join(", ")}.`,
    );
  }
  return expectedPaths.map(
    (path) => checks.find((check) => check.path === path)!,
  );
}

function validateArchiveEntry(
  entry: ZipEntry,
  expected: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): void {
  if (
    entry.fileName.endsWith("/") ||
    !expected.has(entry.fileName) ||
    seen.has(entry.fileName)
  ) {
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_INVALID",
      `Unexpected or duplicate archive member ${entry.fileName}.`,
    );
  }
  const unixMode = entry.externalFileAttributes >>> 16;
  if (
    entry.isEncrypted() ||
    !entry.canDecodeFileData() ||
    (unixMode & 0o170000) === 0o120000
  ) {
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_INVALID",
      `Archive member ${entry.fileName} is not a regular readable file.`,
    );
  }
}

class Crc32Verifier extends Transform {
  value = 0;

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    void encoding;
    this.value = crc32(chunk, this.value);
    callback(null, chunk);
  }
}

async function validateHeaders(
  descriptor: SourceDescriptor,
  extractionPath: string,
): Promise<void> {
  const expectedHeaders = [
    ...descriptor.members.trade.map(({ path }) => [path, TRADE_HEADER] as const),
    [
      descriptor.members.products.path,
      descriptor.members.products.header,
    ] as const,
    [
      descriptor.members.economies.path,
      descriptor.members.economies.header,
    ] as const,
  ];
  for (const [memberPath, expectedHeader] of expectedHeaders) {
    const actualHeader = await readFirstLine(join(extractionPath, memberPath));
    if (actualHeader !== expectedHeader) {
      throw new BaciStagingError(
        "SOURCE_DATA_INVALID",
        `Source member ${memberPath} has an incompatible header.`,
      );
    }
  }
  await validateDocumentationIdentity(descriptor, extractionPath);
}

async function validateDocumentationIdentity(
  descriptor: SourceDescriptor,
  extractionPath: string,
): Promise<void> {
  const documentationPath = join(
    extractionPath,
    descriptor.members.documentation.path,
  );
  const metadata = await stat(documentationPath);
  if (!metadata.isFile() || metadata.size > MAX_DOCUMENTATION_BYTES) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      "Source documentation is not a bounded regular file.",
    );
  }
  const lines = (await readFile(documentationPath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim());
  const expectedVersion = `Version: ${descriptor.baciRelease.slice(1)}`;
  const expectedReleaseDate =
    `Release Date: ${descriptor.sourceUpdateDate.replaceAll("-", " ")}`;
  if (
    !lines.includes(expectedVersion) ||
    !lines.includes(expectedReleaseDate)
  ) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      "Source documentation does not match the pinned release identity.",
    );
  }
}

async function readFirstLine(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newline === -1) {
      throw new BaciStagingError(
        "SOURCE_DATA_INVALID",
        `Source member ${path} has no complete header record.`,
      );
    }
    const header = buffer.subarray(0, newline);
    return header.at(-1) === 0x0d
      ? header.subarray(0, -1).toString("utf8")
      : header.toString("utf8");
  } finally {
    await file.close();
  }
}

async function validateAndStageWithDuckDb(
  descriptor: SourceDescriptor,
  approvedAnnualChecks: readonly AnnualSourceCheck[],
  extractionPath: string,
  partialStagingPath: string,
): Promise<{
  dimensions: { products: number; economies: number };
  annualChecks: AnnualSourceCheck[];
  coverageDifferences: ReturnType<typeof compareCoverage>;
  partitions: StagingPartition[];
  dimensionFiles: StagingDimensionFiles;
  duckdbVersion: string;
}> {
  const spillPath = join(extractionPath, "duckdb-spill");
  await mkdir(spillPath, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "2",
    memory_limit: "4GB",
    temp_directory: spillPath,
  });
  const connection = await instance.connect();
  try {
    await connection.run("SET preserve_insertion_order = false");
    await createDimensionViews(connection, descriptor, extractionPath);
    const dimensions = await validateDimensions(connection, descriptor);
    const dimensionFiles = await stageDimensionFiles(
      connection,
      partialStagingPath,
      dimensions,
    );
    const annualChecks: AnnualSourceCheck[] = [];
    const approvedByYear = new Map(
      approvedAnnualChecks.map((check) => [check.year, check] as const),
    );
    const partitions: StagingPartition[] = [];

    for (const member of descriptor.members.trade) {
      await createTradeView(connection, member, extractionPath);
      await validateTradeView(connection, member);
      const annualCheck = await readAnnualCheck(connection, member.year);
      annualChecks.push(annualCheck);

      const approvedCheck = approvedByYear.get(member.year);
      if (
        approvedCheck === undefined ||
        compareCoverage([approvedCheck], [annualCheck]).length > 0
      ) {
        continue;
      }
      const partitionRelativePath = `year=${member.year}/trade.parquet`;
      const partitionPath = join(
        partialStagingPath,
        partitionRelativePath,
      );
      await mkdir(dirname(partitionPath), { recursive: true });
      await connection.run(`
        COPY (
          SELECT
            CAST(t AS USMALLINT) AS year,
            CAST(i AS USMALLINT) AS exporter_code,
            CAST(j AS USMALLINT) AS importer_code,
            k AS product_code,
            CAST(v AS DECIMAL(38,3)) AS value_kusd,
            CASE
              WHEN q IS NULL THEN NULL
              ELSE CAST(q AS DECIMAL(38,3))
            END AS quantity_tons
          FROM current_trade
          ORDER BY
            CAST(i AS USMALLINT),
            CAST(j AS USMALLINT),
            k
        ) TO ${sqlString(partitionPath)}
        (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)
      `);
      const partitionIdentity = await fileIdentity(partitionPath);
      partitions.push({
        year: member.year,
        relativePath: partitionRelativePath,
        rowCount: annualCheck.rowCount,
        bytes: partitionIdentity.bytes,
        sha256: partitionIdentity.sha256,
      });
    }
    const coverageDifferences = compareCoverage(
      approvedAnnualChecks,
      annualChecks,
    );
    const version = await queryOne(connection, "SELECT version() AS version");

    return {
      dimensions,
      annualChecks,
      coverageDifferences,
      partitions,
      dimensionFiles,
      duckdbVersion: requireQueryString(version, "version"),
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function createDimensionViews(
  connection: DuckDBConnection,
  descriptor: SourceDescriptor,
  extractionPath: string,
): Promise<void> {
  const productsPath = join(
    extractionPath,
    descriptor.members.products.path,
  );
  const economiesPath = join(
    extractionPath,
    descriptor.members.economies.path,
  );
  await connection.run(`
    CREATE TEMP VIEW product_dimension AS
    SELECT code, description
    FROM read_csv(
      ${sqlString(productsPath)},
      header = true,
      auto_detect = false,
      columns = {'code': 'VARCHAR', 'description': 'VARCHAR'},
      strict_mode = true,
      null_padding = false
    )
  `);
  await connection.run(`
    CREATE TEMP VIEW economy_dimension AS
    SELECT country_code, country_name, country_iso2, country_iso3
    FROM read_csv(
      ${sqlString(economiesPath)},
      header = true,
      auto_detect = false,
      columns = {
        'country_code': 'VARCHAR',
        'country_name': 'VARCHAR',
        'country_iso2': 'VARCHAR',
        'country_iso3': 'VARCHAR'
      },
      strict_mode = true,
      null_padding = false
    )
  `);
}

async function validateDimensions(
  connection: DuckDBConnection,
  descriptor: SourceDescriptor,
): Promise<{ products: number; economies: number }> {
  const productCheck = await queryOne(
    connection,
    `
      SELECT
        COUNT(*)::UBIGINT AS "rowCount",
        COUNT(DISTINCT code)::UBIGINT AS "uniqueCount",
        COUNT_IF(
          code IS NULL
          OR NOT regexp_full_match(code, '[0-9]{6}')
          OR description IS NULL
          OR trim(description) = ''
        )::UBIGINT
          AS "invalidCount"
      FROM product_dimension
    `,
  );
  const economyCheck = await queryOne(
    connection,
    `
      SELECT
        COUNT(*)::UBIGINT AS "rowCount",
        COUNT(DISTINCT country_code)::UBIGINT AS "uniqueCount",
        COUNT_IF(
          country_code IS NULL
          OR NOT regexp_full_match(country_code, '[0-9]{1,3}')
          OR country_name IS NULL
          OR trim(country_name) = ''
        )::UBIGINT AS "invalidCount"
      FROM economy_dimension
    `,
  );
  const products = requireQueryCount(productCheck, "rowCount");
  const economies = requireQueryCount(economyCheck, "rowCount");
  if (
    products !== descriptor.expectedDimensions.products ||
    requireQueryCount(productCheck, "uniqueCount") !== products ||
    requireQueryCount(productCheck, "invalidCount") !== 0 ||
    economies !== descriptor.expectedDimensions.economies ||
    requireQueryCount(economyCheck, "uniqueCount") !== economies ||
    requireQueryCount(economyCheck, "invalidCount") !== 0
  ) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      "Source dimensions do not match the pinned coverage.",
    );
  }
  return { products, economies };
}

async function stageDimensionFiles(
  connection: DuckDBConnection,
  partialStagingPath: string,
  dimensions: { products: number; economies: number },
): Promise<StagingDimensionFiles> {
  const productsRelativePath = "dimensions/products.parquet";
  const economiesRelativePath = "dimensions/economies.parquet";
  const productsPath = join(partialStagingPath, productsRelativePath);
  const economiesPath = join(partialStagingPath, economiesRelativePath);
  await mkdir(dirname(productsPath), { recursive: true });
  await connection.run(`
    COPY (
      SELECT
        code AS hs12_code,
        description AS source_description
      FROM product_dimension
      ORDER BY code
    ) TO ${sqlString(productsPath)}
    (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
  await connection.run(`
    COPY (
      SELECT
        CAST(country_code AS USMALLINT) AS economy_code,
        country_name AS display_name,
        country_iso2 AS iso2,
        country_iso3 AS iso3
      FROM economy_dimension
      ORDER BY CAST(country_code AS USMALLINT)
    ) TO ${sqlString(economiesPath)}
    (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
  const productsIdentity = await fileIdentity(productsPath);
  const economiesIdentity = await fileIdentity(economiesPath);
  return {
    products: {
      relativePath: productsRelativePath,
      rowCount: dimensions.products,
      ...productsIdentity,
      schema: PRODUCT_DIMENSION_SCHEMA.map(([name, type, nullable]) => ({
        name,
        type,
        nullable,
      })),
    },
    economies: {
      relativePath: economiesRelativePath,
      rowCount: dimensions.economies,
      ...economiesIdentity,
      schema: ECONOMY_DIMENSION_SCHEMA.map(([name, type, nullable]) => ({
        name,
        type,
        nullable,
      })),
    },
  };
}

async function createTradeView(
  connection: DuckDBConnection,
  member: TradeMember,
  extractionPath: string,
): Promise<void> {
  await connection.run(`
    CREATE OR REPLACE TEMP TABLE current_trade AS
    SELECT t, i, j, k, v, q
    FROM read_csv(
      ${sqlString(join(extractionPath, member.path))},
      header = true,
      auto_detect = false,
      columns = {
        't': 'VARCHAR',
        'i': 'VARCHAR',
        'j': 'VARCHAR',
        'k': 'VARCHAR',
        'v': 'VARCHAR',
        'q': 'VARCHAR'
      },
      nullstr = '',
      strict_mode = true,
      null_padding = false
    )
  `);
}

async function validateTradeView(
  connection: DuckDBConnection,
  member: TradeMember,
): Promise<void> {
  const invalid = await queryOne(
    connection,
    `
      SELECT
        COUNT_IF(
          t IS NULL OR t != '${member.year}'
        )::UBIGINT AS "yearMismatchCount",
        COUNT_IF(
          i IS NULL OR NOT regexp_full_match(i, '[0-9]{1,3}')
        )::UBIGINT
          AS "invalidExporterCount",
        COUNT_IF(
          j IS NULL OR NOT regexp_full_match(j, '[0-9]{1,3}')
        )::UBIGINT
          AS "invalidImporterCount",
        COUNT_IF(
          k IS NULL OR NOT regexp_full_match(k, '[0-9]{6}')
        )::UBIGINT
          AS "invalidProductCount",
        COUNT_IF(
          v IS NULL
          OR NOT regexp_full_match(v, '[0-9]+(\\.[0-9]+)?')
          OR TRY_CAST(v AS DECIMAL(38,18)) IS NULL
          OR TRY_CAST(v AS DECIMAL(38,18)) <= 0
          OR ABS(
            TRY_CAST(v AS DECIMAL(38,18))
            - CAST(
              TRY_CAST(v AS DECIMAL(38,3))
              AS DECIMAL(38,18)
            )
          ) > CAST(
            '${SOURCE_MILL_PRECISION_TOLERANCE}'
            AS DECIMAL(38,18)
          )
        )::UBIGINT AS "invalidValueCount",
        COUNT_IF(
          q IS NOT NULL
          AND (
            NOT regexp_full_match(q, '[0-9]+(\\.[0-9]+)?')
            OR TRY_CAST(q AS DECIMAL(38,18)) IS NULL
            OR TRY_CAST(q AS DECIMAL(38,18)) <= 0
            OR ABS(
              TRY_CAST(q AS DECIMAL(38,18))
              - CAST(
                TRY_CAST(q AS DECIMAL(38,3))
                AS DECIMAL(38,18)
              )
            ) > CAST(
              '${SOURCE_MILL_PRECISION_TOLERANCE}'
              AS DECIMAL(38,18)
            )
          )
        )::UBIGINT AS "invalidQuantityCount"
      FROM current_trade
    `,
  );
  if (
    [
      "yearMismatchCount",
      "invalidExporterCount",
      "invalidImporterCount",
      "invalidProductCount",
      "invalidValueCount",
      "invalidQuantityCount",
    ].some((key) => requireQueryCount(invalid, key) !== 0)
  ) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source member ${member.path} contains invalid values.`,
    );
  }

  const duplicate = await queryOne(
    connection,
    `
      SELECT COUNT(*)::UBIGINT AS "count"
      FROM (
        SELECT i, j, k
        FROM current_trade
        GROUP BY i, j, k
        HAVING COUNT(*) != 1
      )
    `,
  );
  if (requireQueryCount(duplicate, "count") !== 0) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source member ${member.path} contains duplicate annual keys.`,
    );
  }

  const missingMetadata = await queryOne(
    connection,
    `
      SELECT
        COUNT_IF(exporter.country_code IS NULL)::UBIGINT
          AS "missingExporterCount",
        COUNT_IF(importer.country_code IS NULL)::UBIGINT
          AS "missingImporterCount",
        COUNT_IF(product.code IS NULL)::UBIGINT
          AS "missingProductCount"
      FROM current_trade AS trade
      LEFT JOIN economy_dimension AS exporter
        ON trade.i = exporter.country_code
      LEFT JOIN economy_dimension AS importer
        ON trade.j = importer.country_code
      LEFT JOIN product_dimension AS product
        ON trade.k = product.code
    `,
  );
  if (
    [
      "missingExporterCount",
      "missingImporterCount",
      "missingProductCount",
    ].some((key) => requireQueryCount(missingMetadata, key) !== 0)
  ) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source member ${member.path} has incomplete metadata joins.`,
    );
  }
}

async function readAnnualCheck(
  connection: DuckDBConnection,
  year: number,
): Promise<AnnualSourceCheck> {
  const row = await queryOne(
    connection,
    `
      SELECT
        COUNT(*)::UBIGINT AS "rowCount",
        COUNT(DISTINCT i)::UBIGINT AS "exporterCount",
        COUNT(DISTINCT j)::UBIGINT AS "importerCount",
        COUNT(DISTINCT k)::UBIGINT AS "observedProductCount",
        COUNT(q)::UBIGINT AS "quantityPresentCount",
        COUNT_IF(q IS NULL)::UBIGINT AS "quantityNullCount",
        SUM(CAST(v AS DECIMAL(38,3))) AS "valueTotalKusd",
        COALESCE(
          SUM(CAST(q AS DECIMAL(38,3))),
          CAST(0 AS DECIMAL(38,3))
        ) AS "quantityTotalTons"
      FROM current_trade
    `,
  );
  return {
    year,
    rowCount: requireQueryCount(row, "rowCount"),
    exporterCount: requireQueryCount(row, "exporterCount"),
    importerCount: requireQueryCount(row, "importerCount"),
    observedProductCount: requireQueryCount(row, "observedProductCount"),
    quantityPresentCount: requireQueryCount(row, "quantityPresentCount"),
    quantityNullCount: requireQueryCount(row, "quantityNullCount"),
    valueTotalKusd: requireQueryString(row, "valueTotalKusd"),
    quantityTotalTons: requireQueryString(row, "quantityTotalTons"),
  };
}

async function queryOne(
  connection: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>> {
  const result = await connection.runAndReadAll(sql);
  const row = result.getRowObjectsJson()[0];
  if (row === undefined) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      "Source validation query returned no result.",
    );
  }
  return row;
}

function requireQueryCount(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source validation returned an invalid ${key}.`,
    );
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source validation returned an unsafe ${key}.`,
    );
  }
  return count;
}

function requireQueryString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new BaciStagingError(
      "SOURCE_DATA_INVALID",
      `Source validation returned an invalid ${key}.`,
    );
  }
  return value;
}

function compareCoverage(
  approved: readonly AnnualSourceCheck[],
  actual: readonly AnnualSourceCheck[],
): {
  year: number;
  field: keyof AnnualSourceCheck | "annualCheck";
  approved: number | string | null;
  actual: number | string | null;
}[] {
  const approvedByYear = new Map(
    approved.map((check) => [check.year, check] as const),
  );
  const actualByYear = new Map(
    actual.map((check) => [check.year, check] as const),
  );
  const years = [...new Set([...approvedByYear.keys(), ...actualByYear.keys()])]
    .sort((left, right) => left - right);
  const differences: {
    year: number;
    field: keyof AnnualSourceCheck | "annualCheck";
    approved: number | string | null;
    actual: number | string | null;
  }[] = [];
  for (const year of years) {
    const expected = approvedByYear.get(year);
    const observed = actualByYear.get(year);
    if (expected === undefined || observed === undefined) {
      differences.push({
        year,
        field: "annualCheck",
        approved: expected === undefined ? null : year,
        actual: observed === undefined ? null : year,
      });
      continue;
    }
    for (const field of Object.keys(expected) as (keyof AnnualSourceCheck)[]) {
      if (expected[field] !== observed[field]) {
        differences.push({
          year,
          field,
          approved: expected[field],
          actual: observed[field],
        });
      }
    }
  }
  return differences;
}

function sourceReportIdentity(
  descriptor: SourceDescriptor,
  descriptorBytes: Uint8Array,
  archiveIdentity: { bytes: number; sha256: string },
): {
  baciRelease: string;
  url: string;
  archiveFilename: string;
  bytes: number;
  sha256: string;
  sourceUpdateDate: string;
  hsRevision: "HS12";
  ingestedYears: number[];
  finalizedYears: number[];
  provisionalYears: number[];
  scoreWindow: { start: number; end: number };
  license: { name: string; url: string };
  attribution: string;
  pinApproval: SourceDescriptor["pinApproval"];
  descriptorSha256: string;
} {
  return {
    baciRelease: descriptor.baciRelease,
    url: descriptor.sourceUrl,
    archiveFilename: descriptor.archiveFilename,
    bytes: archiveIdentity.bytes,
    sha256: archiveIdentity.sha256,
    sourceUpdateDate: descriptor.sourceUpdateDate,
    hsRevision: descriptor.hsRevision,
    ingestedYears: descriptor.ingestedYears,
    finalizedYears: descriptor.finalizedYears,
    provisionalYears: descriptor.provisionalYears,
    scoreWindow: descriptor.scoreWindow,
    license: descriptor.license,
    attribution: descriptor.attribution,
    pinApproval: descriptor.pinApproval,
    descriptorSha256: sha256(descriptorBytes),
  };
}

async function publishStaging(
  partialPath: string,
  acceptedPath: string,
  manifestBytes: Buffer,
  reportBytes: Buffer,
  dataFiles: readonly {
    relativePath: string;
    bytes: number;
    sha256: string;
  }[],
): Promise<void> {
  await mkdir(dirname(acceptedPath), { recursive: true });
  if (!(await pathExists(acceptedPath))) {
    await rename(partialPath, acceptedPath);
    return;
  }

  try {
    const acceptedManifest = await readFile(
      join(acceptedPath, "staging-manifest.json"),
    );
    if (!acceptedManifest.equals(manifestBytes)) {
      throw new BaciStagingError(
        "STAGING_PUBLICATION_FAILED",
        "An incompatible staging publication already exists.",
      );
    }
    const acceptedReport = await readFile(
      join(acceptedPath, "source-report.json"),
    );
    if (!acceptedReport.equals(reportBytes)) {
      throw new BaciStagingError(
        "STAGING_PUBLICATION_FAILED",
        "The existing staging publication has an incompatible source report.",
      );
    }
    for (const dataFile of dataFiles) {
      const identity = await fileIdentity(
        join(acceptedPath, dataFile.relativePath),
      );
      if (
        identity.bytes !== dataFile.bytes ||
        identity.sha256 !== dataFile.sha256
      ) {
        throw new BaciStagingError(
          "STAGING_PUBLICATION_FAILED",
          `Existing staging file ${dataFile.relativePath} is corrupted.`,
        );
      }
    }
  } catch (error) {
    if (
      error instanceof BaciStagingError &&
      error.code === "STAGING_PUBLICATION_FAILED"
    ) {
      throw error;
    }
    throw new BaciStagingError(
      "STAGING_PUBLICATION_FAILED",
      `Existing staging publication cannot be verified: ${errorMessage(error)}`,
    );
  }
  await rm(partialPath, { force: true, recursive: true });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const publication = await prepareJsonPublication(path, jsonBytes(value));
  await commitJsonPublication(publication);
}

type PreparedJsonPublication = {
  targetPath: string;
  temporaryPath: string;
};

async function prepareJsonPublication(
  path: string,
  bytes: Uint8Array,
): Promise<PreparedJsonPublication> {
  const temporaryPath = `${path}.${process.pid}.partial`;
  try {
    await mkdir(dirname(path), { recursive: true });
    if ((await pathExists(path)) && !(await stat(path)).isFile()) {
      throw new Error("The report destination is not a regular file.");
    }
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    return { targetPath: path, temporaryPath };
  } catch (error) {
    await discardJsonPublication(temporaryPath);
    throw new BaciStagingError(
      "REPORT_PUBLICATION_FAILED",
      `Source report could not be prepared: ${errorMessage(error)}`,
    );
  }
}

async function commitJsonPublication(
  publication: PreparedJsonPublication,
): Promise<void> {
  try {
    await rename(publication.temporaryPath, publication.targetPath);
  } catch (error) {
    await discardJsonPublication(publication.temporaryPath);
    throw new BaciStagingError(
      "REPORT_PUBLICATION_FAILED",
      `Source report could not be published: ${errorMessage(error)}`,
    );
  }
}

async function discardJsonPublication(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return;
    }
    throw new BaciStagingError(
      "REPORT_PUBLICATION_FAILED",
      `Temporary source report could not be removed: ${errorMessage(error)}`,
    );
  }
}

async function fileIdentity(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new BaciStagingError(
      "SOURCE_ARCHIVE_MISMATCH",
      `Expected a regular file at ${path}.`,
    );
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return {
    bytes: metadata.size,
    sha256: digest.digest("hex"),
  };
}

function expectedMemberPaths(descriptor: SourceDescriptor): string[] {
  return [
    ...descriptor.members.trade.map(({ path }) => path),
    descriptor.members.products.path,
    descriptor.members.economies.path,
    descriptor.members.documentation.path,
  ];
}

function parseSourceDescriptor(
  bytes: Buffer,
  path: string,
): SourceDescriptor {
  const value = parseJson(bytes, path);
  const object = requireRecord(value, "source descriptor");
  const members = requireRecord(object.members, "source descriptor members");
  const products = requireRecord(members.products, "product member");
  const economies = requireRecord(members.economies, "economy member");
  const documentation = requireRecord(
    members.documentation,
    "documentation member",
  );
  const dimensions = requireRecord(
    object.expectedDimensions,
    "expected dimensions",
  );
  const scoreWindow = requireRecord(object.scoreWindow, "score window");
  const license = requireRecord(object.license, "source license");
  const pinApproval = requireRecord(
    object.pinApproval,
    "source pin approval",
  );
  const trade = requireArray(members.trade, "trade members").map(
    (member, index) => {
      const record = requireRecord(member, `trade member ${index}`);
      return {
        year: requireInteger(record.year, `trade member ${index} year`),
        path: requireString(record.path, `trade member ${index} path`),
      };
    },
  );
  const descriptor: SourceDescriptor = {
    schemaVersion: requireLiteral(
      object.schemaVersion,
      "baci-source-descriptor-v1",
      "source descriptor schema",
    ),
    baciRelease: requireString(object.baciRelease, "BACI Release"),
    sourceUrl: requireString(object.sourceUrl, "source URL"),
    archiveFilename: requireString(
      object.archiveFilename,
      "archive filename",
    ),
    expectedBytes: requireInteger(
      object.expectedBytes,
      "expected archive bytes",
    ),
    expectedSha256: requireSha256(
      object.expectedSha256,
      "expected archive SHA-256",
    ),
    sourceUpdateDate: requireString(
      object.sourceUpdateDate,
      "source update date",
    ),
    hsRevision: requireLiteral(
      object.hsRevision,
      "HS12",
      "HS revision",
    ),
    ingestedYears: requireYearArray(
      object.ingestedYears,
      "ingested years",
    ),
    finalizedYears: requireYearArray(
      object.finalizedYears,
      "finalized years",
    ),
    provisionalYears: requireYearArray(
      object.provisionalYears,
      "provisional years",
    ),
    scoreWindow: {
      start: requireInteger(scoreWindow.start, "score-window start"),
      end: requireInteger(scoreWindow.end, "score-window end"),
    },
    members: {
      trade,
      products: {
        path: requireString(products.path, "product member path"),
        header: requireString(products.header, "product member header"),
      },
      economies: {
        path: requireString(economies.path, "economy member path"),
        header: requireString(economies.header, "economy member header"),
      },
      documentation: {
        path: requireString(
          documentation.path,
          "documentation member path",
        ),
      },
    },
    expectedDimensions: {
      products: requireInteger(
        dimensions.products,
        "expected product count",
      ),
      economies: requireInteger(
        dimensions.economies,
        "expected economy count",
      ),
    },
    license: {
      name: requireString(license.name, "license name"),
      url: requireString(license.url, "license URL"),
    },
    attribution: requireString(object.attribution, "source attribution"),
    pinApproval: {
      approvedBy: requireString(
        pinApproval.approvedBy,
        "source pin approver",
      ),
      approvedAt: requireString(
        pinApproval.approvedAt,
        "source pin approval time",
      ),
      evidenceUrl: requireString(
        pinApproval.evidenceUrl,
        "source pin evidence URL",
      ),
    },
  };
  validateSourceDescriptor(descriptor);
  return descriptor;
}

function validateSourceDescriptor(descriptor: SourceDescriptor): void {
  const sourceUrl = new URL(descriptor.sourceUrl);
  if (!isAllowedSourceUrl(sourceUrl)) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      "The pinned source URL must use HTTPS.",
    );
  }

  if (
    descriptor.expectedBytes <= 0 ||
    !/^[A-Za-z0-9._-]+\.zip$/u.test(descriptor.archiveFilename) ||
    !/^V[A-Z0-9]+$/u.test(descriptor.baciRelease) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(descriptor.sourceUpdateDate)
  ) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      "The source descriptor contains an invalid source identity.",
    );
  }
  const tradeYears = descriptor.members.trade.map(({ year }) => year);
  if (
    !sameArray(tradeYears, descriptor.ingestedYears) ||
    !descriptor.finalizedYears.every((year) =>
      descriptor.ingestedYears.includes(year),
    ) ||
    !descriptor.provisionalYears.every((year) =>
      descriptor.ingestedYears.includes(year),
    ) ||
    descriptor.scoreWindow.start > descriptor.scoreWindow.end ||
    !descriptor.finalizedYears.includes(descriptor.scoreWindow.start) ||
    !descriptor.finalizedYears.includes(descriptor.scoreWindow.end)
  ) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      "The source descriptor has incompatible year roles.",
    );
  }
  const paths = expectedMemberPaths(descriptor);
  if (
    new Set(paths).size !== paths.length ||
    paths.some(
      (path) =>
        path.length === 0 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").includes(".."),
    )
  ) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      "The source descriptor has unsafe or duplicate member paths.",
    );
  }
}

function isAllowedSourceUrl(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "::1", "localhost"].includes(url.hostname))
  );
}

async function pathExists(path: string): Promise<boolean> {
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

function parseCoverageApproval(
  bytes: Buffer,
  path: string,
): CoverageApproval {
  const value = parseJson(bytes, path);
  const object = requireRecord(value, "coverage approval");
  return {
    schemaVersion: requireLiteral(
      object.schemaVersion,
      "baci-source-coverage-approval-v1",
      "coverage approval schema",
    ),
    sourceSha256: requireSha256(
      object.sourceSha256,
      "approved source SHA-256",
    ),
    annualChecks: requireArray(
      object.annualChecks,
      "approved annual checks",
    ).map(parseAnnualSourceCheck),
    approvedBy: requireString(object.approvedBy, "coverage approver"),
    approvedAt: requireString(object.approvedAt, "coverage approval time"),
    rationale: requireString(object.rationale, "coverage rationale"),
    evidenceUrl: requireString(
      object.evidenceUrl,
      "coverage evidence URL",
    ),
  };
}

function parseAnnualSourceCheck(
  value: unknown,
  index: number,
): AnnualSourceCheck {
  const object = requireRecord(value, `annual check ${index}`);
  return {
    year: requireInteger(object.year, `annual check ${index} year`),
    rowCount: requireInteger(
      object.rowCount,
      `annual check ${index} row count`,
    ),
    exporterCount: requireInteger(
      object.exporterCount,
      `annual check ${index} exporter count`,
    ),
    importerCount: requireInteger(
      object.importerCount,
      `annual check ${index} importer count`,
    ),
    observedProductCount: requireInteger(
      object.observedProductCount,
      `annual check ${index} product count`,
    ),
    quantityPresentCount: requireInteger(
      object.quantityPresentCount,
      `annual check ${index} quantity-present count`,
    ),
    quantityNullCount: requireInteger(
      object.quantityNullCount,
      `annual check ${index} quantity-null count`,
    ),
    valueTotalKusd: requireDecimalString(
      object.valueTotalKusd,
      `annual check ${index} value total`,
    ),
    quantityTotalTons: requireDecimalString(
      object.quantityTotalTons,
      `annual check ${index} quantity total`,
    ),
  };
}

function parseJson(bytes: Buffer, path: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${path} is not valid JSON: ${errorMessage(error)}`,
    );
  }
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be an array.`,
    );
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be a non-empty string.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be a non-negative safe integer.`,
    );
  }
  return Number(value);
}

function requireLiteral<const Value extends string>(
  value: unknown,
  expected: Value,
  name: string,
): Value {
  if (value !== expected) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be ${expected}.`,
    );
  }
  return expected;
}

function requireSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function requireYearArray(value: unknown, name: string): number[] {
  const years = requireArray(value, name).map((year) =>
    requireInteger(year, name),
  );
  if (
    years.length === 0 ||
    new Set(years).size !== years.length ||
    years.some((year, index) => index > 0 && year <= years[index - 1]!)
  ) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must be unique and ascending.`,
    );
  }
  return years;
}

function requireDecimalString(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d+\.\d{3}$/u.test(value)) {
    throw new BaciStagingError(
      "SOURCE_DESCRIPTOR_INVALID",
      `${name} must have exactly three decimal places.`,
    );
  }
  return value;
}

function sameArray(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
