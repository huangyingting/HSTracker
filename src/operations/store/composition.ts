import type { Clock } from "./internal";
import type { OperationalStore } from "./operational-store";
import {
  PostgresOperationalStore,
  type PostgresOperationalStoreOptions,
} from "./postgres-operational-store";
import {
  SqliteOperationalStore,
  type SqliteOperationalStoreOptions,
} from "./sqlite-operational-store";

/**
 * Configuration for the operational store. The hosted product uses PostgreSQL;
 * a complete but strictly single-instance lightweight deployment uses SQLite.
 * Callers never branch on the driver again once the store is built — the
 * {@link OperationalStore} contract is identical across both.
 */
export type OperationalStoreConfig =
  | ({ readonly driver: "postgres" } & PostgresOperationalStoreOptions)
  | ({ readonly driver: "sqlite" } & SqliteOperationalStoreOptions);

/** Build the operational store selected by configuration (composition root). */
export async function createOperationalStore(
  config: OperationalStoreConfig,
): Promise<OperationalStore> {
  if (config.driver === "postgres") {
    return PostgresOperationalStore.create(config);
  }
  return new SqliteOperationalStore(config);
}

export type { Clock };
