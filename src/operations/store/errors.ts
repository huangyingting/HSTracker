import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "OperationalStoreError";

export type OperationalStoreErrorCode =
  // A required input was missing or malformed.
  | "INVALID_STORE_INPUT"
  // The referenced account, watch, or event does not exist.
  | "UNKNOWN_ENTITY"
  // A single-instance SQLite deployment already holds a live application lease.
  | "APPLICATION_LEASE_UNAVAILABLE"
  // A SQLite deployment was pointed at anything other than a local file volume.
  | "NON_LOCAL_SQLITE_VOLUME"
  // A migration validation step (count, reference, or digest) failed.
  | "MIGRATION_VALIDATION_FAILED"
  // The normalized credential identity already belongs to another account.
  | "DUPLICATE_CREDENTIAL_IDENTITY"
  // The store rejected a write because it was placed in maintenance mode.
  | "STORE_IN_MAINTENANCE";

export class OperationalStoreError extends Error {
  constructor(
    readonly code: OperationalStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OperationalStoreError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isOperationalStoreError(
  value: unknown,
): value is OperationalStoreError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidStoreInput(message: string): OperationalStoreError {
  return new OperationalStoreError("INVALID_STORE_INPUT", message);
}

export function unknownEntity(message: string): OperationalStoreError {
  return new OperationalStoreError("UNKNOWN_ENTITY", message);
}

export function applicationLeaseUnavailable(
  holder: string,
): OperationalStoreError {
  return new OperationalStoreError(
    "APPLICATION_LEASE_UNAVAILABLE",
    `A live single-instance application lease is already held by ${holder}.`,
  );
}

export function nonLocalSqliteVolume(path: string): OperationalStoreError {
  return new OperationalStoreError(
    "NON_LOCAL_SQLITE_VOLUME",
    `SQLite must reside on a local persistent file volume, not ${path}.`,
  );
}

export function migrationValidationFailed(
  message: string,
): OperationalStoreError {
  return new OperationalStoreError("MIGRATION_VALIDATION_FAILED", message);
}

export function duplicateCredentialIdentity(
  identity: string,
): OperationalStoreError {
  return new OperationalStoreError(
    "DUPLICATE_CREDENTIAL_IDENTITY",
    `Credential identity ${identity} already exists.`,
  );
}

export function storeInMaintenance(): OperationalStoreError {
  return new OperationalStoreError(
    "STORE_IN_MAINTENANCE",
    "The operational store is in maintenance mode and rejects writes.",
  );
}
