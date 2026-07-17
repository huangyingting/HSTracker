import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  accountRuntimeBuildIdsForTests,
  getAccountService,
  resetAccountServiceForTests,
} from "../../src/runtime/account-runtime";
import { ACCEPTANCE_FIXTURE_BUILD_IDS, ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

afterEach(async () => {
  await resetAccountServiceForTests();
});

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("account runtime composition", () => {
  it("builds the fixture SQLite account service with catalog build IDs that validate the running fixture server", async () => {
    process.env.HS_TRACKER_RUNTIME_MODE = "fixture";
    process.env.HS_TRACKER_OPERATIONAL_DRIVER = "sqlite";
    process.env.HS_TRACKER_OPERATIONAL_SQLITE_PATH = join(
      tempDir,
      `${randomUUID()}.db`,
    );

    const service = await getAccountService();
    const { account } = await service.registerAccount({
      email: `runtime-${randomUUID()}@example.com`,
      password: "correct horse battery staple",
      displayName: "Fixture runtime analyst",
      primaryExportEconomy: "156",
    });
    const portfolio = await service.confirmProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });

    expect(account.primaryExportEconomy).toBe("156");
    expect(portfolio).toMatchObject([
      {
        product: { hsRevision: "HS12", code: "010121" },
      },
    ]);
    expect(await accountRuntimeBuildIdsForTests()).toEqual({
      economyAnalysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
      productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
    });
  });
});
