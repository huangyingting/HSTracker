import { join } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureEconomyDirectory } from "../../src/economy/fixture-economy-directory";
import { createAccountService } from "../../src/operations/account/account-service";
import { SqliteOperationalStore } from "../../src/operations/store/sqlite-operational-store";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { buildPortfolioProjection } from "../../src/app/portfolio-projection";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

let store: OperationalStore;
let sqlitePath: string;

afterEach(async () => {
  await store.close();
});

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("signed-in portfolio projection", () => {
  it("filters visibility by confirmed products while preserving byte-identical public row values and ranks", async () => {
    const { service } = createService();
    const { account } = await service.registerAccount({
      email: `projection-${randomUUID()}@example.com`,
      password: "correct horse battery staple",
      displayName: "Projection analyst",
      primaryExportEconomy: "156",
    });
    const portfolio = await service.confirmProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });
    const page = await currentOpportunityPage(account.primaryExportEconomy);

    const complete = buildPortfolioProjection(page, portfolio, "complete");
    const filtered = buildPortfolioProjection(page, portfolio, "portfolio");

    expect(complete.completeCandidates).toBe(page.candidates);
    expect(filtered.completeCandidates).toBe(page.candidates);
    expect(filtered.visibleRows.map((row) => ({
      canonicalRank: row.canonicalRank,
      product: row.candidate.product.code,
      market: row.candidate.market.name,
      priority: row.candidate.investigationPriority.display,
      attractiveness: row.candidate.marketAttractiveness.display,
      exporterFit: row.candidate.exporterFit.display,
    }))).toEqual([
      {
        canonicalRank: 1,
        product: "010121",
        market: "Mexico",
        priority: 73,
        attractiveness: 88,
        exporterFit: 55,
      },
      {
        canonicalRank: 2,
        product: "010121",
        market: "Netherlands",
        priority: 66,
        attractiveness: 54,
        exporterFit: 80,
      },
    ]);
    expect(filtered.visibleRows.map((row) => JSON.stringify(row.candidate))).toEqual(
      [page.candidates[0], page.candidates[1]].map((candidate) =>
        JSON.stringify(candidate),
      ),
    );
  });

  it("gives two accounts with the same primary exporter identical current public rows", async () => {
    const { service } = createService();
    const first = await service.registerAccount({
      email: `same-exporter-a-${randomUUID()}@example.com`,
      password: "correct horse battery staple",
      displayName: "First analyst",
      primaryExportEconomy: "156",
    });
    const second = await service.registerAccount({
      email: `same-exporter-b-${randomUUID()}@example.com`,
      password: "correct horse battery staple",
      displayName: "Second analyst",
      primaryExportEconomy: "156",
    });

    const firstPage = await currentOpportunityPage(
      first.account.primaryExportEconomy,
    );
    const secondPage = await currentOpportunityPage(
      second.account.primaryExportEconomy,
    );

    expect(JSON.stringify(firstPage.candidates)).toBe(
      JSON.stringify(secondPage.candidates),
    );
  });

  it("keeps operational SQLite limited to mutable operational records after projection", async () => {
    const { service } = createService();
    const { account } = await service.registerAccount({
      email: `no-copy-${randomUUID()}@example.com`,
      password: "correct horse battery staple",
      displayName: "No copy analyst",
      primaryExportEconomy: "156",
    });
    const portfolio = await service.confirmProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });
    const page = await currentOpportunityPage(account.primaryExportEconomy);
    buildPortfolioProjection(page, portfolio, "portfolio");
    await store.close();

    const db = new Database(sqlitePath, { readonly: true });
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'operational_%' ORDER BY name",
        )
        .all() as { name: string }[];
      expect(tables.map((row) => row.name)).toEqual([
        "operational_account",
        "operational_alert_event",
        "operational_application_lease",
        "operational_audit_event",
        "operational_confirmed_product",
        "operational_credential",
        "operational_delivery_consent",
        "operational_delivery_state",
        "operational_delivery_suppression",
        "operational_evaluation_lease",
        "operational_last_evaluation",
        "operational_recovery_token",
        "operational_session",
        "operational_watch",
      ]);
      const textDump = tables
        .map(({ name }) => dumpTextColumns(db, name))
        .join("\n");
      expect(textDump).not.toContain("market-investigation-result-v1");
      expect(textDump).not.toContain("investigationPriority");
      expect(textDump).not.toContain(JSON.stringify(page.candidates[0]));
    } finally {
      db.close();
    }
  });
});

function createService() {
  sqlitePath = join(tempDir, `${randomUUID()}.db`);
  store = new SqliteOperationalStore({ filePath: sqlitePath });
  const service = createAccountService({
    store,
    economyDirectory: createFixtureEconomyDirectory(),
    productCatalog: createFixtureProductCatalog(),
    economyAnalysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
  });
  return { service };
}

async function currentOpportunityPage(exporterCode: string) {
  const runtime = createFixtureApplicationRuntime();
  const manifest = runtime.currentAnalysis();
  const result = await runtime.tradeAnalytics.execute({
    recipe: "opportunity-discovery-v1",
    analysisBuildId: manifest.analysisBuildId,
    exportEconomyCode: exporterCode,
  });
  if (result.state !== "success") {
    throw new TypeError("Expected the fixture opportunity feed to succeed.");
  }
  return result.payload;
}

function dumpTextColumns(db: Database.Database, table: string): string {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string; type: string }[];
  const textColumns = columns
    .filter((column) => column.type.toUpperCase() === "TEXT")
    .map((column) => column.name);
  if (textColumns.length === 0) {
    return "";
  }
  const quotedColumns = textColumns.map((column) => `"${column}"`).join(" || ' ' || ");
  const rows = db.prepare(`SELECT ${quotedColumns} AS text_value FROM ${table}`).all() as {
    text_value: string | null;
  }[];
  return rows.map((row) => row.text_value ?? "").join("\n");
}
