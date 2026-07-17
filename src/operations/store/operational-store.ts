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
  DeliveryConsentState,
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

  /** Create an account and its initial credential in one transaction. */
  createAccountWithCredential(
    input: CreateAccountWithCredentialInput,
  ): Promise<AccountCredentialRegistration>;

  findAccount(id: AccountId): Promise<Account | null>;

  createCredential(input: CreateCredentialInput): Promise<Credential>;

  findCredentialByIdentity(identity: string): Promise<Credential | null>;

  findCredentialByAccount(accountId: AccountId): Promise<Credential | null>;

  updateCredentialAttempts(
    input: UpdateCredentialAttemptsInput,
  ): Promise<Credential>;

  updateCredentialVerifier(
    input: UpdateCredentialVerifierInput,
  ): Promise<Credential>;

  requestDeliveryConsent(
    input: RequestDeliveryConsentInput,
  ): Promise<DeliveryConsentState>;

  verifyDeliveryConsent(
    input: VerifyDeliveryConsentInput,
  ): Promise<DeliveryConsentState | null>;

  findDeliveryConsent(
    accountId: AccountId,
    channel: string,
    target: string,
  ): Promise<DeliveryConsentState | null>;

  unsubscribeDeliveryTarget(
    unsubscribeToken: string,
  ): Promise<DeliveryConsentState | null>;

  recordDeliverySuppression(
    input: RecordDeliverySuppressionInput,
  ): Promise<DeliverySuppressionState>;

  getDeliverySuppression(
    accountId: AccountId,
    channel: string,
    target: string,
  ): Promise<DeliverySuppressionState | null>;

  createSession(input: CreateSessionInput): Promise<OperationalSession>;

  findSession(tokenDigest: string): Promise<OperationalSession | null>;

  revokeSession(tokenDigest: string): Promise<void>;

  revokeSessionsForAccount(accountId: AccountId): Promise<void>;

  issueRecoveryToken(
    input: IssueRecoveryTokenInput,
  ): Promise<RecoveryToken>;

  consumeRecoveryToken(tokenDigest: string): Promise<RecoveryToken | null>;

  appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent>;

  listAuditEvents(accountId: AccountId): Promise<readonly AuditEvent[]>;

  setPrimaryExporter(
    accountId: AccountId,
    economyCode: string,
  ): Promise<Account>;

  deleteAccount(accountId: AccountId): Promise<AuditEvent>;

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

  /** Pause an active Watch. Paused Watches are retained but not claimed. */
  pauseWatch(watchId: WatchId): Promise<OpportunityWatch>;

  /** Resume a paused Watch without changing its immutable signal context. */
  resumeWatch(watchId: WatchId): Promise<OpportunityWatch>;

  /** Soft-delete a Watch. Deleted Watches are hidden from list/claim results. */
  deleteWatch(watchId: WatchId): Promise<OpportunityWatch>;

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
    evaluation?: CompleteEvaluationInput,
  ): Promise<void>;

  /**
   * Append an alert event. Idempotent on (watchId, dedupeKey): a repeated call
   * returns the pre-existing event with `created: false` and appends nothing.
   */
  recordAlertEvent(input: RecordAlertEventInput): Promise<RecordedAlertEvent>;

  listAlertEvents(accountId: AccountId): Promise<readonly AlertEvent[]>;

  ensureDeliveryState(
    eventId: AlertEventId,
    channel: string,
  ): Promise<DeliveryState>;

  recordDeliveryAttempt(
    input: RecordDeliveryAttemptInput,
  ): Promise<DeliveryState>;

  markDelivered(
    eventId: AlertEventId,
    channel: string,
    providerReceipt?: string | null,
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
