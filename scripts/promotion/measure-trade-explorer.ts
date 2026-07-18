import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  createFixtureApplicationRuntime,
  type ApplicationRuntime,
} from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import type {
  AnalysisExecutionOptions,
  AnalysisOperationObservation,
  AnalysisOutcome,
  AnalysisRequest,
} from "../../src/domain/trade-analytics/trade-analytics-platform";
import { executeTradeExplorerV1 } from "../../src/domain/trade-analytics/trade-explorer-v1-adapter";
import {
  evaluateTradeExplorer,
  REQUIRED_PRODUCT_ROLES,
  type TradeExplorerMeasurementInput,
  type TradeExplorerQueryMeasurementInput,
} from "../../src/promotion/performance-gates";
import { serializeTradeExplorerCsv } from "../../src/export/trade-explorer-csv";
import type { TradeExplorerArtifactBenchmarkQuery } from "../../src/evidence/analysis-artifact-manifest";

const REPO_ROOT = process.cwd();
const ANALYSIS_BUILD_ID = "acceptance-fixtures-v1";
const DEFAULT_OUT =
  "reports/promotion/candidate/evidence/trade-explorer-measurement.json";

interface RoleObservation {
  cacheState: string;
  queueWaitMs: number;
  queryMs: number;
  scanRows: number;
  resultRows: number;
  resultBytes: number;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Trade Explorer drill failed.";
  process.stderr.write(
    `${JSON.stringify({ error: { code: "TRADE_EXPLORER_DRILL_FAILED", message } })}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const outPath = values.out ?? DEFAULT_OUT;

  const fixture = createFixtureApplicationRuntime();
  const manifest = fixture.currentAnalysis();
  const benchmarkQueries = manifest.tradeExplorerBenchmarkQueries;
  if (benchmarkQueries.length !== REQUIRED_PRODUCT_ROLES.length) {
    throw new Error(
      "Current analysis manifest must attest one Trade Explorer benchmark per product role.",
    );
  }

  const cancellation = await measureCancellation();

  const queries: TradeExplorerQueryMeasurementInput[] = [];
  for (const benchmark of benchmarkQueries) {
    const observation = await measureRole(benchmark, manifest);
    queries.push({
      productRole: benchmark.role,
      benchmarkQuery: {
        shape: benchmark.shape,
        measures: benchmark.measures,
        exportEconomyCode: benchmark.exportEconomyCode,
        importEconomyCode: benchmark.importEconomyCode,
        hsProductCode: benchmark.hsProductCode,
      },
      scanRows: observation.scanRows,
      resultRows: observation.resultRows,
      resultBytes: observation.resultBytes,
      exportBytes: observation.exportBytes,
      peakMemoryBytes: observation.peakMemoryBytes,
      // The fixture Trade Explorer evidence source is a pure in-memory model
      // with no DuckDB query engine, so there is genuinely no query spill.
      peakSpillBytes: 0,
      queueWaitMs: observation.queueWaitMs,
      executionMs: observation.queryMs,
      cancellationReleaseMs: cancellation.cancellationReleaseMs,
      cancellationReleased: cancellation.cancellationReleased,
      cacheUnpoisoned: cancellation.cacheUnpoisoned,
      queueUnpoisoned: cancellation.queueUnpoisoned,
      subsequentRequestSucceeded: cancellation.subsequentRequestSucceeded,
    });
  }

  const measurementInput: TradeExplorerMeasurementInput = {
    queries,
    benchmarkQueries,
  };
  const evaluation = evaluateTradeExplorer(measurementInput);

  const evidence = {
    schemaVersion: "trade-explorer-measurement-v1",
    analysisBuildId: ANALYSIS_BUILD_ID,
    measuredAt: utcNow(),
    status: evaluation.status,
    reasons: evaluation.reasons,
    cancellation,
    queries: queries.map((query) => ({
      productRole: query.productRole,
      scanRows: query.scanRows,
      resultRows: query.resultRows,
      resultBytes: query.resultBytes,
      exportBytes: query.exportBytes,
      peakMemoryBytes: query.peakMemoryBytes,
      peakSpillBytes: query.peakSpillBytes,
      queueWaitMs: query.queueWaitMs,
      executionMs: query.executionMs,
    })),
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const absoluteOut = join(REPO_ROOT, outPath);
  await mkdir(dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, evidenceBytes);

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "trade-explorer-measurement-report-v1",
        out: outPath,
        status: evaluation.status,
        reasons: evaluation.reasons,
        sha256: sha256(evidenceBytes),
      },
      null,
      2,
    )}\n`,
  );
}

async function measureRole(
  benchmark: TradeExplorerArtifactBenchmarkQuery,
  manifest: ReturnType<ApplicationRuntime["currentAnalysis"]>,
): Promise<
  RoleObservation & { peakMemoryBytes: number; exportBytes: number }
> {
  const runtime = createBoundedApplicationRuntime(
    createFixtureApplicationRuntime(),
  );
  let observation: RoleObservation | null = null;
  const memorySamples: number[] = [process.memoryUsage().rss];
  const sampler = setInterval(() => {
    memorySamples.push(process.memoryUsage().rss);
  }, 1);
  const baseline = process.memoryUsage().rss;
  const result = await executeTradeExplorerV1(
    runtime.tradeAnalytics,
    tradeExplorerAdapterRequest(benchmark),
    {
      observe: (sample: AnalysisOperationObservation) => {
        observation = {
          cacheState: sample.cacheState,
          queueWaitMs: sample.queueWaitMs ?? 0,
          queryMs: sample.queryMs ?? 0,
          scanRows: sample.scanRows ?? 0,
          resultRows: sample.resultRows ?? 0,
          resultBytes: sample.resultBytes,
        };
      },
    },
  );
  clearInterval(sampler);
  memorySamples.push(process.memoryUsage().rss);
  if (observation === null) {
    throw new Error(
      `Trade Explorer ${benchmark.role} query did not report an observation.`,
    );
  }
  const actual = result.budget.actual;
  const representation = serializeTradeExplorerCsv({
    result,
    manifest,
  });
  const peakMemoryBytes = Math.max(0, Math.max(...memorySamples) - baseline);
  return {
    cacheState: (observation as RoleObservation).cacheState,
    queueWaitMs: (observation as RoleObservation).queueWaitMs,
    queryMs: (observation as RoleObservation).queryMs,
    scanRows: actual.scanRows,
    resultRows: actual.resultRows,
    resultBytes: actual.resultBytes,
    exportBytes: representation.bytes.byteLength,
    peakMemoryBytes,
  };
}

interface CancellationMeasurement {
  cancellationReleaseMs: number;
  cancellationReleased: boolean;
  cacheUnpoisoned: boolean;
  queueUnpoisoned: boolean;
  subsequentRequestSucceeded: boolean;
}

async function measureCancellation(): Promise<CancellationMeasurement> {
  const fixture = createFixtureApplicationRuntime();
  const benchmark = fixture.currentAnalysis().tradeExplorerBenchmarkQueries[0]!;
  const gate = deferred<void>();
  let computations = 0;
  let sharedSignal: AbortSignal | undefined;
  const inner = interceptTradeExplorer(fixture, async (request, options) => {
    computations += 1;
    sharedSignal = options?.signal;
    await gate.promise;
    return fixture.tradeAnalytics.execute(request, options);
  });
  const runtime = createBoundedApplicationRuntime(inner);

  const disconnected = new AbortController();
  const first = runtime.tradeAnalytics.execute(tradeExplorerRequest(benchmark), {
    signal: disconnected.signal,
  });
  const shared = runtime.tradeAnalytics.execute(tradeExplorerRequest(benchmark));
  await Promise.resolve();

  const abortedAt = performance.now();
  disconnected.abort();
  let cancellationReleased = false;
  try {
    await first;
  } catch (error) {
    cancellationReleased =
      (error as { name?: string } | null)?.name === "AbortError" &&
      sharedSignal?.aborted !== true;
  }
  const cancellationReleaseMs = performance.now() - abortedAt;

  gate.resolve();
  const sharedOutcome = await shared;
  const cacheUnpoisoned = sharedOutcome.state === "success";
  const queueUnpoisoned = computations === 1;

  const subsequent = await runtime.tradeAnalytics.execute(
    tradeExplorerRequest(benchmark),
  );
  const subsequentRequestSucceeded = subsequent.state === "success";

  return {
    cancellationReleaseMs,
    cancellationReleased,
    cacheUnpoisoned,
    queueUnpoisoned,
    subsequentRequestSucceeded,
  };
}

function interceptTradeExplorer(
  runtime: ApplicationRuntime,
  execute: (
    request: AnalysisRequest,
    options?: AnalysisExecutionOptions,
  ) => Promise<AnalysisOutcome<AnalysisRequest["recipe"]>>,
): ApplicationRuntime {
  return {
    ...runtime,
    tradeAnalytics: {
      execute<Request extends AnalysisRequest>(
        request: Request,
        options?: AnalysisExecutionOptions,
      ): Promise<AnalysisOutcome<Request["recipe"]>> {
        if (request.recipe !== "trade-explorer-v1") {
          return runtime.tradeAnalytics.execute(request, options);
        }
        return execute(request, options) as Promise<
          AnalysisOutcome<Request["recipe"]>
        >;
      },
    },
  };
}

function tradeExplorerRequest(
  benchmark: TradeExplorerArtifactBenchmarkQuery,
): AnalysisRequest {
  return {
    recipe: "trade-explorer-v1",
    analysisBuildId: ANALYSIS_BUILD_ID,
    shape: benchmark.shape,
    dimensions: ["YEAR"],
    measures: benchmark.measures,
    filters: {
      year: { mode: "list", years: [] },
      exportEconomy: [benchmark.exportEconomyCode],
      importEconomy: [benchmark.importEconomyCode],
      hsProduct: [benchmark.hsProductCode],
    },
    sort: null,
  } as unknown as AnalysisRequest;
}

function tradeExplorerAdapterRequest(
  benchmark: TradeExplorerArtifactBenchmarkQuery,
): Parameters<typeof executeTradeExplorerV1>[1] {
  const { recipe: _recipe, ...request } = tradeExplorerRequest(benchmark) as {
    recipe: string;
  } & Record<string, unknown>;
  void _recipe;
  return request as unknown as Parameters<typeof executeTradeExplorerV1>[1];
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
