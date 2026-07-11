"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import { PUBLIC_ANALYSIS_BUILD_ID } from "../domain/candidate-market/analysis-config";
import type {
  CandidateMarket,
  CandidateMarketResult,
  EconomyIdentity,
} from "../domain/candidate-market/result";
import type { EconomyRecord } from "../economy/economy-directory";
import { EconomyCombobox } from "./economy-combobox";
import { ProductCombobox } from "./product-combobox";

const copy = {
  en: {
    eyebrow: "Candidate Market workspace",
    title: "Define the analysis inputs.",
    lede:
      "Select an export economy and HS 2012 product, then load the complete canonical ranking.",
    analyze: "Analyze Candidate Markets",
    loading: "Loading the complete Candidate Market result…",
    ranked: "Ranked Candidate Markets",
    candidateList: "Candidate Markets",
    selectedEvidence: "Selected Candidate Market evidence",
    analysisScope: "Analysis source scope",
    baciRelease: "BACI Release",
    sourceDate: "Source date",
    scoreWindow: "Candidate Market Score window",
    supportingEvidence: "Supporting evidence",
    finalizedYears: "Finalized Years",
    provisionalYear: "Provisional Year",
    score: "Candidate Market Score",
    rank: "Rank",
    rankJoin: "of",
    confidence: "Data Confidence",
    percentile: "Percentile",
    finalizedEvidenceThrough: "Finalized Year evidence through",
    marketSize: "Mean finalized imports",
    marketGrowth: "Finalized annual growth",
    foothold: "Recorded exporter foothold",
    diversity: "Alternative-supplier diversity",
    neutral: "Neutral evidence",
    noFlow: "No recorded positive flow",
    emptyTitle: "No eligible Candidate Markets",
    emptyBody:
      "The selected context is valid, but no market has sufficient evidence in the finalized score window.",
    malformed:
      "These analysis inputs are invalid. Check the selected export economy and HS Product.",
    stale:
      "This analysis build has retired. Refresh the current fixture context.",
    capacity:
      "Analysis capacity is temporarily busy. The complete result was not loaded.",
    unavailable:
      "The compatible analysis artifact is temporarily unavailable.",
    fatal: "The analysis could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry complete analysis",
    disclaimer:
      "Use this workspace as a discovery aid rather than a recommendation. Validate customers, competition, regulation, logistics, and margins separately.",
    candidates: "Candidate Markets",
  },
  "zh-Hans": {
    eyebrow: "候选市场工作区",
    title: "定义分析输入。",
    lede: "选择出口经济体和 HS 2012 产品，然后加载完整的规范排名。",
    analyze: "分析候选市场",
    loading: "正在加载完整的候选市场结果…",
    ranked: "候选市场排名",
    candidateList: "候选市场",
    selectedEvidence: "所选候选市场证据",
    analysisScope: "分析来源范围",
    baciRelease: "BACI 发布版本",
    sourceDate: "来源日期",
    scoreWindow: "候选市场评分窗口",
    supportingEvidence: "辅助证据",
    finalizedYears: "计分定稿年份",
    provisionalYear: "暂定年份",
    score: "候选市场评分",
    rank: "排名",
    rankJoin: "/",
    confidence: "数据置信度",
    percentile: "百分位",
    finalizedEvidenceThrough: "计分定稿证据截至",
    marketSize: "计分定稿年份平均进口额",
    marketGrowth: "计分定稿年份年增长率",
    foothold: "已记录出口方市场基础",
    diversity: "替代供应方多样性",
    neutral: "中性证据",
    noFlow: "未记录正向流量",
    emptyTitle: "没有符合条件的候选市场",
    emptyBody: "所选输入有效，但计分定稿窗口内没有候选市场具备足够证据。",
    malformed: "该分析情境无效。请检查所选出口经济体和产品。",
    stale: "该分析构建已停用。请刷新当前测试情境。",
    capacity: "分析容量暂时繁忙。尚未加载完整结果。",
    unavailable: "兼容的分析工件暂时不可用。",
    fatal: "无法完成分析。",
    refresh: "刷新当前分析",
    retry: "重试完整分析",
    disclaimer:
      "这是发现辅助工具，而非建议。请另行验证客户、竞争、法规、物流和利润。",
    candidates: "个候选市场",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type SelectionSource = "restore" | "explicit";
type AnalysisStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "malformed"
  | "stale"
  | "capacity"
  | "unavailable"
  | "fatal";

export function DiscoveryWorkspace({ locale }: { locale: WorkspaceLocale }) {
  const messages = copy[locale];
  const requestSequence = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const canonicalRestorePending = useRef(true);
  const analyzedInputsInHistory = useRef(false);
  const [controlRestorationKey, setControlRestorationKey] = useState(0);
  const [exporter, setExporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [result, setResult] = useState<CandidateMarketResult | null>(null);
  const [selectedCandidateCode, setSelectedCandidateCode] = useState<
    string | null
  >(
    null,
  );
  const [status, setStatus] = useState<AnalysisStatus>("idle");

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    setResult(null);
    setSelectedCandidateCode(null);
    setStatus("idle");
    const url = new URL(window.location.href);
    url.searchParams.delete("market");
    window.history.replaceState(null, "", url);
  }, []);

  const prepareForExplicitContextChange = useCallback(() => {
    canonicalRestorePending.current = false;
    if (analyzedInputsInHistory.current) {
      window.history.pushState(null, "", window.location.href);
      analyzedInputsInHistory.current = false;
    }
    clearResult();
  }, [clearResult]);

  const handleExporterSelection = useCallback(
    (nextExporter: EconomyRecord | null, source: SelectionSource) => {
      setExporter(nextExporter);
      if (source === "explicit") {
        prepareForExplicitContextChange();
      }
    },
    [prepareForExplicitContextChange],
  );

  const handleProductSelection = useCallback(
    (nextProduct: ProductSearchProduct | null, source: SelectionSource) => {
      setProduct(nextProduct);
      if (source === "explicit") {
        prepareForExplicitContextChange();
      }
    },
    [prepareForExplicitContextChange],
  );

  const analyzeCandidateMarkets = useCallback(async () => {
    if (exporter === null || product === null) {
      return;
    }

    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    analyzedInputsInHistory.current = true;
    setResult(null);
    setSelectedCandidateCode(null);
    setStatus("loading");

    try {
      const parameters = new URLSearchParams({
        exporter: exporter.code,
        product: product.code,
      });
      const response = await fetch(
        `/api/v1/analyses/${PUBLIC_ANALYSIS_BUILD_ID}/candidate-markets?${parameters}`,
        { signal: controller.signal },
      );
      if (requestSequence.current !== sequence) {
        return;
      }
      if (!response.ok) {
        setStatus(analysisErrorStatus(response.status));
        return;
      }
      const completeResult = (await response.json()) as CandidateMarketResult;
      if (requestSequence.current !== sequence) {
        return;
      }

      setResult(completeResult);
      if (completeResult.candidates.length === 0) {
        setStatus("empty");
        return;
      }

      const requestedCandidateCode = new URL(
        window.location.href,
      ).searchParams.get("market");
      const initialCandidate =
        completeResult.candidates.find(
          ({ economy }) => economy.code === requestedCandidateCode,
        ) ?? completeResult.candidates[0];
      setSelectedCandidateCode(initialCandidate.economy.code);
      setStatus("success");
      const url = new URL(window.location.href);
      url.searchParams.set("market", initialCandidate.economy.code);
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestSequence.current !== sequence
      ) {
        return;
      }
      console.error("Candidate Market workspace request failed", error);
      setStatus("fatal");
    }
  }, [exporter, product]);

  useEffect(() => {
    if (
      !canonicalRestorePending.current ||
      exporter === null ||
      product === null
    ) {
      return;
    }

    canonicalRestorePending.current = false;
    const parameters = new URL(window.location.href).searchParams;
    if (
      parameters.get("exporter") === exporter.code &&
      parameters.get("revision") === "HS12" &&
      parameters.get("product") === product.code
    ) {
      const timeout = window.setTimeout(
        () => void analyzeCandidateMarkets(),
        0,
      );
      return () => window.clearTimeout(timeout);
    }
  }, [analyzeCandidateMarkets, exporter, product]);

  useEffect(() => {
    function restoreContextFromHistory() {
      const parameters = new URL(window.location.href).searchParams;
      const matchesLoadedContext =
        result !== null &&
        parameters.get("exporter") === result.query.exporter.code &&
        parameters.get("revision") === result.query.product.hsRevision &&
        parameters.get("product") === result.query.product.code;

      if (matchesLoadedContext) {
        const requestedCandidateCode = parameters.get("market");
        if (
          result.candidates.some(
            ({ economy }) => economy.code === requestedCandidateCode,
          )
        ) {
          setSelectedCandidateCode(requestedCandidateCode);
        }
        return;
      }

      analysisController.current?.abort();
      requestSequence.current += 1;
      analyzedInputsInHistory.current = false;
      canonicalRestorePending.current = true;
      setExporter(null);
      setProduct(null);
      setResult(null);
      setSelectedCandidateCode(null);
      setStatus("idle");
      setControlRestorationKey((current) => current + 1);
    }

    window.addEventListener("popstate", restoreContextFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreContextFromHistory);
  }, [result]);

  function selectCandidateMarket(candidate: CandidateMarket) {
    setSelectedCandidateCode(candidate.economy.code);
    const url = new URL(window.location.href);
    url.searchParams.set("market", candidate.economy.code);
    window.history.pushState(null, "", url);
  }

  const selectedCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === selectedCandidateCode,
    ) ?? null;

  return (
    <section className="analysis-workspace" aria-labelledby="workspace-title">
      <div className="workspace-intro">
        <p>{messages.eyebrow}</p>
        <h2 id="workspace-title">{messages.title}</h2>
        <p>{messages.lede}</p>
      </div>

      <div className="analysis-controls">
        <EconomyCombobox
          key={`economy-${controlRestorationKey}`}
          locale={locale}
          onSelectionChange={handleExporterSelection}
        />
        <ProductCombobox
          key={`product-${controlRestorationKey}`}
          locale={locale}
          onSelectionChange={handleProductSelection}
        />
        <button
          className="analyze-button"
          type="button"
          disabled={exporter === null || product === null || status === "loading"}
          onClick={() => void analyzeCandidateMarkets()}
        >
          {messages.analyze}
        </button>
      </div>

      {status === "loading" ? (
        <div className="analysis-state analysis-loading" role="status">
          <span aria-hidden="true" />
          {messages.loading}
        </div>
      ) : null}

      {result !== null ? (
        <AnalysisContextStrip result={result} locale={locale} />
      ) : null}

      {status === "success" && result !== null && selectedCandidate !== null ? (
        <div className="candidate-workspace">
          <section className="candidate-ranking" aria-labelledby="ranking-title">
            <div className="candidate-heading">
              <div>
                <p>{messages.eyebrow}</p>
                <h3 id="ranking-title">{messages.ranked}</h3>
              </div>
              <strong>
                {result.cohortSize} {messages.candidates}
              </strong>
            </div>
            <ol aria-label={messages.candidateList}>
              {result.candidates.map((candidate) => (
                <li key={candidate.economy.code}>
                  <button
                    type="button"
                    aria-pressed={
                      candidate.economy.code === selectedCandidateCode
                    }
                    onClick={() => selectCandidateMarket(candidate)}
                  >
                    <span className="candidate-rank">#{candidate.rank}</span>
                    <span>
                      <strong>{candidate.economy.name}</strong>
                      <small>
                        BACI {candidate.economy.code} ·{" "}
                        {messages.confidence}:{" "}
                        {localizedConfidence(candidate.confidence.label, locale)}
                      </small>
                    </span>
                    <span className="candidate-score">
                      {candidate.score}
                      <small>/100</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <CandidateEvidence
            candidate={selectedCandidate}
            cohortSize={result.cohortSize}
            exporter={result.query.exporter}
            locale={locale}
          />
        </div>
      ) : null}

      {status === "empty" ? (
        <div className="analysis-state" role="status">
          <h3>{messages.emptyTitle}</h3>
          <p>{messages.emptyBody}</p>
        </div>
      ) : null}

      {isErrorStatus(status) ? (
        <div className="analysis-state analysis-error" role="alert">
          <p>{messages[status]}</p>
          {status === "stale" || status === "capacity" ? (
            <button
              type="button"
              onClick={() => {
                if (status === "stale") {
                  window.location.reload();
                } else {
                  void analyzeCandidateMarkets();
                }
              }}
            >
              {status === "stale" ? messages.refresh : messages.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="workspace-disclaimer">{messages.disclaimer}</p>
    </section>
  );
}

function AnalysisContextStrip({
  result,
  locale,
}: {
  result: CandidateMarketResult;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <dl className="analysis-context" aria-label={messages.analysisScope}>
      <div>
        <dt>{messages.baciRelease}</dt>
        <dd>{result.provenance.baciRelease}</dd>
      </div>
      <div>
        <dt>{messages.sourceDate}</dt>
        <dd>{result.provenance.sourceUpdateDate}</dd>
      </div>
      <div>
        <dt>{messages.scoreWindow}</dt>
        <dd>
          {messages.finalizedYears} {result.provenance.scoreWindow.start}–
          {result.provenance.scoreWindow.end}
        </dd>
      </div>
      <div>
        <dt>{messages.supportingEvidence}</dt>
        <dd>
          {messages.provisionalYear} {result.provenance.provisionalYear}
        </dd>
      </div>
    </dl>
  );
}

function CandidateEvidence({
  candidate,
  cohortSize,
  exporter,
  locale,
}: {
  candidate: CandidateMarket;
  cohortSize: number;
  exporter: EconomyIdentity;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <section
      className="candidate-evidence"
      aria-label={messages.selectedEvidence}
    >
      <p className="evidence-kicker">{messages.selectedEvidence}</p>
      <h3>{candidate.economy.name}</h3>
      <div className="evidence-summary">
        <strong>
          {messages.score} {candidate.score}
        </strong>
        <span>
          {messages.rank} {candidate.rank} {messages.rankJoin} {cohortSize}
        </span>
        <span>
          {messages.confidence}:{" "}
          {localizedConfidence(candidate.confidence.label, locale)}{" "}
          {candidate.confidence.score}
        </span>
      </div>
      <dl className="basic-evidence">
        <EvidenceRow
          label={messages.marketSize}
          value={`USD ${candidate.components.marketSize.meanCurrentUsd}`}
          percentile={candidate.components.marketSize.percentile}
          percentileLabel={messages.percentile}
        />
        <EvidenceRow
          label={messages.marketGrowth}
          value={
            candidate.components.marketGrowth.state === "NEUTRAL"
              ? messages.neutral
              : candidate.components.marketGrowth.annualRate ?? messages.neutral
          }
          percentile={candidate.components.marketGrowth.percentile}
          percentileLabel={messages.percentile}
        />
        <EvidenceRow
          label={messages.foothold}
          value={
            candidate.components.recordedFoothold.bilateralFlowState ===
            "NO_RECORDED_POSITIVE_FLOW"
              ? messages.noFlow
              : candidate.components.recordedFoothold.share
          }
          percentile={candidate.components.recordedFoothold.percentile}
          percentileLabel={messages.percentile}
        />
        <EvidenceRow
          label={messages.diversity}
          value={
            candidate.components.supplierDiversity.state === "NEUTRAL"
              ? messages.neutral
              : candidate.components.supplierDiversity.index ?? messages.neutral
          }
          percentile={candidate.components.supplierDiversity.percentile}
          percentileLabel={messages.percentile}
        />
      </dl>
      <p className="evidence-source">
        {exporter.name} · HS 2012 · {messages.finalizedEvidenceThrough}{" "}
        {candidate.latestFinalizedObservedYear}
      </p>
    </section>
  );
}

function EvidenceRow({
  label,
  value,
  percentile,
  percentileLabel,
}: {
  label: string;
  value: string;
  percentile: number;
  percentileLabel: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        <span>
          {percentileLabel} {percentile}
        </span>
      </dd>
    </div>
  );
}

function localizedConfidence(
  label: CandidateMarket["confidence"]["label"],
  locale: WorkspaceLocale,
): string {
  if (locale === "en") {
    return label;
  }
  return {
    HIGH: "高",
    MEDIUM: "中",
    LOW: "低",
  }[label];
}

function analysisErrorStatus(status: number): AnalysisStatus {
  if (status === 400 || status === 404) {
    return "malformed";
  }
  if (status === 410) {
    return "stale";
  }
  if (status === 429) {
    return "capacity";
  }
  if (status === 503) {
    return "unavailable";
  }
  return "fatal";
}

function isErrorStatus(
  status: AnalysisStatus,
): status is "malformed" | "stale" | "capacity" | "unavailable" | "fatal" {
  return (
    status === "malformed" ||
    status === "stale" ||
    status === "capacity" ||
    status === "unavailable" ||
    status === "fatal"
  );
}
