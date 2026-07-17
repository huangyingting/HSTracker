import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ProductCatalog } from "../catalog/product-catalog";
import { createFixtureProductCatalog } from "../catalog/fixture-product-catalog";
import type { EconomyDirectory } from "../economy/economy-directory";
import { createFixtureEconomyDirectory } from "../economy/fixture-economy-directory";
import {
  createAccountService,
  type AccountService,
} from "../operations/account/account-service";
import {
  createOperationalStore,
  type OperationalStoreConfig,
} from "../operations/store/composition";
import type { OperationalStore } from "../operations/store/operational-store";
import { getApplicationRuntime } from "./application-runtime";

type Environment = Readonly<Record<string, string | undefined>>;

type AccountRuntimeState = {
  readonly service: AccountService;
  readonly store: OperationalStore | null;
  readonly buildIds: AccountRuntimeBuildIds;
};

export type AccountRuntimeBuildIds = Readonly<{
  economyAnalysisBuildId: string;
  productSearchBuildId: string;
}>;

type AccountRuntimeGlobal = typeof globalThis & {
  __hsTrackerAccountRuntime?: Promise<AccountRuntimeState>;
};

export class AccountRuntimeConfigurationError extends Error {
  readonly code = "ACCOUNT_RUNTIME_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AccountRuntimeConfigurationError";
  }
}

export async function getAccountService(): Promise<AccountService> {
  return (await getAccountRuntimeState()).service;
}

export function installAccountService(
  service: AccountService,
  buildIds: AccountRuntimeBuildIds = {
    economyAnalysisBuildId: "installed-account-runtime",
    productSearchBuildId: "installed-product-search",
  },
): () => void {
  const runtimeGlobal = globalThis as AccountRuntimeGlobal;
  const previous = runtimeGlobal.__hsTrackerAccountRuntime;
  const installed = Promise.resolve({
    service,
    store: null,
    buildIds,
  });
  runtimeGlobal.__hsTrackerAccountRuntime = installed;
  return () => {
    if (runtimeGlobal.__hsTrackerAccountRuntime !== installed) {
      return;
    }
    if (previous === undefined) {
      delete runtimeGlobal.__hsTrackerAccountRuntime;
    } else {
      runtimeGlobal.__hsTrackerAccountRuntime = previous;
    }
  };
}

export async function resetAccountServiceForTests(): Promise<void> {
  const runtimeGlobal = globalThis as AccountRuntimeGlobal;
  const current = runtimeGlobal.__hsTrackerAccountRuntime;
  delete runtimeGlobal.__hsTrackerAccountRuntime;
  if (current === undefined) {
    return;
  }
  const state = await current;
  await state.store?.close();
}

export async function accountRuntimeBuildIdsForTests(): Promise<AccountRuntimeBuildIds> {
  return (await getAccountRuntimeState()).buildIds;
}

async function getAccountRuntimeState(): Promise<AccountRuntimeState> {
  const runtimeGlobal = globalThis as AccountRuntimeGlobal;
  runtimeGlobal.__hsTrackerAccountRuntime ??= createAccountRuntimeState();
  return runtimeGlobal.__hsTrackerAccountRuntime;
}

async function createAccountRuntimeState(
  environment: Environment = process.env,
): Promise<AccountRuntimeState> {
  const runtime = getApplicationRuntime();
  const current = runtime.currentAnalysis();
  const { economyDirectory, productCatalog } =
    accountCatalogs(environment, runtime);
  const buildIds = {
    economyAnalysisBuildId: current.analysisBuildId,
    productSearchBuildId: current.productSearchBuildId,
  };
  const store = await createOperationalStore(
    operationalStoreConfig(environment),
  );
  return {
    service: createAccountService({
      store,
      economyDirectory,
      productCatalog,
      ...buildIds,
    }),
    store,
    buildIds,
  };
}

function accountCatalogs(
  environment: Environment,
  runtime: ReturnType<typeof getApplicationRuntime>,
): {
  readonly economyDirectory: EconomyDirectory;
  readonly productCatalog: ProductCatalog;
} {
  if (runtimeMode(environment) === "fixture") {
    return {
      economyDirectory: createFixtureEconomyDirectory(),
      productCatalog: createFixtureProductCatalog(),
    };
  }
  return {
    economyDirectory: {
      search: (query) => runtime.searchEconomies(query),
    },
    productCatalog: {
      normalizeQuery: (query) => runtime.normalizeProductSearchQuery(query),
      search: (query) => runtime.searchProducts(query),
    },
  };
}

function operationalStoreConfig(
  environment: Environment,
): OperationalStoreConfig {
  const driver = operationalDriver(environment);
  if (driver === "postgres") {
    const connectionString =
      nonEmpty(environment.HS_TRACKER_OPERATIONAL_PG_URL) ??
      nonEmpty(environment.DATABASE_URL);
    if (connectionString === undefined) {
      throw new AccountRuntimeConfigurationError(
        "HS_TRACKER_OPERATIONAL_PG_URL or DATABASE_URL is required for the PostgreSQL operational store.",
      );
    }
    return {
      driver,
      connectionString,
      applicationName: nonEmpty(environment.HS_TRACKER_OPERATIONAL_PG_APP_NAME),
      maxConnections: optionalInteger(
        environment.HS_TRACKER_OPERATIONAL_PG_MAX_CONNECTIONS,
        "HS_TRACKER_OPERATIONAL_PG_MAX_CONNECTIONS",
      ),
    };
  }

  const filePath =
    nonEmpty(environment.HS_TRACKER_OPERATIONAL_SQLITE_PATH) ??
    join(process.cwd(), "data", "work", "operational", "hs-tracker.sqlite");
  mkdirSync(dirname(filePath), { recursive: true });
  return {
    driver,
    filePath,
    holder: nonEmpty(environment.HS_TRACKER_OPERATIONAL_HOLDER),
    applicationLeaseSeconds: optionalInteger(
      environment.HS_TRACKER_OPERATIONAL_SQLITE_LEASE_SECONDS,
      "HS_TRACKER_OPERATIONAL_SQLITE_LEASE_SECONDS",
    ),
  };
}

function operationalDriver(environment: Environment): "sqlite" | "postgres" {
  const configured = nonEmpty(environment.HS_TRACKER_OPERATIONAL_DRIVER);
  if (configured === "sqlite" || configured === "postgres") {
    return configured;
  }
  if (configured !== undefined) {
    throw new AccountRuntimeConfigurationError(
      "HS_TRACKER_OPERATIONAL_DRIVER must be sqlite or postgres.",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    runtimeMode(environment) === "release"
  ) {
    return "postgres";
  }
  return "sqlite";
}

function runtimeMode(environment: Environment): "fixture" | "release" {
  const configured = nonEmpty(environment.HS_TRACKER_RUNTIME_MODE);
  if (configured === "fixture" || configured === "release") {
    return configured;
  }
  if (configured !== undefined) {
    throw new AccountRuntimeConfigurationError(
      "HS_TRACKER_RUNTIME_MODE must be fixture or release.",
    );
  }
  return environment.NODE_ENV === "production" ? "release" : "fixture";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function optionalInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  const trimmed = nonEmpty(value);
  if (trimmed === undefined) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AccountRuntimeConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}
