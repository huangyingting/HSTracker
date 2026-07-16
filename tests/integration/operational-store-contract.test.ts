import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, describe, it } from "vitest";

import { createOperationalStore } from "../../src/operations/store/composition";
import { runOperationalStoreContract } from "../support/operational-store-contract";
import {
  makeTempStoreDir,
  postgresTestUrl,
  removeTempStoreDir,
  resetPostgres,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

afterAll(() => {
  removeTempStoreDir(tempDir);
});

runOperationalStoreContract("sqlite", () =>
  createOperationalStore({
    driver: "sqlite",
    filePath: join(tempDir, `${randomUUID()}.db`),
  }),
);

const pgUrl = postgresTestUrl();

describe.skipIf(pgUrl === null)("postgres contract availability", () => {
  it("runs the shared contract against PostgreSQL", () => {});
});

if (pgUrl !== null) {
  runOperationalStoreContract("postgres", async () => {
    await resetPostgres(pgUrl);
    return createOperationalStore({
      driver: "postgres",
      connectionString: pgUrl,
    });
  });
}
