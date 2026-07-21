import {
  invalidAnalysisQuery,
  retiredAnalysisBuild,
  unavailableAnalysisBuild,
  unknownExporter,
  unknownProduct,
} from "../candidate-market/errors";
import type { CandidateMarketResult } from "../candidate-market/result";
import {
  invalidSupplierCompetitionQuery,
  retiredSupplierCompetitionAnalysisBuild,
  unavailableSupplierCompetitionAnalysisBuild,
  unknownSupplierCompetitionImporter,
  unknownSupplierCompetitionProduct,
} from "../supplier-competition/errors";
import type { SupplierCompetitionResult } from "../supplier-competition/result";
import {
  invalidTradeTrendQuery,
  retiredTradeTrendAnalysisBuild,
  unavailableTradeTrendAnalysisBuild,
  unknownImporter,
  unknownTradeTrendProduct,
} from "../trade-trend/errors";
import type { TradeTrendResult } from "../trade-trend/result";
import { AnalysisBudgetExceededError } from "../../runtime/analysis-budget-error";
import { AnalysisCapacityExceededError } from "../../runtime/analysis-capacity-error";
import { AnalysisRateLimitedError } from "../../runtime/analysis-rate-limit-error";
import type {
  AnalysisExecutionOptions,
  AnalysisOutcome,
  TradeAnalyticsPlatform,
} from "../trade-analytics/trade-analytics-platform";

import { candidateMarketNotFound } from "./errors";
import type { MarketAnalysisRequest, MarketAnalysisV1 } from "./result";

// The deep Module above TradeAnalyticsPlatform (spec:
// docs/spec/export-market-analysis-workspace.md §5.1-§5.5; ADR 0005; issue
// #66). `MarketAnalysis.load` is the entire public seam: it hides recipe
// coordination, selected-row projection, annual-provenance reconciliation,
// selected-exporter lookup in the supplier cohort, and deterministic
// failure precedence. `createMarketAnalysis(platform)` is the sole
// production constructor and takes the exact same `TradeAnalyticsPlatform`
// every other recipe already crosses, so this Module adds no new
// evidence-source seam of its own.

export interface MarketAnalysis {
  load(
    request: MarketAnalysisRequest,
    options?: AnalysisExecutionOptions,
  ): Promise<MarketAnalysisV1>;
}

const MARKET_ANALYSIS_DISCLAIMER =
  "Market Analysis brings together public trade evidence for one Candidate Market Context. It is a discovery aid for further investigation, not a recommendation, forecast, or prediction of commercial success.";

// Deterministic cross-recipe failure precedence (spec §5.4): the category
// rank a constituent Analysis Outcome state occupies when more than one
// constituent execution fails. States absent here ("success", "empty") are
// not failures at this layer.
const FAILURE_CATEGORY_RANK: Readonly<Record<string, number>> = Object.freeze(
  {
    "invalid-input": 1,
    retired: 2,
    "incompatible-package": 3,
    budget: 4,
    "rate-limit": 5,
    capacity: 6,
    "temporary-unavailability": 7,
  },
);

function normalizeEconomyCode(code: string): string {
  return String(Number(code));
}

// Picks the lowest-ranked (highest-precedence) category among the three
// constituents, preferring the earliest index -- Candidate Market, then
// Trade Trend, then Supplier Competition -- on a tie, which is exactly the
// within-category recipe order the spec requires.
function pickFailureWinner(
  ranks: readonly (number | undefined)[],
): number | null {
  let winnerIndex: number | null = null;
  let winnerRank = Number.POSITIVE_INFINITY;
  for (const [index, rank] of ranks.entries()) {
    if (rank !== undefined && rank < winnerRank) {
      winnerIndex = index;
      winnerRank = rank;
    }
  }
  return winnerIndex;
}

function throwCandidateMarketFailure(
  request: MarketAnalysisRequest,
  outcome: AnalysisOutcome<"candidate-market-v1">,
): never {
  switch (outcome.state) {
    case "invalid-input": {
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidAnalysisQuery("The analysis query is invalid.");
        case "UNKNOWN_EXPORTER":
          throw unknownExporter(outcome.error.exporterCode);
        case "UNKNOWN_PRODUCT":
          throw unknownProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Candidate Market input error: ${String(unreachable)}`,
      );
    }
    case "retired":
      throw retiredAnalysisBuild(outcome.error.analysisBuildId);
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableAnalysisBuild(request.analysisBuildId);
    case "budget":
      throw new AnalysisBudgetExceededError(
        outcome.error.budget,
        "Candidate Market",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Candidate Market",
      );
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Candidate Market",
      );
    case "success":
    case "empty":
      throw new TypeError(
        `pickFailureWinner selected a non-failing Candidate Market outcome: ${outcome.state}`,
      );
  }
}

function throwTradeTrendFailure(
  request: MarketAnalysisRequest,
  outcome: AnalysisOutcome<"trade-trend-v1">,
): never {
  switch (outcome.state) {
    case "invalid-input": {
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidTradeTrendQuery("The analysis query is invalid.");
        case "UNKNOWN_IMPORTER":
          throw unknownImporter(outcome.error.importerCode);
        case "UNKNOWN_PRODUCT":
          throw unknownTradeTrendProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Trade Trend input error: ${String(unreachable)}`,
      );
    }
    case "retired":
      throw retiredTradeTrendAnalysisBuild(outcome.error.analysisBuildId);
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableTradeTrendAnalysisBuild(request.analysisBuildId);
    case "budget":
      throw new AnalysisBudgetExceededError(
        outcome.error.budget,
        "Trade Trend",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Trade Trend",
      );
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Trade Trend",
      );
    case "success":
    case "empty":
      throw new TypeError(
        `pickFailureWinner selected a non-failing Trade Trend outcome: ${outcome.state}`,
      );
  }
}

function throwSupplierCompetitionFailure(
  request: MarketAnalysisRequest,
  outcome: AnalysisOutcome<"supplier-competition-v1">,
): never {
  switch (outcome.state) {
    case "invalid-input": {
      switch (outcome.error.code) {
        case "INVALID_ANALYSIS_QUERY":
          throw invalidSupplierCompetitionQuery(
            "The analysis query is invalid.",
          );
        case "UNKNOWN_IMPORTER":
          throw unknownSupplierCompetitionImporter(outcome.error.importerCode);
        case "UNKNOWN_PRODUCT":
          throw unknownSupplierCompetitionProduct(outcome.error.productCode);
      }
      const unreachable: never = outcome.error;
      throw new TypeError(
        `Unsupported Supplier Competition input error: ${String(unreachable)}`,
      );
    }
    case "retired":
      throw retiredSupplierCompetitionAnalysisBuild(
        outcome.error.analysisBuildId,
      );
    case "incompatible-package":
    case "temporary-unavailability":
      throw unavailableSupplierCompetitionAnalysisBuild(
        request.analysisBuildId,
      );
    case "budget":
      throw new AnalysisBudgetExceededError(
        outcome.error.budget,
        "Supplier Competition",
      );
    case "rate-limit":
      throw new AnalysisRateLimitedError(
        outcome.error.retryAfterSeconds,
        "Supplier Competition",
      );
    case "capacity":
      throw new AnalysisCapacityExceededError(
        outcome.error.reason,
        outcome.error.retryAfterSeconds,
        "Supplier Competition",
      );
    case "success":
    case "empty":
      throw new TypeError(
        `pickFailureWinner selected a non-failing Supplier Competition outcome: ${outcome.state}`,
      );
  }
}

// Fails closed as ANALYSIS_UNAVAILABLE the moment shared annual semantics
// disagree (spec §5.5): BACI Release, HS revision, the five-Finalized-Year
// window, Provisional Year, value unit, and analysis build. Dataset Package
// identities themselves stay individually visible and are not compared here.
function verifyAnnualProvenance(
  request: MarketAnalysisRequest,
  candidateMarket: CandidateMarketResult,
  tradeTrend: TradeTrendResult,
  supplierCompetition: SupplierCompetitionResult,
): void {
  const agrees =
    candidateMarket.analysisBuildId === tradeTrend.analysisBuildId &&
    candidateMarket.analysisBuildId === supplierCompetition.analysisBuildId &&
    candidateMarket.provenance.baciRelease ===
      tradeTrend.provenance.baciRelease &&
    candidateMarket.provenance.baciRelease ===
      supplierCompetition.provenance.baciRelease &&
    candidateMarket.provenance.hsRevision ===
      tradeTrend.provenance.hsRevision &&
    candidateMarket.provenance.hsRevision ===
      supplierCompetition.provenance.hsRevision &&
    candidateMarket.provenance.scoreWindow.start ===
      tradeTrend.provenance.finalizedWindow.start &&
    candidateMarket.provenance.scoreWindow.end ===
      tradeTrend.provenance.finalizedWindow.end &&
    candidateMarket.provenance.scoreWindow.start ===
      supplierCompetition.provenance.finalizedWindow.start &&
    candidateMarket.provenance.scoreWindow.end ===
      supplierCompetition.provenance.finalizedWindow.end &&
    candidateMarket.provenance.provisionalYear ===
      tradeTrend.provenance.provisionalYear &&
    candidateMarket.provenance.provisionalYear ===
      supplierCompetition.provenance.provisionalYear &&
    candidateMarket.provenance.valueUnit === tradeTrend.provenance.valueUnit &&
    candidateMarket.provenance.valueUnit ===
      supplierCompetition.provenance.valueUnit;
  if (!agrees) {
    throw unavailableAnalysisBuild(request.analysisBuildId);
  }
}

export function createMarketAnalysis(
  platform: TradeAnalyticsPlatform,
): MarketAnalysis {
  return {
    async load(request, options) {
      const [candidateMarket, tradeTrend, supplierCompetition] =
        await Promise.all([
          platform.execute(
            {
              recipe: "candidate-market-v1",
              analysisBuildId: request.analysisBuildId,
              exporterCode: request.exportEconomyCode,
              productCode: request.productCode,
            },
            options,
          ),
          platform.execute(
            {
              recipe: "trade-trend-v1",
              analysisBuildId: request.analysisBuildId,
              importerCode: request.marketCode,
              productCode: request.productCode,
            },
            options,
          ),
          platform.execute(
            {
              recipe: "supplier-competition-v1",
              analysisBuildId: request.analysisBuildId,
              importerCode: request.marketCode,
              productCode: request.productCode,
            },
            options,
          ),
        ]);

      const winner = pickFailureWinner([
        FAILURE_CATEGORY_RANK[candidateMarket.state],
        FAILURE_CATEGORY_RANK[tradeTrend.state],
        FAILURE_CATEGORY_RANK[supplierCompetition.state],
      ]);
      if (winner === 0) {
        throwCandidateMarketFailure(request, candidateMarket);
      }
      if (winner === 1) {
        throwTradeTrendFailure(request, tradeTrend);
      }
      if (winner === 2) {
        throwSupplierCompetitionFailure(request, supplierCompetition);
      }

      // No constituent failed in one of the seven categories above, so every
      // outcome must now be "success" (Trade Trend) or "success"/"empty"
      // (Candidate Market, Supplier Competition). These guards are the type
      // narrowing the discriminated AnalysisOutcome union needs; they should
      // be unreachable in practice.
      if (
        candidateMarket.state !== "success" &&
        candidateMarket.state !== "empty"
      ) {
        throw new TypeError(
          `Unexpected Candidate Market outcome state: ${candidateMarket.state}`,
        );
      }
      if (tradeTrend.state !== "success") {
        throw new TypeError(
          `Unexpected Trade Trend outcome state: ${tradeTrend.state}`,
        );
      }
      if (
        supplierCompetition.state !== "success" &&
        supplierCompetition.state !== "empty"
      ) {
        throw new TypeError(
          `Unexpected Supplier Competition outcome state: ${supplierCompetition.state}`,
        );
      }

      // Resolve constituent invalid-input outcomes before evaluating
      // Candidate Market absence (spec §5.4): reaching here already proves
      // no constituent had an invalid-input (or any other) failure, so an
      // empty cohort or a market missing from it is a typed
      // CANDIDATE_MARKET_NOT_FOUND, never a generic invalid-input failure.
      if (candidateMarket.state === "empty") {
        throw candidateMarketNotFound(request.marketCode);
      }

      const marketCode = normalizeEconomyCode(request.marketCode);
      const candidate = candidateMarket.payload.candidates.find(
        (item) => normalizeEconomyCode(item.economy.code) === marketCode,
      );
      if (candidate === undefined) {
        throw candidateMarketNotFound(request.marketCode);
      }

      verifyAnnualProvenance(
        request,
        candidateMarket.payload,
        tradeTrend.payload,
        supplierCompetition.payload,
      );

      const exporterCode = normalizeEconomyCode(request.exportEconomyCode);
      const pooledSupplier =
        supplierCompetition.payload.supplierShares.find(
          (share) => normalizeEconomyCode(share.economy.code) === exporterCode,
        ) ?? null;

      const result: MarketAnalysisV1 = {
        schemaVersion: "market-analysis-v1",
        context: {
          analysisBuildId: request.analysisBuildId,
          exporter: candidateMarket.payload.query.exporter,
          product: candidateMarket.payload.query.product,
          market: candidate.economy,
        },
        annualContext: {
          baciRelease: candidateMarket.payload.provenance.baciRelease,
          hsRevision: candidateMarket.payload.provenance.hsRevision,
          finalizedWindow: {
            start: candidateMarket.payload.provenance.scoreWindow.start,
            end: candidateMarket.payload.provenance.scoreWindow.end,
          },
          provisionalYear: candidateMarket.payload.provenance.provisionalYear,
          valueUnit: candidateMarket.payload.provenance.valueUnit,
        },
        constituentAnalyses: [
          {
            recipe: "candidate-market-v1",
            analysisIdentity: candidateMarket.analysisIdentity,
            datasetPackageIdentity: candidateMarket.datasetPackageIdentity,
          },
          {
            recipe: "trade-trend-v1",
            analysisIdentity: tradeTrend.analysisIdentity,
            datasetPackageIdentity: tradeTrend.datasetPackageIdentity,
          },
          {
            recipe: "supplier-competition-v1",
            analysisIdentity: supplierCompetition.analysisIdentity,
            datasetPackageIdentity: supplierCompetition.datasetPackageIdentity,
          },
        ],
        opportunity: {
          candidate,
          cohortSize: candidateMarket.payload.cohortSize,
          weights: candidateMarket.payload.weights,
        },
        demand: {
          finalizedObservations: tradeTrend.payload.finalizedObservations,
          summary: tradeTrend.payload.summary,
          provisionalObservation: tradeTrend.payload.provisionalObservation,
        },
        exporterPosition: {
          scoreWindowFoothold: candidate.components.recordedFoothold,
          pooledSupplier,
          provisionalBilateral: candidate.provisionalEvidence,
        },
        supplierLandscape: {
          cohortBudget: supplierCompetition.payload.cohortBudget,
          cohortSize: supplierCompetition.payload.cohortSize,
          emptyReason: supplierCompetition.payload.emptyReason,
          finalizedPooledValueCurrentUsd:
            supplierCompetition.payload.finalizedPooledValueCurrentUsd,
          supplierShares: supplierCompetition.payload.supplierShares,
          concentration: supplierCompetition.payload.concentration,
          qualityWarnings: supplierCompetition.payload.qualityWarnings,
          provisionalMarketState:
            supplierCompetition.payload.provisionalMarketState,
          provisionalSupplierShares:
            supplierCompetition.payload.provisionalSupplierShares,
        },
        evidenceQuality: {
          confidence: candidate.confidence,
          observedFinalizedYears: candidate.observedScoreYears,
          missingFinalizedYears: candidate.missingScoreYears,
          quantityCoverageRate: candidate.quantityCoverageRate,
          caveatCodes: candidate.caveatCodes,
          stability: candidateMarket.payload.stability,
          productSeriesDiscontinuityYears:
            candidateMarket.payload.productSeriesDiscontinuityYears,
          releaseRevision: candidate.releaseRevision,
          releaseRevisionSummary:
            candidateMarket.payload.releaseRevisionSummary,
          sourceUpdateDate: candidateMarket.payload.provenance.sourceUpdateDate,
        },
        discoveryDisclaimer: MARKET_ANALYSIS_DISCLAIMER,
      };
      return result;
    },
  };
}
