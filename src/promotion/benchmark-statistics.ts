import { nonnegativeSafeInteger } from "../deployment/value-validation";

export type BenchmarkSample = {
  measurementMs: number;
  routeMs: number;
  payloadBytes: number;
  status: number | null;
  timedOut: boolean;
};

export class BenchmarkSampleError extends Error {
  readonly code = "BENCHMARK_SAMPLE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "BenchmarkSampleError";
  }
}

export function summarizeBenchmarkSamples(
  samples: readonly BenchmarkSample[],
) {
  if (samples.length === 0) {
    throw new BenchmarkSampleError(
      "Benchmark samples must contain at least one observation.",
    );
  }

  const validated = samples.map(validateSample);
  const measurements = validated
    .map((sample) => sample.measurementMs)
    .sort((left, right) => left - right);

  return {
    sampleCount: validated.length,
    p50Ms: nearestRank(measurements, 0.5),
    p75Ms: nearestRank(measurements, 0.75),
    p95Ms: nearestRank(measurements, 0.95),
    p99Ms: nearestRank(measurements, 0.99),
    maximumRouteMs: Math.max(
      ...validated.map((sample) => sample.routeMs),
    ),
    maximumPayloadBytes: Math.max(
      ...validated.map((sample) => sample.payloadBytes),
    ),
    errors: validated.filter(
      (sample) => !sample.timedOut && !successful(sample.status),
    ).length,
    timeouts: validated.filter((sample) => sample.timedOut).length,
  };
}

function validateSample(
  sample: BenchmarkSample,
  index: number,
): BenchmarkSample {
  const label = `Benchmark sample ${index + 1}`;
  const measurementMs = duration(
    sample.measurementMs,
    `${label} measured duration`,
  );
  const routeMs = duration(sample.routeMs, `${label} route duration`);
  if (routeMs < measurementMs) {
    throw new BenchmarkSampleError(
      `${label} route duration cannot be shorter than its measured duration.`,
    );
  }
  const payloadBytes = nonnegativeSafeInteger(
    sample.payloadBytes,
    `${label} payload bytes`,
    benchmarkSampleError,
  );
  if (
    sample.status !== null &&
    (!Number.isSafeInteger(sample.status) ||
      sample.status < 100 ||
      sample.status > 599)
  ) {
    throw new BenchmarkSampleError(
      `${label} status must be null or an HTTP status from 100 through 599.`,
    );
  }
  if (typeof sample.timedOut !== "boolean") {
    throw new BenchmarkSampleError(
      `${label} timedOut must be a boolean.`,
    );
  }
  if (!sample.timedOut && sample.status === null) {
    throw new BenchmarkSampleError(
      `${label} requires an HTTP status when it did not time out.`,
    );
  }

  return {
    measurementMs,
    routeMs,
    payloadBytes,
    status: sample.status,
    timedOut: sample.timedOut,
  };
}

function nearestRank(
  orderedValues: readonly number[],
  percentile: number,
): number {
  const index = Math.ceil(percentile * orderedValues.length) - 1;
  return orderedValues[index];
}

function successful(status: number | null): boolean {
  return (
    status !== null &&
    ((status >= 200 && status <= 299) || status === 304)
  );
}

function duration(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new BenchmarkSampleError(
      `${label} must be a finite nonnegative number.`,
    );
  }
  return value;
}

function benchmarkSampleError(message: string): BenchmarkSampleError {
  return new BenchmarkSampleError(message);
}
