import type { AlertDeliveryProvider } from "./alert-delivery-provider";
import { renderAlertMessage } from "./alert-message";
import type {
  AlertEvent,
  DeliveryAttemptOutcome,
  DeliveryStatus,
  OpportunityWatch,
  WatchDeliveryPreference,
} from "../store/model";
import type { OperationalStore } from "../store/operational-store";

export interface AlertDeliveryPolicy {
  readonly monthlyCapabilityEnabled: boolean;
  readonly sourceRefreshDelayedSince?: string | null;
  readonly asOf: string;
}

export interface DeliverOpportunityWatchAlertsInput {
  readonly store: OperationalStore;
  readonly accountId: string;
  readonly provider: AlertDeliveryProvider;
  readonly policy: AlertDeliveryPolicy;
  readonly maxAttempts?: number;
}

export interface DeliverAlertEventsInput {
  readonly store: OperationalStore;
  readonly events: readonly AlertEvent[];
  readonly provider: AlertDeliveryProvider;
  readonly policy: AlertDeliveryPolicy;
  readonly maxAttempts?: number;
}

export interface DeliverySuppressionCounts {
  readonly unsubscribe: number;
  readonly accountDeleted: number;
  readonly bounce: number;
  readonly complaint: number;
  readonly pausedWatch: number;
  readonly sourceDelayed: number;
  readonly monthlyCapabilityDisabled: number;
  readonly unverifiedConsent: number;
}

export interface AlertDeliverySummary {
  readonly considered: number;
  readonly sent: number;
  readonly failed: number;
  readonly deadLettered: number;
  readonly suppressedByCause: DeliverySuppressionCounts;
}

type SuppressionCause = keyof DeliverySuppressionCounts;

export async function deliverOpportunityWatchAlerts(
  input: DeliverOpportunityWatchAlertsInput,
): Promise<AlertDeliverySummary> {
  const account = await input.store.findAccount(input.accountId);
  if (account === null) {
    return summarizeDeletedAccount();
  }
  const [events, watches] = await Promise.all([
    input.store.listAlertEvents(input.accountId),
    input.store.listWatches(input.accountId),
  ]);
  return deliverEventsWithWatches({
    ...input,
    events,
    watchesById: new Map(watches.map((watch) => [watch.id, watch])),
  });
}

export async function deliverAlertEvents(
  input: DeliverAlertEventsInput,
): Promise<AlertDeliverySummary> {
  const accountIds = [...new Set(input.events.map((event) => event.accountId))];
  const deleted = new Set<string>();
  const watchesById = new Map<string, OpportunityWatch>();
  for (const accountId of accountIds) {
    const account = await input.store.findAccount(accountId);
    if (account === null) {
      deleted.add(accountId);
      continue;
    }
    const watches = await input.store.listWatches(accountId);
    for (const watch of watches) {
      watchesById.set(watch.id, watch);
    }
  }
  return deliverEventsWithWatches({ ...input, watchesById, deletedAccountIds: deleted });
}

async function deliverEventsWithWatches(input: DeliverAlertEventsInput & {
  readonly watchesById: ReadonlyMap<string, OpportunityWatch>;
  readonly deletedAccountIds?: ReadonlySet<string>;
}): Promise<AlertDeliverySummary> {
  const mutable = mutableSummary();
  const maxAttempts = input.maxAttempts ?? 3;
  for (const event of input.events) {
    const watch = input.watchesById.get(event.watchId) ?? null;
    const preferences = watch?.deliveryPreferences ?? [];
    const deliverablePreferences = preferences.filter(
      (preference) => preference.enabled && preference.target !== null,
    );
    if (deliverablePreferences.length === 0) {
      if ((input.deletedAccountIds ?? new Set()).has(event.accountId)) {
        mutable.considered += 1;
        mutable.suppressedByCause.accountDeleted += 1;
      }
      continue;
    }
    for (const preference of deliverablePreferences) {
      mutable.considered += 1;
      const cause = await suppressionCause({
        store: input.store,
        event,
        watch,
        preference,
        policy: input.policy,
        deletedAccountIds: input.deletedAccountIds ?? new Set(),
      });
      if (cause !== null) {
        mutable.suppressedByCause[cause] += 1;
        await recordSuppressedIfPossible(input.store, event, preference.channel);
        continue;
      }
      const outcome = await deliverOne({
        store: input.store,
        event,
        preference,
        provider: input.provider,
        maxAttempts,
      });
      if (outcome === "sent") {
        mutable.sent += 1;
      } else if (outcome === "dead-letter") {
        mutable.deadLettered += 1;
      } else if (outcome === "failed") {
        mutable.failed += 1;
      }
    }
  }
  return freezeSummary(mutable);
}

async function suppressionCause(input: {
  readonly store: OperationalStore;
  readonly event: AlertEvent;
  readonly watch: OpportunityWatch | null;
  readonly preference: WatchDeliveryPreference;
  readonly policy: AlertDeliveryPolicy;
  readonly deletedAccountIds: ReadonlySet<string>;
}): Promise<SuppressionCause | null> {
  if (input.deletedAccountIds.has(input.event.accountId)) {
    return "accountDeleted";
  }
  if ((await input.store.findAccount(input.event.accountId)) === null) {
    return "accountDeleted";
  }
  if (!input.policy.monthlyCapabilityEnabled) {
    return "monthlyCapabilityDisabled";
  }
  if (sourceDelayedSevenDays(input.policy)) {
    return "sourceDelayed";
  }
  if (input.watch === null || input.watch.status === "PAUSED") {
    return "pausedWatch";
  }
  const target = input.preference.target;
  if (target === null) {
    return "unverifiedConsent";
  }
  const consent = await input.store.findDeliveryConsent(
    input.event.accountId,
    input.preference.channel,
    target,
  );
  if (consent === null || consent.verifiedAt === null) {
    return "unverifiedConsent";
  }
  if (consent.unsubscribedAt !== null) {
    return "unsubscribe";
  }
  const suppression = await input.store.getDeliverySuppression(
    input.event.accountId,
    input.preference.channel,
    target,
  );
  if (suppression?.reason === "UNSUBSCRIBE") {
    return "unsubscribe";
  }
  if (suppression?.reason === "BOUNCE") {
    return "bounce";
  }
  if (suppression?.reason === "COMPLAINT") {
    return "complaint";
  }
  return null;
}

async function deliverOne(input: {
  readonly store: OperationalStore;
  readonly event: AlertEvent;
  readonly preference: WatchDeliveryPreference;
  readonly provider: AlertDeliveryProvider;
  readonly maxAttempts: number;
}): Promise<"sent" | "failed" | "dead-letter" | "skipped"> {
  const state = await input.store.ensureDeliveryState(
    input.event.id,
    input.preference.channel,
  );
  if (state.status === "DEAD_LETTER") {
    return "skipped";
  }
  if (state.status === "SENT" && !input.provider.supportsIdempotency) {
    await input.store.recordDeliveryAttempt({
      eventId: input.event.id,
      channel: input.preference.channel,
      status: "SENT",
      outcome: "DUPLICATE_SUPPRESSED",
      providerReceipt: state.providerReceipt,
    });
    return "sent";
  }

  let attempts = state.attempts;
  while (attempts < input.maxAttempts) {
    const current = await input.store.getDeliveryState(
      input.event.id,
      input.preference.channel,
    );
    attempts = current?.attempts ?? attempts;
    const result = await input.provider.send(
      renderAlertMessage(input.event),
      state.idempotencyKey,
    );
    const mapped = mapProviderOutcome(result.outcome);
    const recorded = await input.store.recordDeliveryAttempt({
      eventId: input.event.id,
      channel: input.preference.channel,
      status: mapped.status,
      outcome: result.outcome,
      providerReceipt: result.providerReceipt,
      failureReason: mapped.failureReason,
    });
    if (result.outcome === "BOUNCE" || result.outcome === "COMPLAINT") {
      const target = input.preference.target;
      if (target !== null) {
        await input.store.recordDeliverySuppression({
          accountId: input.event.accountId,
          channel: input.preference.channel,
          target,
          reason: result.outcome,
          providerReceipt: result.providerReceipt,
        });
      }
    }
    if (recorded.status === "SENT") {
      return "sent";
    }
    if (recorded.status === "DEAD_LETTER") {
      return "dead-letter";
    }
    attempts = recorded.attempts;
  }
  return "failed";
}

function mapProviderOutcome(outcome: DeliveryAttemptOutcome): {
  readonly status: Exclude<DeliveryStatus, "PENDING">;
  readonly failureReason: string | null;
} {
  if (outcome === "ACCEPTED") {
    return { status: "SENT", failureReason: null };
  }
  if (outcome === "TRANSIENT_FAILURE") {
    return {
      status: "FAILED",
      failureReason: "Provider reported a transient delivery failure.",
    };
  }
  if (outcome === "PERMANENT_FAILURE") {
    return {
      status: "DEAD_LETTER",
      failureReason: "Provider reported a permanent delivery failure.",
    };
  }
  if (outcome === "BOUNCE" || outcome === "COMPLAINT") {
    return {
      status: "DEAD_LETTER",
      failureReason: `Provider reported ${outcome}.`,
    };
  }
  return { status: "SUPPRESSED", failureReason: "Delivery suppressed." };
}

async function recordSuppressedIfPossible(
  store: OperationalStore,
  event: AlertEvent,
  channel: string,
): Promise<void> {
  try {
    await store.recordDeliveryAttempt({
      eventId: event.id,
      channel,
      status: "SUPPRESSED",
      outcome: "SUPPRESSED",
      failureReason: "Delivery suppressed before provider send.",
    });
  } catch {
    // Account deletion may have removed the event; the summary remains auditable.
  }
}

function sourceDelayedSevenDays(policy: AlertDeliveryPolicy): boolean {
  if (!policy.sourceRefreshDelayedSince) {
    return false;
  }
  const delayedSince = Date.parse(policy.sourceRefreshDelayedSince);
  const asOf = Date.parse(policy.asOf);
  if (!Number.isFinite(delayedSince) || !Number.isFinite(asOf)) {
    return false;
  }
  return asOf - delayedSince >= 7 * 24 * 60 * 60 * 1000;
}

function mutableSummary() {
  return {
    considered: 0,
    sent: 0,
    failed: 0,
    deadLettered: 0,
    suppressedByCause: {
      unsubscribe: 0,
      accountDeleted: 0,
      bounce: 0,
      complaint: 0,
      pausedWatch: 0,
      sourceDelayed: 0,
      monthlyCapabilityDisabled: 0,
      unverifiedConsent: 0,
    },
  };
}

function summarizeDeletedAccount(): AlertDeliverySummary {
  return freezeSummary(mutableSummary());
}

function freezeSummary(summary: ReturnType<typeof mutableSummary>): AlertDeliverySummary {
  return {
    considered: summary.considered,
    sent: summary.sent,
    failed: summary.failed,
    deadLettered: summary.deadLettered,
    suppressedByCause: { ...summary.suppressedByCause },
  };
}
