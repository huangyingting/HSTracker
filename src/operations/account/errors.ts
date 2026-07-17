import {
  brandCrossBundleError,
  hasCrossBundleErrorBrand,
} from "../../errors/cross-bundle-error";

const ERROR_BRAND = "AccountServiceError";

export type AccountServiceErrorCode =
  | "INVALID_ACCOUNT_INPUT"
  | "INVALID_CREDENTIALS"
  | "CREDENTIAL_LOCKED"
  | "INVALID_PRIMARY_EXPORTER"
  | "INVALID_PRODUCT_IDENTITY"
  | "INVALID_RECOVERY_TOKEN";

export class AccountServiceError extends Error {
  constructor(
    readonly code: AccountServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountServiceError";
    brandCrossBundleError(this, ERROR_BRAND);
  }
}

export function isAccountServiceError(
  value: unknown,
): value is AccountServiceError {
  return hasCrossBundleErrorBrand(value, ERROR_BRAND);
}

export function invalidAccountInput(message: string): AccountServiceError {
  return new AccountServiceError("INVALID_ACCOUNT_INPUT", message);
}

export function invalidCredentials(): AccountServiceError {
  return new AccountServiceError(
    "INVALID_CREDENTIALS",
    "The credentials could not be verified.",
  );
}

export function credentialLocked(lockedUntil: string): AccountServiceError {
  return new AccountServiceError(
    "CREDENTIAL_LOCKED",
    `The credential is locked until ${lockedUntil}.`,
  );
}

export function invalidPrimaryExporter(
  economyCode: string,
): AccountServiceError {
  return new AccountServiceError(
    "INVALID_PRIMARY_EXPORTER",
    `Primary exporter ${economyCode} is not a supported economy code.`,
  );
}

export function invalidProductIdentity(
  hsRevision: string,
  code: string,
): AccountServiceError {
  return new AccountServiceError(
    "INVALID_PRODUCT_IDENTITY",
    `${hsRevision} product ${code} is not a confirmed catalog identity.`,
  );
}

export function invalidRecoveryToken(): AccountServiceError {
  return new AccountServiceError(
    "INVALID_RECOVERY_TOKEN",
    "The recovery token is expired, consumed, or unknown.",
  );
}
