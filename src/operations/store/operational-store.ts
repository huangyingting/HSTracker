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

/**
 * The single business-storage interface for the operational data plane.
 *
 * Methods are business-level transactions rather than table-shaped CRUD: for
 * example {@link confirmPortfolio} replaces an account's whole portfolio
 * atomically, and {@link claimWatchesForEvaluation} claims and leases a batch
 * of Watches in one step. Both the PostgreSQL and SQLite adapters implement
 * this contract identically; callers never branch on the underlying database.
 */
export interface OperationalStore {
  /** Create an account with exactly one primary export economy. */
  createAccount(input: CreateAccountInput): Promise<Account>;

  findAccount(id: AccountId): Promise<Account | null>;

  /**
   * Replace the account's confirmed portfolio with exactly the given products
   * in one transaction. Duplicate product references collapse to one entry.
   */
  confirmPortfolio(
    accountId: AccountId,
    products: readonly ProductRefInput[],
  ): Promise<readonly ConfirmedProduct[]>;

  listConfirmedProducts(
    accountId: AccountId,
  ): Promise<readonly ConfirmedProduct[]>;

  /**
   * Open (or return the existing) Watch for one confirmed product and market.
   * Opening the same pair twice is idempotent and returns the same Watch.
   */
  openWatch(
    accountId: AccountId,
    input: OpenWatchInput,
  ): Promise<OpportunityWatch>;

  listWatches(accountId: AccountId): Promise<readonly OpportunityWatch[]>;

  /**
   * Atomically claim up to `limit` active Watches that are not already held by
   * a live lease and have not yet been evaluated for the given package. Two
   * evaluators running concurrently receive disjoint batches, so no Watch is
   * ever evaluated twice for one package activation.
   */
  claimWatchesForEvaluation(
    input: ClaimWatchesInput,
  ): Promise<readonly ClaimedWatch[]>;

  /**
   * Release an evaluation lease and record that the Watch was evaluated for the
   * package. A stale or already-released lease id is a no-op.
   */
  completeEvaluation(
    leaseId: EvaluationLeaseId,
    packageId: string,
  ): Promise<void>;

  /**
   * Append an alert event. Idempotent on (watchId, dedupeKey): a repeated call
   * returns the pre-existing event with `created: false` and appends nothing.
   */
  recordAlertEvent(input: RecordAlertEventInput): Promise<RecordedAlertEvent>;

  listAlertEvents(accountId: AccountId): Promise<readonly AlertEvent[]>;

  markDelivered(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState>;

  getDeliveryState(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState | null>;

  /** Release resources (connections, leases). Safe to call more than once. */
  close(): Promise<void>;
}

export interface ProductRefInput {
  readonly hsRevision: string;
  readonly code: string;
}
