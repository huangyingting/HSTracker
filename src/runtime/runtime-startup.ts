import { isAbsolute } from "node:path";

import type { ReleaseObjectReader } from "../release/release-object-store";
import { createRuntimeReleaseObjectReader } from "../release/release-object-storage";
import { privateErrorDiagnostic } from "../operations/private-error-diagnostic";
import {
  observeDeploymentActivationMetric,
  observeSourceStatusPollMetric,
  startRuntimeMetricCollection,
} from "../operations/runtime-prometheus-metrics";
import { writeStructuredLog } from "../operations/structured-log";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
  type ApplicationRuntime,
} from "./application-runtime";
import { createBoundedApplicationRuntime } from "./bounded-application-runtime";
import {
  SourceStatusPoller,
  type SourceStatusPollerEvent,
} from "./source-status-poller";
import { VerifiedReleaseRuntime } from "./verified-release-runtime";

type Environment = Readonly<Record<string, string | undefined>>;

type StartApplicationRuntimeInput = {
  environment?: Environment;
  objectStore?: ReleaseObjectReader;
  now?: () => string;
};

type RuntimeStartupGlobal = typeof globalThis & {
  __hsTrackerRuntimeStartup?: Promise<void>;
};

export class RuntimeStartupConfigurationError extends Error {
  readonly code = "ENVIRONMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeStartupConfigurationError";
  }
}

export async function startApplicationRuntime(
  input: StartApplicationRuntimeInput = {},
): Promise<{
  runtime: ApplicationRuntime;
  stop: () => void;
}> {
  const environment = input.environment ?? process.env;
  startRuntimeMetricCollection();
  const mode = runtimeMode(environment);
  if (mode === "fixture") {
    const buildId = applicationBuildId(environment);
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    );
    const restore = installApplicationRuntime(runtime);
    logRuntimeReady(environment, runtime, mode, buildId);
    return {
      runtime,
      stop: restore,
    };
  }

  assertRuntimeCredentialScope(environment);
  const volumePath = requiredAbsolutePath(
    environment.HS_TRACKER_RELEASE_VOLUME_PATH,
    "HS_TRACKER_RELEASE_VOLUME_PATH",
  );
  const buildId = applicationBuildId(environment);
  const objectStore =
    input.objectStore ??
    createRuntimeReleaseObjectReader(environment);
  const verifiedRuntime = await VerifiedReleaseRuntime.load({
    objectStore,
    volumePath,
    now: input.now,
  });
  const sourceStatusPoller = new SourceStatusPoller({
    objectStore,
    servedBaciRelease:
      verifiedRuntime.currentAnalysis().source.baciRelease,
    fallback: verifiedRuntime.sourceStatusFallback(),
    retain: (snapshots) =>
      verifiedRuntime.retainSourceStatuses(snapshots),
    accept: (snapshot) =>
      verifiedRuntime.acceptSourceStatus(snapshot),
    now: input.now,
    observe: observeSourceStatusPolling,
  });
  verifiedRuntime.observeSourceStatusPolling(() =>
    sourceStatusPoller.diagnostics(),
  );
  const runtime = createBoundedApplicationRuntime(verifiedRuntime);
  const restore = installApplicationRuntime(runtime);
  sourceStatusPoller.start();
  logRuntimeReady(environment, runtime, mode, buildId);
  let stopped = false;
  return {
    runtime,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      sourceStatusPoller.stop();
      restore();
      verifiedRuntime.close();
    },
  };
}

export function ensureApplicationRuntimeStarted(): Promise<void> {
  const runtimeGlobal = globalThis as RuntimeStartupGlobal;
  runtimeGlobal.__hsTrackerRuntimeStartup ??= startApplicationRuntime().then(
    () => undefined,
  );
  return runtimeGlobal.__hsTrackerRuntimeStartup;
}

function runtimeMode(environment: Environment): "fixture" | "release" {
  const value = environment.HS_TRACKER_RUNTIME_MODE;
  if (value === "fixture" || value === "release") {
    return value;
  }
  if (value !== undefined) {
    throw new RuntimeStartupConfigurationError(
      "HS_TRACKER_RUNTIME_MODE must be fixture or release.",
    );
  }
  return environment.NODE_ENV === "production"
    ? "release"
    : "fixture";
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new RuntimeStartupConfigurationError(`${name} is required.`);
  }
  return value;
}

function requiredAbsolutePath(
  value: string | undefined,
  name: string,
): string {
  const path = required(value, name);
  if (!isAbsolute(path)) {
    throw new RuntimeStartupConfigurationError(
      `${name} must be an absolute path.`,
    );
  }
  return path;
}

function assertRuntimeCredentialScope(environment: Environment): void {
  if (
    environment.HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID !== undefined ||
    environment.HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY !== undefined ||
    environment.HS_TRACKER_RELEASE_WRITE_SESSION_TOKEN !== undefined
  ) {
    throw new RuntimeStartupConfigurationError(
      "Write-scoped release credentials must not be available to the runtime.",
    );
  }
}

function applicationBuildId(environment: Environment): string {
  const value = environment.APP_BUILD_ID?.trim();
  if (environment.NODE_ENV === "production") {
    return required(value, "APP_BUILD_ID");
  }
  return value || "development";
}

function observeSourceStatusPolling(
  event: SourceStatusPollerEvent,
): void {
  observeSourceStatusPollMetric(event);
  if (
    event.type === "status-poll-failed" &&
    event.consecutiveFailures === 3
  ) {
    writeStructuredLog("warn", "source-status-poll-degraded", {
      consecutiveFailures: event.consecutiveFailures,
      error: privateErrorDiagnostic(event.error),
    });
    return;
  }
  if (event.type !== "freshness-alert-changed") {
    return;
  }
  const details = {
    observedAt: event.observedAt,
    previous: event.previous,
    current: event.current,
  };
  if (event.current.level === "page") {
    writeStructuredLog(
      "error",
      "source-freshness-alert-page",
      details,
    );
  } else if (event.current.level === "warn") {
    writeStructuredLog(
      "warn",
      "source-freshness-alert-warning",
      details,
    );
  } else {
    writeStructuredLog(
      "info",
      "source-freshness-alert-resolved",
      details,
    );
  }
}

function logRuntimeReady(
  environment: Environment,
  runtime: ApplicationRuntime,
  mode: "fixture" | "release",
  buildId: string,
): void {
  const activation = runtime.activation();
  observeDeploymentActivationMetric(activation);
  if (environment.NODE_ENV !== "production") {
    return;
  }
  const current = runtime.currentAnalysis();
  // One bounded-cardinality startup/fallback log event (see issue #45):
  // `activationMode`/`fallbackReason` are fixed enum values, never a raw
  // error message, and the event name never changes -- only its level
  // does, since a verified fallback is operationally significant but
  // still a truthful, ready serving state.
  const details = {
    mode,
    buildId,
    baciRelease: current.source.baciRelease,
    analysisBuildId: current.analysisBuildId,
    productSearchBuildId: current.productSearchBuildId,
    activationMode: activation.mode,
    fallbackReason:
      activation.mode === "LAST_VERIFIED_RESIDENT_FALLBACK"
        ? activation.reason
        : null,
  };
  writeStructuredLog(
    activation.mode === "LAST_VERIFIED_RESIDENT_FALLBACK"
      ? "warn"
      : "info",
    "application-runtime-ready",
    details,
  );
}
