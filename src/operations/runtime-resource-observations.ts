import {
  lstatSync,
  readFileSync,
  readdirSync,
  statfsSync,
} from "node:fs";
import { totalmem } from "node:os";
import { resolve } from "node:path";

export type RuntimeResourceObservation = {
  readonly cgroupMemoryCurrentFraction: number;
  readonly processRssFraction: number;
  readonly spillBytes: number;
  readonly volumeFreeFraction: number;
  readonly cpuPeriods: number;
  readonly cpuThrottledPeriods: number;
};

export type RuntimeResourceObserver = () => RuntimeResourceObservation;

export function observeRuntimeResources(): RuntimeResourceObservation {
  const cgroupPath = currentCgroupPath();
  const rssBytes = process.memoryUsage().rss;
  const memoryCurrentBytes = numericCgroupValue(
    resolve(cgroupPath, "memory.current"),
  );
  const memoryLimitBytes = cgroupMemoryLimit(cgroupPath);
  const cpu = cgroupKeyValueFile(resolve(cgroupPath, "cpu.stat"));
  const volumePath =
    process.env.HS_TRACKER_RELEASE_VOLUME_PATH?.trim() || process.cwd();
  const volume = statfsSync(volumePath, { bigint: true });
  const volumeBlocks = Number(volume.blocks);
  if (volumeBlocks <= 0) {
    throw new Error("The serving volume reported no filesystem blocks.");
  }

  return {
    cgroupMemoryCurrentFraction: memoryCurrentBytes / memoryLimitBytes,
    processRssFraction: rssBytes / memoryLimitBytes,
    spillBytes: directoryBytes(resolve(volumePath, "spill")),
    volumeFreeFraction: Number(volume.bavail) / volumeBlocks,
    cpuPeriods: requiredCgroupCounter(cpu, "nr_periods"),
    cpuThrottledPeriods: requiredCgroupCounter(cpu, "nr_throttled"),
  };
}

function currentCgroupPath(): string {
  const unified = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  if (unified === undefined) {
    throw new Error("The runtime does not expose a unified cgroup v2 path.");
  }
  const relativePath = unified.slice(3);
  if (!relativePath.startsWith("/")) {
    throw new Error("The runtime cgroup v2 path is malformed.");
  }
  return resolve("/sys/fs/cgroup", `.${relativePath}`);
}

function cgroupMemoryLimit(cgroupPath: string): number {
  const value = readFileSync(resolve(cgroupPath, "memory.max"), "utf8").trim();
  if (value !== "max") {
    return positiveNumber(value, "cgroup memory limit");
  }
  const constrained = process.constrainedMemory();
  const physicalMemoryBytes = totalmem();
  if (
    constrained !== undefined &&
    Number.isFinite(constrained) &&
    constrained > 0 &&
    constrained <= physicalMemoryBytes
  ) {
    return constrained;
  }
  return physicalMemoryBytes;
}

function numericCgroupValue(path: string): number {
  return positiveNumber(readFileSync(path, "utf8").trim(), path);
}

function positiveNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must contain a positive finite number.`);
  }
  return parsed;
}

function cgroupKeyValueFile(path: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").trim().split("\n")) {
    const [key, rawValue, ...extra] = line.trim().split(/\s+/u);
    if (
      key === undefined ||
      rawValue === undefined ||
      extra.length > 0 ||
      !/^\d+$/u.test(rawValue)
    ) {
      throw new Error(`${path} contains a malformed cgroup counter.`);
    }
    result.set(key, Number(rawValue));
  }
  return result;
}

function requiredCgroupCounter(
  counters: ReadonlyMap<string, number>,
  key: string,
): number {
  const value = counters.get(key);
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`The cgroup CPU report is missing ${key}.`);
  }
  return value;
}

function directoryBytes(path: string): number {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return 0;
    }
    throw error;
  }
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      bytes += directoryBytes(entryPath);
    } else if (entry.isFile()) {
      bytes += lstatSync(entryPath).size;
    }
  }
  return bytes;
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
