"use client";

import type { ReactNode } from "react";

import type { MarketInvestigationCandidate } from "../domain/opportunity-discovery/result";
import { shouldHandleMarketAnalysisClick } from "./market-analysis-navigation";
import {
  marketAnalysisActionLabel,
  opportunityTypeLabel,
} from "./opportunity-row-presentation";
import type { TradeAnalysisLocale } from "./trade-analysis-context";

const copy = {
  en: {
    investigationPriority: "Investigation Priority",
    marketAttractiveness: "Market Attractiveness",
    exporterFit: "Exporter Fit",
    confidence: "Data Confidence",
    coverage: "Coverage",
    observed: "observed",
    missing: "missing",
    analyzeMarket: "Analyze this market",
  },
  "zh-Hans": {
    investigationPriority: "调查优先级",
    marketAttractiveness: "市场吸引力",
    exporterFit: "出口方匹配度",
    confidence: "数据置信度",
    coverage: "覆盖",
    observed: "已观察",
    missing: "缺失",
    analyzeMarket: "分析此市场",
  },
} as const;

export function OpportunityCandidateRow({
  candidate,
  locale,
  leading,
  leadingClassName,
  summaryClassName,
  actionId,
  href,
  onOpen,
}: {
  candidate: MarketInvestigationCandidate;
  locale: TradeAnalysisLocale;
  leading: ReactNode;
  leadingClassName?: string;
  summaryClassName: string;
  actionId: string;
  href: string | null;
  onOpen: () => void;
}) {
  const messages = copy[locale];
  return (
    <li>
      <div className={summaryClassName}>
        <span className={leadingClassName}>{leading}</span>
        <span>
          <span className="opportunity-row-identities">
            <strong>
              HS12 {candidate.product.code} · {candidate.product.descriptionEn}
            </strong>
            <strong>{candidate.market.name}</strong>
          </span>
          <small>{opportunityTypeLabel(candidate, locale)}</small>
          <span className="opportunity-row-metrics">
            <span>
              {messages.marketAttractiveness}{" "}
              {candidate.marketAttractiveness.display}
            </span>
            <span>
              {messages.exporterFit} {candidate.exporterFit.display}
            </span>
            <span>
              {messages.confidence}:{" "}
              {localizedConfidence(candidate.confidence.label, locale)}
            </span>
            <span>
              {messages.coverage}: {candidate.observedMarketYears.length}{" "}
              {messages.observed} · {candidate.missingMarketYears.length}{" "}
              {messages.missing}
            </span>
          </span>
          <span className="candidate-score-bar" aria-hidden="true">
            <span
              style={{
                width: `${candidate.investigationPriority.display}%`,
              }}
            />
          </span>
        </span>
        <span className="candidate-score">
          <small>{messages.investigationPriority}</small>{" "}
          {candidate.investigationPriority.display}
          <small>/100</small>
        </span>
      </div>
      {href === null ? null : (
        <a
          id={actionId}
          className="candidate-primary-action"
          aria-label={marketAnalysisActionLabel(candidate, locale)}
          href={href}
          onClick={(event) => {
            if (!shouldHandleMarketAnalysisClick(event)) {
              return;
            }
            event.preventDefault();
            onOpen();
          }}
        >
          {messages.analyzeMarket}
          <span aria-hidden="true"> →</span>
        </a>
      )}
    </li>
  );
}

function localizedConfidence(
  confidence: MarketInvestigationCandidate["confidence"]["label"],
  locale: TradeAnalysisLocale,
): string {
  if (locale === "en") {
    return confidence;
  }
  return confidence === "HIGH" ? "高" : confidence === "MEDIUM" ? "中" : "低";
}
