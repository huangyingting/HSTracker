"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import type {
  CandidateMarket,
  CandidateMarketResult,
} from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import {
  CandidateMarketComparison,
  MAX_COMPARISON_CANDIDATES,
} from "./candidate-market-comparison";
import {
  CandidateMarketEvidence,
  candidateDisplayName,
  localizedConfidence,
} from "./candidate-market-evidence";
import { CandidateMarketExportAction } from "./candidate-market-export-action";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";

const copy = {
  en: {
    eyebrow: "Candidate Market workspace",
    title: "Define the analysis inputs.",
    lede: "Select an export economy and HS 2012 product, then load the complete canonical ranking.",
    analyze: "Analyze Candidate Markets",
    loading: "Loading the complete Candidate Market result…",
    refreshing: "Revalidating the current analysis release…",
    ranked: "Ranked Candidate Markets",
    candidateList: "Candidate Markets",
    analysisScope: "Analysis source scope",
    baciRelease: "BACI Release",
    sourceDate: "Source date",
    scoreWindow: "Candidate Market Score window",
    supportingEvidence: "Supporting evidence",
    valueBasis: "Value basis",
    nominalCurrentUsd: "Nominal current USD",
    finalizedYears: "Finalized Years",
    provisionalYear: "Provisional Year",
    confidence: "Data Confidence",
    emptyTitle: "No eligible Candidate Markets",
    emptyBody:
      "The selected context is valid, but no market has sufficient evidence in the finalized score window.",
    malformed:
      "These analysis inputs are invalid. Check the selected export economy and HS Product.",
    stale:
      "This analysis build has retired. Refresh the current fixture context.",
    capacity:
      "Analysis capacity is temporarily busy. The complete result was not loaded.",
    unavailable: "The compatible analysis artifact is temporarily unavailable.",
    fatal: "The analysis could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry complete analysis",
    disclaimer:
      "Use this workspace as a discovery aid rather than a recommendation. Validate customers, competition, regulation, logistics, and margins separately.",
    candidates: "Candidate Markets",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable:
      "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
  },
  "zh-Hans": {
    eyebrow: "候选市场工作区",
    title: "定义分析输入。",
    lede: "选择出口经济体和 HS 2012 产品，然后加载完整的规范排名。",
    analyze: "分析候选市场",
    loading: "正在加载完整的候选市场结果…",
    refreshing: "正在重新验证当前分析发布版本…",
    ranked: "候选市场排名",
    candidateList: "候选市场",
    analysisScope: "分析来源范围",
    baciRelease: "BACI 发布版本",
    sourceDate: "来源日期",
    scoreWindow: "候选市场评分窗口",
    supportingEvidence: "辅助证据",
    valueBasis: "价值口径",
    nominalCurrentUsd: "名义当期美元",
    finalizedYears: "计分定稿年份",
    provisionalYear: "暂定年份",
    confidence: "数据置信度",
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
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type SelectionSource = "restore" | "explicit";
type AnalysisStatus =
  | "idle"
  | "loading"
  | "refreshing"
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
  const currentManifestController = useRef<AbortController | null>(null);
  const canonicalRestorePending = useRef(true);
  const analyzedInputsInHistory = useRef(false);
  const [controlRestorationKey, setControlRestorationKey] = useState(0);
  const [exporter, setExporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [result, setResult] = useState<CandidateMarketResult | null>(null);
  const [comparedCandidateCodes, setComparedCandidateCodes] = useState<
    readonly string[]
  >([]);
  const [selectedCandidateCode, setSelectedCandidateCode] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [currentManifest, setCurrentManifest] =
    useState<CurrentAnalysisManifest | null>(null);
  const [currentManifestStatus, setCurrentManifestStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");

  const loadCurrentManifest = useCallback(
    async (signal: AbortSignal, revalidate = false) => {
      try {
        const manifest = await loadCurrentAnalysisManifest({
          fetcher: fetch,
          signal,
          revalidate,
        });
        setCurrentManifest(manifest);
        setCurrentManifestStatus("ready");
        return manifest;
      } catch (error) {
        if (signal.aborted) {
          return null;
        }
        console.error("Current analysis manifest request failed", error);
        setCurrentManifestStatus("failed");
        return null;
      }
    },
    [],
  );

  const beginCurrentManifestRequest = useCallback(
    (revalidate = false) => {
      currentManifestController.current?.abort();
      const controller = new AbortController();
      currentManifestController.current = controller;
      const promise = loadCurrentManifest(
        controller.signal,
        revalidate,
      ).finally(() => {
        if (currentManifestController.current === controller) {
          currentManifestController.current = null;
        }
      });
      return { controller, promise };
    },
    [loadCurrentManifest],
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void beginCurrentManifestRequest(false).promise,
      0,
    );
    return () => {
      window.clearTimeout(timeout);
      currentManifestController.current?.abort();
    };
  }, [beginCurrentManifestRequest]);

  const recoverRetiredAnalysis = useCallback(async () => {
    if (currentManifest === null) {
      return;
    }
    analysisController.current?.abort();
    setStatus("refreshing");
    const { controller, promise } = beginCurrentManifestRequest(true);
    const discovered = await promise;
    if (controller.signal.aborted || discovered === null) {
      if (!controller.signal.aborted) {
        setStatus("stale");
      }
      return;
    }

    requestSequence.current += 1;
    canonicalRestorePending.current = true;
    analyzedInputsInHistory.current = false;
    setCurrentManifest(discovered);
    setExporter(null);
    setProduct(null);
    setResult(null);
    setComparedCandidateCodes([]);
    setSelectedCandidateCode(null);
    setStatus("idle");
    setControlRestorationKey((current) => current + 1);
  }, [beginCurrentManifestRequest, currentManifest]);

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    setResult(null);
    setComparedCandidateCodes([]);
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
    if (exporter === null || product === null || currentManifest === null) {
      return;
    }

    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    analyzedInputsInHistory.current = true;
    setResult(null);
    setComparedCandidateCodes([]);
    setSelectedCandidateCode(null);
    setStatus("loading");

    try {
      const parameters = new URLSearchParams({
        exporter: exporter.code,
        product: product.code,
      });
      const response = await fetch(
        `/api/v1/analyses/${currentManifest.analysisBuildId}/candidate-markets?${parameters}`,
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

      if (
        completeResult.analysisBuildId !== currentManifest.analysisBuildId ||
        completeResult.provenance.baciRelease !==
          currentManifest.source.baciRelease ||
        completeResult.provenance.artifactSha256 !==
          currentManifest.source.artifact.sha256
      ) {
        throw new TypeError(
          "The analysis result does not match the discovered current manifest.",
        );
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
      if (controller.signal.aborted || requestSequence.current !== sequence) {
        return;
      }
      console.error("Candidate Market workspace request failed", error);
      setStatus("fatal");
    }
  }, [currentManifest, exporter, product]);

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

  useLayoutEffect(() => {
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
      setComparedCandidateCodes([]);
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

  function toggleCandidateComparison(candidate: CandidateMarket) {
    setComparedCandidateCodes((current) =>
      current.includes(candidate.economy.code)
        ? current.filter((code) => code !== candidate.economy.code)
        : current.length < MAX_COMPARISON_CANDIDATES
          ? [...current, candidate.economy.code]
          : current,
    );
  }

  const selectedCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === selectedCandidateCode,
    ) ?? null;

  return (
    <section
      className="analysis-workspace"
      id="discovery"
      tabIndex={-1}
      aria-labelledby="workspace-title"
    >
      <div className="workspace-intro">
        <p>{messages.eyebrow}</p>
        <h2 id="workspace-title">{messages.title}</h2>
        <p>{messages.lede}</p>
      </div>

      {currentManifest === null ? (
        <div
          className={`analysis-state ${
            currentManifestStatus === "loading"
              ? "analysis-loading"
              : "analysis-error"
          }`}
          role={currentManifestStatus === "failed" ? "alert" : "status"}
        >
          {currentManifestStatus === "loading" ? (
            <>
              <span aria-hidden="true" />
              {messages.loadingCurrent}
            </>
          ) : (
            <>
              <p>{messages.currentUnavailable}</p>
              <button
                type="button"
                onClick={() => {
                  setCurrentManifestStatus("loading");
                  void beginCurrentManifestRequest(false).promise;
                }}
              >
                {messages.retryCurrent}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="analysis-controls">
            <EconomyCombobox
              key={`economy-${controlRestorationKey}`}
              analysisBuildId={currentManifest.analysisBuildId}
              locale={locale}
              onSelectionChange={handleExporterSelection}
              onRetiredBuild={recoverRetiredAnalysis}
            />
            <ProductCombobox
              key={`product-${controlRestorationKey}`}
              productSearchBuildId={currentManifest.productSearchBuildId}
              locale={locale}
              onSelectionChange={handleProductSelection}
              onRetiredBuild={recoverRetiredAnalysis}
            />
            <button
              className="analyze-button"
              type="button"
              disabled={
                exporter === null ||
                product === null ||
                status === "loading" ||
                status === "refreshing"
              }
              onClick={() => void analyzeCandidateMarkets()}
            >
              {messages.analyze}
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <SourceScope
            manifest={currentManifest}
            result={result}
            locale={locale}
          />
        </>
      )}

      {status === "loading" || status === "refreshing" ? (
        <div className="analysis-state analysis-loading" role="status">
          <span aria-hidden="true" />
          {messages[status]}
        </div>
      ) : null}

      {(status === "success" || status === "empty") && result !== null ? (
        <>
          <CandidateMarketExportAction
            result={result}
            locale={locale}
            onManifestRevalidated={setCurrentManifest}
          />
          <AnalysisShareLink locale={locale} />
        </>
      ) : null}

      {status === "success" && result !== null && selectedCandidate !== null ? (
        <>
          <div className="candidate-workspace">
            <section
              className="candidate-ranking"
              aria-labelledby="ranking-title"
            >
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
                        <strong>
                          {candidateDisplayName(candidate, locale)}
                        </strong>
                        <small>
                          BACI {candidate.economy.code} · {messages.confidence}:{" "}
                          {localizedConfidence(
                            candidate.confidence.label,
                            locale,
                          )}
                        </small>
                        <span
                          className="candidate-score-bar"
                          aria-hidden="true"
                        >
                          <span style={{ width: `${candidate.score}%` }} />
                        </span>
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

            <CandidateMarketEvidence
              candidate={selectedCandidate}
              result={result}
              locale={locale}
              isCompared={comparedCandidateCodes.includes(
                selectedCandidate.economy.code,
              )}
              comparisonFull={
                comparedCandidateCodes.length >= MAX_COMPARISON_CANDIDATES
              }
              onToggleComparison={toggleCandidateComparison}
            />
          </div>
          <CandidateMarketComparison
            result={result}
            comparedCodes={comparedCandidateCodes}
            locale={locale}
            onRemove={(code) =>
              setComparedCandidateCodes((current) =>
                current.filter((candidateCode) => candidateCode !== code),
              )
            }
          />
        </>
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
                  void recoverRetiredAnalysis();
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
