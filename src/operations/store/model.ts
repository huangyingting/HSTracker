// Domain model for the operational data plane.
//
// Per ADR 0001, one business-storage interface owns hosted account, portfolio,
// Opportunity Watch, append-only alert-event, and delivery state. It never
// holds BACI evidence, Opportunity Index rows, monthly facts, product-mapping
// tables, or per-user copies of public analytical results — those live only in
// immutable analytical Dataset Packages.

/** Stable UUID identity of a hosted account. */
export type AccountId = string;
/** Stable UUID identity of an Opportunity Watch. */
export type WatchId = string;
/** Stable UUID identity of an append-only alert event. */
export type AlertEventId = string;
/** Opaque token identifying one evaluation lease over a claimed Watch. */
export type EvaluationLeaseId = string;

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

/** One confirmed HS product in an account's portfolio. */
export interface ConfirmedProduct {
  readonly accountId: AccountId;
  readonly product: ProductRef;
  readonly confirmedAt: string;
}

export type WatchStatus = "ACTIVE" | "PAUSED";

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
  readonly status: WatchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastEvaluatedPackageId: string | null;
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
  readonly kind: string;
  readonly dedupeKey: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly createdAt: string;
}

export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

/** Per-channel delivery state for one alert event. */
export interface DeliveryState {
  readonly eventId: AlertEventId;
  readonly channel: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly updatedAt: string;
}

export interface CreateAccountInput {
  readonly displayName: string;
  readonly primaryExportEconomy: string;
}

export interface OpenWatchInput {
  readonly product: ProductRef;
  readonly marketEconomy: string;
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
  readonly kind: string;
  readonly dedupeKey: string;
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
