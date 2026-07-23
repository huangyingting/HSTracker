import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";

import { DuckDbAnalysisDatabase } from "../../src/evidence/duckdb-analysis-database";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("DuckDB analysis database", () => {
  it("shares configured current and previous artifacts across four connections", async () => {
    const root = await temporaryWorkspace();
    const currentPath = join(root, "current.duckdb");
    const previousPath = join(root, "previous.duckdb");
    const volumePath = join(root, "volume");
    await Promise.all([
      createArtifact(currentPath, 1),
      createArtifact(previousPath, 2),
    ]);
    const database = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: currentPath,
      previousArtifactPath: previousPath,
      servingVolumePath: volumePath,
    });

    try {
      let active = 0;
      let maximumActive = 0;
      const allStarted = deferred<void>();
      const release = deferred<void>();
      const probes = Array.from({ length: 4 }, () =>
        database.withConnection(undefined, async (connection) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (active === 4) {
            allStarted.resolve();
          }
          await release.promise;
          const result = await connection.runAndReadAll(`
            SELECT
              (SELECT value FROM main.probe) AS current_value,
              (SELECT value FROM previous.main.probe) AS previous_value,
              current_setting('threads') AS threads,
              current_setting('memory_limit') AS memory_limit,
              current_setting('temp_directory') AS temp_directory,
              current_setting('max_temp_directory_size')
                AS max_temp_directory_size
          `);
          active -= 1;
          return result.getRowObjectsJson()[0];
        }),
      );
      const queuedProbe = database.withConnection(
        undefined,
        async (connection) =>
          (
            await connection.runAndReadAll(
              "SELECT value FROM previous.main.probe",
            )
          ).getRowObjectsJson(),
      );

      await allStarted.promise;
      expect(maximumActive).toBe(4);
      expect(database.resources()).toEqual({
        connections: 4,
        activeConnections: 4,
        queued: 1,
        threads: 4,
        memoryLimit: "1GiB",
        tempDirectory: resolve(volumePath, "spill"),
        maxTempDirectorySize: "4GiB",
      });
      release.resolve();
      await expect(Promise.all(probes)).resolves.toEqual(
        Array.from({ length: 4 }, () => ({
          current_value: 1,
          previous_value: 2,
          threads: "4",
          memory_limit: "1.0 GiB",
          temp_directory: resolve(volumePath, "spill"),
          max_temp_directory_size: "4.0 GiB",
        })),
      );
      await expect(queuedProbe).resolves.toEqual([{ value: 2 }]);
      expect(database.resources()).toMatchObject({
        activeConnections: 0,
        queued: 0,
      });
      await expect(
        database.withConnection(undefined, (connection) =>
          connection.run("CREATE TABLE main.forbidden(value INTEGER)"),
        ),
      ).rejects.toThrow(/read-only/u);
      await expect(
        database.withConnection(undefined, (connection) =>
          connection.run(
            "CREATE TABLE previous.main.forbidden(value INTEGER)",
          ),
        ),
      ).rejects.toThrow(/read-only/u);
    } finally {
      database.close();
    }
  });

  it("interrupts native queries and reuses their connections only after settlement", async () => {
    const root = await temporaryWorkspace();
    const currentPath = join(root, "current.duckdb");
    await createArtifact(currentPath, 1);
    const database = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: currentPath,
      previousArtifactPath: null,
      servingVolumePath: join(root, "volume"),
    });

    try {
      const controllers = [new AbortController(), new AbortController()];
      let started = 0;
      const bothStarted = deferred<void>();
      const pending = controllers.map((controller) =>
        database.withConnection(
          controller.signal,
          async (connection) => {
            started += 1;
            if (started === 2) {
              bothStarted.resolve();
            }
            return connection.runAndReadAll(`
              SELECT sum(value)
              FROM range(100000000000) AS values(value)
            `);
          },
        ),
      );

      await bothStarted.promise;
      controllers.forEach((controller) => controller.abort());
      const interrupted = await Promise.allSettled(pending);
      expect(interrupted).toEqual([
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ name: "AbortError" }),
        }),
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({ name: "AbortError" }),
        }),
      ]);

      await expect(
        Promise.all([
          database.withConnection(undefined, async (connection) =>
            (
              await connection.runAndReadAll(
                "SELECT 41 + 1 AS answer",
              )
            ).getRowObjectsJson(),
          ),
          database.withConnection(undefined, async (connection) =>
            (
              await connection.runAndReadAll(
                "SELECT 20 + 22 AS answer",
              )
            ).getRowObjectsJson(),
          ),
        ]),
      ).resolves.toEqual([[{ answer: 42 }], [{ answer: 42 }]]);
    } finally {
      database.close();
    }
  });

  it("spills bounded analytical work without mutating its artifact", async () => {
    const root = await temporaryWorkspace();
    const currentPath = join(root, "current.duckdb");
    const volumePath = join(root, "volume");
    await createArtifact(currentPath, 1);
    const artifactBefore = await readFile(currentPath);
    const database = await DuckDbAnalysisDatabase.open({
      currentArtifactPath: currentPath,
      previousArtifactPath: null,
      servingVolumePath: volumePath,
    });

    try {
      let settled = false;
      const query = database
        .withConnection(undefined, async (connection) => {
          await connection.run(`
            SET memory_limit = '64MB';
            SET preserve_insertion_order = false
          `);
          return connection.runAndReadAll(`
            SELECT max(ordered_row)
            FROM (
              SELECT row_number() OVER (
                ORDER BY hash(value)
              ) AS ordered_row
              FROM range(5000000) AS values(value)
            )
          `);
        })
        .finally(() => {
          settled = true;
        });
      let observedSpill = false;
      while (!settled) {
        if ((await readdir(join(volumePath, "spill"))).length > 0) {
          observedSpill = true;
          break;
        }
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 2),
        );
      }

      await query;
      expect(observedSpill).toBe(true);
      expect(await readFile(currentPath)).toEqual(artifactBefore);
    } finally {
      database.close();
    }
  }, 15_000);
});

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hs-tracker-duckdb-runtime-"));
  temporaryDirectories.push(root);
  return root;
}

async function createArtifact(path: string, value: number): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  try {
    const connection = await instance.connect();
    try {
      await connection.run(
        `CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES (${value})`,
      );
    } finally {
      connection.closeSync();
    }
  } finally {
    instance.closeSync();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
