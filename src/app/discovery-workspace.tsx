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
    title: "Define one analysis context.",
    lede:
      "Select an export economy and HS 2012 product, then load the complete canonical ranking.",
    analyze: "Analyze markets",
    loading: "Loading the complete Candidate Market result…",
    ranked: "Ranked Candidate Markets",
    selectedEvidence: "Selected Candidate Market evidence",
    score: "Score",
    rank: "Rank",
    confidence: "Data Confidence",
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
      "This analysis context is invalid. Check the selected exporter and product.",
    stale:
      "This analysis build has retired. Refresh the current fixture context.",
    capacity:
      "Analysis capacity is temporarily busy. The complete result was not loaded.",
    unavailable:
      "The compatible analysis artifact is temporarily unavailable.",
    fatal: "The analysis could not be completed.",
    retry: "Retry complete analysis",
    disclaimer:
      "Use this workspace as a discovery aid rather than a recommendation. Validate customers, competition, regulation, logistics, and margins separately.",
    candidates: "markets",
  },
  "zh-Hans": {
    eyebrow: "候选市场工作区",
    title: "定义一个分析情境。",
    lede: "选择出口经济体和 HS 2012 产品，然后加载完整的规范排名。",
    analyze: "分析市场",
    loading: "正在加载完整的候选市场结果…",
    ranked: "候选市场排名",
    selectedEvidence: "所选候选市场证据",
    score: "评分",
    rank: "排名",
    confidence: "数据置信度",
    marketSize: "最终年份平均进口额",
    marketGrowth: "最终年份年增长率",
    foothold: "已记录出口方市场基础",
    diversity: "替代供应方多样性",
    neutral: "中性证据",
    noFlow: "未记录正向流量",
    emptyTitle: "没有符合条件的候选市场",
    emptyBody: "所选情境有效，但最终评分窗口内没有市场具备足够证据。",
    malformed: "该分析情境无效。请检查所选出口经济体和产品。",
    stale: "该分析构建已停用。请刷新当前测试情境。",
    capacity: "分析容量暂时繁忙。尚未加载完整结果。",
    unavailable: "兼容的分析工件暂时不可用。",
    fatal: "无法完成分析。",
    retry: "重试完整分析",
    disclaimer:
      "这是发现辅助工具，而非建议。请另行验证客户、竞争、法规、物流和利润。",
    candidates: "个市场",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type SelectionSource = "restore" | "user";
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
  const [exporter, setExporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [result, setResult] = useState<CandidateMarketResult | null>(null);
  const [selectedMarketCode, setSelectedMarketCode] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<AnalysisStatus>("idle");

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    setResult(null);
    setSelectedMarketCode(null);
    setStatus("idle");
    const url = new URL(window.location.href);
    url.searchParams.delete("market");
    window.history.replaceState(null, "", url);
  }, []);

  const handleExporterSelection = useCallback(
    (nextExporter: EconomyRecord | null, source: SelectionSource) => {
      setExporter(nextExporter);
      if (source === "user") {
        canonicalRestorePending.current = false;
        clearResult();
      }
    },
    [clearResult],
  );

  const handleProductSelection = useCallback(
    (nextProduct: ProductSearchProduct | null, source: SelectionSource) => {
      setProduct(nextProduct);
      if (source === "user") {
        canonicalRestorePending.current = false;
        clearResult();
      }
    },
    [clearResult],
  );

  const analyzeMarkets = useCallback(async () => {
    if (exporter === null || product === null) {
      return;
    }

    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setResult(null);
    setSelectedMarketCode(null);
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

      const requestedMarket = new URL(
        window.location.href,
      ).searchParams.get("market");
      const initialMarket =
        completeResult.candidates.find(
          ({ economy }) => economy.code === requestedMarket,
        ) ?? completeResult.candidates[0];
      setSelectedMarketCode(initialMarket.economy.code);
      setStatus("success");
      const url = new URL(window.location.href);
      url.searchParams.set("market", initialMarket.economy.code);
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
      const timeout = window.setTimeout(() => void analyzeMarkets(), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [analyzeMarkets, exporter, product]);

  useEffect(() => {
    function restoreMarketFromHistory() {
      if (result === null) {
        return;
      }
      const requestedMarket = new URL(window.location.href).searchParams.get(
        "market",
      );
      if (
        result.candidates.some(
          ({ economy }) => economy.code === requestedMarket,
        )
      ) {
        setSelectedMarketCode(requestedMarket);
      }
    }

    window.addEventListener("popstate", restoreMarketFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreMarketFromHistory);
  }, [result]);

  function selectMarket(candidate: CandidateMarket) {
    setSelectedMarketCode(candidate.economy.code);
    const url = new URL(window.location.href);
    url.searchParams.set("market", candidate.economy.code);
    window.history.pushState(null, "", url);
  }

  const selectedMarket =
    result?.candidates.find(
      ({ economy }) => economy.code === selectedMarketCode,
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
          locale={locale}
          onSelectionChange={handleExporterSelection}
        />
        <ProductCombobox
          locale={locale}
          onSelectionChange={handleProductSelection}
        />
        <button
          className="analyze-button"
          type="button"
          disabled={exporter === null || product === null || status === "loading"}
          onClick={() => void analyzeMarkets()}
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

      {status === "success" && result !== null && selectedMarket !== null ? (
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
            <ol aria-label="Candidate Markets">
              {result.candidates.map((candidate) => (
                <li key={candidate.economy.code}>
                  <button
                    type="button"
                    aria-pressed={
                      candidate.economy.code === selectedMarketCode
                    }
                    onClick={() => selectMarket(candidate)}
                  >
                    <span className="candidate-rank">#{candidate.rank}</span>
                    <span>
                      <strong>{candidate.economy.name}</strong>
                      <small>
                        BACI {candidate.economy.code} ·{" "}
                        {candidate.confidence.label} {messages.confidence}
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
            candidate={selectedMarket}
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
          {status === "stale" ||
          status === "capacity" ||
          status === "unavailable" ? (
            <button type="button" onClick={() => void analyzeMarkets()}>
              {messages.retry}
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
}: {
  result: CandidateMarketResult;
  locale: WorkspaceLocale;
}) {
  return (
    <dl className="analysis-context" aria-label="Analysis source scope">
      <div>
        <dt>BACI</dt>
        <dd>{result.provenance.baciRelease}</dd>
      </div>
      <div>
        <dt>Source date</dt>
        <dd>{result.provenance.sourceUpdateDate}</dd>
      </div>
      <div>
        <dt>Score window</dt>
        <dd>
          Finalized {result.provenance.scoreWindow.start}–
          {result.provenance.scoreWindow.end}
        </dd>
      </div>
      <div>
        <dt>Supporting evidence</dt>
        <dd>Provisional {result.provenance.provisionalYear}</dd>
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
          {messages.rank} {candidate.rank} of {cohortSize}
        </span>
        <span>
          {messages.confidence}: {candidate.confidence.label}{" "}
          {candidate.confidence.score}
        </span>
      </div>
      <dl className="basic-evidence">
        <EvidenceRow
          label={messages.marketSize}
          value={`USD ${candidate.components.marketSize.meanCurrentUsd}`}
          percentile={candidate.components.marketSize.percentile}
        />
        <EvidenceRow
          label={messages.marketGrowth}
          value={
            candidate.components.marketGrowth.state === "NEUTRAL"
              ? messages.neutral
              : candidate.components.marketGrowth.annualRate ?? messages.neutral
          }
          percentile={candidate.components.marketGrowth.percentile}
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
        />
        <EvidenceRow
          label={messages.diversity}
          value={
            candidate.components.supplierDiversity.state === "NEUTRAL"
              ? messages.neutral
              : candidate.components.supplierDiversity.index ?? messages.neutral
          }
          percentile={candidate.components.supplierDiversity.percentile}
        />
      </dl>
      <p className="evidence-source">
        {exporter.name} · HS 2012 · finalized evidence through{" "}
        {candidate.latestFinalizedObservedYear}
      </p>
    </section>
  );
}

function EvidenceRow({
  label,
  value,
  percentile,
}: {
  label: string;
  value: string;
  percentile: number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        <span>Percentile {percentile}</span>
      </dd>
    </div>
  );
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
