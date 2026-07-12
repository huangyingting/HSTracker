import type { ReleaseObjectReader } from "../release/release-object-store";
import { createRuntimeReleaseObjectReader } from "../release/release-object-storage";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
  type ApplicationRuntime,
} from "./application-runtime";
import { createBoundedApplicationRuntime } from "./bounded-application-runtime";
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
  const verifiedRuntime = await VerifiedReleaseRuntime.load({
    objectStore:
      input.objectStore ??
      createRuntimeReleaseObjectReader(environment),
    volumePath,
    now: input.now,
  });
  const runtime = createBoundedApplicationRuntime(verifiedRuntime);
  const restore = installApplicationRuntime(runtime);
  let stopped = false;
  return {
    runtime,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
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
