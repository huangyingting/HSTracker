import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, describe, it } from "vitest";

import { createOperationalStore } from "../../src/operations/store/composition";
import { runOperationalStoreContract } from "../support/operational-store-contract";
import {
  createScopedPostgresSchema,
  makeTempStoreDir,
  postgresTestUrl,
  removeTempStoreDir,
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
const pgSchema =
  pgUrl === null ? null : createScopedPostgresSchema(pgUrl, "contract");

afterAll(async () => {
  await pgSchema?.drop();
});

describe.skipIf(pgUrl === null)("postgres contract availability", () => {
  it("runs the shared contract against PostgreSQL", () => {});
});

if (pgUrl !== null) {
  runOperationalStoreContract("postgres", async () => {
    await pgSchema!.reset();
    return createOperationalStore({
      driver: "postgres",
      connectionString: pgSchema!.connectionString,
    });
  });
}
