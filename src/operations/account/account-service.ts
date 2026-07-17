import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

import { isOperationalStoreError } from "../store/errors";
import {
  requireNonEmpty,
  requirePositiveInt,
  systemClock,
  toIso,
} from "../store/internal";
import type { Credential, ProductRef } from "../store/model";
import {
  credentialLocked,
  invalidAccountInput,
  invalidCredentials,
  invalidPrimaryExporter,
  invalidProductIdentity,
  invalidRecoveryToken,
} from "./errors";
import type {
  AccountService,
  AccountServiceOptions,
  AccountRegistration,
  AuthenticateInput,
  AuthenticatedSession,
  ConsumeRecoveryTokenInput,
  IssueRecoveryTokenInput,
  ProductCandidateSearchInput,
  RecoveryTokenIssued,
  RegisterAccountInput,
} from "./model";

export type {
  AccountService,
  AccountServiceOptions,
  AccountRegistration,
  AuthenticateInput,
  AuthenticatedSession,
  ConsumeRecoveryTokenInput,
  IssueRecoveryTokenInput,
  ProductCandidateSearchInput,
  RecoveryTokenIssued,
  RegisterAccountInput,
} from "./model";
export { isAccountServiceError } from "./errors";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;
const DEFAULT_RECOVERY_SECONDS = 60 * 60;
const FAILED_ATTEMPT_LOCK_THRESHOLD = 5;
const LOCKOUT_MILLISECONDS = 15 * 60 * 1000;

class DefaultAccountService implements AccountService {
  constructor(private readonly options: Required<AccountServiceOptions>) {}

  async registerAccount(
    input: RegisterAccountInput,
  ): Promise<AccountRegistration> {
    const email = normalizeEmail(input.email);
    const password = requirePassword(input.password);
    const displayName = requireNonEmpty(input.displayName, "displayName");
    const primaryExportEconomy = await this.requirePrimaryExporter(
      input.primaryExportEconomy,
    );
    const verifier = await hashPassword(password);

    try {
      const registered = await this.options.store.createAccountWithCredential({
        displayName,
        primaryExportEconomy,
        credentialIdentity: email,
        credentialVerifier: verifier,
      });
      await this.options.store.appendAuditEvent({
        accountId: registered.account.id,
        kind: "ACCOUNT_CREATED",
        detail: { primaryExportEconomy },
      });
      return { account: registered.account };
    } catch (error) {
      if (
        isOperationalStoreError(error) &&
        error.code === "DUPLICATE_CREDENTIAL_IDENTITY"
      ) {
        throw invalidAccountInput("An account already uses that email identity.");
      }
      throw error;
    }
  }

  async getAccount(accountId: string) {
    return this.options.store.findAccount(accountId);
  }

  async authenticate(
    input: AuthenticateInput,
  ): Promise<AuthenticatedSession> {
    const email = normalizeEmail(input.email);
    const password = requirePassword(input.password);
    const credential = await this.options.store.findCredentialByIdentity(email);
    if (credential === null) {
      await this.auditSignInRefused(null, "INVALID_CREDENTIALS");
      throw invalidCredentials();
    }

    const activeLockUntil = activeLock(credential, this.now());
    if (activeLockUntil !== null) {
      await this.auditSignInRefused(credential.accountId, "LOCKED");
      throw credentialLocked(activeLockUntil);
    }

    if (!(await verifyPassword(password, credential.verifier))) {
      const priorFailedAttemptCount =
        expiredLock(credential, this.now()) ? 0 : credential.failedAttemptCount;
      const failedAttemptCount = priorFailedAttemptCount + 1;
      const lockedUntil =
        failedAttemptCount >= FAILED_ATTEMPT_LOCK_THRESHOLD
          ? toIso(new Date(this.now().getTime() + LOCKOUT_MILLISECONDS))
          : null;
      await this.options.store.updateCredentialAttempts({
        credentialId: credential.id,
        failedAttemptCount,
        lockedUntil,
      });
      await this.auditSignInRefused(
        credential.accountId,
        lockedUntil === null ? "INVALID_CREDENTIALS" : "LOCKED",
      );
      if (lockedUntil !== null) {
        throw credentialLocked(lockedUntil);
      }
      throw invalidCredentials();
    }

    await this.options.store.updateCredentialAttempts({
      credentialId: credential.id,
      failedAttemptCount: 0,
      lockedUntil: null,
    });

    const account = await this.options.store.findAccount(credential.accountId);
    if (account === null) {
      await this.auditSignInRefused(null, "INVALID_CREDENTIALS");
      throw invalidCredentials();
    }

    const durationSeconds = input.sessionDurationSeconds ?? DEFAULT_SESSION_SECONDS;
    requirePositiveInt(durationSeconds, "sessionDurationSeconds");
    const issued = issueOpaqueToken();
    const expiresAt = toIso(
      new Date(this.now().getTime() + durationSeconds * 1000),
    );
    await this.options.store.createSession({
      accountId: account.id,
      tokenDigest: issued.digest,
      expiresAt,
    });
    await this.options.store.appendAuditEvent({
      accountId: account.id,
      kind: "SIGN_IN_SUCCEEDED",
      detail: { expiresAt },
    });
    return { account, sessionToken: issued.token, expiresAt };
  }

  async resolveSession(sessionToken: string) {
    const session = await this.options.store.findSession(
      digestToken(requireNonEmpty(sessionToken, "sessionToken")),
    );
    if (session === null) {
      return null;
    }
    return this.options.store.findAccount(session.accountId);
  }

  async signOut(sessionToken: string): Promise<void> {
    await this.options.store.revokeSession(
      digestToken(requireNonEmpty(sessionToken, "sessionToken")),
    );
  }

  async issueRecoveryToken(
    input: IssueRecoveryTokenInput,
  ): Promise<RecoveryTokenIssued> {
    const email = normalizeEmail(input.email);
    const credential = await this.options.store.findCredentialByIdentity(email);
    if (credential === null) {
      await this.options.store.appendAuditEvent({
        accountId: null,
        kind: "RECOVERY_REFUSED",
        detail: { reason: "INVALID_CREDENTIALS" },
      });
      throw invalidCredentials();
    }

    const durationSeconds =
      input.tokenDurationSeconds ?? DEFAULT_RECOVERY_SECONDS;
    requirePositiveInt(durationSeconds, "tokenDurationSeconds");
    const issued = issueOpaqueToken();
    const expiresAt = toIso(
      new Date(this.now().getTime() + durationSeconds * 1000),
    );
    await this.options.store.issueRecoveryToken({
      accountId: credential.accountId,
      tokenDigest: issued.digest,
      expiresAt,
    });
    await this.options.store.appendAuditEvent({
      accountId: credential.accountId,
      kind: "RECOVERY_TOKEN_ISSUED",
      detail: { expiresAt },
    });
    return { token: issued.token, expiresAt };
  }

  async consumeRecoveryToken(
    input: ConsumeRecoveryTokenInput,
  ): Promise<void> {
    const token = requireNonEmpty(input.token, "token");
    const newPassword = requirePassword(input.newPassword);
    const consumed = await this.options.store.consumeRecoveryToken(
      digestToken(token),
    );
    if (consumed === null) {
      throw invalidRecoveryToken();
    }
    const credential = await this.options.store.findCredentialByAccount(
      consumed.accountId,
    );
    if (credential === null) {
      throw invalidRecoveryToken();
    }

    await this.options.store.updateCredentialVerifier({
      credentialId: credential.id,
      verifier: await hashPassword(newPassword),
    });
    await this.options.store.revokeSessionsForAccount(consumed.accountId);
    await this.options.store.appendAuditEvent({
      accountId: consumed.accountId,
      kind: "ACCOUNT_RECOVERED",
      detail: {},
    });
  }

  async setPrimaryExporter(accountId: string, economyCode: string) {
    const existing = await this.options.store.findAccount(accountId);
    if (existing === null) {
      throw invalidAccountInput(`Account ${accountId} does not exist.`);
    }
    const primaryExportEconomy =
      await this.requirePrimaryExporter(economyCode);
    const changed = await this.options.store.setPrimaryExporter(
      accountId,
      primaryExportEconomy,
    );
    await this.options.store.appendAuditEvent({
      accountId,
      kind: "PRIMARY_EXPORTER_CHANGED",
      detail: {
        from: existing.primaryExportEconomy,
        to: primaryExportEconomy,
      },
    });
    return changed;
  }

  async searchProductCandidates(input: ProductCandidateSearchInput) {
    return this.options.productCatalog.search({
      productSearchBuildId: this.options.productSearchBuildId,
      query: requireNonEmpty(input.query, "query"),
      locale: input.locale,
      limit: input.limit,
    });
  }

  async confirmProduct(accountId: string, product: ProductRef) {
    const confirmedProduct = await this.requireProductIdentity(product);
    const current = await this.options.store.listConfirmedProducts(accountId);
    const next = new Map(
      current.map((entry) => [
        productKey(entry.product),
        entry.product,
      ]),
    );
    next.set(productKey(confirmedProduct), confirmedProduct);
    const confirmed = await this.options.store.confirmPortfolio(
      accountId,
      [...next.values()],
    );
    await this.options.store.appendAuditEvent({
      accountId,
      kind: "PRODUCT_CONFIRMED",
      detail: { product: confirmedProduct },
    });
    return confirmed;
  }

  async removeProduct(accountId: string, product: ProductRef) {
    const normalized = normalizeProductRef(product);
    const current = await this.options.store.listConfirmedProducts(accountId);
    const remaining = current
      .map((entry) => entry.product)
      .filter((entry) => productKey(entry) !== productKey(normalized));
    const confirmed = await this.options.store.confirmPortfolio(
      accountId,
      remaining,
    );
    await this.options.store.appendAuditEvent({
      accountId,
      kind: "PRODUCT_REMOVED",
      detail: { product: normalized },
    });
    return confirmed;
  }

  async listConfirmedProducts(accountId: string) {
    return this.options.store.listConfirmedProducts(accountId);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.options.store.deleteAccount(accountId);
  }

  private async requirePrimaryExporter(economyCode: string): Promise<string> {
    const code = requireNonEmpty(economyCode, "primaryExportEconomy");
    const result = await this.options.economyDirectory.search({
      analysisBuildId: this.options.economyAnalysisBuildId,
      query: code,
      limit: 1,
    });
    const match = result.matches[0];
    if (
      match === undefined ||
      match.match?.class !== "EXACT_CODE" ||
      match.economy.code !== result.query.normalized
    ) {
      throw invalidPrimaryExporter(code);
    }
    return match.economy.code;
  }

  private async requireProductIdentity(product: ProductRef): Promise<ProductRef> {
    const normalized = normalizeProductRef(product);
    const result = await this.options.productCatalog.search({
      productSearchBuildId: this.options.productSearchBuildId,
      query: normalized.code,
      locale: "en",
      limit: 1,
    });
    const match = result.matches[0];
    if (
      match === undefined ||
      match.match.class !== "EXACT_CODE" ||
      match.match.field !== "CODE" ||
      match.product.hsRevision !== normalized.hsRevision ||
      match.product.code !== normalized.code
    ) {
      throw invalidProductIdentity(normalized.hsRevision, normalized.code);
    }
    return {
      hsRevision: match.product.hsRevision,
      code: match.product.code,
    };
  }

  private now(): Date {
    return this.options.clock();
  }

  private async auditSignInRefused(
    accountId: string | null,
    reason: string,
  ): Promise<void> {
    await this.options.store.appendAuditEvent({
      accountId,
      kind: "SIGN_IN_REFUSED",
      detail: { reason },
    });
  }
}

export function createAccountService(
  options: AccountServiceOptions,
): AccountService {
  return new DefaultAccountService({
    ...options,
    clock: options.clock ?? systemClock,
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = await deriveScrypt(password, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLength: SCRYPT_KEY_LENGTH,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

async function verifyPassword(
  password: string,
  verifier: string,
): Promise<boolean> {
  const parsed = parseVerifier(verifier);
  if (parsed === null) {
    return false;
  }
  const actual = await deriveScrypt(password, parsed.salt, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    keyLength: parsed.hash.length,
  });
  return (
    actual.length === parsed.hash.length &&
    timingSafeEqual(actual, parsed.hash)
  );
}

async function deriveScrypt(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number; keyLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      params.keyLength,
      {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function parseVerifier(verifier: string): {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
} | null {
  const [kind, N, r, p, salt, hash] = verifier.split("$");
  if (kind !== "scrypt" || !N || !r || !p || !salt || !hash) {
    return null;
  }
  const parsed = {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
  if (
    !Number.isInteger(parsed.N) ||
    !Number.isInteger(parsed.r) ||
    !Number.isInteger(parsed.p) ||
    parsed.salt.length === 0 ||
    parsed.hash.length === 0
  ) {
    return null;
  }
  return parsed;
}

function issueOpaqueToken(): { token: string; digest: string } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return { token, digest: digestToken(token) };
}

function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeEmail(email: string): string {
  const normalized = requireNonEmpty(email, "email")
    .trim()
    .toLocaleLowerCase("und");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw invalidAccountInput("Email must be a valid address.");
  }
  return normalized;
}

function requirePassword(password: string): string {
  const value = requireNonEmpty(password, "password");
  if ([...value].length < 8) {
    throw invalidAccountInput("Password must be at least 8 characters.");
  }
  return value;
}

function activeLock(credential: Credential, now: Date): string | null {
  return credential.lockedUntil !== null &&
    Date.parse(credential.lockedUntil) > now.getTime()
    ? credential.lockedUntil
    : null;
}

function expiredLock(credential: Credential, now: Date): boolean {
  return credential.lockedUntil !== null &&
    Date.parse(credential.lockedUntil) <= now.getTime();
}

function normalizeProductRef(product: ProductRef): ProductRef {
  return {
    hsRevision: requireNonEmpty(product.hsRevision, "product.hsRevision"),
    code: requireNonEmpty(product.code, "product.code"),
  };
}

function productKey(product: ProductRef): string {
  return `${product.hsRevision}|${product.code}`;
}
