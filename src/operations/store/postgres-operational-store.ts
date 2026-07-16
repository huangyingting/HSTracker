import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import { storeInMaintenance, unknownEntity } from "./errors";
import {
  requireNonEmpty,
  requirePositiveInt,
  systemClock,
  toIso,
  type Clock,
} from "./internal";
import type {
  Account,
  AccountId,
  AlertEvent,
  AlertEventId,
  ClaimedWatch,
  ClaimWatchesInput,
  ConfirmedProduct,
  CreateAccountInput,
  DeliveryState,
  EvaluationLeaseId,
  OpenWatchInput,
  OpportunityWatch,
  RecordAlertEventInput,
  RecordedAlertEvent,
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
    await pool.query(SCHEMA);
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

  async findAccount(id: AccountId): Promise<Account | null> {
    const { rows } = await this.pool.query<AccountRow>(
      "SELECT * FROM operational_account WHERE id = $1",
      [id],
    );
    return rows[0] ? mapAccount(rows[0]) : null;
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
