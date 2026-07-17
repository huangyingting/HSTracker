// Domain model for the operational data plane.
//
// Per ADR 0001, one business-storage interface owns hosted account, portfolio,
// Opportunity Watch, append-only alert-event, and delivery state. It never
// holds BACI evidence, Opportunity Index rows, monthly facts, product-mapping
// tables, or per-user copies of public analytical results — those live only in
// immutable analytical Dataset Packages.

/** Stable UUID identity of a hosted account. */
export type AccountId = string;
/** Stable UUID identity of one account credential. */
export type CredentialId = string;
/** Stable UUID identity of an Opportunity Watch. */
export type WatchId = string;
/** Stable UUID identity of an append-only alert event. */
export type AlertEventId = string;
/** Opaque token identifying one evaluation lease over a claimed Watch. */
export type EvaluationLeaseId = string;
/** Stable UUID identity of one operational audit event. */
export type AuditEventId = string;

/**
 * A Harmonized System product identity: the revision and six-digit code.
 * Source descriptions and aliases are discovery aids and are not stored here.
 */
export interface ProductRef {
  readonly hsRevision: string;
  readonly code: string;
}

/** An account and its single primary export economy. */
export interface Account {
  readonly id: AccountId;
  readonly displayName: string;
  readonly primaryExportEconomy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One normalized email credential and its password verifier bookkeeping. */
export interface Credential {
  readonly id: CredentialId;
  readonly accountId: AccountId;
  readonly normalizedIdentity: string;
  readonly verifier: string;
  readonly failedAttemptCount: number;
  readonly lockedUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A server-side session keyed by the digest of an opaque token. */
export interface OperationalSession {
  readonly tokenDigest: string;
  readonly accountId: AccountId;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** A single-use recovery token keyed by digest only. */
export interface RecoveryToken {
  readonly tokenDigest: string;
  readonly accountId: AccountId;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/** Append-only operational audit event. */
export interface AuditEvent {
  readonly id: AuditEventId;
  readonly accountId: AccountId | null;
  readonly kind: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/** One confirmed HS product in an account's portfolio. */
export interface ConfirmedProduct {
  readonly accountId: AccountId;
  readonly product: ProductRef;
  readonly confirmedAt: string;
}

export type WatchStatus = "ACTIVE" | "PAUSED";
export type WatchCadence = "MONTHLY" | "QUARTERLY";
export type AlertEventKind =
  | "MOMENTUM_SIGNAL"
  | "REVISION_UPDATE"
  | "REVISION_RETRACTION"
  | "REVISION_REINSTATEMENT";

export interface WatchDeliveryPreference {
  readonly channel: string;
  readonly target: string | null;
  readonly enabled: boolean;
}

export interface LastEvaluation {
  readonly watchId: WatchId;
  readonly recipeId: string;
  readonly packageId: string;
  readonly cutoffMonth: string;
  readonly resultDigest: string;
  readonly state: string;
  readonly growthRateDecimal: string | null;
  readonly confidence: string | null;
  readonly evaluatedAt: string;
  readonly alertEventId: AlertEventId | null;
}

/**
 * A standing watch that pairs one confirmed product with one supported market.
 * Evaluation bookkeeping (lease holder, expiry, last evaluated package) is
 * internal to the store and never exposed to callers.
 */
export interface OpportunityWatch {
  readonly id: WatchId;
  readonly accountId: AccountId;
  readonly product: ProductRef;
  readonly marketEconomy: string;
  readonly reportingEconomyIso2: string;
  readonly hs12Code: string;
  readonly exportEconomyCode: string | null;
  readonly cadence: WatchCadence;
  readonly deliveryPreferences: readonly WatchDeliveryPreference[];
  readonly contextIdentity: string;
  readonly status: WatchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pausedAt: string | null;
  readonly deletedAt: string | null;
  readonly lastEvaluatedPackageId: string | null;
  readonly lastEvaluation: LastEvaluation | null;
}

/**
 * An append-only record that a Watch produced a signal for one triggering
 * package. Uniqueness is enforced on (watchId, dedupeKey) so repeated
 * evaluation of the same activation never appends a duplicate event.
 */
export interface AlertEvent {
  readonly id: AlertEventId;
  readonly watchId: WatchId;
  readonly accountId: AccountId;
  readonly kind: AlertEventKind | string;
  readonly dedupeKey: string;
  readonly recipeId: string | null;
  readonly packageId: string | null;
  readonly supersededPackageId: string | null;
  readonly cutoffMonth: string | null;
  readonly priorEventId: AlertEventId | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly createdAt: string;
}

export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

/** Per-channel delivery state for one alert event. */
export interface DeliveryState {
  readonly deliveryId: string;
  readonly eventId: AlertEventId;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt: string;
  readonly providerReceipt: string | null;
  readonly updatedAt: string;
}

export interface CreateAccountInput {
  readonly displayName: string;
  readonly primaryExportEconomy: string;
}

export interface CreateAccountWithCredentialInput extends CreateAccountInput {
  readonly credentialIdentity: string;
  readonly credentialVerifier: string;
}

export interface AccountCredentialRegistration {
  readonly account: Account;
  readonly credential: Credential;
}

export interface CreateCredentialInput {
  readonly accountId: AccountId;
  readonly identity: string;
  readonly verifier: string;
}

export interface UpdateCredentialAttemptsInput {
  readonly credentialId: CredentialId;
  readonly failedAttemptCount: number;
  readonly lockedUntil: string | null;
}

export interface UpdateCredentialVerifierInput {
  readonly credentialId: CredentialId;
  readonly verifier: string;
}

export interface CreateSessionInput {
  readonly accountId: AccountId;
  readonly tokenDigest: string;
  readonly expiresAt: string;
}

export interface IssueRecoveryTokenInput {
  readonly accountId: AccountId;
  readonly tokenDigest: string;
  readonly expiresAt: string;
}

export interface AppendAuditEventInput {
  readonly accountId: AccountId | null;
  readonly kind: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface OpenWatchInput {
  readonly product: ProductRef;
  readonly marketEconomy: string;
  readonly reportingEconomyIso2?: string;
  readonly hs12Code?: string;
  readonly exportEconomyCode?: string | null;
  readonly cadence?: WatchCadence;
  readonly deliveryPreferences?: readonly WatchDeliveryPreference[];
}

export interface ClaimWatchesInput {
  /** Identifies the evaluator process claiming work. */
  readonly evaluatorId: string;
  /** The activated analytical package the claim will evaluate against. */
  readonly packageId: string;
  /** Maximum number of Watches to claim in one batch. */
  readonly limit: number;
  /** Lease duration; a lease older than this may be reclaimed. */
  readonly leaseSeconds: number;
}

/** One Watch claimed for evaluation, with its exclusive lease. */
export interface ClaimedWatch {
  readonly watch: OpportunityWatch;
  readonly leaseId: EvaluationLeaseId;
  readonly leaseExpiresAt: string;
}

export interface RecordAlertEventInput {
  readonly watchId: WatchId;
  readonly kind: AlertEventKind | string;
  readonly dedupeKey: string;
  readonly recipeId?: string;
  readonly packageId?: string;
  readonly supersededPackageId?: string | null;
  readonly cutoffMonth?: string;
  readonly priorEventId?: AlertEventId | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

/**
 * The stored event plus whether this call created it. `created` is false when
 * an event with the same (watchId, dedupeKey) already existed, in which case
 * the pre-existing event is returned unchanged.
 */
export interface RecordedAlertEvent {
  readonly event: AlertEvent;
  readonly created: boolean;
}

export interface CompleteEvaluationInput {
  readonly recipeId: string;
  readonly cutoffMonth: string;
  readonly resultDigest: string;
  readonly state: string;
  readonly growthRateDecimal: string | null;
  readonly confidence: string | null;
  readonly alertEventId?: AlertEventId | null;
}
