import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../errors/cross-bundle-error";

const ERROR_BRAND = "RequestDeadlineExceededError";

export const ROUTE_DEADLINE_MS = {
  currentAnalysis: 2_000,
  search: 2_000,
  candidateMarket: 12_000,
  tradeTrend: 12_000,
  supplierCompetition: 12_000,
  candidateMarketCsv: 15_000,
  tradeTrendCsv: 15_000,
  health: 2_000,
} as const;

export class RequestDeadlineExceededError extends Error {
  readonly code = "REQUEST_DEADLINE_EXCEEDED";
  readonly status = 503;
  readonly publicMessage = "The request exceeded its processing deadline.";

  constructor() {
    super("The route processing deadline was exceeded.");
    this.name = "RequestDeadlineExceededError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isRequestDeadlineExceededError(
  value: unknown,
): value is RequestDeadlineExceededError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function createRequestDeadline(
  requestSignal: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const onRequestAbort = () => {
    controller.abort(requestSignal.reason);
  };
  requestSignal.addEventListener("abort", onRequestAbort, {
    once: true,
  });
  if (requestSignal.aborted) {
    onRequestAbort();
  }
  const timer = setTimeout(() => {
    controller.abort(new RequestDeadlineExceededError());
  }, timeoutMs);
  let disposed = false;

  return {
    signal: controller.signal,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", onRequestAbort);
    },
  };
}

export function createSynchronousRequestDeadline(
  timeoutMs: number,
): {
  hasElapsed(): boolean;
} {
  const startedAt = performance.now();
  return {
    hasElapsed() {
      return performance.now() - startedAt >= timeoutMs;
    },
  };
}
