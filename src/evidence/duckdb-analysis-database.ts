import { resolve } from "node:path";

import {
  DuckDBInstance,
  type DuckDBConnection,
} from "@duckdb/node-api";

import { makeRuntimeDirectory } from "../runtime-file-access";
import { RUNTIME_RESOURCE_POLICY } from "../runtime-resource-policy";

type DuckDbAnalysisDatabaseOptions = {
  currentArtifactPath: string;
  previousArtifactPath: string | null;
  servingVolumePath: string;
};

type ConnectionWaiter = {
  readonly resolve: (connection: DuckDBConnection) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
  onAbort?: () => void;
};

export class DuckDbAnalysisDatabase {
  private readonly available: DuckDBConnection[];
  private readonly waiters: ConnectionWaiter[] = [];
  private closed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connections: readonly DuckDBConnection[],
    private readonly tempDirectory: string,
  ) {
    this.available = [...connections];
  }

  static async open(
    options: DuckDbAnalysisDatabaseOptions,
  ): Promise<DuckDbAnalysisDatabase> {
    const currentArtifactPath = resolve(
      /* turbopackIgnore: true */ options.currentArtifactPath,
    );
    const previousArtifactPath =
      options.previousArtifactPath === null
        ? null
        : resolve(
            /* turbopackIgnore: true */ options.previousArtifactPath,
          );
    const spillPath = resolve(
      /* turbopackIgnore: true */ options.servingVolumePath,
      "spill",
    );
    await makeRuntimeDirectory(spillPath, { recursive: true });

    const instance = await DuckDBInstance.create(currentArtifactPath, {
      access_mode: "READ_ONLY",
      threads: String(RUNTIME_RESOURCE_POLICY.duckDbThreads),
      memory_limit: RUNTIME_RESOURCE_POLICY.duckDbMemoryLimit,
      temp_directory: spillPath,
      max_temp_directory_size:
        RUNTIME_RESOURCE_POLICY.duckDbMaxTempDirectorySize,
    });
    const connections: DuckDBConnection[] = [];
    try {
      const first = await instance.connect();
      connections.push(first);
      if (previousArtifactPath !== null) {
        await first.run(
          `ATTACH DATABASE ${sqlString(previousArtifactPath)} ` +
            "AS previous (READ_ONLY)",
        );
      }
      connections.push(await instance.connect());
      return new DuckDbAnalysisDatabase(
        instance,
        connections,
        spillPath,
      );
    } catch (error) {
      for (const connection of connections.reverse()) {
        connection.closeSync();
      }
      instance.closeSync();
      throw error;
    }
  }

  async withConnection<Result>(
    signal: AbortSignal | undefined,
    run: (connection: DuckDBConnection) => Promise<Result>,
  ): Promise<Result> {
    const connection = await this.acquire(signal);
    let settled = false;
    let retryInterrupt: ReturnType<typeof setTimeout> | undefined;
    const interruptUntilSettled = () => {
      if (settled) {
        return;
      }
      connection.interrupt();
      retryInterrupt = setTimeout(interruptUntilSettled, 2);
    };
    const onAbort = () => interruptUntilSettled();
    try {
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
      }
      const result = await run(connection);
      if (signal?.aborted) {
        throw abortReason(signal);
      }
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw abortReason(signal);
      }
      throw error;
    } finally {
      settled = true;
      if (retryInterrupt !== undefined) {
        clearTimeout(retryInterrupt);
      }
      signal?.removeEventListener("abort", onAbort);
      this.release(connection);
    }
  }

  resources(): {
    connections: number;
    activeConnections: number;
    queued: number;
    threads: number;
    memoryLimit: string;
    tempDirectory: string;
    maxTempDirectorySize: string;
  } {
    return {
      connections: this.connections.length,
      activeConnections:
        this.connections.length - this.available.length,
      queued: this.waiters.length,
      threads: RUNTIME_RESOURCE_POLICY.duckDbThreads,
      memoryLimit: RUNTIME_RESOURCE_POLICY.duckDbMemoryLimit,
      tempDirectory: this.tempDirectory,
      maxTempDirectorySize:
        RUNTIME_RESOURCE_POLICY.duckDbMaxTempDirectorySize,
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const error = new Error("The DuckDB analysis database is closed.");
    for (const waiter of this.waiters.splice(0)) {
      this.removeAbortListener(waiter);
      waiter.reject(error);
    }
    for (const connection of [...this.connections].reverse()) {
      connection.closeSync();
    }
    this.instance.closeSync();
    this.available.length = 0;
  }

  private acquire(
    signal: AbortSignal | undefined,
  ): Promise<DuckDBConnection> {
    if (this.closed) {
      return Promise.reject(
        new Error("The DuckDB analysis database is closed."),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    const connection = this.available.shift();
    if (connection !== undefined) {
      return Promise.resolve(connection);
    }

    return new Promise((resolveConnection, reject) => {
      const waiter: ConnectionWaiter = {
        resolve: resolveConnection,
        reject,
        signal,
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) {
          return;
        }
        this.waiters.splice(index, 1);
        this.removeAbortListener(waiter);
        reject(signal === undefined ? abortError() : abortReason(signal));
      };
      waiter.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
      if (signal?.aborted) {
        onAbort();
      }
    });
  }

  private release(connection: DuckDBConnection): void {
    if (this.closed) {
      return;
    }
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      this.removeAbortListener(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      waiter.resolve(connection);
      return;
    }
    this.available.push(connection);
  }

  private removeAbortListener(waiter: ConnectionWaiter): void {
    if (waiter.onAbort === undefined) {
      return;
    }
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiter.onAbort = undefined;
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? abortError();
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}
