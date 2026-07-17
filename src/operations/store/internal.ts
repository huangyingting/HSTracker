import { createHash } from "node:crypto";

import { invalidStoreInput } from "./errors";
import type { ProductRefInput } from "./operational-store";

/** Injectable clock; returns the current instant. Defaults to the system clock. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Millisecond-precision ISO-8601 UTC timestamp. */
export function toIso(date: Date): string {
  return date.toISOString();
}

export function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidStoreInput(`${field} must be a non-empty string.`);
  }
  return value;
}

export function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw invalidStoreInput(`${field} must be a positive integer.`);
  }
  return value;
}

export function requireNonNegativeInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidStoreInput(`${field} must be a non-negative integer.`);
  }
  return value;
}

export function normalizeCredentialIdentity(
  identity: string,
): string {
  return requireNonEmpty(identity, "identity")
    .trim()
    .toLocaleLowerCase("und");
}

export function normalizeProduct(product: ProductRefInput): {
  hsRevision: string;
  code: string;
} {
  return {
    hsRevision: requireNonEmpty(product.hsRevision, "product.hsRevision"),
    code: requireNonEmpty(product.code, "product.code"),
  };
}

/**
 * The complete set of operational tables. This list is deliberately closed:
 * every table names an operational concern (accounts, portfolios, watches,
 * append-only alert events, delivery state, and internal lease bookkeeping).
 * No table holds BACI evidence, Opportunity Index rows, monthly facts,
 * product-mapping tables, or per-user copies of public analytical results.
 */
export const OPERATIONAL_TABLES = [
  "operational_account",
  "operational_credential",
  "operational_session",
  "operational_recovery_token",
  "operational_confirmed_product",
  "operational_watch",
  "operational_alert_event",
  "operational_last_evaluation",
  "operational_delivery_state",
  "operational_audit_event",
  "operational_evaluation_lease",
  "operational_application_lease",
] as const;

export type OperationalTable = (typeof OPERATIONAL_TABLES)[number];

/**
 * Tables carried by the one-way SQLite -> PostgreSQL migration, in dependency
 * order. Lease tables are intentionally excluded: leases are ephemeral runtime
 * state, not durable business records, so they are never migrated.
 */
export const MIGRATED_TABLES = [
  "operational_account",
  "operational_credential",
  "operational_confirmed_product",
  "operational_watch",
  "operational_alert_event",
  "operational_last_evaluation",
  "operational_delivery_state",
  "operational_audit_event",
] as const;

export type MigratedTable = (typeof MIGRATED_TABLES)[number];

/**
 * A stable content digest over a table's rows, independent of storage order.
 * Each row is canonically serialized (sorted keys) then the sorted lines are
 * hashed, so two stores holding the same records produce the same digest.
 */
export function digestRows(
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  const lines = rows.map((row) => canonicalJson(row)).sort();
  const hash = createHash("sha256");
  for (const line of lines) {
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function computeWatchContextIdentity(input: {
  readonly reportingEconomyIso2: string;
  readonly hsRevision: string;
  readonly hs12Code: string;
}): string {
  return createHash("sha256")
    .update(
      [
        "opportunity-watch-context-v1",
        input.reportingEconomyIso2,
        input.hsRevision,
        input.hs12Code,
      ].join("|"),
    )
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}
