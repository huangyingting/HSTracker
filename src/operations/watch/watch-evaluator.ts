import { createHash } from "node:crypto";

import type { RecentTradeMomentumOutcome } from "../../domain/recent-trade-momentum/recent-trade-momentum-v1";
import type {
  AlertEventKind,
  AlertEventId,
  LastEvaluation,
  OpportunityWatch,
} from "../store/model";
import type { OperationalStore } from "../store/operational-store";
import {
  computeAlertDedupeKey,
  decideWatchAlert,
  stateFromOutcome,
  type WatchEvaluationSnapshot,
} from "./watch-alert-decision";

export interface MomentumEvaluationRequest {
  readonly packageIdentity: string;
  readonly reportingEconomyIso2: string;
  readonly hs12Code: string;
}

export interface MomentumEvaluationSource {
  evaluate(
    request: MomentumEvaluationRequest,
  ): Promise<RecentTradeMomentumOutcome | null>;
}

export interface EvaluateOpportunityWatchesInput {
  readonly store: OperationalStore;
  readonly packageIdentity: string;
  readonly cutoffMonth: string;
  readonly source: MomentumEvaluationSource;
  readonly evaluatorId: string;
  readonly batchSize: number;
  readonly leaseSeconds?: number;
  readonly recipeId?: "recent-trade-momentum-v1";
  readonly supersedesPackageIdentity?: string | null;
  readonly revisionReportSha256?: string | null;
}

export interface EvaluateOpportunityWatchesSummary {
  readonly claimedWatchCount: number;
  readonly evaluatedWatchCount: number;
  readonly skippedWatchCount: number;
  readonly createdEventCount: number;
  readonly claimedBatchSizes: readonly number[];
}

export async function evaluateOpportunityWatchesForPackage(
  input: EvaluateOpportunityWatchesInput,
): Promise<EvaluateOpportunityWatchesSummary> {
  const recipeId = input.recipeId ?? "recent-trade-momentum-v1";
  const leaseSeconds = input.leaseSeconds ?? 300;
  const claimedBatchSizes: number[] = [];
  let claimedWatchCount = 0;
  let evaluatedWatchCount = 0;
  let skippedWatchCount = 0;
  let createdEventCount = 0;
  let eventSequence = Date.now();

  for (;;) {
    const claims = await input.store.claimWatchesForEvaluation({
      evaluatorId: input.evaluatorId,
      packageId: input.packageIdentity,
      limit: input.batchSize,
      leaseSeconds,
    });
    if (claims.length === 0) {
      break;
    }
    claimedBatchSizes.push(claims.length);
    claimedWatchCount += claims.length;

    for (const claim of claims) {
      const watch = claim.watch;
      if (!shouldEvaluateCadence(watch, input)) {
        skippedWatchCount += 1;
        await input.store.completeEvaluation(claim.leaseId, input.packageIdentity);
        continue;
      }

      const result = await input.source.evaluate({
        packageIdentity: input.packageIdentity,
        reportingEconomyIso2: watch.reportingEconomyIso2,
        hs12Code: watch.hs12Code,
      });
      if (result === null) {
        skippedWatchCount += 1;
        await input.store.completeEvaluation(claim.leaseId, input.packageIdentity);
        continue;
      }

      evaluatedWatchCount += 1;
      const prior = watch.lastEvaluation
        ? toDecisionSnapshot(watch.lastEvaluation)
        : null;
      const resultState = stateFromOutcome(result);
      const resultDigest = computeWatchResultDigest(result);
      const occurredAt = new Date(eventSequence).toISOString();
      eventSequence += 1;

      let alertEventIdForEvaluation: AlertEventId | null = null;
      const revisionKind = decideRevisionEventKind({
        prior: watch.lastEvaluation,
        current: result,
        supersedesPackageIdentity: input.supersedesPackageIdentity ?? null,
      });

      if (revisionKind !== null) {
        const recorded = await input.store.recordAlertEvent({
          watchId: watch.id,
          kind: revisionKind,
          dedupeKey: computeAlertDedupeKey({
            watchId: watch.id,
            recipeId,
            cutoffMonth: result.cutoffMonth,
            packageId: input.packageIdentity,
            eventKind: revisionKind,
            priorAlertEventId: watch.lastEvaluation?.alertEventId ?? null,
          }),
          recipeId,
          packageId: input.packageIdentity,
          supersededPackageId: input.supersedesPackageIdentity ?? null,
          cutoffMonth: result.cutoffMonth,
          priorEventId: watch.lastEvaluation?.alertEventId ?? null,
          detail: revisionPayload({
            kind: revisionKind,
            prior: watch.lastEvaluation,
            current: result,
            newState: resultState.state,
            packageIdentity: input.packageIdentity,
            supersedesPackageIdentity: input.supersedesPackageIdentity ?? null,
            revisionReportSha256: input.revisionReportSha256 ?? null,
          }),
          occurredAt,
        });
        alertEventIdForEvaluation = watch.lastEvaluation?.alertEventId ?? null;
        if (recorded.created) {
          createdEventCount += 1;
          await recordDeliveries(input.store, watch, recorded.event.id);
        }
      } else {
        const decision = decideWatchAlert(prior, result, recipeId);
        if (decision.alert) {
          const recorded = await input.store.recordAlertEvent({
            watchId: watch.id,
            kind: decision.eventKind,
            dedupeKey: computeAlertDedupeKey({
              watchId: watch.id,
              recipeId,
              cutoffMonth: result.cutoffMonth,
              packageId: input.packageIdentity,
              eventKind: decision.eventKind,
              priorAlertEventId: watch.lastEvaluation?.alertEventId ?? null,
            }),
            recipeId,
            packageId: input.packageIdentity,
            cutoffMonth: result.cutoffMonth,
            priorEventId: watch.lastEvaluation?.alertEventId ?? null,
            detail: {
              reason: decision.reason,
              state: resultState.state,
              growthRateDecimal: result.growthRateDecimal,
              confidence: result.confidence,
              resultDigest,
            },
            occurredAt,
          });
          alertEventIdForEvaluation = recorded.event.id;
          if (recorded.created) {
            createdEventCount += 1;
            await recordDeliveries(input.store, watch, recorded.event.id);
          }
        }
      }

      await input.store.completeEvaluation(claim.leaseId, input.packageIdentity, {
        recipeId,
        cutoffMonth: result.cutoffMonth,
        resultDigest,
        state: resultState.state,
        growthRateDecimal: result.growthRateDecimal,
        confidence: result.confidence,
        alertEventId: alertEventIdForEvaluation,
      });
    }
  }

  return {
    claimedWatchCount,
    evaluatedWatchCount,
    skippedWatchCount,
    createdEventCount,
    claimedBatchSizes,
  };
}

export function computeWatchResultDigest(
  result: RecentTradeMomentumOutcome,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: result.schemaVersion,
        recipe: result.recipe,
        monthlyPackageId: result.monthlyPackageId,
        sourceVintageId: result.sourceVintageId,
        reporterIso2: result.reporterIso2,
        hs12Code: result.hs12Code,
        cutoffMonth: result.cutoffMonth,
        coverageState: result.coverageState,
        signalState: result.signalState,
        reasonCodes: result.reasonCodes,
        growthRateDecimal: result.growthRateDecimal,
        confidence: result.confidence,
      }),
    )
    .digest("hex");
}

function shouldEvaluateCadence(
  watch: OpportunityWatch,
  input: EvaluateOpportunityWatchesInput,
): boolean {
  if (watch.cadence === "MONTHLY") {
    return true;
  }
  if (isQuarterEndpoint(input.cutoffMonth)) {
    return true;
  }
  return (
    input.supersedesPackageIdentity !== null &&
    input.supersedesPackageIdentity !== undefined &&
    watch.lastEvaluation?.cutoffMonth === input.cutoffMonth
  );
}

function isQuarterEndpoint(cutoffMonth: string): boolean {
  return /-(03|06|09|12)$/u.test(cutoffMonth);
}

function toDecisionSnapshot(
  evaluation: LastEvaluation,
): WatchEvaluationSnapshot {
  return {
    recipeId: evaluation.recipeId,
    packageId: evaluation.packageId,
    cutoffMonth: evaluation.cutoffMonth,
    resultDigest: evaluation.resultDigest,
    state: evaluation.state as WatchEvaluationSnapshot["state"],
    growthRateDecimal: evaluation.growthRateDecimal,
    confidence: evaluation.confidence,
    evaluatedAt: evaluation.evaluatedAt,
    alertEventId: evaluation.alertEventId,
  };
}

function decideRevisionEventKind(input: {
  readonly prior: LastEvaluation | null;
  readonly current: RecentTradeMomentumOutcome;
  readonly supersedesPackageIdentity: string | null;
}): AlertEventKind | null {
  if (
    input.supersedesPackageIdentity === null ||
    input.prior === null ||
    input.prior.packageId !== input.supersedesPackageIdentity ||
    input.prior.cutoffMonth !== input.current.cutoffMonth
  ) {
    return null;
  }
  const currentState = stateFromOutcome(input.current).state;
  const currentDirectional = isDirectional(currentState);
  const priorDirectional = isDirectional(input.prior.state);
  if (
    input.prior.alertEventId !== null &&
    priorDirectional &&
    !currentDirectional
  ) {
    return "REVISION_RETRACTION";
  }
  if (
    input.prior.alertEventId !== null &&
    !priorDirectional &&
    currentDirectional
  ) {
    return "REVISION_REINSTATEMENT";
  }
  if (
    input.prior.alertEventId !== null &&
    currentDirectional &&
    revisionMateriallyChanged(input.prior, input.current)
  ) {
    return "REVISION_UPDATE";
  }
  return null;
}

function revisionMateriallyChanged(
  prior: LastEvaluation,
  current: RecentTradeMomentumOutcome,
): boolean {
  const currentState = stateFromOutcome(current).state;
  if (prior.state !== currentState) {
    return true;
  }
  if (prior.growthRateDecimal === null || current.growthRateDecimal === null) {
    return false;
  }
  return Math.abs(Number(current.growthRateDecimal) - Number(prior.growthRateDecimal)) >=
    0.1;
}

function isDirectional(state: string): boolean {
  return (
    state === "RISING" ||
    state === "RISING_FAST" ||
    state === "FALLING" ||
    state === "FALLING_FAST"
  );
}

function revisionPayload(input: {
  readonly kind: AlertEventKind;
  readonly prior: LastEvaluation | null;
  readonly current: RecentTradeMomentumOutcome;
  readonly newState: string;
  readonly packageIdentity: string;
  readonly supersedesPackageIdentity: string | null;
  readonly revisionReportSha256: string | null;
}): Readonly<Record<string, unknown>> {
  return {
    revisionKind: input.kind,
    originalAlertEventId: input.prior?.alertEventId ?? null,
    oldPackageId: input.supersedesPackageIdentity,
    newPackageId: input.packageIdentity,
    oldState: input.prior?.state ?? null,
    newState: input.newState,
    oldGrowthRateDecimal: input.prior?.growthRateDecimal ?? null,
    newGrowthRateDecimal: input.current.growthRateDecimal,
    affectedPeriods: {
      recentMonths: input.current.recentMonths,
      baselineMonths: input.current.baselineMonths,
      cutoffMonth: input.current.cutoffMonth,
    },
    revisionReportSha256: input.revisionReportSha256,
  };
}

async function recordDeliveries(
  store: OperationalStore,
  watch: OpportunityWatch,
  eventId: AlertEventId,
): Promise<void> {
  for (const preference of watch.deliveryPreferences) {
    if (preference.enabled) {
      await store.ensureDeliveryState(eventId, preference.channel);
    }
  }
}
