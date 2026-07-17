import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import {
  duplicateCredentialIdentity,
  storeInMaintenance,
  unknownEntity,
} from "./errors";
import {
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
  ConfirmedProduct,
  CreateAccountInput,
  CreateAccountWithCredentialInput,
  CreateCredentialInput,
  CreateSessionInput,
  Credential,
  DeliveryState,
  EvaluationLeaseId,
  IssueRecoveryTokenInput,
  OpenWatchInput,
  OpportunityWatch,
  OperationalSession,
  RecordAlertEventInput,
  RecordedAlertEvent,
  RecoveryToken,
  UpdateCredentialAttemptsInput,
  UpdateCredentialVerifierInput,
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
CREATE TABLE IF NOT EXISTS operational_watch (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  hs_revision TEXT NOT NULL,
  code TEXT NOT NULL,
  market_economy TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_evaluated_package_id TEXT,
  UNIQUE (account_id, hs_revision, code, market_economy)
);
CREATE TABLE IF NOT EXISTS operational_alert_event (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES operational_watch(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (watch_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS operational_delivery_state (
  event_id TEXT NOT NULL REFERENCES operational_alert_event(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, channel)
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

const SCHEMA_ADVISORY_LOCK_ID = 56000056;

export interface PostgresOperationalStoreOptions {
  readonly connectionString: string;
  readonly applicationName?: string;
  readonly clock?: Clock;
  /** Maximum pool size; defaults to the pg default. */
  readonly maxConnections?: number;
}

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

interface WatchRow {
  id: string;
  account_id: string;
  hs_revision: string;
  code: string;
  market_economy: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_evaluated_package_id: string | null;
}

interface AlertEventRow {
  id: string;
  watch_id: string;
  account_id: string;
  kind: string;
  dedupe_key: string;
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
 * PostgreSQL adapter for the hosted deployment. It supports many concurrent
 * evaluators: {@link claimWatchesForEvaluation} uses `FOR UPDATE SKIP LOCKED`
 * plus a unique lease per (watch, package), so simultaneous evaluators receive
 * disjoint batches and no Watch is evaluated — or alerted — twice.
 */
export class PostgresOperationalStore implements OperationalStore {
  private readonly pool: Pool;
  private readonly clock: Clock;
  private maintenance = false;
  private closed = false;

  private constructor(pool: Pool, clock: Clock) {
    this.pool = pool;
    this.clock = clock;
  }

  static async create(
    options: PostgresOperationalStoreOptions,
  ): Promise<PostgresOperationalStore> {
    const connectionString = requireNonEmpty(
      options.connectionString,
      "connectionString",
    );
    const pool = new Pool({
      connectionString,
      application_name: options.applicationName ?? "hs-tracker-operational",
      max: options.maxConnections,
    });
    const store = new PostgresOperationalStore(
      pool,
      options.clock ?? systemClock,
    );
    const client = await pool.connect();
    let initialized = false;
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(${SCHEMA_ADVISORY_LOCK_ID})`,
      );
      await client.query(SCHEMA);
      await client.query("COMMIT");
      initialized = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      if (!initialized) {
        await pool.end();
      }
    }
    return store;
  }

  private now(): Date {
    return this.clock();
  }

  private assertWritable(): void {
    if (this.maintenance) {
      throw storeInMaintenance();
    }
  }

  enterMaintenance(): void {
    this.maintenance = true;
  }

  private async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
    await this.pool.query(
      `INSERT INTO operational_account (id, display_name, primary_export_economy, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [id, displayName, economy, ts],
    );
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
    try {
      await this.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO operational_account (id, display_name, primary_export_economy, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $4)`,
          [accountId, displayName, economy, ts],
        );
        await client.query(
          `INSERT INTO operational_credential
             (id, account_id, normalized_identity, verifier, failed_attempt_count, locked_until, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 0, NULL, $5, $5)`,
          [credentialId, accountId, normalizedIdentity, verifier, ts],
        );
      });
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
    const { rows } = await this.pool.query<AccountRow>(
      "SELECT * FROM operational_account WHERE id = $1",
      [id],
    );
    return rows[0] ? mapAccount(rows[0]) : null;
  }

  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const normalizedIdentity = normalizeCredentialIdentity(input.identity);
    const verifier = requireNonEmpty(input.verifier, "verifier");
    const id = randomUUID();
    const ts = toIso(this.now());
    try {
      await this.withTransaction(async (client) => {
        await requireAccountTx(client, accountId);
        await client.query(
          `INSERT INTO operational_credential
             (id, account_id, normalized_identity, verifier, failed_attempt_count, locked_until, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 0, NULL, $5, $5)`,
          [id, accountId, normalizedIdentity, verifier, ts],
        );
      });
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
    const { rows } = await this.pool.query<CredentialRow>(
      "SELECT * FROM operational_credential WHERE normalized_identity = $1",
      [normalizedIdentity],
    );
    return rows[0] ? mapCredential(rows[0]) : null;
  }

  async findCredentialByAccount(
    accountId: AccountId,
  ): Promise<Credential | null> {
    const { rows } = await this.pool.query<CredentialRow>(
      "SELECT * FROM operational_credential WHERE account_id = $1",
      [accountId],
    );
    return rows[0] ? mapCredential(rows[0]) : null;
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
    const { rows } = await this.pool.query<CredentialRow>(
      `UPDATE operational_credential
       SET failed_attempt_count = $1, locked_until = $2, updated_at = $3
       WHERE id = $4
       RETURNING *`,
      [failedAttemptCount, lockedUntil, toIso(this.now()), credentialId],
    );
    if (!rows[0]) {
      throw unknownEntity(`Credential ${credentialId} does not exist.`);
    }
    return mapCredential(rows[0]);
  }

  async updateCredentialVerifier(
    input: UpdateCredentialVerifierInput,
  ): Promise<Credential> {
    this.assertWritable();
    const credentialId = requireNonEmpty(input.credentialId, "credentialId");
    const verifier = requireNonEmpty(input.verifier, "verifier");
    const { rows } = await this.pool.query<CredentialRow>(
      `UPDATE operational_credential
       SET verifier = $1, failed_attempt_count = 0, locked_until = NULL, updated_at = $2
       WHERE id = $3
       RETURNING *`,
      [verifier, toIso(this.now()), credentialId],
    );
    if (!rows[0]) {
      throw unknownEntity(`Credential ${credentialId} does not exist.`);
    }
    return mapCredential(rows[0]);
  }

  async createSession(input: CreateSessionInput): Promise<OperationalSession> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const tokenDigest = requireNonEmpty(input.tokenDigest, "tokenDigest");
    const expiresAt = requireNonEmpty(input.expiresAt, "expiresAt");
    const createdAt = toIso(this.now());
    await this.withTransaction(async (client) => {
      await requireAccountTx(client, accountId);
      await client.query(
        `INSERT INTO operational_session
           (token_digest, account_id, created_at, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, NULL)`,
        [tokenDigest, accountId, createdAt, expiresAt],
      );
    });
    return { tokenDigest, accountId, createdAt, expiresAt };
  }

  async findSession(tokenDigest: string): Promise<OperationalSession | null> {
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT token_digest, account_id, created_at, expires_at
       FROM operational_session
       WHERE token_digest = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [digest, toIso(this.now())],
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async revokeSession(tokenDigest: string): Promise<void> {
    this.assertWritable();
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    await this.pool.query(
      `UPDATE operational_session
       SET revoked_at = $1
       WHERE token_digest = $2 AND revoked_at IS NULL`,
      [toIso(this.now()), digest],
    );
  }

  async revokeSessionsForAccount(accountId: AccountId): Promise<void> {
    this.assertWritable();
    await this.withTransaction(async (client) => {
      await requireAccountTx(client, accountId);
      await client.query(
        `UPDATE operational_session
         SET revoked_at = $1
         WHERE account_id = $2 AND revoked_at IS NULL`,
        [toIso(this.now()), accountId],
      );
    });
  }

  async issueRecoveryToken(
    input: IssueRecoveryTokenInput,
  ): Promise<RecoveryToken> {
    this.assertWritable();
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const tokenDigest = requireNonEmpty(input.tokenDigest, "tokenDigest");
    const expiresAt = requireNonEmpty(input.expiresAt, "expiresAt");
    const createdAt = toIso(this.now());
    await this.withTransaction(async (client) => {
      await requireAccountTx(client, accountId);
      await client.query(
        `INSERT INTO operational_recovery_token
           (token_digest, account_id, created_at, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, NULL)`,
        [tokenDigest, accountId, createdAt, expiresAt],
      );
    });
    return { tokenDigest, accountId, createdAt, expiresAt, consumedAt: null };
  }

  async consumeRecoveryToken(
    tokenDigest: string,
  ): Promise<RecoveryToken | null> {
    this.assertWritable();
    const digest = requireNonEmpty(tokenDigest, "tokenDigest");
    const consumedAt = toIso(this.now());
    const { rows } = await this.withTransaction(async (client) =>
      client.query<RecoveryTokenRow>(
        `UPDATE operational_recovery_token
         SET consumed_at = $2
         WHERE token_digest = $1
           AND consumed_at IS NULL
           AND expires_at > $2
         RETURNING token_digest, account_id, created_at, expires_at, consumed_at`,
        [digest, consumedAt],
      ),
    );
    return rows[0] ? mapRecoveryToken(rows[0]) : null;
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
      await this.withTransaction(async (client) => {
        await requireAccountTx(client, accountId);
        await client.query(
          `INSERT INTO operational_audit_event (id, account_id, kind, detail, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, accountId, kind, detail, createdAt],
        );
      });
    } else {
      await this.pool.query(
        `INSERT INTO operational_audit_event (id, account_id, kind, detail, created_at)
         VALUES ($1, NULL, $2, $3, $4)`,
        [id, kind, detail, createdAt],
      );
    }
    return {
      id,
      accountId,
      kind,
      detail: JSON.parse(detail) as Record<string, unknown>,
      createdAt,
    };
  }

  async listAuditEvents(
    accountId: AccountId,
  ): Promise<readonly AuditEvent[]> {
    const { rows } = await this.pool.query<AuditEventRow>(
      `SELECT * FROM operational_audit_event
       WHERE account_id = $1
       ORDER BY created_at, id`,
      [accountId],
    );
    return rows.map(mapAuditEvent);
  }

  async setPrimaryExporter(
    accountId: AccountId,
    economyCode: string,
  ): Promise<Account> {
    this.assertWritable();
    const economy = requireNonEmpty(economyCode, "economyCode");
    const { rows } = await this.pool.query<AccountRow>(
      `UPDATE operational_account
       SET primary_export_economy = $1, updated_at = $2
       WHERE id = $3
       RETURNING *`,
      [economy, toIso(this.now()), accountId],
    );
    if (!rows[0]) {
      throw unknownEntity(`Account ${accountId} does not exist.`);
    }
    return mapAccount(rows[0]);
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
    await this.withTransaction(async (client) => {
      await requireAccountTx(client, id);
      await client.query("DELETE FROM operational_account WHERE id = $1", [id]);
      await client.query(
        `INSERT INTO operational_audit_event (id, account_id, kind, detail, created_at)
         VALUES ($1, $2, 'ACCOUNT_DELETED', $3, $4)`,
        [auditId, id, detail, createdAt],
      );
    });
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
    await this.withTransaction(async (client) => {
      await requireAccountTx(client, accountId);
      await client.query(
        "DELETE FROM operational_confirmed_product WHERE account_id = $1",
        [accountId],
      );
      for (const product of normalized) {
        await client.query(
          `INSERT INTO operational_confirmed_product (account_id, hs_revision, code, confirmed_at)
           VALUES ($1, $2, $3, $4)`,
          [accountId, product.hsRevision, product.code, ts],
        );
      }
    });
    return this.listConfirmedProducts(accountId);
  }

  async listConfirmedProducts(
    accountId: AccountId,
  ): Promise<readonly ConfirmedProduct[]> {
    const { rows } = await this.pool.query<{
      account_id: string;
      hs_revision: string;
      code: string;
      confirmed_at: string;
    }>(
      `SELECT account_id, hs_revision, code, confirmed_at
       FROM operational_confirmed_product WHERE account_id = $1
       ORDER BY hs_revision, code`,
      [accountId],
    );
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
    const ts = toIso(this.now());
    const id = randomUUID();
    const row = await this.withTransaction(async (client) => {
      await requireAccountTx(client, accountId);
      await client.query(
        `INSERT INTO operational_watch
           (id, account_id, hs_revision, code, market_economy, status, created_at, updated_at, last_evaluated_package_id)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $6, NULL)
         ON CONFLICT (account_id, hs_revision, code, market_economy) DO NOTHING`,
        [id, accountId, hsRevision, code, market, ts],
      );
      const { rows } = await client.query<WatchRow>(
        `SELECT * FROM operational_watch
         WHERE account_id = $1 AND hs_revision = $2 AND code = $3 AND market_economy = $4`,
        [accountId, hsRevision, code, market],
      );
      return rows[0]!;
    });
    return mapWatch(row);
  }

  async listWatches(
    accountId: AccountId,
  ): Promise<readonly OpportunityWatch[]> {
    const { rows } = await this.pool.query<WatchRow>(
      "SELECT * FROM operational_watch WHERE account_id = $1 ORDER BY created_at, id",
      [accountId],
    );
    return rows.map(mapWatch);
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

    return this.withTransaction(async (client) => {
      const { rows } = await client.query<
        WatchRow & { lease_id: string; lease_expires_at: string }
      >(
        `WITH eligible AS (
           SELECT w.id
           FROM operational_watch w
           WHERE w.status = 'ACTIVE'
             AND (w.last_evaluated_package_id IS DISTINCT FROM $1)
             AND NOT EXISTS (
               SELECT 1 FROM operational_evaluation_lease l
               WHERE l.watch_id = w.id AND l.package_id = $1 AND l.expires_at > $2
             )
           ORDER BY w.created_at, w.id
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         ),
         claimed AS (
           INSERT INTO operational_evaluation_lease
             (lease_id, watch_id, evaluator_id, package_id, acquired_at, expires_at)
           SELECT gen_random_uuid()::text, e.id, $4, $1, $2, $5 FROM eligible e
           ON CONFLICT (watch_id, package_id) DO NOTHING
           RETURNING lease_id, watch_id, expires_at
         )
         SELECT w.*, c.lease_id, c.expires_at AS lease_expires_at
         FROM claimed c JOIN operational_watch w ON w.id = c.watch_id
         ORDER BY w.created_at, w.id`,
        [packageId, nowIso, limit, evaluatorId, expiresAt],
      );
      return rows.map((row) => ({
        watch: mapWatch(row),
        leaseId: row.lease_id,
        leaseExpiresAt: row.lease_expires_at,
      }));
    });
  }

  async completeEvaluation(
    leaseId: EvaluationLeaseId,
    packageId: string,
  ): Promise<void> {
    this.assertWritable();
    await this.withTransaction(async (client) => {
      const { rows } = await client.query<{ watch_id: string }>(
        "SELECT watch_id FROM operational_evaluation_lease WHERE lease_id = $1 AND package_id = $2",
        [leaseId, packageId],
      );
      const lease = rows[0];
      if (!lease) {
        return;
      }
      await client.query(
        "UPDATE operational_watch SET last_evaluated_package_id = $1, updated_at = $2 WHERE id = $3",
        [packageId, toIso(this.now()), lease.watch_id],
      );
      await client.query(
        "DELETE FROM operational_evaluation_lease WHERE lease_id = $1",
        [leaseId],
      );
    });
  }

  async recordAlertEvent(
    input: RecordAlertEventInput,
  ): Promise<RecordedAlertEvent> {
    this.assertWritable();
    const watchId = requireNonEmpty(input.watchId, "watchId");
    const kind = requireNonEmpty(input.kind, "kind");
    const dedupeKey = requireNonEmpty(input.dedupeKey, "dedupeKey");
    const occurredAt = requireNonEmpty(input.occurredAt, "occurredAt");
    const detail = JSON.stringify(input.detail ?? {});
    const id = randomUUID();
    const createdAt = toIso(this.now());

    const created = await this.withTransaction(async (client) => {
      const watch = await client.query<{ account_id: string }>(
        "SELECT account_id FROM operational_watch WHERE id = $1",
        [watchId],
      );
      if (!watch.rows[0]) {
        throw unknownEntity(`Watch ${watchId} does not exist.`);
      }
      const inserted = await client.query(
        `INSERT INTO operational_alert_event
           (id, watch_id, account_id, kind, dedupe_key, detail, occurred_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (watch_id, dedupe_key) DO NOTHING`,
        [
          id,
          watchId,
          watch.rows[0].account_id,
          kind,
          dedupeKey,
          detail,
          occurredAt,
          createdAt,
        ],
      );
      return (inserted.rowCount ?? 0) > 0;
    });

    const { rows } = await this.pool.query<AlertEventRow>(
      "SELECT * FROM operational_alert_event WHERE watch_id = $1 AND dedupe_key = $2",
      [watchId, dedupeKey],
    );
    return { event: mapAlertEvent(rows[0]!), created };
  }

  async listAlertEvents(
    accountId: AccountId,
  ): Promise<readonly AlertEvent[]> {
    const { rows } = await this.pool.query<AlertEventRow>(
      `SELECT * FROM operational_alert_event WHERE account_id = $1
       ORDER BY occurred_at, created_at, id`,
      [accountId],
    );
    return rows.map(mapAlertEvent);
  }

  async markDelivered(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState> {
    this.assertWritable();
    const chan = requireNonEmpty(channel, "channel");
    const ts = toIso(this.now());
    await this.withTransaction(async (client) => {
      const event = await client.query(
        "SELECT 1 FROM operational_alert_event WHERE id = $1",
        [eventId],
      );
      if (!event.rows[0]) {
        throw unknownEntity(`Alert event ${eventId} does not exist.`);
      }
      await client.query(
        `INSERT INTO operational_delivery_state (event_id, channel, status, attempts, updated_at)
         VALUES ($1, $2, 'SENT', 1, $3)
         ON CONFLICT (event_id, channel) DO UPDATE SET
           status = 'SENT',
           attempts = operational_delivery_state.attempts + 1,
           updated_at = EXCLUDED.updated_at`,
        [eventId, chan, ts],
      );
    });
    return (await this.getDeliveryState(eventId, chan))!;
  }

  async getDeliveryState(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState | null> {
    const { rows } = await this.pool.query<{
      event_id: string;
      channel: string;
      status: string;
      attempts: number;
      updated_at: string;
    }>(
      "SELECT * FROM operational_delivery_state WHERE event_id = $1 AND channel = $2",
      [eventId, channel],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      eventId: row.event_id,
      channel: row.channel,
      status: row.status as DeliveryState["status"],
      attempts: row.attempts,
      updatedAt: row.updated_at,
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }
}

async function requireAccountTx(
  client: PoolClient,
  accountId: AccountId,
): Promise<void> {
  const { rows } = await client.query(
    "SELECT 1 FROM operational_account WHERE id = $1",
    [accountId],
  );
  if (!rows[0]) {
    throw unknownEntity(`Account ${accountId} does not exist.`);
  }
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

function mapWatch(row: WatchRow): OpportunityWatch {
  return {
    id: row.id,
    accountId: row.account_id,
    product: { hsRevision: row.hs_revision, code: row.code },
    marketEconomy: row.market_economy,
    status: row.status as OpportunityWatch["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEvaluatedPackageId: row.last_evaluated_package_id,
  };
}

function mapAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    watchId: row.watch_id,
    accountId: row.account_id,
    kind: row.kind,
    dedupeKey: row.dedupe_key,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
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

function mapCredentialInsertError(error: unknown, identity: string): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    throw duplicateCredentialIdentity(identity);
  }
  throw error;
}
