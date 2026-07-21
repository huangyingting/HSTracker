"use client";

// The Market Analysis orchestrator (spec:
// docs/spec/export-market-analysis-workspace.md §4.3, §7;
// docs/spec/export-market-analysis-workspace-ui-design.md §9, §11; issue
// #68). It owns the Market Analysis header, product-area navigation, the
// eight-area (seven in this slice; Recent Momentum ships with Slice 6)
// reading order from `MARKET_ANALYSIS_PRODUCT_AREAS`, and every loading/
// evidence/fatal-failure presentation state. It renders one already-loaded
// `MarketAnalysisV1` or a typed failure -- it never fetches, and it never
// recomputes a Candidate Market Score, CAGR, supplier share, HHI, or
// momentum value.

import type { RefObject } from "react";

import { MARKET_ANALYSIS_COPY, type MarketAnalysisLocale } from "../domain/market-analysis/copy";
import { MARKET_ANALYSIS_PRODUCT_AREAS } from "../domain/market-analysis/product-areas";
import type { MarketAnalysisV1 } from "../domain/market-analysis/result";
import type { EffectiveSourceFreshness } from "../domain/release/source-freshness";
import type { CandidateMarket } from "../domain/candidate-market/result";
import { MarketAnalysisClientError } from "./market-analysis-client";
import {
  DemandPanel,
  EvidenceQualityPanel,
  ExploreFurtherPanel,
  ExporterPositionPanel,
  MarketSnapshotPanel,
  SupplierLandscapePanel,
  ValidationPlanPanel,
} from "./market-analysis-panels";

// Maps a rejected `loadMarketAnalysis()` call onto the exact typed
// recovery surface docs/spec/export-market-analysis-workspace-ui-design.md
// §11.3 documents, reusing the route's own public error code precedence
// instead of re-deriving recovery behavior from bare HTTP status.
export function marketAnalysisStatusFromError(error: unknown): MarketAnalysisStatus {
  if (!(error instanceof MarketAnalysisClientError)) {
    return "fatal";
  }
  switch (error.publicCode) {
    case "ANALYSIS_RATE_LIMITED":
      return "rateLimit";
    case "ANALYSIS_BUDGET_EXCEEDED":
      return "budget";
    case "ANALYSIS_CAPACITY_EXCEEDED":
      return "capacity";
    case "ANALYSIS_BUILD_RETIRED":
      return "retired";
    case "CANDIDATE_MARKET_NOT_FOUND":
      return "notFound";
    case "ANALYSIS_UNAVAILABLE":
      return "unavailable";
    case "INVALID_ANALYSIS_QUERY":
      return "invalid";
  }
  if (error.status === 400 || error.status === 404) {
    return "invalid";
  }
  if (error.status === 410) {
    return "retired";
  }
  if (error.status === 429) {
    return "rateLimit";
  }
  if (error.status === 503) {
    return "unavailable";
  }
  return "fatal";
}

export type MarketAnalysisStatus =
  | "loading"
  | "success"
  | "invalid"
  | "notFound"
  | "retired"
  | "budget"
  | "rateLimit"
  | "capacity"
  | "unavailable"
  | "fatal";

const copy = {
  en: {
    heading: "Market Analysis",
    loading: "Loading the atomic annual Market Analysis…",
    invalid:
      "These analysis inputs are invalid. Check the selected export economy, HS Product, and market.",
    notFound:
      "The requested market is not a Candidate Market for this export economy and product.",
    retired:
      "This analysis build has retired. Refresh the current analysis to continue.",
    budget:
      "This Market Analysis request exceeds the complete-result size limit. Choose a different market.",
    rateLimit:
      "Market Analysis requests are temporarily limited. Wait a moment before retrying.",
    capacity: "Analysis capacity is temporarily busy. Market Analysis was not loaded.",
    unavailable:
      "Compatible Market Analysis evidence is temporarily unavailable.",
    fatal: "Market Analysis could not be completed.",
    retry: "Retry",
    refresh: "Refresh with current evidence",
    productAreaNavigationLabel: "Product areas",
  },
  "zh-Hans": {
    heading: "市场分析",
    loading: "正在加载完整的年度市场分析…",
    invalid: "该分析情境无效。请检查所选出口经济体、HS 产品和市场。",
    notFound: "所请求的市场不是该出口经济体和产品的候选市场。",
    retired: "该分析构建已停用。请刷新当前分析以继续。",
    budget: "该市场分析请求超出完整结果大小限制。请选择其他市场。",
    rateLimit: "市场分析请求暂时受限。请稍候再试。",
    capacity: "分析容量暂时繁忙。尚未加载市场分析。",
    unavailable: "兼容的市场分析证据暂时不可用。",
    fatal: "无法完成市场分析。",
    retry: "重试",
    refresh: "使用当前证据刷新",
    productAreaNavigationLabel: "产品区域",
  },
} as const;

// Recent Momentum ships with Slice 6 (issue #68 boundary: "Do not add
// Recent Trade Momentum to MarketAnalysisV1"). It is skipped here so the
// remaining seven areas keep the exact relative order
// MARKET_ANALYSIS_PRODUCT_AREAS defines instead of reserving a
// "Coming Soon" placeholder slot for it.
const RENDERED_PRODUCT_AREAS = MARKET_ANALYSIS_PRODUCT_AREAS.filter(
  (area) => area !== "recentMomentum",
);

export function MarketAnalysisView({
  status,
  analysis,
  locale,
  freshness,
  isCompared,
  comparisonFull,
  onToggleComparison,
  onRetry,
  onRefreshCurrent,
  headingRef,
  tradeTrendHref,
  supplierCompetitionHref,
  tradeExplorerHref,
}: {
  status: MarketAnalysisStatus;
  analysis: MarketAnalysisV1 | null;
  locale: MarketAnalysisLocale;
  freshness: EffectiveSourceFreshness | null;
  isCompared: boolean;
  comparisonFull: boolean;
  onToggleComparison: (candidate: CandidateMarket) => void;
  onRetry: () => void;
  onRefreshCurrent: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  tradeTrendHref: string;
  supplierCompetitionHref: string;
  tradeExplorerHref: string;
}) {
  const messages = copy[locale];
  const areaCopy = MARKET_ANALYSIS_COPY[locale];

  if (status === "loading") {
    return (
      <section
        className="market-analysis-view"
        aria-labelledby="market-analysis-heading"
      >
        <h2 id="market-analysis-heading" tabIndex={-1} ref={headingRef}>
          {messages.heading}
        </h2>
        <div className="market-analysis-skeleton" role="status">
          <span aria-hidden="true" />
          {messages.loading}
        </div>
      </section>
    );
  }

  if (status !== "success" || analysis === null) {
    const fatal = status === "unavailable" || status === "fatal";
    const recoveryAction =
      status === "retired" ? (
        <button type="button" onClick={onRefreshCurrent}>
          {messages.refresh}
        </button>
      ) : status === "rateLimit" || status === "capacity" || status === "fatal" ? (
        <button type="button" onClick={onRetry}>
          {messages.retry}
        </button>
      ) : null;
    return (
      <section
        className="market-analysis-view"
        aria-labelledby="market-analysis-heading"
      >
        <h2 id="market-analysis-heading" tabIndex={-1} ref={headingRef}>
          {messages.heading}
        </h2>
        <div
          className="market-analysis-error"
          role={fatal ? "alert" : "status"}
        >
          <p>{messages[status === "success" ? "fatal" : status]}</p>
          {recoveryAction}
        </div>
      </section>
    );
  }

  return (
    <section
      className="market-analysis-view"
      aria-labelledby="market-analysis-heading"
    >
      <header className="market-analysis-header">
        <h2 id="market-analysis-heading" tabIndex={-1} ref={headingRef}>
          {analysis.context.market.name} · {messages.heading}
        </h2>
        <p>
          {analysis.context.exporter.name} → {analysis.context.market.name} ·
          HS12 {analysis.context.product.code} ·{" "}
          {analysis.annualContext.finalizedWindow.start}–
          {analysis.annualContext.finalizedWindow.end} ·{" "}
          {analysis.annualContext.provisionalYear}
        </p>
      </header>

      <nav
        className="market-analysis-area-nav"
        aria-label={messages.productAreaNavigationLabel}
      >
        <ul>
          {RENDERED_PRODUCT_AREAS.map((area) => (
            <li key={area}>
              <a href={`#${areaAnchor(area)}`}>{areaCopy.productAreas[area]}</a>
            </li>
          ))}
        </ul>
      </nav>

      <MarketSnapshotPanel
        analysis={analysis}
        locale={locale}
        isCompared={isCompared}
        comparisonFull={comparisonFull}
        onToggleComparison={onToggleComparison}
        tradeTrendHref={tradeTrendHref}
        supplierCompetitionHref={supplierCompetitionHref}
      />
      <DemandPanel
        analysis={analysis}
        locale={locale}
        tradeTrendHref={tradeTrendHref}
      />
      <ExporterPositionPanel analysis={analysis} locale={locale} />
      <SupplierLandscapePanel
        analysis={analysis}
        locale={locale}
        supplierCompetitionHref={supplierCompetitionHref}
      />
      <EvidenceQualityPanel
        analysis={analysis}
        locale={locale}
        freshness={freshness}
      />
      <ExploreFurtherPanel
        locale={locale}
        tradeTrendHref={tradeTrendHref}
        supplierCompetitionHref={supplierCompetitionHref}
        tradeExplorerHref={tradeExplorerHref}
      />
      <ValidationPlanPanel locale={locale} />
    </section>
  );
}

function areaAnchor(area: (typeof MARKET_ANALYSIS_PRODUCT_AREAS)[number]): string {
  return area
    .replace(/([a-z])([A-Z])/gu, "$1-$2")
    .toLowerCase();
}
