"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  MARKET_ANALYSIS_COPY,
  type MarketAnalysisLocale,
} from "../domain/market-analysis/copy";
import type { MarketAnalysisV1 } from "../domain/market-analysis/result";
import type {
  RecentTradeMomentumConfidenceReason,
  RecentTradeMomentumReasonCode,
} from "../domain/recent-trade-momentum/recent-trade-momentum-v1";
import type { RecentTradeMomentumV1Payload } from "../domain/trade-analytics/recent-trade-momentum-v1-adapter";
import type { DatasetPackageIdentity } from "../domain/trade-analytics/dataset-package";
import { resolveReviewedMonthlyReporter } from "../economy/reviewed-monthly-reporter";
import { loadRecentTradeMomentum } from "./recent-trade-momentum-client";

type MomentumRequestState =
  | Readonly<{ contextKey: string; status: "loading" }>
  | Readonly<{ contextKey: string; status: "failed" }>
  | Readonly<{
      contextKey: string;
      status: "ready";
      payload: RecentTradeMomentumV1Payload;
    }>;

const copy = {
  en: {
    boundaryLabel: "Adjacent monthly evidence",
    boundary:
      "Monthly evidence never changes annual evidence, Candidate Market Score, Investigation Priority, rank, or Data Confidence.",
    loading: "Loading Recent Momentum after annual Market Analysis…",
    unsupportedMarket: "Unsupported market",
    unsupportedMarketBody:
      "This market has no reviewed ISO3-to-ISO2 monthly reporter mapping. HS Tracker does not guess one.",
    unavailable: "Monthly capability unavailable",
    unavailableBody:
      "This deployment does not publish a Recent Momentum Dataset Package. Annual Market Analysis remains available.",
    failed:
      "Recent Momentum could not be loaded. Annual Market Analysis remains available.",
    retry: "Retry monthly evidence",
    signal: "Signal",
    coverage: "Coverage State",
    reporter: "Reporting market",
    product: "HS Product",
    recentPeriod: "Recent comparison months",
    baselinePeriod: "Prior-year comparison months",
    values: "Recorded comparison values",
    cutoff: "Cutoff month",
    currency: "Currency",
    history: "Recorded history",
    confidence: "Monthly confidence",
    mapping: "Product mapping",
    mappingDirect: "Direct exact reviewed correspondence",
    mappingMultiStep: "Multi-step exact reviewed correspondence",
    mappingUnsupported: "No exact complete reviewed correspondence",
    reasons: "Reasons",
    sourceVintage: "Monthly Source Vintage",
    monthlyPackage: "Monthly package",
    analysisIdentity: "Analysis Identity",
    datasetPackageIdentity: "Dataset Package identity",
    notAvailable: "Not available",
    notSignalled: "Not signalled",
    months: "months",
    recentValue: "recent",
    baselineValue: "prior year",
    risingFast: "Rising fast",
    rising: "Rising",
    stable: "Broadly stable",
    falling: "Falling",
    fallingFast: "Falling fast",
    supportedNoSignal: "Supported coverage — no signal",
    notObserved: "Not observed",
    suppressed: "Suppressed or reallocated",
    unsupportedProduct: "Unsupported product mapping",
    sourceUnavailable: "Source unavailable",
    insufficientCompleteHistory:
      "Fewer than 24 eligible complete months are available.",
    insufficientRecordedMonths:
      "Fewer than 18 months contain recorded positive evidence.",
    missingComparisonMonth:
      "At least one comparison month was not observed.",
    smallBase: "The comparison base is below the published EUR threshold.",
    windowConcentration:
      "One month exceeds the published comparison-window concentration cap.",
    suppressedReason:
      "At least one monthly observation was suppressed or reallocated by the source.",
    classificationBreak:
      "The reviewed product correspondence contains a classification break.",
    unsupportedProductReason:
      "The HS12 product has no exact complete reviewed monthly correspondence.",
    unsupportedMarketReason:
      "The market is outside the reviewed monthly reporter mapping.",
    sourceUnavailableReason:
      "The monthly source is unavailable for this reporting context.",
    recordedHistory20To23:
      "Only 20–23 of the expected 24 history months contain recorded evidence.",
    recordedHistory18To19:
      "Only 18–19 of the expected 24 history months contain recorded evidence.",
    preliminaryComparisonMonth:
      "At least one comparison month is preliminary under the source schedule.",
    multiStepCorrespondence:
      "The exact reviewed product correspondence uses a multi-step chain.",
    materialSourceRevision:
      "The monthly source materially revised the comparison window.",
    noReasons: "No scoped coverage or confidence limitation.",
    confidenceHigh: "High",
    confidenceMedium: "Medium",
    confidenceLow: "Low",
  },
  "zh-Hans": {
    boundaryLabel: "相邻月度证据",
    boundary:
      "月度证据绝不会改变年度证据、候选市场评分、调查优先级、排名或数据置信度。",
    loading: "年度市场分析可用后，正在加载近期动量…",
    unsupportedMarket: "不支持的市场",
    unsupportedMarketBody:
      "该市场没有经审查的 ISO3 到 ISO2 月度申报方映射。HS Tracker 不会猜测映射。",
    unavailable: "月度功能不可用",
    unavailableBody:
      "此部署未发布近期动量数据集包。年度市场分析仍然可用。",
    failed: "无法加载近期动量。年度市场分析仍然可用。",
    retry: "重试月度证据",
    signal: "信号",
    coverage: "覆盖状态",
    reporter: "申报市场",
    product: "HS 产品",
    recentPeriod: "近期比较月份",
    baselinePeriod: "上年同期比较月份",
    values: "已记录比较值",
    cutoff: "截止月份",
    currency: "币种",
    history: "已记录历史",
    confidence: "月度置信度",
    mapping: "产品映射",
    mappingDirect: "直接精确审查对应关系",
    mappingMultiStep: "多步精确审查对应关系",
    mappingUnsupported: "没有完整、精确且经审查的对应关系",
    reasons: "原因",
    sourceVintage: "月度来源版本",
    monthlyPackage: "月度数据包",
    analysisIdentity: "分析标识",
    datasetPackageIdentity: "数据集包标识",
    notAvailable: "不可用",
    notSignalled: "未生成信号",
    months: "个月",
    recentValue: "近期",
    baselineValue: "上年同期",
    risingFast: "快速上升",
    rising: "上升",
    stable: "大致稳定",
    falling: "下降",
    fallingFast: "快速下降",
    supportedNoSignal: "覆盖受支持 — 未生成信号",
    notObserved: "未观测",
    suppressed: "已抑制或重新分配",
    unsupportedProduct: "不支持的产品映射",
    sourceUnavailable: "来源不可用",
    insufficientCompleteHistory: "可用的完整合格月份少于 24 个月。",
    insufficientRecordedMonths: "包含已记录正向证据的月份少于 18 个月。",
    missingComparisonMonth: "至少一个比较月份未被观测。",
    smallBase: "比较基数低于已公布的欧元阈值。",
    windowConcentration: "单个月份超过已公布的比较窗口集中度上限。",
    suppressedReason: "至少一个月度观测被来源抑制或重新分配。",
    classificationBreak: "经审查的产品对应关系存在分类中断。",
    unsupportedProductReason: "该 HS12 产品没有完整、精确且经审查的月度对应关系。",
    unsupportedMarketReason: "该市场不在经审查的月度申报方映射范围内。",
    sourceUnavailableReason: "该申报情境的月度来源不可用。",
    recordedHistory20To23: "预期 24 个月中仅有 20–23 个月包含已记录证据。",
    recordedHistory18To19: "预期 24 个月中仅有 18–19 个月包含已记录证据。",
    preliminaryComparisonMonth: "至少一个比较月份按来源时间表仍属初步数据。",
    multiStepCorrespondence: "精确且经审查的产品对应关系使用多步链。",
    materialSourceRevision: "月度来源对比较窗口进行了重大修订。",
    noReasons: "没有范围内的覆盖或置信度限制。",
    confidenceHigh: "高",
    confidenceMedium: "中",
    confidenceLow: "低",
  },
} as const;

export function RecentMomentumPanel({
  analysis,
  locale,
  datasetPackageIdentity,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  datasetPackageIdentity: DatasetPackageIdentity | null;
}) {
  const messages = copy[locale];
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const reporter = useMemo(
    () => resolveReviewedMonthlyReporter(analysis.context.market.iso3),
    [analysis.context.market.iso3],
  );
  const contextKey = [
    analysis.context.analysisBuildId,
    analysis.context.product.code,
    reporter.state === "REVIEWED" ? reporter.iso2 : "unsupported",
    datasetPackageIdentity ?? "unavailable",
  ].join(":");
  const requestSequence = useRef(0);
  const [retrySequence, setRetrySequence] = useState(0);
  const [requestState, setRequestState] = useState<MomentumRequestState>({
    contextKey,
    status: "loading",
  });

  useEffect(() => {
    if (
      reporter.state !== "REVIEWED" ||
      datasetPackageIdentity === null
    ) {
      return;
    }
    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    void loadRecentTradeMomentum({
      analysisBuildId: analysis.context.analysisBuildId,
      reporterIso2: reporter.iso2,
      productCode: analysis.context.product.code,
      expectedDatasetPackageIdentity: datasetPackageIdentity,
      fetcher: fetch,
      signal: controller.signal,
    })
      .then((payload) => {
        if (
          !controller.signal.aborted &&
          requestSequence.current === sequence
        ) {
          setRequestState({ contextKey, status: "ready", payload });
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          requestSequence.current === sequence
        ) {
          console.error("Recent Momentum request failed", error);
          setRequestState({ contextKey, status: "failed" });
        }
      });
    return () => controller.abort();
  }, [
    analysis.context.analysisBuildId,
    analysis.context.product.code,
    contextKey,
    datasetPackageIdentity,
    reporter,
    retrySequence,
  ]);

  const visibleState =
    requestState.contextKey === contextKey
      ? requestState
      : ({ contextKey, status: "loading" } as const);

  return (
    <section
      className="market-analysis-area recent-momentum-area"
      id="recent-momentum"
      role="region"
      aria-labelledby="recent-momentum-heading"
    >
      <h3 id="recent-momentum-heading">
        {areaCopy.productAreas.recentMomentum}
      </h3>
      <p className="recent-momentum-boundary">
        <strong>{messages.boundaryLabel}.</strong> {messages.boundary}
      </p>
      <div
        className="recent-momentum-content"
        aria-live="polite"
        aria-atomic="true"
      >
        {reporter.state === "UNSUPPORTED_MARKET" ? (
          <MomentumBoundedState
            title={messages.unsupportedMarket}
            body={messages.unsupportedMarketBody}
            coverageState="UNSUPPORTED_MARKET"
            datasetPackageIdentity={datasetPackageIdentity}
            messages={messages}
          />
        ) : datasetPackageIdentity === null ? (
          <MomentumBoundedState
            title={messages.unavailable}
            body={messages.unavailableBody}
            coverageState="SOURCE_UNAVAILABLE"
            datasetPackageIdentity={null}
            messages={messages}
          />
        ) : visibleState.status === "loading" ? (
          <div className="recent-momentum-status" role="status">
            <span aria-hidden="true" />
            {messages.loading}
          </div>
        ) : visibleState.status === "failed" ? (
          <div className="recent-momentum-local-failure" role="status">
            <p>{messages.failed}</p>
            <button
              type="button"
              onClick={() => {
                setRequestState({ contextKey, status: "loading" });
                setRetrySequence((current) => current + 1);
              }}
            >
              {messages.retry}
            </button>
          </div>
        ) : (
          <MomentumEvidence
            payload={visibleState.payload}
            locale={locale}
            messages={messages}
          />
        )}
      </div>
    </section>
  );
}

function MomentumEvidence({
  payload,
  locale,
  messages,
}: {
  payload: RecentTradeMomentumV1Payload;
  locale: MarketAnalysisLocale;
  messages: (typeof copy)[MarketAnalysisLocale];
}) {
  const signal =
    payload.signalState === null
      ? coverageLabel(payload, messages)
      : signalLabel(payload.signalState, messages);
  const growth =
    payload.growthPercentDisplay === null
      ? ""
      : ` · ${payload.growthPercentDisplay}%`;
  const mapping =
    payload.coverageState === "UNSUPPORTED_PRODUCT_MAPPING"
      ? messages.mappingUnsupported
      : payload.confidenceReasons.includes(
            "MULTI_STEP_EXACT_CORRESPONDENCE",
          )
        ? messages.mappingMultiStep
        : messages.mappingDirect;
  return (
    <>
      <p className="recent-momentum-signal">
        <strong>{signal}</strong>
        {growth}
      </p>
      <dl className="market-evidence-ledger recent-momentum-facts">
        <Fact label={messages.coverage} value={payload.coverageState} />
        <Fact label={messages.reporter} value={payload.reporterIso2} />
        <Fact label={messages.product} value={`HS12 ${payload.hs12Code}`} />
        <Fact
          label={messages.recentPeriod}
          value={payload.recentMonths.join(", ")}
        />
        <Fact
          label={messages.baselinePeriod}
          value={payload.baselineMonths.join(", ")}
        />
        <Fact
          label={messages.values}
          value={`${messages.recentValue}: ${formatEuro(payload.recentValueEur, locale)} · ${messages.baselineValue}: ${formatEuro(payload.baselineValueEur, locale)}`}
        />
        <Fact label={messages.currency} value="EUR" />
        <Fact label={messages.cutoff} value={payload.cutoffMonth} />
        <Fact
          label={messages.history}
          value={`${payload.recordedHistoryMonths}/${payload.expectedHistoryMonths} ${messages.months}`}
        />
        <Fact
          label={messages.confidence}
          value={
            payload.confidence === null
              ? messages.notSignalled
              : confidenceLabel(payload.confidence, messages)
          }
        />
        <Fact label={messages.mapping} value={mapping} />
        <Fact
          label={messages.reasons}
          value={
            [
              ...payload.reasonCodes.map((reason) =>
                reasonLabel(reason, messages),
              ),
              ...payload.confidenceReasons.map((reason) =>
                confidenceReasonLabel(reason, messages),
              ),
            ].join(" ") || messages.noReasons
          }
        />
        <Fact
          label={messages.sourceVintage}
          value={payload.sourceVintageId}
          identity
        />
        <Fact
          label={messages.monthlyPackage}
          value={payload.monthlyPackageId}
          identity
        />
        <Fact
          label={messages.analysisIdentity}
          value={payload.analysisIdentity}
          identity
        />
        <Fact
          label={messages.datasetPackageIdentity}
          value={payload.datasetPackageIdentity}
          identity
        />
      </dl>
    </>
  );
}

function MomentumBoundedState({
  title,
  body,
  coverageState,
  datasetPackageIdentity,
  messages,
}: {
  title: string;
  body: string;
  coverageState: "UNSUPPORTED_MARKET" | "SOURCE_UNAVAILABLE";
  datasetPackageIdentity: DatasetPackageIdentity | null;
  messages: (typeof copy)[MarketAnalysisLocale];
}) {
  return (
    <div className="recent-momentum-bounded" role="status">
      <strong>{title}</strong>
      <p>{body}</p>
      <dl className="market-evidence-ledger">
        <Fact label={messages.coverage} value={coverageState} />
        <Fact
          label={messages.analysisIdentity}
          value={messages.notAvailable}
        />
        <Fact
          label={messages.datasetPackageIdentity}
          value={datasetPackageIdentity ?? messages.notAvailable}
          identity={datasetPackageIdentity !== null}
        />
      </dl>
    </div>
  );
}

function Fact({
  label,
  value,
  identity = false,
}: {
  label: string;
  value: string;
  identity?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={identity ? "market-analysis-identity" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function signalLabel(
  signal: NonNullable<RecentTradeMomentumV1Payload["signalState"]>,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  switch (signal) {
    case "RISING_FAST":
      return messages.risingFast;
    case "RISING":
      return messages.rising;
    case "BROADLY_STABLE":
      return messages.stable;
    case "FALLING":
      return messages.falling;
    case "FALLING_FAST":
      return messages.fallingFast;
  }
}

function coverageLabel(
  payload: RecentTradeMomentumV1Payload,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  if (payload.reasonCodes.includes("MISSING_COMPARISON_MONTH")) {
    return messages.notObserved;
  }
  if (payload.reasonCodes.includes("SUPPRESSED_OR_REALLOCATED")) {
    return messages.suppressed;
  }
  switch (payload.coverageState) {
    case "SUPPORTED":
    case "SUPPORTED_NO_SIGNAL":
      return messages.supportedNoSignal;
    case "NOT_OBSERVED":
      return messages.notObserved;
    case "SUPPRESSED_OR_REALLOCATED":
      return messages.suppressed;
    case "UNSUPPORTED_MARKET":
      return messages.unsupportedMarket;
    case "UNSUPPORTED_PRODUCT_MAPPING":
      return messages.unsupportedProduct;
    case "SOURCE_UNAVAILABLE":
      return messages.sourceUnavailable;
  }
}

function reasonLabel(
  reason: RecentTradeMomentumReasonCode,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  switch (reason) {
    case "INSUFFICIENT_COMPLETE_HISTORY":
      return messages.insufficientCompleteHistory;
    case "INSUFFICIENT_RECORDED_MONTHS":
      return messages.insufficientRecordedMonths;
    case "MISSING_COMPARISON_MONTH":
      return messages.missingComparisonMonth;
    case "SMALL_BASE":
      return messages.smallBase;
    case "WINDOW_CONCENTRATION":
      return messages.windowConcentration;
    case "SUPPRESSED_OR_REALLOCATED":
      return messages.suppressedReason;
    case "CLASSIFICATION_BREAK":
      return messages.classificationBreak;
    case "UNSUPPORTED_PRODUCT_MAPPING":
      return messages.unsupportedProductReason;
    case "UNSUPPORTED_MARKET":
      return messages.unsupportedMarketReason;
    case "SOURCE_UNAVAILABLE":
      return messages.sourceUnavailableReason;
  }
}

function confidenceReasonLabel(
  reason: RecentTradeMomentumConfidenceReason,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  switch (reason) {
    case "RECORDED_HISTORY_20_TO_23":
      return messages.recordedHistory20To23;
    case "RECORDED_HISTORY_18_TO_19":
      return messages.recordedHistory18To19;
    case "PRELIMINARY_COMPARISON_MONTH":
      return messages.preliminaryComparisonMonth;
    case "MULTI_STEP_EXACT_CORRESPONDENCE":
      return messages.multiStepCorrespondence;
    case "MATERIAL_SOURCE_REVISION":
      return messages.materialSourceRevision;
  }
}

function confidenceLabel(
  confidence: NonNullable<RecentTradeMomentumV1Payload["confidence"]>,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  switch (confidence) {
    case "HIGH":
      return messages.confidenceHigh;
    case "MEDIUM":
      return messages.confidenceMedium;
    case "LOW":
      return messages.confidenceLow;
  }
}

function formatEuro(
  value: string | null,
  locale: MarketAnalysisLocale,
): string {
  return value === null
    ? copy[locale].notAvailable
    : `EUR ${new Intl.NumberFormat(locale === "en" ? "en" : "zh-Hans").format(
        BigInt(value),
      )}`;
}
