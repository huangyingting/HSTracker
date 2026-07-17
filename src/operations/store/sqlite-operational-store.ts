import { closeSync, copyFileSync, openSync, chmodSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import {
  applicationLeaseUnavailable,
  duplicateCredentialIdentity,
  invalidStoreInput,
  nonLocalSqliteVolume,
  storeInMaintenance,
  unknownEntity,
} from "./errors";
import {
  computeWatchContextIdentity,
  normalizeCredentialIdentity,
  requireNonEmpty,
  requireNonNegativeInt,
  requirePositiveInt,
  systemClock,
  toIso,
  type Clock,
} from "./internal";
import type {
  Account,
  AccountCredentialRegistration,
  AccountId,
  AlertEvent,
  AlertEventId,
  AppendAuditEventInput,
  AuditEvent,
  ClaimedWatch,
  ClaimWatchesInput,
  CompleteEvaluationInput,
  ConfirmedProduct,
  CreateAccountInput,
  CreateAccountWithCredentialInput,
  CreateCredentialInput,
  CreateSessionInput,
  Credential,
  DeliveryAttemptOutcome,
  DeliveryConsentState,
  DeliveryStatus,
  DeliverySuppressionReason,
  DeliverySuppressionState,
  DeliveryState,
  EvaluationLeaseId,
  IssueRecoveryTokenInput,
  OpenWatchInput,
  OpportunityWatch,
  OperationalSession,
  RecordAlertEventInput,
  RecordDeliveryAttemptInput,
  RecordDeliverySuppressionInput,
  RecordedAlertEvent,
  RecoveryToken,
  RequestDeliveryConsentInput,
  UpdateCredentialAttemptsInput,
  UpdateCredentialVerifierInput,
  VerifyDeliveryConsentInput,
  WatchId,
} from "./model";
import type {
  OperationalStore,
  ProductRefInput,
} from "./operational-store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operational_account (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  primary_export_economy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operational_credential (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  normalized_identity TEXT NOT NULL UNIQUE,
  verifier TEXT NOT NULL,
  failed_attempt_count INTEGER NOT NULL,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operational_session (
  token_digest TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS operational_recovery_token (
  token_digest TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS operational_confirmed_product (
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  hs_revision TEXT NOT NULL,
  code TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, hs_revision, code)
);
CREATE TABLE IF NOT EXISTS operational_delivery_consent (
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  verified_at TEXT,
  unsubscribed_at TEXT,
  verification_token TEXT NOT NULL UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, channel, target)
);
CREATE TABLE IF NOT EXISTS operational_delivery_suppression (
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT NOT NULL,
  provider_receipt TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, channel, target, reason)
);
CREATE TABLE IF NOT EXISTS operational_watch (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  hs_revision TEXT NOT NULL,
  code TEXT NOT NULL,
  market_economy TEXT NOT NULL,
  reporting_economy_iso2 TEXT NOT NULL,
  hs12_code TEXT NOT NULL,
  export_economy_code TEXT NOT NULL,
  cadence TEXT NOT NULL,
  delivery_preferences TEXT NOT NULL,
  context_identity TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paused_at TEXT,
  deleted_at TEXT,
  last_evaluated_package_id TEXT,
  UNIQUE (account_id, reporting_economy_iso2, hs_revision, hs12_code, cadence, export_economy_code)
);
CREATE TABLE IF NOT EXISTS operational_last_evaluation (
  watch_id TEXT NOT NULL REFERENCES operational_watch(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  cutoff_month TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  growth_rate_decimal TEXT,
  confidence TEXT,
  evaluated_at TEXT NOT NULL,
  alert_event_id TEXT REFERENCES operational_alert_event(id) ON DELETE SET NULL,
  PRIMARY KEY (watch_id, recipe_id)
);
CREATE TABLE IF NOT EXISTS operational_alert_event (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES operational_watch(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  recipe_id TEXT,
  package_id TEXT,
  superseded_package_id TEXT,
  cutoff_month TEXT,
  prior_event_id TEXT REFERENCES operational_alert_event(id) ON DELETE SET NULL,
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (watch_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS operational_delivery_state (
  delivery_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES operational_alert_event(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  last_attempt_at TEXT NOT NULL,
  provider_receipt TEXT,
  last_outcome TEXT,
  failure_reason TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, channel)
);
CREATE TABLE IF NOT EXISTS operational_audit_event (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operational_evaluation_lease (
  lease_id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES operational_watch(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (watch_id, package_id)
);
CREATE TABLE IF NOT EXISTS operational_application_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export interface SqliteOperationalStoreOptions {
  /** Absolute or relative path to a local SQLite file. `:memory:` is rejected. */
  readonly filePath: string;
  /** Identifies this application instance in the single-instance lease. */
  readonly holder?: string;
  /** Application-lease duration in seconds. */
  readonly applicationLeaseSeconds?: number;
  readonly clock?: Clock;
}

type SqliteDatabase = InstanceType<typeof Database>;

interface AccountRow {
  id: string;
  display_name: string;
  primary_export_economy: string;
  created_at: string;
  updated_at: string;
}

interface CredentialRow {
  id: string;
  account_id: string;
  normalized_identity: string;
  verifier: string;
  failed_attempt_count: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  token_digest: string;
  account_id: string;
  created_at: string;
  expires_at: string;
}

interface RecoveryTokenRow {
  token_digest: string;
  account_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface DeliveryConsentRow {
  account_id: string;
  channel: string;
  target: string;
  consented_at: string;
  verified_at: string | null;
  unsubscribed_at: string | null;
  verification_token: string;
  unsubscribe_token: string;
  created_at: string;
  updated_at: string;
}

interface DeliverySuppressionRow {
  account_id: string;
  channel: string;
  target: string;
  reason: string;
  provider_receipt: string | null;
  created_at: string;
}

interface WatchRow {
  id: string;
  account_id: string;
  hs_revision: string;
  code: string;
  market_economy: string;
  reporting_economy_iso2: string;
  hs12_code: string;
  export_economy_code: string;
  cadence: string;
  delivery_preferences: string;
  context_identity: string;
  status: string;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  deleted_at: string | null;
  last_evaluated_package_id: string | null;
}

interface LastEvaluationRow {
  watch_id: string;
  recipe_id: string;
  package_id: string;
  cutoff_month: string;
  result_digest: string;
  state: string;
  growth_rate_decimal: string | null;
  confidence: string | null;
  evaluated_at: string;
  alert_event_id: string | null;
}

interface AlertEventRow {
  id: string;
  watch_id: string;
  account_id: string;
  kind: string;
  dedupe_key: string;
  recipe_id: string | null;
  package_id: string | null;
  superseded_package_id: string | null;
  cutoff_month: string | null;
  prior_event_id: string | null;
  detail: string;
  occurred_at: string;
  created_at: string;
}

interface AuditEventRow {
  id: string;
  account_id: string | null;
  kind: string;
  detail: string;
  created_at: string;
}

/**
 * Strict single-instance SQLite adapter. It runs in WAL mode, refuses to open
 * against a non-local target, and holds a single-instance application lease so
 * a second application or evaluator on the same file is rejected.
 */
export class SqliteOperationalStore implements OperationalStore {
  private readonly db: SqliteDatabase;
  private readonly clock: Clock;
  private readonly holder: string;
  private readonly token = randomUUID();
  private readonly applicationLeaseSeconds: number;
  private closed = false;
  private maintenance = false;

  constructor(options: SqliteOperationalStoreOptions) {
    const filePath = requireNonEmpty(options.filePath, "filePath");
    if (filePath === ":memory:" || filePath.includes("://")) {
      throw nonLocalSqliteVolume(filePath);
    }
    this.clock = options.clock ?? systemClock;
    this.holder =
      options.holder ?? `${hostname()}:${process.pid}:${randomUUID()}`;
    this.applicationLeaseSeconds = options.applicationLeaseSeconds ?? 60;

    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.upgradeSchema();
    this.acquireApplicationLease();
  }

  private now(): Date {
    return this.clock();
  }

  private acquireApplicationLease(): void {
    const nowMs = this.now().getTime();
    const acquire = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          "SELECT holder, token, expires_at FROM operational_application_lease WHERE id = 1",
        )
        .get() as
        | { holder: string; token: string; expires_at: string }
        | undefined;
      const live =
        existing !== undefined &&
        Date.parse(existing.expires_at) > nowMs &&
        existing.token !== this.token;
      if (live) {
        throw applicationLeaseUnavailable(existing.holder);
      }
      const expiresAt = toIso(
        new Date(nowMs + this.applicationLeaseSeconds * 1000),
      );
      this.db
        .prepare(
          `INSERT INTO operational_application_lease (id, holder, token, acquired_at, expires_at)
           VALUES (1, @holder, @token, @acquiredAt, @expiresAt)
           ON CONFLICT (id) DO UPDATE SET
             holder = excluded.holder,
             token = excluded.token,
             acquired_at = excluded.acquired_at,
             expires_at = excluded.expires_at`,
        )
        .run({
          holder: this.holder,
          token: this.token,
          acquiredAt: toIso(new Date(nowMs)),
          expiresAt,
        });
    });
    acquire.immediate();
  }

  private assertWritable(): void {
    if (this.maintenance) {
      throw storeInMaintenance();
    }
  }

  private upgradeSchema(): void {
    addColumnIfMissing(
      this.db,
      "operational_delivery_state",
      "last_outcome",
      "TEXT",
    );
    addColumnIfMissing(
      this.db,
      "operational_delivery_state",
      "failure_reason",
      "TEXT",
    );
  }

  /** Place the store in maintenance mode, rejecting further writes. */
  enterMaintenance(): void {
    this.maintenance = true;
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    this.assertWritable();
    const displayName = requireNonEmpty(input.displayName, "displayName");
    const economy = requireNonEmpty(
      input.primaryExportEconomy,
      "primaryExportEconomy",
    );
    const id = randomUUID();
    const ts = toIso(this.now());
    this.db
      .prepare(
        `INSERT INTO operational_account (id, display_name, primary_export_economy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, displayName, economy, ts, ts);
    return {
      id,
      displayName,
      primaryExportEconomy: economy,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async createAccountWithCredential(
    input: CreateAccountWithCredentialInput,
  ): Promise<AccountCredentialRegistration> {
    this.assertWritable();
    const displayName = requireNonEmpty(input.displayName, "displayName");
    const economy = requireNonEmpty(
      input.primaryExportEconomy,
      "primaryExportEconomy",
    );
    const normalizedIdentity = normalizeCredentialIdentity(
      input.credentialIdentity,
    );
    const verifier = requireNonEmpty(
      input.credentialVerifier,
      "credentialVerifier",
    );
    const accountId = randomUUID();
    const credentialId = randomUUID();
    const ts = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO operational_account (id, display_name, primary_export_economy, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(accountId, displayName, economy, ts, ts);
      this.db
        .prepare(
          `INSERT INTO operational_credential
             (id, account_id, normalized_identity, verifier, failed_attempt_count, locked_until, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
        )
        .run(credentialId, accountId, normalizedIdentity, verifier, ts, ts);
    });
    try {
      tx();
    } catch (error) {
      throw mapCredentialInsertError(error, normalizedIdentity);
    }
    return {
      account: {
        id: accountId,
        displayName,
        primaryExportEconomy: economy,
        createdAt: ts,
        updatedAt: ts,
      },
      credential: {
        id: credentialId,
        accountId,
        normalizedIdentity,
        verifier,
        failedAttemptCount: 0,
        lockedUntil: null,
        createdAt: ts,
        updatedAt: ts,
      },
    };
  }

  async findAccount(id: AccountId): Promise<Account | null> {
    const row = this.db
      .prepare("SELECT * FROM operational_account WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? mapAccount(row) : null;
  }

  private requireAccount(id: AccountId): void {
    const found = this.db
      .prepare("SELECT 1 FROM operational_account WHERE id = ?")
      .get(id);
    if (!found) {
      throw unknownEntity(`Account ${id} does not exist.`);
    }
  }

  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const normalizedIdentity = normalizeCredentialIdentity(input.identity);
    const verifier = requireNonEmpty(input.verifier, "verifier");
    const id = randomUUID();
    const ts = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_credential
             (id, account_id, normalized_identity, verifier, failed_attempt_count, locked_until, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
        )
        .run(id, accountId, normalizedIdentity, verifier, ts, ts);
    });
    try {
      tx();
    } catch (error) {
      throw mapCredentialInsertError(error, normalizedIdentity);
    }
    return {
      id,
      accountId,
      normalizedIdentity,
      verifier,
      failedAttemptCount: 0,
      lockedUntil: null,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async findCredentialByIdentity(
    identity: string,
  ): Promise<Credential | null> {
    const normalizedIdentity = normalizeCredentialIdentity(identity);
    const row = this.db
      .prepare(
        "SELECT * FROM operational_credential WHERE normalized_identity = ?",
      )
      .get(normalizedIdentity) as CredentialRow | undefined;
    return row ? mapCredential(row) : null;
  }

  async findCredentialByAccount(
    accountId: AccountId,
  ): Promise<Credential | null> {
    const row = this.db
      .prepare("SELECT * FROM operational_credential WHERE account_id = ?")
      .get(accountId) as CredentialRow | undefined;
    return row ? mapCredential(row) : null;
  }

  async updateCredentialAttempts(
    input: UpdateCredentialAttemptsInput,
  ): Promise<Credential> {
    this.assertWritable();
    const credentialId = requireNonEmpty(input.credentialId, "credentialId");
    const failedAttemptCount = requireNonNegativeInt(
      input.failedAttemptCount,
      "failedAttemptCount",
    );
    const lockedUntil =
      input.lockedUntil === null
        ? null
        : requireNonEmpty(input.lockedUntil, "lockedUntil");
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_credential
         SET failed_attempt_count = ?, locked_until = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(failedAttemptCount, lockedUntil, ts, credentialId);
    if (result.changes === 0) {
      throw unknownEntity(`Credential ${credentialId} does not exist.`);
    }
    const row = this.db
      .prepare("SELECT * FROM operational_credential WHERE id = ?")
      .get(credentialId) as CredentialRow;
    return mapCredential(row);
  }

  async updateCredentialVerifier(
    input: UpdateCredentialVerifierInput,
  ): Promise<Credential> {
    this.assertWritable();
    const credentialId = requireNonEmpty(input.credentialId, "credentialId");
    const verifier = requireNonEmpty(input.verifier, "verifier");
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_credential
         SET verifier = ?, failed_attempt_count = 0, locked_until = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(verifier, ts, credentialId);
    if (result.changes === 0) {
      throw unknownEntity(`Credential ${credentialId} does not exist.`);
    }
    const row = this.db
      .prepare("SELECT * FROM operational_credential WHERE id = ?")
      .get(credentialId) as CredentialRow;
    return mapCredential(row);
  }

  async requestDeliveryConsent(
    input: RequestDeliveryConsentInput,
  ): Promise<DeliveryConsentState> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const channel = normalizeDeliveryChannel(input.channel);
    const target = normalizeDeliveryTarget(input.target);
    const verificationToken = input.verificationToken
      ? requireNonEmpty(input.verificationToken, "verificationToken")
      : randomUUID();
    const unsubscribeToken = input.unsubscribeToken
      ? requireNonEmpty(input.unsubscribeToken, "unsubscribeToken")
      : randomUUID();
    const ts = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_delivery_consent
             (account_id, channel, target, consented_at, verified_at, unsubscribed_at,
              verification_token, unsubscribe_token, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
           ON CONFLICT (account_id, channel, target) DO UPDATE SET
             consented_at = excluded.consented_at,
             verified_at = NULL,
             unsubscribed_at = NULL,
             verification_token = excluded.verification_token,
             unsubscribe_token = excluded.unsubscribe_token,
             updated_at = excluded.updated_at`,
        )
        .run(
          accountId,
          channel,
          target,
          ts,
          verificationToken,
          unsubscribeToken,
          ts,
          ts,
        );
    });
    tx();
    return (await this.findDeliveryConsent(accountId, channel, target))!;
  }

  async verifyDeliveryConsent(
    input: VerifyDeliveryConsentInput,
  ): Promise<DeliveryConsentState | null> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const channel = normalizeDeliveryChannel(input.channel);
    const target = normalizeDeliveryTarget(input.target);
    const verificationToken = requireNonEmpty(
      input.verificationToken,
      "verificationToken",
    );
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_delivery_consent
         SET verified_at = COALESCE(verified_at, ?), updated_at = ?
         WHERE account_id = ? AND channel = ? AND target = ?
           AND verification_token = ? AND unsubscribed_at IS NULL`,
      )
      .run(ts, ts, accountId, channel, target, verificationToken);
    if (result.changes === 0) {
      return null;
    }
    return this.findDeliveryConsent(accountId, channel, target);
  }

  async findDeliveryConsent(
    accountId: AccountId,
    channel: string,
    target: string,
  ): Promise<DeliveryConsentState | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM operational_delivery_consent
         WHERE account_id = ? AND channel = ? AND target = ?`,
      )
      .get(
        requireNonEmpty(accountId, "accountId"),
        normalizeDeliveryChannel(channel),
        normalizeDeliveryTarget(target),
      ) as DeliveryConsentRow | undefined;
    return row ? mapDeliveryConsent(row) : null;
  }

  async unsubscribeDeliveryTarget(
    unsubscribeToken: string,
  ): Promise<DeliveryConsentState | null> {
    this.assertWritable();
    const token = requireNonEmpty(unsubscribeToken, "unsubscribeToken");
    const ts = toIso(this.now());
    let consent: DeliveryConsentRow | undefined;
    const tx = this.db.transaction(() => {
      consent = this.db
        .prepare(
          "SELECT * FROM operational_delivery_consent WHERE unsubscribe_token = ?",
        )
        .get(token) as DeliveryConsentRow | undefined;
      if (!consent) {
        return;
      }
      this.db
        .prepare(
          `UPDATE operational_delivery_consent
           SET unsubscribed_at = COALESCE(unsubscribed_at, ?), updated_at = ?
           WHERE unsubscribe_token = ?`,
        )
        .run(ts, ts, token);
      this.db
        .prepare(
          `INSERT INTO operational_delivery_suppression
             (account_id, channel, target, reason, provider_receipt, created_at)
           VALUES (?, ?, ?, 'UNSUBSCRIBE', NULL, ?)
           ON CONFLICT (account_id, channel, target, reason) DO NOTHING`,
        )
        .run(consent.account_id, consent.channel, consent.target, ts);
    });
    tx();
    if (!consent) {
      return null;
    }
    return this.findDeliveryConsent(
      consent.account_id,
      consent.channel,
      consent.target,
    );
  }

  async recordDeliverySuppression(
    input: RecordDeliverySuppressionInput,
  ): Promise<DeliverySuppressionState> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const channel = normalizeDeliveryChannel(input.channel);
    const target = normalizeDeliveryTarget(input.target);
    const reason = normalizeSuppressionReason(input.reason);
    const providerReceipt = input.providerReceipt ?? null;
    const ts = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_delivery_suppression
             (account_id, channel, target, reason, provider_receipt, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (account_id, channel, target, reason) DO UPDATE SET
             provider_receipt = COALESCE(operational_delivery_suppression.provider_receipt, excluded.provider_receipt)`,
        )
        .run(accountId, channel, target, reason, providerReceipt, ts);
    });
    tx();
    return (await this.getDeliverySuppression(accountId, channel, target))!;
  }

  async getDeliverySuppression(
    accountId: AccountId,
    channel: string,
    target: string,
  ): Promise<DeliverySuppressionState | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM operational_delivery_suppression
         WHERE account_id = ? AND channel = ? AND target = ?
         ORDER BY CASE reason
           WHEN 'BOUNCE' THEN 1
           WHEN 'COMPLAINT' THEN 2
           WHEN 'UNSUBSCRIBE' THEN 3
           ELSE 4
         END, created_at, reason
         LIMIT 1`,
      )
      .get(
        requireNonEmpty(accountId, "accountId"),
        normalizeDeliveryChannel(channel),
        normalizeDeliveryTarget(target),
      ) as DeliverySuppressionRow | undefined;
    return row ? mapDeliverySuppression(row) : null;
  }

  async createSession(input: CreateSessionInput): Promise<OperationalSession> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const tokenDigest = requireNonEmpty(input.tokenDigest, "tokenDigest");
    const expiresAt = requireNonEmpty(input.expiresAt, "expiresAt");
    const createdAt = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_session
             (token_digest, account_id, created_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(tokenDigest, accountId, createdAt, expiresAt);
    });
    tx();
    return { tokenDigest, accountId, createdAt, expiresAt };
  }

  async findSession(tokenDigest: string): Promise<OperationalSession | null> {
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    const row = this.db
      .prepare(
        `SELECT token_digest, account_id, created_at, expires_at
         FROM operational_session
         WHERE token_digest = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(digest, toIso(this.now())) as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  async revokeSession(tokenDigest: string): Promise<void> {
    this.assertWritable();
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    this.db
      .prepare(
        `UPDATE operational_session
         SET revoked_at = ?
         WHERE token_digest = ? AND revoked_at IS NULL`,
      )
      .run(toIso(this.now()), digest);
  }

  async revokeSessionsForAccount(accountId: AccountId): Promise<void> {
    this.assertWritable();
    this.requireAccount(accountId);
    this.db
      .prepare(
        `UPDATE operational_session
         SET revoked_at = ?
         WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .run(toIso(this.now()), accountId);
  }

  async issueRecoveryToken(
    input: IssueRecoveryTokenInput,
  ): Promise<RecoveryToken> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const tokenDigest = requireNonEmpty(input.tokenDigest, "tokenDigest");
    const expiresAt = requireNonEmpty(input.expiresAt, "expiresAt");
    const createdAt = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_recovery_token
             (token_digest, account_id, created_at, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(tokenDigest, accountId, createdAt, expiresAt);
    });
    tx();
    return { tokenDigest, accountId, createdAt, expiresAt, consumedAt: null };
  }

  async consumeRecoveryToken(
    tokenDigest: string,
  ): Promise<RecoveryToken | null> {
    this.assertWritable();
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    const consumedAt = toIso(this.now());
    let consumed: RecoveryToken | null = null;
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT token_digest, account_id, created_at, expires_at, consumed_at
           FROM operational_recovery_token
           WHERE token_digest = ?
             AND consumed_at IS NULL
             AND expires_at > ?`,
        )
        .get(digest, consumedAt) as RecoveryTokenRow | undefined;
      if (!row) {
        return;
      }
      this.db
        .prepare(
          "UPDATE operational_recovery_token SET consumed_at = ? WHERE token_digest = ?",
        )
        .run(consumedAt, digest);
      consumed = mapRecoveryToken({ ...row, consumed_at: consumedAt });
    });
    tx.immediate();
    return consumed;
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
    this.assertWritable();
    const accountId =
      input.accountId === null
        ? null
        : requireNonEmpty(input.accountId, "accountId");
    const kind = requireNonEmpty(input.kind, "kind");
    const detail = JSON.stringify(input.detail ?? {});
    const id = randomUUID();
    const createdAt = toIso(this.now());
    if (accountId !== null) {
      this.requireAccount(accountId);
    }
    this.db
      .prepare(
        `INSERT INTO operational_audit_event (id, account_id, kind, detail, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, accountId, kind, detail, createdAt);
    return {
      id,
      accountId,
      kind,
      detail: JSON.parse(detail) as Record<string, unknown>,
      createdAt,
    };
  }

  async listAuditEvents(accountId: AccountId): Promise<readonly AuditEvent[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM operational_audit_event
         WHERE account_id = ?
         ORDER BY created_at, id`,
      )
      .all(accountId) as AuditEventRow[];
    return rows.map(mapAuditEvent);
  }

  async setPrimaryExporter(
    accountId: AccountId,
    economyCode: string,
  ): Promise<Account> {
    this.assertWritable();
    const economy = requireNonEmpty(economyCode, "economyCode");
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_account
         SET primary_export_economy = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(economy, ts, accountId);
    if (result.changes === 0) {
      throw unknownEntity(`Account ${accountId} does not exist.`);
    }
    return (await this.findAccount(accountId))!;
  }

  async deleteAccount(accountId: AccountId): Promise<AuditEvent> {
    this.assertWritable();
    const id = requireNonEmpty(accountId, "accountId");
    const auditId = randomUUID();
    const createdAt = toIso(this.now());
    const detail = JSON.stringify({
      accountId: id,
      retentionPolicy: "operational-account-deletion-v1",
    });
    const tx = this.db.transaction(() => {
      this.requireAccount(id);
      this.db.prepare("DELETE FROM operational_account WHERE id = ?").run(id);
      this.db
        .prepare(
          `INSERT INTO operational_audit_event (id, account_id, kind, detail, created_at)
           VALUES (?, ?, 'ACCOUNT_DELETED', ?, ?)`,
        )
        .run(auditId, id, detail, createdAt);
    });
    tx.immediate();
    return {
      id: auditId,
      accountId: id,
      kind: "ACCOUNT_DELETED",
      detail: JSON.parse(detail) as Record<string, unknown>,
      createdAt,
    };
  }

  async confirmPortfolio(
    accountId: AccountId,
    products: readonly ProductRefInput[],
  ): Promise<readonly ConfirmedProduct[]> {
    this.assertWritable();
    const normalized = dedupeProducts(products);
    const ts = toIso(this.now());
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare("DELETE FROM operational_confirmed_product WHERE account_id = ?")
        .run(accountId);
      const insert = this.db.prepare(
        `INSERT INTO operational_confirmed_product (account_id, hs_revision, code, confirmed_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const product of normalized) {
        insert.run(accountId, product.hsRevision, product.code, ts);
      }
    });
    tx();
    return this.listConfirmedProducts(accountId);
  }

  async listConfirmedProducts(
    accountId: AccountId,
  ): Promise<readonly ConfirmedProduct[]> {
    const rows = this.db
      .prepare(
        `SELECT account_id, hs_revision, code, confirmed_at
         FROM operational_confirmed_product WHERE account_id = ?
         ORDER BY hs_revision, code`,
      )
      .all(accountId) as {
      account_id: string;
      hs_revision: string;
      code: string;
      confirmed_at: string;
    }[];
    return rows.map((row) => ({
      accountId: row.account_id,
      product: { hsRevision: row.hs_revision, code: row.code },
      confirmedAt: row.confirmed_at,
    }));
  }

  async openWatch(
    accountId: AccountId,
    input: OpenWatchInput,
  ): Promise<OpportunityWatch> {
    this.assertWritable();
    const hsRevision = requireNonEmpty(
      input.product.hsRevision,
      "product.hsRevision",
    );
    const code = requireNonEmpty(input.product.code, "product.code");
    const market = requireNonEmpty(input.marketEconomy, "marketEconomy");
    const reportingEconomyIso2 = requireNonEmpty(
      input.reportingEconomyIso2 ?? market,
      "reportingEconomyIso2",
    );
    const hs12Code = requireNonEmpty(input.hs12Code ?? code, "hs12Code");
    const exportEconomyCode = input.exportEconomyCode ?? "";
    const cadence = normalizeCadence(input.cadence ?? "MONTHLY");
    const deliveryPreferences = JSON.stringify(input.deliveryPreferences ?? []);
    const contextIdentity = computeWatchContextIdentity({
      reportingEconomyIso2,
      hsRevision,
      hs12Code,
    });
    const ts = toIso(this.now());
    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.requireAccount(accountId);
      this.db
        .prepare(
          `INSERT INTO operational_watch
             (id, account_id, hs_revision, code, market_economy,
              reporting_economy_iso2, hs12_code, export_economy_code, cadence,
              delivery_preferences, context_identity, status, created_at, updated_at,
              paused_at, deleted_at, last_evaluated_package_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL, NULL)
           ON CONFLICT (account_id, reporting_economy_iso2, hs_revision, hs12_code, cadence, export_economy_code)
           DO NOTHING`,
        )
        .run(
          id,
          accountId,
          hsRevision,
          code,
          market,
          reportingEconomyIso2,
          hs12Code,
          exportEconomyCode,
          cadence,
          deliveryPreferences,
          contextIdentity,
          ts,
          ts,
        );
    });
    tx();
    const row = this.db
      .prepare(
        `SELECT * FROM operational_watch
         WHERE account_id = ?
           AND reporting_economy_iso2 = ?
           AND hs_revision = ?
           AND hs12_code = ?
           AND cadence = ?
           AND export_economy_code = ?`,
      )
      .get(
        accountId,
        reportingEconomyIso2,
        hsRevision,
        hs12Code,
        cadence,
        exportEconomyCode,
      ) as WatchRow;
    return this.mapWatchWithLastEvaluation(row);
  }

  async listWatches(
    accountId: AccountId,
  ): Promise<readonly OpportunityWatch[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM operational_watch
         WHERE account_id = ? AND deleted_at IS NULL
         ORDER BY created_at, id`,
      )
      .all(accountId) as WatchRow[];
    return rows.map((row) => this.mapWatchWithLastEvaluation(row));
  }

  async pauseWatch(watchId: WatchId): Promise<OpportunityWatch> {
    this.assertWritable();
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_watch
         SET status = 'PAUSED', paused_at = COALESCE(paused_at, ?), updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(ts, ts, watchId);
    if (result.changes === 0) {
      throw unknownEntity(`Watch ${watchId} does not exist.`);
    }
    return this.findWatch(watchId);
  }

  async resumeWatch(watchId: WatchId): Promise<OpportunityWatch> {
    this.assertWritable();
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_watch
         SET status = 'ACTIVE', paused_at = NULL, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(ts, watchId);
    if (result.changes === 0) {
      throw unknownEntity(`Watch ${watchId} does not exist.`);
    }
    return this.findWatch(watchId);
  }

  async deleteWatch(watchId: WatchId): Promise<OpportunityWatch> {
    this.assertWritable();
    const existing = this.findWatch(watchId);
    const ts = toIso(this.now());
    const result = this.db
      .prepare(
        `UPDATE operational_watch
         SET status = 'PAUSED', deleted_at = COALESCE(deleted_at, ?), updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(ts, ts, watchId);
    if (result.changes === 0) {
      throw unknownEntity(`Watch ${watchId} does not exist.`);
    }
    return { ...existing, status: "PAUSED", updatedAt: ts, deletedAt: ts };
  }

  private findWatch(watchId: WatchId): OpportunityWatch {
    const row = this.db
      .prepare("SELECT * FROM operational_watch WHERE id = ? AND deleted_at IS NULL")
      .get(watchId) as WatchRow | undefined;
    if (!row) {
      throw unknownEntity(`Watch ${watchId} does not exist.`);
    }
    return this.mapWatchWithLastEvaluation(row);
  }

  private mapWatchWithLastEvaluation(row: WatchRow): OpportunityWatch {
    const lastEvaluation = this.db
      .prepare(
        `SELECT * FROM operational_last_evaluation
         WHERE watch_id = ?
         ORDER BY evaluated_at DESC, recipe_id
         LIMIT 1`,
      )
      .get(row.id) as LastEvaluationRow | undefined;
    return mapWatch(row, lastEvaluation ? mapLastEvaluation(lastEvaluation) : null);
  }

  async claimWatchesForEvaluation(
    input: ClaimWatchesInput,
  ): Promise<readonly ClaimedWatch[]> {
    this.assertWritable();
    const evaluatorId = requireNonEmpty(input.evaluatorId, "evaluatorId");
    const packageId = requireNonEmpty(input.packageId, "packageId");
    const limit = requirePositiveInt(input.limit, "limit");
    const leaseSeconds = requirePositiveInt(input.leaseSeconds, "leaseSeconds");
    const nowMs = this.now().getTime();
    const nowIso = toIso(new Date(nowMs));
    const expiresAt = toIso(new Date(nowMs + leaseSeconds * 1000));

    const claimed: ClaimedWatch[] = [];
    const tx = this.db.transaction(() => {
      const eligible = this.db
        .prepare(
          `SELECT w.* FROM operational_watch w
           WHERE w.status = 'ACTIVE'
             AND w.deleted_at IS NULL
             AND (w.last_evaluated_package_id IS NULL OR w.last_evaluated_package_id <> @packageId)
             AND NOT EXISTS (
               SELECT 1 FROM operational_evaluation_lease l
               WHERE l.watch_id = w.id AND l.package_id = @packageId AND l.expires_at > @nowIso
             )
           ORDER BY w.created_at, w.id
           LIMIT @limit`,
        )
        .all({ packageId, nowIso, limit }) as WatchRow[];
      const upsertLease = this.db.prepare(
        `INSERT INTO operational_evaluation_lease
           (lease_id, watch_id, evaluator_id, package_id, acquired_at, expires_at)
         VALUES (@leaseId, @watchId, @evaluatorId, @packageId, @nowIso, @expiresAt)
         ON CONFLICT (watch_id, package_id) DO UPDATE SET
           lease_id = excluded.lease_id,
           evaluator_id = excluded.evaluator_id,
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at
         WHERE operational_evaluation_lease.expires_at <= @nowIso`,
      );
      for (const row of eligible) {
        const leaseId = randomUUID();
        const result = upsertLease.run({
          leaseId,
          watchId: row.id,
          evaluatorId,
          packageId,
          nowIso,
          expiresAt,
        });
        if (result.changes > 0) {
          claimed.push({
            watch: this.mapWatchWithLastEvaluation(row),
            leaseId,
            leaseExpiresAt: expiresAt,
          });
        }
      }
    });
    tx.immediate();
    return claimed;
  }

  async completeEvaluation(
    leaseId: EvaluationLeaseId,
    packageId: string,
    evaluation?: CompleteEvaluationInput,
  ): Promise<void> {
    this.assertWritable();
    const tx = this.db.transaction(() => {
      const lease = this.db
        .prepare(
          "SELECT watch_id, package_id FROM operational_evaluation_lease WHERE lease_id = ?",
        )
        .get(leaseId) as { watch_id: string; package_id: string } | undefined;
      if (!lease || lease.package_id !== packageId) {
        return;
      }
      this.db
        .prepare(
          "UPDATE operational_watch SET last_evaluated_package_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(packageId, toIso(this.now()), lease.watch_id);
      if (evaluation !== undefined) {
        const evaluatedAt = toIso(this.now());
        this.db
          .prepare(
            `INSERT INTO operational_last_evaluation
               (watch_id, recipe_id, package_id, cutoff_month, result_digest, state,
                growth_rate_decimal, confidence, evaluated_at, alert_event_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (watch_id, recipe_id) DO UPDATE SET
               package_id = excluded.package_id,
               cutoff_month = excluded.cutoff_month,
               result_digest = excluded.result_digest,
               state = excluded.state,
               growth_rate_decimal = excluded.growth_rate_decimal,
               confidence = excluded.confidence,
               evaluated_at = excluded.evaluated_at,
               alert_event_id = excluded.alert_event_id`,
          )
          .run(
            lease.watch_id,
            requireNonEmpty(evaluation.recipeId, "evaluation.recipeId"),
            packageId,
            requireNonEmpty(evaluation.cutoffMonth, "evaluation.cutoffMonth"),
            requireNonEmpty(evaluation.resultDigest, "evaluation.resultDigest"),
            requireNonEmpty(evaluation.state, "evaluation.state"),
            evaluation.growthRateDecimal,
            evaluation.confidence,
            evaluatedAt,
            evaluation.alertEventId ?? null,
          );
      }
      this.db
        .prepare("DELETE FROM operational_evaluation_lease WHERE lease_id = ?")
        .run(leaseId);
    });
    tx();
  }

  async recordAlertEvent(
    input: RecordAlertEventInput,
  ): Promise<RecordedAlertEvent> {
    this.assertWritable();
    const watchId = requireNonEmpty(input.watchId, "watchId");
    const kind = requireNonEmpty(input.kind, "kind");
    const dedupeKey = requireNonEmpty(input.dedupeKey, "dedupeKey");
    const occurredAt = requireNonEmpty(input.occurredAt, "occurredAt");
    const recipeId = input.recipeId
      ? requireNonEmpty(input.recipeId, "recipeId")
      : null;
    const eventPackageId = input.packageId
      ? requireNonEmpty(input.packageId, "packageId")
      : null;
    const supersededPackageId =
      input.supersededPackageId === undefined || input.supersededPackageId === null
        ? null
        : requireNonEmpty(input.supersededPackageId, "supersededPackageId");
    const cutoffMonth = input.cutoffMonth
      ? requireNonEmpty(input.cutoffMonth, "cutoffMonth")
      : null;
    const priorEventId = input.priorEventId ?? null;
    const detail = JSON.stringify(input.detail ?? {});
    const id = randomUUID();
    const createdAt = toIso(this.now());

    let created = false;
    const tx = this.db.transaction(() => {
      const watch = this.db
        .prepare("SELECT account_id FROM operational_watch WHERE id = ?")
        .get(watchId) as { account_id: string } | undefined;
      if (!watch) {
        throw unknownEntity(`Watch ${watchId} does not exist.`);
      }
      const result = this.db
        .prepare(
          `INSERT INTO operational_alert_event
             (id, watch_id, account_id, kind, dedupe_key, recipe_id, package_id,
              superseded_package_id, cutoff_month, prior_event_id, detail, occurred_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (watch_id, dedupe_key) DO NOTHING`,
        )
        .run(
          id,
          watchId,
          watch.account_id,
          kind,
          dedupeKey,
          recipeId,
          eventPackageId,
          supersededPackageId,
          cutoffMonth,
          priorEventId,
          detail,
          occurredAt,
          createdAt,
        );
      created = result.changes > 0;
    });
    tx();

    const row = this.db
      .prepare(
        "SELECT * FROM operational_alert_event WHERE watch_id = ? AND dedupe_key = ?",
      )
      .get(watchId, dedupeKey) as AlertEventRow;
    return { event: mapAlertEvent(row), created };
  }

  async listAlertEvents(
    accountId: AccountId,
  ): Promise<readonly AlertEvent[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM operational_alert_event WHERE account_id = ?
         ORDER BY occurred_at, created_at, id`,
      )
      .all(accountId) as AlertEventRow[];
    return rows.map(mapAlertEvent);
  }

  async ensureDeliveryState(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState> {
    this.assertWritable();
    const chan = requireNonEmpty(channel, "channel");
    const ts = toIso(this.now());
    const idempotencyKey = deliveryIdempotencyKey(eventId, chan);
    const tx = this.db.transaction(() => {
      const event = this.db
        .prepare("SELECT 1 FROM operational_alert_event WHERE id = ?")
        .get(eventId);
      if (!event) {
        throw unknownEntity(`Alert event ${eventId} does not exist.`);
      }
      this.db
        .prepare(
          `INSERT INTO operational_delivery_state
             (delivery_id, event_id, channel, idempotency_key, status, attempt_count,
              last_attempt_at, provider_receipt, last_outcome, failure_reason, updated_at)
           VALUES (?, ?, ?, ?, 'PENDING', 0, ?, NULL, NULL, NULL, ?)
           ON CONFLICT (event_id, channel) DO NOTHING`,
        )
        .run(
          randomUUID(),
          eventId,
          chan,
          idempotencyKey,
          ts,
          ts,
        );
    });
    tx();
    return (await this.getDeliveryState(eventId, chan))!;
  }

  async recordDeliveryAttempt(
    input: RecordDeliveryAttemptInput,
  ): Promise<DeliveryState> {
    this.assertWritable();
    const eventId = requireNonEmpty(input.eventId, "eventId");
    const chan = requireNonEmpty(input.channel, "channel");
    const status = normalizeDeliveryStatus(input.status);
    const outcome = normalizeDeliveryAttemptOutcome(input.outcome);
    const providerReceipt = input.providerReceipt ?? null;
    const failureReason =
      input.failureReason === undefined || input.failureReason === null
        ? null
        : requireNonEmpty(input.failureReason, "failureReason");
    const ts = toIso(this.now());
    const idempotencyKey = deliveryIdempotencyKey(eventId, chan);
    const tx = this.db.transaction(() => {
      const event = this.db
        .prepare("SELECT 1 FROM operational_alert_event WHERE id = ?")
        .get(eventId);
      if (!event) {
        throw unknownEntity(`Alert event ${eventId} does not exist.`);
      }
      this.db
        .prepare(
          `INSERT INTO operational_delivery_state
             (delivery_id, event_id, channel, idempotency_key, status, attempt_count,
              last_attempt_at, provider_receipt, last_outcome, failure_reason, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT (event_id, channel) DO UPDATE SET
             status = excluded.status,
             attempt_count = operational_delivery_state.attempt_count + 1,
             last_attempt_at = excluded.last_attempt_at,
             provider_receipt = COALESCE(excluded.provider_receipt, operational_delivery_state.provider_receipt),
             last_outcome = excluded.last_outcome,
             failure_reason = excluded.failure_reason,
             updated_at = excluded.updated_at`,
        )
        .run(
          randomUUID(),
          eventId,
          chan,
          idempotencyKey,
          status,
          ts,
          providerReceipt,
          outcome,
          failureReason,
          ts,
        );
    });
    tx();
    return (await this.getDeliveryState(eventId, chan))!;
  }

  async markDelivered(
    eventId: AlertEventId,
    channel: string,
    providerReceipt?: string | null,
  ): Promise<DeliveryState> {
    return this.recordDeliveryAttempt({
      eventId,
      channel,
      status: "SENT",
      outcome: "ACCEPTED",
      providerReceipt,
    });
  }

  async getDeliveryState(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState | null> {
    const row = this.db
      .prepare(
        "SELECT * FROM operational_delivery_state WHERE event_id = ? AND channel = ?",
      )
      .get(eventId, channel) as
      | {
          delivery_id: string;
          event_id: string;
          channel: string;
          idempotency_key: string;
          status: string;
          attempt_count: number;
          last_attempt_at: string;
          provider_receipt: string | null;
          last_outcome: string | null;
          failure_reason: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      deliveryId: row.delivery_id,
      eventId: row.event_id,
      channel: row.channel,
      idempotencyKey: row.idempotency_key,
      status: row.status as DeliveryState["status"],
      attempts: row.attempt_count,
      lastAttemptAt: row.last_attempt_at,
      providerReceipt: row.provider_receipt,
      lastOutcome: row.last_outcome as DeliveryState["lastOutcome"],
      failureReason: row.failure_reason,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Produce a consistent point-in-time backup of durable business records at
   * `destinationPath`, safe to run while the store is open. Ephemeral runtime
   * leases (application and evaluation) are stripped from the copy so a restore
   * yields a clean, unleased database ready for a single instance to open.
   */
  async backup(destinationPath: string): Promise<void> {
    const target = requireNonEmpty(destinationPath, "destinationPath");
    if (target === ":memory:" || target.includes("://")) {
      throw invalidStoreInput("Backup destination must be a local file path.");
    }
    await this.db.backup(target);
    const copy = new Database(target);
    try {
      copy.exec(
        `DELETE FROM operational_application_lease;
         DELETE FROM operational_evaluation_lease;
         DELETE FROM operational_session;
         DELETE FROM operational_recovery_token;`,
      );
    } finally {
      copy.close();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.db
        .prepare(
          "DELETE FROM operational_application_lease WHERE id = 1 AND token = ?",
        )
        .run(this.token);
    } catch {
      // Best-effort lease release: a sealed read-only archive cannot be
      // written, but the connection must still close cleanly.
    } finally {
      this.db.close();
    }
  }
}

/**
 * Restore a SQLite backup to a target path by atomically copying the backup
 * file into place. The target must not be currently open by another instance.
 */
export function restoreSqliteBackup(
  backupPath: string,
  targetPath: string,
): void {
  requireNonEmpty(backupPath, "backupPath");
  requireNonEmpty(targetPath, "targetPath");
  copyFileSync(backupPath, targetPath);
}

/** Mark a migrated SQLite file read-only, sealing it as a source archive. */
export function sealSqliteArchive(path: string): void {
  requireNonEmpty(path, "path");
  const fd = openSync(path, "r");
  closeSync(fd);
  chmodSync(path, 0o444);
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    displayName: row.display_name,
    primaryExportEconomy: row.primary_export_economy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    accountId: row.account_id,
    normalizedIdentity: row.normalized_identity,
    verifier: row.verifier,
    failedAttemptCount: row.failed_attempt_count,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): OperationalSession {
  return {
    tokenDigest: row.token_digest,
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapRecoveryToken(row: RecoveryTokenRow): RecoveryToken {
  return {
    tokenDigest: row.token_digest,
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function mapDeliveryConsent(row: DeliveryConsentRow): DeliveryConsentState {
  return {
    accountId: row.account_id,
    channel: row.channel,
    target: row.target,
    consentedAt: row.consented_at,
    verifiedAt: row.verified_at,
    unsubscribedAt: row.unsubscribed_at,
    verificationToken: row.verification_token,
    unsubscribeToken: row.unsubscribe_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeliverySuppression(
  row: DeliverySuppressionRow,
): DeliverySuppressionState {
  return {
    accountId: row.account_id,
    channel: row.channel,
    target: row.target,
    reason: row.reason as DeliverySuppressionReason,
    providerReceipt: row.provider_receipt,
    createdAt: row.created_at,
  };
}

function mapWatch(
  row: WatchRow,
  lastEvaluation: OpportunityWatch["lastEvaluation"],
): OpportunityWatch {
  return {
    id: row.id,
    accountId: row.account_id,
    product: { hsRevision: row.hs_revision, code: row.code },
    marketEconomy: row.market_economy,
    reportingEconomyIso2: row.reporting_economy_iso2,
    hs12Code: row.hs12_code,
    exportEconomyCode: row.export_economy_code === "" ? null : row.export_economy_code,
    cadence: row.cadence as OpportunityWatch["cadence"],
    deliveryPreferences: JSON.parse(row.delivery_preferences) as OpportunityWatch["deliveryPreferences"],
    contextIdentity: row.context_identity,
    status: row.status as WatchStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pausedAt: row.paused_at,
    deletedAt: row.deleted_at,
    lastEvaluatedPackageId: row.last_evaluated_package_id,
    lastEvaluation,
  };
}

function mapAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    watchId: row.watch_id,
    accountId: row.account_id,
    kind: row.kind,
    dedupeKey: row.dedupe_key,
    recipeId: row.recipe_id,
    packageId: row.package_id,
    supersededPackageId: row.superseded_package_id,
    cutoffMonth: row.cutoff_month,
    priorEventId: row.prior_event_id,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function mapLastEvaluation(row: LastEvaluationRow): OpportunityWatch["lastEvaluation"] {
  return {
    watchId: row.watch_id,
    recipeId: row.recipe_id,
    packageId: row.package_id,
    cutoffMonth: row.cutoff_month,
    resultDigest: row.result_digest,
    state: row.state,
    growthRateDecimal: row.growth_rate_decimal,
    confidence: row.confidence,
    evaluatedAt: row.evaluated_at,
    alertEventId: row.alert_event_id,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function dedupeProducts(
  products: readonly ProductRefInput[],
): { hsRevision: string; code: string }[] {
  const seen = new Map<string, { hsRevision: string; code: string }>();
  for (const product of products) {
    const hsRevision = requireNonEmpty(product.hsRevision, "product.hsRevision");
    const code = requireNonEmpty(product.code, "product.code");
    seen.set(`${hsRevision}|${code}`, { hsRevision, code });
  }
  return [...seen.values()];
}

type WatchStatus = OpportunityWatch["status"];

function normalizeCadence(value: string): OpportunityWatch["cadence"] {
  const cadence = requireNonEmpty(value, "cadence");
  if (cadence !== "MONTHLY" && cadence !== "QUARTERLY") {
    throw invalidStoreInput("cadence must be MONTHLY or QUARTERLY.");
  }
  return cadence;
}

function deliveryIdempotencyKey(eventId: AlertEventId, channel: string): string {
  return `${eventId}:${channel}`;
}

function normalizeDeliveryChannel(channel: string): string {
  return requireNonEmpty(channel, "channel").trim().toLocaleLowerCase("und");
}

function normalizeDeliveryTarget(target: string): string {
  return requireNonEmpty(target, "target").trim().toLocaleLowerCase("und");
}

function normalizeSuppressionReason(
  reason: DeliverySuppressionReason,
): DeliverySuppressionReason {
  if (reason === "UNSUBSCRIBE" || reason === "BOUNCE" || reason === "COMPLAINT") {
    return reason;
  }
  throw invalidStoreInput("suppression reason must be UNSUBSCRIBE, BOUNCE, or COMPLAINT.");
}

function normalizeDeliveryStatus(
  status: Exclude<DeliveryStatus, "PENDING">,
): Exclude<DeliveryStatus, "PENDING"> {
  if (
    status === "SENT" ||
    status === "FAILED" ||
    status === "DEAD_LETTER" ||
    status === "SUPPRESSED"
  ) {
    return status;
  }
  throw invalidStoreInput("delivery attempt status cannot be PENDING.");
}

function normalizeDeliveryAttemptOutcome(
  outcome: DeliveryAttemptOutcome,
): DeliveryAttemptOutcome {
  if (
    outcome === "ACCEPTED" ||
    outcome === "TRANSIENT_FAILURE" ||
    outcome === "PERMANENT_FAILURE" ||
    outcome === "BOUNCE" ||
    outcome === "COMPLAINT" ||
    outcome === "SUPPRESSED" ||
    outcome === "DUPLICATE_SUPPRESSED"
  ) {
    return outcome;
  }
  throw invalidStoreInput("delivery attempt outcome is not supported.");
}

function addColumnIfMissing(
  db: SqliteDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function mapCredentialInsertError(error: unknown, identity: string): never {
  if (
    error instanceof Error &&
    (error.message.includes("operational_credential.normalized_identity") ||
      error.message.includes("UNIQUE constraint failed"))
  ) {
    throw duplicateCredentialIdentity(identity);
  }
  throw error;
}
