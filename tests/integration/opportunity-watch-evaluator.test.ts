import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, describe, it } from "vitest";

import { createOperationalStore } from "../../src/operations/store/composition";
import { runOpportunityWatchEvaluatorContract } from "../support/opportunity-watch-evaluator-contract";
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

runOpportunityWatchEvaluatorContract("sqlite", () =>
  createOperationalStore({
    driver: "sqlite",
    filePath: join(tempDir, `${randomUUID()}.db`),
  }),
);

const pgUrl = postgresTestUrl();
const pgSchema =
  pgUrl === null ? null : createScopedPostgresSchema(pgUrl, "watch-evaluator");

afterAll(async () => {
  await pgSchema?.drop();
});

describe.skipIf(pgUrl === null)("opportunity watch evaluator postgres availability", () => {
  it("runs the shared evaluator contract against PostgreSQL", () => {});
});

if (pgUrl !== null) {
  runOpportunityWatchEvaluatorContract("postgres", async () => {
    await pgSchema!.reset();
    return createOperationalStore({
      driver: "postgres",
      connectionString: pgSchema!.connectionString,
    });
  });
}
