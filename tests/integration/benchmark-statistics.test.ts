import { describe, expect, it } from "vitest";

import {
  BenchmarkSampleError,
  summarizeBenchmarkSamples,
} from "../../src/promotion/benchmark-statistics";

describe("promotion benchmark statistics", () => {
  it("reports nearest-rank percentiles, failures, and payload maxima", () => {
    const samples = Array.from({ length: 100 }, (_, index) => ({
      measurementMs: index + 1,
      routeMs: index + 2,
      payloadBytes: 1_000 + index,
      status: index === 98 ? 503 : 200,
      timedOut: index === 99,
    }));

    expect(summarizeBenchmarkSamples(samples)).toEqual({
      sampleCount: 100,
      p50Ms: 50,
      p75Ms: 75,
      p95Ms: 95,
      p99Ms: 99,
      maximumRouteMs: 101,
      maximumPayloadBytes: 1_099,
      errors: 1,
      timeouts: 1,
    });
  });

  it("fails closed instead of treating an empty sample window as success", () => {
    expect(() => summarizeBenchmarkSamples([])).toThrowError(
      new BenchmarkSampleError(
        "Benchmark samples must contain at least one observation.",
      ),
    );
  });

  it("rejects non-monotonic or invalid observations", () => {
    expect(() =>
      summarizeBenchmarkSamples([
        {
          measurementMs: 12,
          routeMs: 11,
          payloadBytes: 10,
          status: 200,
          timedOut: false,
        },
      ]),
    ).toThrowError(
      new BenchmarkSampleError(
        "Benchmark sample 1 route duration cannot be shorter than its measured duration.",
      ),
    );
  });
});
