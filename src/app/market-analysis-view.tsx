"use client";

// The Market Analysis orchestrator (spec:
// docs/spec/export-market-analysis-workspace.md §4.3, §7;
// docs/spec/export-market-analysis-workspace-ui-design.md §9, §11; issue
// #68, #70). It owns the Market Analysis header, product-area navigation, the
// eight-area
// reading order from `MARKET_ANALYSIS_PRODUCT_AREAS`, and every loading/
// evidence/fatal-failure presentation state. It renders one already-loaded
// `MarketAnalysisV1` or a typed failure -- it never fetches, and it never
// recomputes a Candidate Market Score, CAGR, supplier share, HHI, or
// momentum value.

import {
  useEffect,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

import { MARKET_ANALYSIS_COPY, type MarketAnalysisLocale } from "../domain/market-analysis/copy";
import { MARKET_ANALYSIS_PRODUCT_AREAS } from "../domain/market-analysis/product-areas";
import type { MarketAnalysisV1 } from "../domain/market-analysis/result";
import type { EffectiveSourceFreshness } from "../domain/release/source-freshness";
import type { DatasetPackageIdentity } from "../domain/trade-analytics/dataset-package";
import { AnalysisShareLink } from "./analysis-share-link";
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
import { RecentMomentumPanel } from "./recent-momentum-panel";

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
    retiredBuild: (analysisBuildId: string) =>
      `Analysis build ${analysisBuildId} has retired. Refresh with current evidence to continue.`,
    budget:
      "This Market Analysis request exceeds the complete-result size limit. Choose a different market.",
    rateLimit:
      "Market Analysis requests are temporarily limited. Wait a moment before retrying.",
    retryAfter: (seconds: number) =>
      `Retry available in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
    capacity: "Analysis capacity is temporarily busy. Market Analysis was not loaded.",
    unavailable:
      "Compatible Market Analysis evidence is temporarily unavailable.",
    fatal: "Market Analysis could not be completed.",
    retry: "Retry",
    refresh: "Refresh with current evidence",
    backToOpportunities: "Back to opportunities",
    backUnavailable: "Opportunities are unavailable for this evidence version.",
    changeScope: "Change scope",
    narrowScope: "Narrow scope",
    jumpToSection: "Jump to section",
    viewScope: "View scope",
    current: "Current",
    retained: "Retained",
    activationCurrent: "Active deployment",
    activationFallback: "Last Verified Resident Fallback",
    freshnessLatest: "Fresh",
    freshnessUpdate: "New source release under validation",
    freshnessDelayed: "Source refresh delayed",
    freshnessOverdue: "Source freshness check overdue",
    productAreaNavigationLabel: "Product areas",
  },
  "zh-Hans": {
    heading: "市场分析",
    loading: "正在加载完整的年度市场分析…",
    invalid: "该分析情境无效。请检查所选出口经济体、HS 产品和市场。",
    notFound: "所请求的市场不是该出口经济体和产品的候选市场。",
    retired: "该分析构建已停用。请刷新当前分析以继续。",
    retiredBuild: (analysisBuildId: string) =>
      `分析构建 ${analysisBuildId} 已停用。请使用当前证据刷新以继续。`,
    budget: "该市场分析请求超出完整结果大小限制。请选择其他市场。",
    rateLimit: "市场分析请求暂时受限。请稍候再试。",
    retryAfter: (seconds: number) => `${seconds} 秒后可重试。`,
    capacity: "分析容量暂时繁忙。尚未加载市场分析。",
    unavailable: "兼容的市场分析证据暂时不可用。",
    fatal: "无法完成市场分析。",
    retry: "重试",
    refresh: "使用当前证据刷新",
    backToOpportunities: "返回机会列表",
    backUnavailable: "此证据版本无法打开机会列表。",
    changeScope: "更改范围",
    narrowScope: "缩小范围",
    jumpToSection: "跳转到章节",
    viewScope: "查看范围",
    current: "当前",
    retained: "保留版本",
    activationCurrent: "当前部署",
    activationFallback: "最后验证的驻留回退",
    freshnessLatest: "新鲜",
    freshnessUpdate: "正在验证新的来源发布版本",
    freshnessDelayed: "来源刷新延迟",
    freshnessOverdue: "来源新鲜度检查逾期",
    productAreaNavigationLabel: "产品区域",
  },
} as const;

const RENDERED_PRODUCT_AREAS = MARKET_ANALYSIS_PRODUCT_AREAS;

export function MarketAnalysisView({
  status,
  analysis,
  locale,
  freshness,
  onRetry,
  onRefreshCurrent,
  retryAfterSeconds,
  requestedAnalysisBuildId,
  headingRef,
  opportunityHref,
  onBackToOpportunities,
  deploymentState,
  productDescription,
  tradeTrendHref,
  supplierCompetitionHref,
  tradeExplorerHref,
  recentMomentumDatasetPackageIdentity,
}: {
  status: MarketAnalysisStatus;
  analysis: MarketAnalysisV1 | null;
  locale: MarketAnalysisLocale;
  freshness: EffectiveSourceFreshness | null;
  onRetry: () => void;
  onRefreshCurrent: () => void;
  retryAfterSeconds: number | null;
  requestedAnalysisBuildId: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  opportunityHref: string | null;
  onBackToOpportunities?: (event: MouseEvent<HTMLAnchorElement>) => void;
  deploymentState: "current" | "retained";
  productDescription: string;
  tradeTrendHref: string;
  supplierCompetitionHref: string;
  tradeExplorerHref: string | null;
  recentMomentumDatasetPackageIdentity: DatasetPackageIdentity | null;
}) {
  const messages = copy[locale];
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const [activeArea, setActiveArea] =
    useState<(typeof RENDERED_PRODUCT_AREAS)[number]>("snapshot");

  useEffect(() => {
    if (status !== "success" || analysis === null) {
      return;
    }
    const sections = RENDERED_PRODUCT_AREAS.map((area) =>
      document.getElementById(areaAnchor(area)),
    ).filter((section): section is HTMLElement => section !== null);
    let frame: number | null = null;
    const updateActiveArea = () => {
      frame = null;
      const readingLine = Math.min(160, window.innerHeight * 0.2);
      let nearest = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= readingLine) {
          nearest = section;
        } else {
          break;
        }
      }
      const area = RENDERED_PRODUCT_AREAS.find(
        (candidate) => areaAnchor(candidate) === nearest?.id,
      );
      if (area !== undefined) {
        setActiveArea(area);
      }
    };
    const scheduleUpdate = () => {
      if (frame === null) {
        frame = window.requestAnimationFrame(updateActiveArea);
      }
    };
    updateActiveArea();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [analysis, status]);

  if (status === "loading") {
    return (
      <section
        className="market-analysis-view"
        aria-labelledby="market-analysis-heading"
      >
        <MarketAnalysisBack
          href={opportunityHref}
          label={messages.backToOpportunities}
          unavailableLabel={messages.backUnavailable}
          onClick={onBackToOpportunities}
        />
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
    const recoveryAction =
      status === "retired" ? (
        <button type="button" onClick={onRefreshCurrent}>
          {messages.refresh}
        </button>
      ) : status === "rateLimit" ? (
        <RateLimitRecovery
          delaySeconds={retryAfterSeconds}
          onRetry={onRetry}
          retryLabel={messages.retry}
          waitLabel={messages.retryAfter}
        />
      ) : status === "capacity" ||
        status === "unavailable" ||
        status === "fatal" ? (
        <button type="button" onClick={onRetry}>
          {messages.retry}
        </button>
      ) : status === "invalid" && opportunityHref !== null ? (
        <a href={opportunityHref}>{messages.changeScope}</a>
      ) : status === "budget" && opportunityHref !== null ? (
        <a href={opportunityHref}>{messages.narrowScope}</a>
      ) : status === "notFound" && opportunityHref !== null ? (
        <a href={opportunityHref}>{messages.backToOpportunities}</a>
      ) : status === "invalid" ||
        status === "budget" ||
        status === "notFound" ? (
        <span aria-disabled="true">{messages.backUnavailable}</span>
      ) : null;
    return (
      <section
        className="market-analysis-view"
        aria-labelledby="market-analysis-heading"
      >
        <MarketAnalysisBack
          href={opportunityHref}
          label={messages.backToOpportunities}
          unavailableLabel={messages.backUnavailable}
          onClick={onBackToOpportunities}
        />
        <h2 id="market-analysis-heading" tabIndex={-1} ref={headingRef}>
          {messages.heading}
        </h2>
        <div
          className="market-analysis-error"
          role="alert"
        >
          <p>
            {status === "retired" && requestedAnalysisBuildId !== null
              ? messages.retiredBuild(requestedAnalysisBuildId)
              : messages[status === "success" ? "fatal" : status]}
          </p>
          {recoveryAction}
        </div>
      </section>
    );
  }

  const scopeDetails = () => (
    <div className="market-analysis-scope-details">
      <p>
        HS12 {analysis.context.product.code} · {productDescription}
      </p>
      <p>
        {analysis.context.exporter.name} ({analysis.context.exporter.code})
        {" → "}
        {analysis.context.market.name} ({analysis.context.market.code})
      </p>
      <p>
        <strong>
          {deploymentState === "current" ? messages.current : messages.retained}
        </strong>{" "}
        ·{" "}
        {freshness?.deploymentActivation.mode ===
        "LAST_VERIFIED_RESIDENT_FALLBACK"
          ? messages.activationFallback
          : messages.activationCurrent}{" "}
        · BACI {analysis.annualContext.baciRelease} ·{" "}
        {analysis.annualContext.finalizedWindow.start}–
        {analysis.annualContext.finalizedWindow.end} ·{" "}
        {analysis.annualContext.provisionalYear}
        {freshness === null
          ? null
          : ` · ${freshnessLabel(freshness.state, messages)}`}
      </p>
      <AnalysisShareLink locale={locale} task="market-analysis" />
    </div>
  );
  const navigateToArea = (
    event: MouseEvent<HTMLAnchorElement>,
    area: (typeof RENDERED_PRODUCT_AREAS)[number],
  ) => {
    const anchor = areaAnchor(area);
    const target = document.getElementById(anchor);
    if (target === null) {
      return;
    }
    event.preventDefault();
    window.history.pushState(window.history.state, "", `#${anchor}`);
    target.scrollIntoView({ block: "start" });
    setActiveArea(area);

    const heading = target.querySelector<HTMLElement>("h3");
    if (heading !== null) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };
  const areaLinks = () => (
    <ul>
      {RENDERED_PRODUCT_AREAS.map((area) => (
        <li key={area}>
          <a
            aria-current={activeArea === area ? "location" : undefined}
            href={`#${areaAnchor(area)}`}
            onClick={(event) => navigateToArea(event, area)}
          >
            {areaCopy.productAreas[area]}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      className="market-analysis-view"
      aria-labelledby="market-analysis-heading"
    >
      <header className="market-analysis-header">
        <MarketAnalysisBack
          href={opportunityHref}
          label={messages.backToOpportunities}
          unavailableLabel={messages.backUnavailable}
          onClick={onBackToOpportunities}
        />
        <h2 id="market-analysis-heading" tabIndex={-1} ref={headingRef}>
          {analysis.context.market.name} · {messages.heading}
        </h2>
        <div className="market-analysis-scope-desktop">{scopeDetails()}</div>
        <details className="market-analysis-scope-mobile">
          <summary>
            HS12 {analysis.context.product.code} ·{" "}
            {analysis.context.exporter.name} → {analysis.context.market.name} ·{" "}
            {messages.viewScope}
            {freshness === null || freshness.state === "LATEST_KNOWN"
              ? null
              : ` · ${freshnessLabel(freshness.state, messages)}`}
          </summary>
          {scopeDetails()}
        </details>
      </header>

      <nav
        className="market-analysis-area-nav"
        aria-label={messages.productAreaNavigationLabel}
      >
        <div className="market-analysis-area-nav-desktop">{areaLinks()}</div>
        <details className="market-analysis-area-nav-mobile">
          <summary>{messages.jumpToSection}</summary>
          {areaLinks()}
        </details>
      </nav>

      <MarketSnapshotPanel
        analysis={analysis}
        locale={locale}
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
      <RecentMomentumPanel
        analysis={analysis}
        locale={locale}
        datasetPackageIdentity={recentMomentumDatasetPackageIdentity}
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

function MarketAnalysisBack({
  href,
  label,
  unavailableLabel,
  onClick,
}: {
  href: string | null;
  label: string;
  unavailableLabel: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return href === null ? (
    <span className="market-analysis-back" aria-disabled="true">
      {unavailableLabel}
    </span>
  ) : (
    <a className="market-analysis-back" href={href} onClick={onClick}>
      ← {label}
    </a>
  );
}

function RateLimitRecovery({
  delaySeconds,
  onRetry,
  retryLabel,
  waitLabel,
}: {
  delaySeconds: number | null;
  onRetry: () => void;
  retryLabel: string;
  waitLabel: (seconds: number) => string;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(delaySeconds ?? 0);

  useEffect(() => {
    if (remainingSeconds <= 0) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRemainingSeconds((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearTimeout(timeout);
  }, [remainingSeconds]);

  return (
    <>
      {remainingSeconds > 0 ? <p>{waitLabel(remainingSeconds)}</p> : null}
      <button
        type="button"
        disabled={remainingSeconds > 0}
        onClick={onRetry}
      >
        {retryLabel}
      </button>
    </>
  );
}

function areaAnchor(area: (typeof MARKET_ANALYSIS_PRODUCT_AREAS)[number]): string {
  return area
    .replace(/([a-z])([A-Z])/gu, "$1-$2")
    .toLowerCase();
}

function freshnessLabel(
  state: EffectiveSourceFreshness["state"],
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  switch (state) {
    case "LATEST_KNOWN":
      return messages.freshnessLatest;
    case "UPDATE_IN_PROGRESS":
      return messages.freshnessUpdate;
    case "REFRESH_DELAYED":
      return messages.freshnessDelayed;
    case "CHECK_OVERDUE":
      return messages.freshnessOverdue;
  }
}
