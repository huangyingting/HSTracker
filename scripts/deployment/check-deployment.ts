import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";

import { parseRecurringCostForecast } from "../../src/deployment/cost-forecast";
import { evaluateDeploymentGates } from "../../src/deployment/deployment-gates";
import {
  nonnegativeSafeInteger,
  positiveSafeInteger,
  record,
} from "../../src/deployment/value-validation";

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

void main().catch((error: unknown) => {
  const code = stringProperty(error, "code") ?? "DEPLOYMENT_CHECK_FAILED";
  const message =
    error instanceof Error
      ? error.message
      : "Deployment check failed with an unknown error.";
  process.stderr.write(
    `${JSON.stringify({ error: { code, message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      image: { type: "string" },
      "artifact-report": { type: "string" },
      "catalog-report": { type: "string" },
      "cost-forecast": { type: "string" },
      "volume-capacity-bytes": { type: "string" },
      "volume-free-at-peak-bytes": { type: "string" },
      "volume-free-after-activation-bytes": { type: "string" },
      "volume-observation-class": { type: "string" },
      "cost-architecture-decision": { type: "string" },
      "evaluated-at": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const image = required(values.image, "image");
  const artifactReportPath = required(
    values["artifact-report"],
    "artifact-report",
  );
  const catalogReportPath = required(
    values["catalog-report"],
    "catalog-report",
  );
  const costForecastPath = required(
    values["cost-forecast"],
    "cost-forecast",
  );
  const volumeCapacityBytes = byteOption(
    values["volume-capacity-bytes"],
    "volume-capacity-bytes",
  );
  const volumeFreeBytesAtPeak = byteOption(
    values["volume-free-at-peak-bytes"],
    "volume-free-at-peak-bytes",
  );
  const volumeFreeBytesAfterActivation = byteOption(
    values["volume-free-after-activation-bytes"],
    "volume-free-after-activation-bytes",
  );
  const observationClass = volumeObservationClass(
    values["volume-observation-class"],
  );
  const evaluatedAt = utcTimestamp(
    required(values["evaluated-at"], "evaluated-at"),
    "evaluated-at",
  );

  const [
    artifactReportBytes,
    catalogReportBytes,
    costForecastBytes,
    imageEvidence,
  ] = await Promise.all([
    readFile(artifactReportPath),
    readFile(catalogReportPath),
    readFile(costForecastPath),
    inspectImage(image),
  ]);
  const artifactBytes = acceptedArtifactBytes(
    parseJson(artifactReportBytes, "artifact report"),
  );
  const catalogResidentBytes = acceptedCatalogResidentBytes(
    parseJson(catalogReportBytes, "catalog report"),
  );
  const costForecast = parseRecurringCostForecast(
    parseJson(costForecastBytes, "cost forecast"),
  );
  if (costForecast.volumeGiB * GIB !== volumeCapacityBytes) {
    throw new DeploymentCheckError(
      "DEPLOYMENT_EVIDENCE_INCOMPATIBLE",
      "Cost forecast volume does not match the checked volume capacity.",
    );
  }

  const evaluation = evaluateDeploymentGates({
    imageCompressedBytes: imageEvidence.compressedBytes,
    artifactBytes,
    catalogResidentBytes,
    volumeCapacityBytes,
    volumeFreeBytesAtPeak,
    volumeFreeBytesAfterActivation,
    recurringMonthlyCostUsd: costForecast.forecastMonthlyUsd,
    costArchitectureDecision: values["cost-architecture-decision"],
  });
  const report = {
    schemaVersion: "production-deployment-check-v1",
    evaluatedAt,
    status: evaluation.status,
    evidence: {
      image: {
        reference: image,
        imageId: imageEvidence.imageId,
        compressedBytes: imageEvidence.compressedBytes,
        compressedSizeMeasurement: "docker-image-save-gzip-v1",
        nodeVersion: imageEvidence.nodeVersion,
        nativeDuckDb: "loaded",
        nativeBindingPath: imageEvidence.nativeBindingPath,
        codeOnly: true,
      },
      artifact: {
        reportSha256: sha256(artifactReportBytes),
        bytes: artifactBytes,
      },
      catalog: {
        reportSha256: sha256(catalogReportBytes),
        residentBytes: catalogResidentBytes,
      },
      volume: {
        observationClass,
        capacityBytes: volumeCapacityBytes,
        freeBytesAtPeak: volumeFreeBytesAtPeak,
        freeBytesAfterActivation: volumeFreeBytesAfterActivation,
      },
      cost: {
        forecastSha256: sha256(costForecastBytes),
        checkedAt: costForecast.checkedAt,
        forecastMonthlyUsd: costForecast.forecastMonthlyUsd,
      },
    },
    gates: evaluation.gates,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "accepted") {
    process.exitCode = 1;
  }
}

async function inspectImage(image: string): Promise<{
  imageId: string;
  compressedBytes: number;
  nodeVersion: string;
  nativeBindingPath: string;
}> {
  const [imageId, compressedBytes, nodeVersion, nativeBindingPath, files] =
    await Promise.all([
      docker(["image", "inspect", "--format", "{{.Id}}", image]),
      compressedImageBytes(image),
      docker([
        "run",
        "--rm",
        "--entrypoint",
        "node",
        image,
        "--version",
      ]),
      loadNativeDuckDb(image),
      docker([
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        image,
        "-c",
        "find /app -type f \\( -name '*.duckdb' -o -name '*.parquet' -o -name '*.zip' \\) -print -quit",
      ]),
    ]);
  if (nodeVersion !== "v24.17.0") {
    throw new DeploymentCheckError(
      "IMAGE_RUNTIME_INCOMPATIBLE",
      `Container Node.js version is ${nodeVersion}; expected v24.17.0.`,
    );
  }
  if (files.length > 0) {
    throw new DeploymentCheckError(
      "IMAGE_CONTAINS_RELEASE_DATA",
      "Container image contains a BACI, Parquet, or DuckDB artifact.",
    );
  }
  return {
    imageId,
    compressedBytes,
    nodeVersion: nodeVersion.slice(1),
    nativeBindingPath,
  };
}

async function loadNativeDuckDb(image: string): Promise<string> {
  const script = [
    "const { DuckDBInstance } = require('@duckdb/node-api');",
    "(async () => {",
    "  const instance = await DuckDBInstance.create(':memory:');",
    "  const connection = await instance.connect();",
    "  await connection.run('SELECT 1');",
    "  connection.closeSync();",
    "  instance.closeSync();",
    "  console.log(require.resolve('@duckdb/node-bindings-linux-x64/duckdb.node'));",
    "})().catch((error) => { console.error(error); process.exit(1); });",
  ].join("\n");
  return docker([
    "run",
    "--rm",
    "--entrypoint",
    "node",
    image,
    "-e",
    script,
  ]);
}

async function compressedImageBytes(image: string): Promise<number> {
  const child = spawn("docker", ["image", "save", image], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gzip = createGzip({ level: 9 });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.pipe(gzip);
  const compressed = (async () => {
    let total = 0;
    for await (const chunk of gzip) {
      total += Buffer.byteLength(chunk);
    }
    return total;
  })();
  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new DeploymentCheckError(
          "DOCKER_COMMAND_FAILED",
          stderr.trim() || `docker image save exited with code ${code}.`,
        ),
      );
    });
  });
  const [bytes] = await Promise.all([compressed, exit]);
  return bytes;
}

async function docker(arguments_: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", [...arguments_], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new DeploymentCheckError(
      "DOCKER_COMMAND_FAILED",
      error instanceof Error ? error.message : "Docker command failed.",
    );
  }
}

function acceptedArtifactBytes(value: unknown): number {
  const report = record(
    value,
    "artifact report",
    deploymentEvidenceError,
  );
  if (
    report.schemaVersion !==
      "candidate-market-artifact-build-report-v1" ||
    report.status !== "accepted"
  ) {
    throw new DeploymentCheckError(
      "ARTIFACT_REPORT_REJECTED",
      "Artifact report is not accepted or has an incompatible schema.",
    );
  }
  return positiveSafeInteger(
    record(
      report.artifact,
      "artifact report artifact",
      deploymentEvidenceError,
    ).bytes,
    "artifact bytes",
    deploymentEvidenceError,
  );
}

function acceptedCatalogResidentBytes(value: unknown): number {
  const report = record(
    value,
    "catalog report",
    deploymentEvidenceError,
  );
  if (
    report.schemaVersion !== "product-catalog-build-report-v1" ||
    report.status !== "accepted"
  ) {
    throw new DeploymentCheckError(
      "CATALOG_REPORT_REJECTED",
      "Catalog report is not accepted or has an incompatible schema.",
    );
  }
  const validation = record(
    report.validation,
    "catalog report validation",
    deploymentEvidenceError,
  );
  const sizeGate = record(
    validation.residentSizeGate,
    "catalog resident-size gate",
    deploymentEvidenceError,
  );
  if (sizeGate.status !== "accepted") {
    throw new DeploymentCheckError(
      "CATALOG_REPORT_REJECTED",
      "Catalog resident-size gate is not accepted.",
    );
  }
  return positiveSafeInteger(
    sizeGate.measuredBytes,
    "catalog resident bytes",
    deploymentEvidenceError,
  );
}

function parseJson(bytes_: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes_.toString("utf8"));
  } catch {
    throw new DeploymentCheckError(
      "DEPLOYMENT_EVIDENCE_INVALID",
      `${label} is not valid JSON.`,
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new DeploymentCheckError(
      "CLI_ARGUMENT_INVALID",
      `--${name} is required.`,
    );
  }
  return value;
}

function byteOption(value: string | undefined, name: string): number {
  return nonnegativeSafeInteger(
    Number(required(value, name)),
    `--${name}`,
    cliArgumentError,
  );
}

function volumeObservationClass(
  value: string | undefined,
): "observed" | "projected" {
  if (value === "observed" || value === "projected") {
    return value;
  }
  throw new DeploymentCheckError(
    "CLI_ARGUMENT_INVALID",
    "--volume-observation-class must be observed or projected.",
  );
}

function utcTimestamp(value: string, name: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new DeploymentCheckError(
      "CLI_ARGUMENT_INVALID",
      `--${name} must be a UTC timestamp without fractional seconds.`,
    );
  }
  return value;
}

function deploymentEvidenceError(message: string): DeploymentCheckError {
  return new DeploymentCheckError(
    "DEPLOYMENT_EVIDENCE_INVALID",
    message,
  );
}

function cliArgumentError(message: string): DeploymentCheckError {
  return new DeploymentCheckError("CLI_ARGUMENT_INVALID", message);
}

function sha256(bytes_: Buffer): string {
  return createHash("sha256").update(bytes_).digest("hex");
}

function stringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}

class DeploymentCheckError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentCheckError";
  }
}
