import { describe, expect, it } from "vitest";

import { createTradeAnalyticsPlatform } from "../../src/domain/trade-analytics/trade-analytics-platform";
import { executeTradeExplorerV1 } from "../../src/domain/trade-analytics/trade-explorer-v1-adapter";
import {
  FixtureTradeEvidenceSource,
} from "../../src/evidence/fixture-trade-evidence-source";
import { createFixtureApplicationRuntime } from "../../src/runtime/application-runtime";
import { createBoundedApplicationRuntime } from "../../src/runtime/bounded-application-runtime";
import { ACCEPTANCE_FIXTURE_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import {
  TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
  TRADE_EXPLORER_ECONOMIES,
  TRADE_EXPLORER_PRODUCTS,
} from "../../fixtures/trade-explorer/v1/evidence";

const BUILD_ID = ACCEPTANCE_FIXTURE_BUILD_IDS.core;

function baseRequest() {
  return {
    recipe: "trade-explorer-v1" as const,
    analysisBuildId: BUILD_ID,
  };
}

describe("TradeAnalyticsPlatform: trade-explorer-v1", () => {
  it("returns the finalized-trend-v1 shape as one row per finalized year", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(outcome.payload.rows.map((row) => row.dimensionValue)).toEqual([
      { dimension: "YEAR", year: 2019 },
      { dimension: "YEAR", year: 2020 },
      { dimension: "YEAR", year: 2021 },
      { dimension: "YEAR", year: 2022 },
      { dimension: "YEAR", year: 2023 },
    ]);
    expect(outcome.payload.rows.map((row) => row.state)).toEqual([
      "RECORDED_POSITIVE",
      "RECORDED_POSITIVE",
      "NO_RECORDED_POSITIVE_FLOW",
      "MISSING_OBSERVATION",
      "RECORDED_POSITIVE",
    ]);
    expect(outcome.payload.query.exportEconomy).toEqual(["156"]);
    expect(outcome.payload.totalRow).toBeNull();
    expect(outcome.analysisIdentity).toMatch(/^analysis-identity-v1-[a-f0-9]{64}$/u);
  });

  it("returns the importing-markets-v1 shape sorted by trade value descending with a total row", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "importing-markets-v1",
      dimensions: ["IMPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"],
      filters: {
        year: { mode: "list", years: [2023] },
        exportEconomy: ["156"],
        importEconomy: ["528", "484", "36", "710"],
        hsProduct: ["010121"],
      },
      sort: { key: "TRADE_VALUE_USD", direction: "desc" },
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(
      outcome.payload.rows.map((row) =>
        row.dimensionValue.dimension === "IMPORT_ECONOMY"
          ? row.dimensionValue.economy.code
          : null,
      ),
    ).toEqual(["528", "484", "36", "710"]);
    expect(outcome.payload.totalRow).toEqual({
      tradeValueUsd: "210000",
      recordedFlowCount: 2,
      includedRowCount: 2,
      missingRowCount: 1,
    });
    expect(outcome.payload.qualityWarnings).toEqual(["INCOMPLETE_COHORT"]);
  });

  it("returns the supplying-economies-v1 shape", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "supplying-economies-v1",
      dimensions: ["EXPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [2023] },
        exportEconomy: ["156", "76", "484", "124", "36"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: { key: "EXPORT_ECONOMY", direction: "asc" },
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(
      outcome.payload.rows.map((row) =>
        row.dimensionValue.dimension === "EXPORT_ECONOMY"
          ? [row.dimensionValue.economy.code, row.state]
          : null,
      ),
    ).toEqual([
      ["36", "RECORDED_POSITIVE"],
      ["76", "RECORDED_POSITIVE"],
      ["124", "RECORDED_POSITIVE"],
      ["156", "RECORDED_POSITIVE"],
      ["484", "NO_RECORDED_POSITIVE_FLOW"],
    ]);
  });

  it("returns the product-mix-v1 shape", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "product-mix-v1",
      dimensions: ["HS_PRODUCT"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [2023] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121", "010129", "010130", "010190", "851712"],
      },
      sort: { key: "HS_PRODUCT", direction: "asc" },
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(
      outcome.payload.rows.map((row) =>
        row.dimensionValue.dimension === "HS_PRODUCT"
          ? row.dimensionValue.product.code
          : null,
      ),
    ).toEqual(["010121", "010129", "010130", "010190", "851712"]);
  });

  it("reports a typed empty outcome when the fixed combination is not enumerable", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: [TRADE_EXPLORER_ECONOMIES.usa.code],
        importEconomy: [TRADE_EXPLORER_ECONOMIES.germany.code],
        hsProduct: [TRADE_EXPLORER_PRODUCTS.horses.code],
      },
      sort: null,
    });

    expect(outcome.state).toBe("empty");
    if (outcome.state !== "empty") {
      throw new Error(`Expected empty, got ${outcome.state}`);
    }
    expect(outcome.emptyReason).toBe("NO_ENUMERABLE_COHORT");
    expect(outcome.payload.rows).toEqual([]);
  });

  it("reports SPARSE_COHORT for a fixed combination with zero recorded evidence", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["36"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(outcome.payload.qualityWarnings).toContain("SPARSE_COHORT");
  });

  it("rejects the Provisional Year as outside the finalized window", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "importing-markets-v1",
      dimensions: ["IMPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [2024] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "invalid-input",
      error: { code: "YEAR_OUT_OF_FINALIZED_WINDOW" },
    });
  });

  it("rejects an unknown export economy with its exact code", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["999"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "invalid-input",
      error: { code: "UNKNOWN_EXPORT_ECONOMY", economyCode: "999" },
    });
  });

  it("rejects an unsupported dimension/shape combination", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["EXPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "invalid-input",
      error: { code: "DIMENSION_MISMATCH" },
    });
  });

  it("rejects a sort key that names neither the grouped dimension nor a requested measure", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: { key: "RECORDED_FLOW_COUNT", direction: "asc" },
    });

    expect(outcome).toMatchObject({
      state: "invalid-input",
      error: { code: "UNSUPPORTED_SORT_KEY" },
    });
  });

  it("accepts exactly the maximum 25 cohort codes end to end", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const codes = Array.from({ length: 25 }, (_, index) => String(index + 1));
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "importing-markets-v1",
      dimensions: ["IMPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [2023] },
        exportEconomy: ["156"],
        importEconomy: codes,
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome.state).toBe("success");
    if (outcome.state !== "success") {
      throw new Error(`Expected success, got ${outcome.state}`);
    }
    expect(outcome.payload.rows).toHaveLength(25);
  });

  it("rejects exactly one cohort code beyond the maximum as a distinct budget outcome", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const codes = Array.from({ length: 26 }, (_, index) => String(index + 1));
    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "importing-markets-v1",
      dimensions: ["IMPORT_ECONOMY"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [2023] },
        exportEconomy: ["156"],
        importEconomy: codes,
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "budget",
      error: { code: "ANALYSIS_BUDGET_EXCEEDED", budget: "INPUT_CARDINALITY" },
    });
  });

  it("leaves trade-explorer-v1 retired when the platform declares no Trade Explorer input", async () => {
    const platform = createTradeAnalyticsPlatform({});

    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome.state).toBe("retired");
  });

  it("reports incompatible-package when the declared capabilities are missing one requirement", async () => {
    const { createTradeExplorerDatasetPackage } = await import(
      "../../src/domain/trade-analytics/trade-explorer-v1-dataset-package"
    );
    const incompatiblePackage = createTradeExplorerDatasetPackage({
      schemaVersion: "trade-explorer-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      finalizedCutoffYear: 2023,
      evidenceSha256: "f".repeat(64),
      capabilities: [{ id: "trade-explorer/economy-identity", version: "1" }],
    });
    const platform = createTradeAnalyticsPlatform({
      tradeExplorer: {
        evidenceSource: new FixtureTradeEvidenceSource(),
        datasetPackages: new Map([[BUILD_ID, incompatiblePackage]]),
      },
    });

    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "incompatible-package",
      error: {
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "MISSING_REQUIRED_CAPABILITY",
      },
    });
    const adapterRequest = {
      analysisBuildId: BUILD_ID,
      shape: "finalized-trend-v1" as const,
      dimensions: ["YEAR"] as const,
      measures: ["TRADE_VALUE_USD"] as const,
      filters: {
        year: { mode: "list" as const, years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    };
    await expect(
      executeTradeExplorerV1(platform, adapterRequest),
    ).rejects.toMatchObject({
      code: "NO_COMPATIBLE_DATASET_PACKAGE",
      status: 503,
      detail: "MISSING_REQUIRED_CAPABILITY",
    });
  });

  it("rejects a Dataset Package whose finalized window does not match its evidence", async () => {
    const {
      createTradeExplorerDatasetPackage,
      TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
    } = await import(
      "../../src/domain/trade-analytics/trade-explorer-v1-dataset-package"
    );
    const mismatchedPackage = createTradeExplorerDatasetPackage({
      schemaVersion: "trade-explorer-dataset-package-manifest-v1",
      baciRelease: "V202601",
      hsRevision: "HS12",
      finalizedYearCount: 5,
      finalizedCutoffYear: 2024,
      evidenceSha256: TRADE_EXPLORER_FIXTURE_CONTENT_SHA256,
      capabilities: TRADE_EXPLORER_V1_CAPABILITY_REQUIREMENTS,
    });
    const platform = createTradeAnalyticsPlatform({
      tradeExplorer: {
        evidenceSource: new FixtureTradeEvidenceSource(),
        datasetPackages: new Map([[BUILD_ID, mismatchedPackage]]),
      },
    });

    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "incompatible-package",
      error: {
        code: "NO_COMPATIBLE_DATASET_PACKAGE",
        reason: "PACKAGE_IDENTITY_MISMATCH",
      },
    });
  });

  it("returns a retryable capacity outcome when execution cannot be admitted", async () => {
    const platform = createBoundedApplicationRuntime(
      createFixtureApplicationRuntime(),
      { maxConcurrentAnalyses: 0, maxQueuedAnalyses: 0 },
    ).tradeAnalytics;

    const outcome = await platform.execute({
      ...baseRequest(),
      shape: "finalized-trend-v1",
      dimensions: ["YEAR"],
      measures: ["TRADE_VALUE_USD"],
      filters: {
        year: { mode: "list", years: [] },
        exportEconomy: ["156"],
        importEconomy: ["528"],
        hsProduct: ["010121"],
      },
      sort: null,
    });

    expect(outcome).toMatchObject({
      state: "capacity",
      error: { code: "ANALYSIS_CAPACITY_EXCEEDED", reason: "queue-full" },
    });
  });

  it("cancels an in-flight Trade Explorer request when its signal aborts", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const controller = new AbortController();
    controller.abort();

    await expect(
      platform.execute(
        {
          ...baseRequest(),
          shape: "finalized-trend-v1",
          dimensions: ["YEAR"],
          measures: ["TRADE_VALUE_USD"],
          filters: {
            year: { mode: "list", years: [] },
            exportEconomy: ["156"],
            importEconomy: ["528"],
            hsProduct: ["010121"],
          },
          sort: null,
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it("derives Analysis Identity only from recipe, package, and canonical normalized inputs", async () => {
    const platform = createFixtureApplicationRuntime().tradeAnalytics;
    const request = (
      importEconomy: readonly string[],
      measures: readonly ("TRADE_VALUE_USD" | "RECORDED_FLOW_COUNT")[],
    ) => ({
      ...baseRequest(),
      shape: "importing-markets-v1" as const,
      dimensions: ["IMPORT_ECONOMY"] as const,
      measures,
      filters: {
        year: { mode: "list" as const, years: [2023] },
        exportEconomy: ["156"],
        importEconomy,
        hsProduct: ["010121"],
      },
      sort: null,
    });

    const canonicalOrder = await platform.execute(
      request(["528", "484"], ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"]),
    );
    const reorderedCodes = await platform.execute(
      request(["484", "528"], ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"]),
    );
    const reorderedMeasures = await platform.execute(
      request(["528", "484"], ["RECORDED_FLOW_COUNT", "TRADE_VALUE_USD"]),
    );
    const differentCohort = await platform.execute(
      request(["528"], ["TRADE_VALUE_USD", "RECORDED_FLOW_COUNT"]),
    );

    if (
      canonicalOrder.state !== "success" ||
      reorderedCodes.state !== "success" ||
      reorderedMeasures.state !== "success" ||
      differentCohort.state !== "success"
    ) {
      throw new Error("Expected every case to succeed.");
    }
    expect(reorderedCodes.analysisIdentity).toBe(canonicalOrder.analysisIdentity);
    expect(reorderedMeasures.analysisIdentity).toBe(canonicalOrder.analysisIdentity);
    expect(differentCohort.analysisIdentity).not.toBe(canonicalOrder.analysisIdentity);
  });
});
