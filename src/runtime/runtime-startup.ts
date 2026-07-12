import type { ReleaseObjectReader } from "../release/release-object-store";
import { createRuntimeReleaseObjectReader } from "../release/release-object-storage";
import { privateErrorDiagnostic } from "../operations/private-error-diagnostic";
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
  const mode = runtimeMode(environment);
  if (mode === "fixture") {
    const runtime = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
    );
    const restore = installApplicationRuntime(runtime);
    return {
      runtime,
      stop: restore,
    };
  }

  const volumePath = required(
    environment.HS_TRACKER_RELEASE_VOLUME_PATH,
    "HS_TRACKER_RELEASE_VOLUME_PATH",
  );
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

function observeSourceStatusPolling(
  event: SourceStatusPollerEvent,
): void {
  if (
    event.type === "status-poll-failed" &&
    event.consecutiveFailures === 3
  ) {
    console.warn("Source-status pointer polling is degraded", {
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
    console.error(
      "Source Freshness Status requires operator action",
      details,
    );
  } else if (event.current.level === "warn") {
    console.warn("Source Freshness Status warning", details);
  } else {
    console.info("Source Freshness Status alert resolved", details);
  }
}
