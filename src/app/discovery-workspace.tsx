"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
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
import type { MarketAnalysisV1 } from "../domain/market-analysis/result";
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import {
  CandidateMarketComparison,
  MAX_COMPARISON_CANDIDATES,
} from "./candidate-market-comparison";
import {
  localizedConfidence,
  candidateDisplayName,
} from "./candidate-market-evidence";
import { CandidateMarketExportAction } from "./candidate-market-export-action";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import {
  loadMarketAnalysis,
} from "./market-analysis-client";
import {
  marketAnalysisStatusFromError,
  MarketAnalysisView,
  type MarketAnalysisStatus,
} from "./market-analysis-view";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withEconomyCode,
  withLocale,
  withoutPin,
  withPin,
  withProductCode,
  withRecipe,
  type CandidateMarketContext,
} from "./trade-analysis-context";

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
    rateLimit:
      "Candidate Market requests are temporarily limited. Wait a moment before retrying.",
    budget:
      "This Candidate Market request exceeds the complete-result size limit. Choose a different export economy or HS Product.",
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
    rateLimit: "候选市场请求暂时受限。请稍候再试。",
    budget:
      "该候选市场请求超出完整结果大小限制。请选择其他出口经济体或 HS 产品。",
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
  | "rateLimit"
  | "budget"
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
  const resolvedAnalysisBuildIdRef = useRef<string | null>(null);
  const marketAnalysisController = useRef<AbortController | null>(null);
  const marketAnalysisRequestSequence = useRef(0);
  const marketAnalysisHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingMarketAnalysisFocusRef = useRef(false);
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
  const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysisV1 | null>(
    null,
  );
  const [marketAnalysisStatus, setMarketAnalysisStatus] =
    useState<MarketAnalysisStatus>("loading");
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
    marketAnalysisController.current?.abort();
    setStatus("refreshing");
    const context = parseTradeAnalysisContext(window.location.href);
    const url = serializeTradeAnalysisContext(
      window.location.href,
      withoutPin(context),
    );
    window.history.replaceState(null, "", url);
    const { controller, promise } = beginCurrentManifestRequest(true);
    const discovered = await promise;
    if (controller.signal.aborted || discovered === null) {
      if (!controller.signal.aborted) {
        setStatus("stale");
      }
      return;
    }

    requestSequence.current += 1;
    marketAnalysisRequestSequence.current += 1;
    canonicalRestorePending.current = true;
    analyzedInputsInHistory.current = false;
    resolvedAnalysisBuildIdRef.current = null;
    setCurrentManifest(discovered);
    setExporter(null);
    setProduct(null);
    setResult(null);
    setComparedCandidateCodes([]);
    setSelectedCandidateCode(null);
    setStatus("idle");
    setMarketAnalysis(null);
    setMarketAnalysisStatus("loading");
    setControlRestorationKey((current) => current + 1);
  }, [beginCurrentManifestRequest, currentManifest]);

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    marketAnalysisController.current?.abort();
    resolvedAnalysisBuildIdRef.current = null;
    setResult(null);
    setComparedCandidateCodes([]);
    setSelectedCandidateCode(null);
    setStatus("idle");
    setMarketAnalysis(null);
    setMarketAnalysisStatus("loading");
    const context = parseTradeAnalysisContext(window.location.href);
    const nextContext: CandidateMarketContext =
      context.recipe === "candidate-market"
        ? { ...context, locale, focusedMarketCode: null, pin: null }
        : {
            recipe: "candidate-market",
            locale,
            productCode: null,
            pin: null,
            exporterCode: null,
            focusedMarketCode: null,
          };
    const url = serializeTradeAnalysisContext(window.location.href, nextContext);
    window.history.replaceState(null, "", url);
  }, [locale]);

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

  // Market Analysis fetch orchestration (issue #68 seam #2): one abort
  // controller and monotonic request sequence, exactly like the ranking
  // fetch above, so a rapid re-selection cancels the outstanding request
  // and a late (stale) response is never written to the page. Focus moves
  // to the Market Analysis heading only for an explicit selection, never
  // for the initial automatic selection or a background/history restore
  // (spec docs/spec/export-market-analysis-workspace-ui-design.md §16).
  const loadMarketAnalysisForCandidate = useCallback(
    async (candidateCode: string, focusHeading: boolean) => {
      const analysisBuildId = resolvedAnalysisBuildIdRef.current;
      if (analysisBuildId === null || exporter === null || product === null) {
        return;
      }
      marketAnalysisController.current?.abort();
      const controller = new AbortController();
      marketAnalysisController.current = controller;
      const sequence = marketAnalysisRequestSequence.current + 1;
      marketAnalysisRequestSequence.current = sequence;
      pendingMarketAnalysisFocusRef.current = focusHeading;
      setMarketAnalysisStatus("loading");
      setMarketAnalysis(null);
      try {
        const payload = await loadMarketAnalysis({
          analysisBuildId,
          exportEconomyCode: exporter.code,
          productCode: product.code,
          marketCode: candidateCode,
          fetcher: fetch,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          marketAnalysisRequestSequence.current !== sequence
        ) {
          return;
        }
        setMarketAnalysis(payload);
        setMarketAnalysisStatus("success");
      } catch (error) {
        if (
          controller.signal.aborted ||
          marketAnalysisRequestSequence.current !== sequence
        ) {
          return;
        }
        console.error("Market Analysis request failed", error);
        setMarketAnalysisStatus(marketAnalysisStatusFromError(error));
      }
    },
    [exporter, product],
  );

  // Focus transfer must happen after React commits the "success" heading
  // to the DOM, not synchronously inside the fetch callback above: the
  // loading/success/error branches each mount their own <h2>, so the ref
  // only points at the newly rendered heading once this effect runs
  // (spec docs/spec/export-market-analysis-workspace-ui-design.md §16,
  // "Explicit Analyze moves focus...background changes do not steal
  // focus").
  useLayoutEffect(() => {
    if (marketAnalysisStatus === "success" && pendingMarketAnalysisFocusRef.current) {
      pendingMarketAnalysisFocusRef.current = false;
      marketAnalysisHeadingRef.current?.focus();
    }
  }, [marketAnalysisStatus]);

  const analyzeCandidateMarkets = useCallback(async () => {
    if (exporter === null || product === null || currentManifest === null) {
      return;
    }

    const urlPin = parseTradeAnalysisContext(window.location.href).pin;
    const pinResolution = resolvePinnedContext(
      urlPin,
      currentManifest,
      "candidate-market",
    );
    if (pinResolution.state === "retired") {
      setStatus("stale");
      return;
    }
    // A retained pin executes its own exact analysisBuildId rather than
    // current's, reproducing its exact deterministic payload (see issue
    // #44); "current"/"unpinned" keep querying the live manifest's build
    // exactly as before.
    const analysisBuildId =
      pinResolution.state === "retained"
        ? pinResolution.deployment.analysisBuildId
        : currentManifest.analysisBuildId;

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
        `/api/v1/analyses/${analysisBuildId}/candidate-markets?${parameters}`,
        { signal: controller.signal },
      );
      if (requestSequence.current !== sequence) {
        return;
      }
      if (!response.ok) {
        setStatus(
          analysisErrorStatus(
            response.status,
            analysisErrorCode(await response.json()),
          ),
        );
        return;
      }
      const completeResult = (await response.json()) as CandidateMarketResult;
      if (requestSequence.current !== sequence) {
        return;
      }

      // A retained execution validates against that exact retained
      // build's own BACI Release/artifact identity (from
      // currentManifest.deploymentWindow) rather than current's, with the
      // same rigor as the "current" check below (see issue #44 "Pinned
      // URLs within the retention window reproduce exact Analysis
      // Identity").
      if (pinResolution.state === "retained") {
        const retainedIdentity = pinResolution.deployment;
        if (
          completeResult.analysisBuildId !== analysisBuildId ||
          completeResult.provenance.baciRelease !==
            retainedIdentity.baciRelease ||
          completeResult.provenance.artifactSha256 !==
            retainedIdentity.artifactSha256
        ) {
          throw new TypeError(
            "The analysis result does not match the discovered retained manifest.",
          );
        }
      } else if (
        completeResult.analysisBuildId !== analysisBuildId ||
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

      resolvedAnalysisBuildIdRef.current = analysisBuildId;

      const priorContext = parseTradeAnalysisContext(window.location.href);
      const requestedCandidateCode =
        priorContext.recipe === "candidate-market"
          ? priorContext.focusedMarketCode
          : null;
      const initialCandidate =
        completeResult.candidates.find(
          ({ economy }) => economy.code === requestedCandidateCode,
        ) ?? completeResult.candidates[0];
      setSelectedCandidateCode(initialCandidate.economy.code);
      setStatus("success");
      void loadMarketAnalysisForCandidate(initialCandidate.economy.code, false);
      const nextContext = withEconomyCode(
        withProductCode(
          withRecipe(priorContext, "candidate-market"),
          product.code,
        ),
        exporter.code,
      );
      if (nextContext.recipe === "candidate-market") {
        const baseContext = withLocale(
          {
            ...nextContext,
            focusedMarketCode: initialCandidate.economy.code,
          },
          locale,
        );
        // A retained execution keeps its own exact pin rather than
        // re-deriving current's live pin, so the canonical URL continues
        // to name the retained build it actually reproduced.
        const pinnedContext =
          pinResolution.state === "retained"
            ? { ...baseContext, pin: pinResolution.pin }
            : withPin(baseContext, currentManifest);
        const url = serializeTradeAnalysisContext(
          window.location.href,
          pinnedContext,
        );
        window.history.replaceState(null, "", url);
      }
    } catch (error) {
      if (controller.signal.aborted || requestSequence.current !== sequence) {
        return;
      }
      console.error("Candidate Market workspace request failed", error);
      setStatus("fatal");
    }
  }, [currentManifest, exporter, loadMarketAnalysisForCandidate, locale, product]);

  useEffect(() => {
    if (
      !canonicalRestorePending.current ||
      exporter === null ||
      product === null
    ) {
      return;
    }

    canonicalRestorePending.current = false;
    const context = parseTradeAnalysisContext(window.location.href);
    if (
      context.recipe === "candidate-market" &&
      context.exporterCode === exporter.code &&
      context.productCode === product.code
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
      const context = parseTradeAnalysisContext(window.location.href);
      const matchesLoadedContext =
        result !== null &&
        context.recipe === "candidate-market" &&
        context.exporterCode === result.query.exporter.code &&
        context.productCode === result.query.product.code;

      if (matchesLoadedContext) {
        const requestedCandidateCode =
          context.recipe === "candidate-market"
            ? context.focusedMarketCode
            : null;
        if (
          result.candidates.some(
            ({ economy }) => economy.code === requestedCandidateCode,
          )
        ) {
          setSelectedCandidateCode(requestedCandidateCode);
          if (requestedCandidateCode !== null) {
            void loadMarketAnalysisForCandidate(requestedCandidateCode, false);
          }
        }
        return;
      }

      analysisController.current?.abort();
      marketAnalysisController.current?.abort();
      requestSequence.current += 1;
      marketAnalysisRequestSequence.current += 1;
      analyzedInputsInHistory.current = false;
      canonicalRestorePending.current = true;
      resolvedAnalysisBuildIdRef.current = null;
      setExporter(null);
      setProduct(null);
      setResult(null);
      setComparedCandidateCodes([]);
      setSelectedCandidateCode(null);
      setStatus("idle");
      setMarketAnalysis(null);
      setMarketAnalysisStatus("loading");
      setControlRestorationKey((current) => current + 1);
    }

    window.addEventListener("popstate", restoreContextFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreContextFromHistory);
  }, [loadMarketAnalysisForCandidate, result]);

  const selectCandidateMarket = useCallback(
    (candidate: CandidateMarket) => {
      setSelectedCandidateCode(candidate.economy.code);
      void loadMarketAnalysisForCandidate(candidate.economy.code, true);
      const context = parseTradeAnalysisContext(window.location.href);
      if (context.recipe !== "candidate-market") {
        return;
      }
      const url = serializeTradeAnalysisContext(window.location.href, {
        ...context,
        focusedMarketCode: candidate.economy.code,
      });
      window.history.pushState(null, "", url);
    },
    [loadMarketAnalysisForCandidate],
  );

  const toggleCandidateComparison = useCallback((candidate: CandidateMarket) => {
    setComparedCandidateCodes((current) =>
      current.includes(candidate.economy.code)
        ? current.filter((code) => code !== candidate.economy.code)
        : current.length < MAX_COMPARISON_CANDIDATES
          ? [...current, candidate.economy.code]
          : current,
    );
  }, []);

  const removeComparedCandidate = useCallback((code: string) => {
    setComparedCandidateCodes((current) =>
      current.filter((candidateCode) => candidateCode !== code),
    );
  }, []);

  const selectedCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === selectedCandidateCode,
    ) ?? null;

  // The evidence panel is an expensive subtree. Selecting a candidate updates
  // the ranking highlight urgently (so the click paints immediately) while the
  // panel re-renders from a deferred code, keeping interaction-to-next-paint
  // low without changing what the user ultimately sees.
  const deferredSelectedCandidateCode = useDeferredValue(selectedCandidateCode);
  const evidenceCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === deferredSelectedCandidateCode,
    ) ?? selectedCandidate;

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

      <div
        className="analysis-output"
        data-analyzing={status === "idle" ? "false" : "true"}
      >
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

      {status === "success" &&
      result !== null &&
      selectedCandidate !== null &&
      evidenceCandidate !== null ? (
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
              {result.candidates.length > VIRTUALIZED_LIST_THRESHOLD ? (
                <VirtualizedCandidateList
                  candidates={result.candidates}
                  selectedCandidateCode={selectedCandidateCode}
                  locale={locale}
                  confidenceLabel={messages.confidence}
                  listLabel={messages.candidateList}
                  onSelect={selectCandidateMarket}
                />
              ) : (
                <ol aria-label={messages.candidateList}>
                  {result.candidates.map((candidate) => (
                    <CandidateRankingRow
                      key={candidate.economy.code}
                      candidate={candidate}
                      selected={
                        candidate.economy.code === selectedCandidateCode
                      }
                      locale={locale}
                      confidenceLabel={messages.confidence}
                      onSelect={selectCandidateMarket}
                    />
                  ))}
                </ol>
              )}
            </section>


            <MarketAnalysisView
              status={marketAnalysisStatus}
              analysis={marketAnalysis}
              locale={locale}
              freshness={currentManifest?.freshness ?? null}
              isCompared={comparedCandidateCodes.includes(
                evidenceCandidate.economy.code,
              )}
              comparisonFull={
                comparedCandidateCodes.length >= MAX_COMPARISON_CANDIDATES
              }
              onToggleComparison={toggleCandidateComparison}
              onRetry={() =>
                void loadMarketAnalysisForCandidate(
                  evidenceCandidate.economy.code,
                  false,
                )
              }
              onRefreshCurrent={() => void recoverRetiredAnalysis()}
              headingRef={marketAnalysisHeadingRef}
              tradeTrendHref={serializeTradeAnalysisContext("/", {
                recipe: "trade-trend",
                locale,
                importerCode: evidenceCandidate.economy.code,
                productCode: result.query.product.code,
                pin: null,
              })}
              supplierCompetitionHref={serializeTradeAnalysisContext("/", {
                recipe: "supplier-competition",
                locale,
                importerCode: evidenceCandidate.economy.code,
                productCode: result.query.product.code,
                pin: null,
              })}
              tradeExplorerHref={serializeTradeAnalysisContext("/", {
                recipe: "trade-explorer",
                locale,
                pin: null,
                shape: "product-mix-v1",
                measures: [],
                years: [],
                exportEconomy: [],
                importEconomy: [],
                hsProduct: [result.query.product.code],
                sort: null,
              })}
            />
          </div>
          <CandidateMarketComparison
            result={result}
            comparedCodes={comparedCandidateCodes}
            locale={locale}
            onRemove={removeComparedCandidate}
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
          {status === "stale" ||
          status === "rateLimit" ||
          status === "capacity" ? (
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
      </div>

      <p className="workspace-disclaimer">{messages.disclaimer}</p>
    </section>
  );
}

const CandidateRankingRow = memo(function CandidateRankingRow({
  candidate,
  selected,
  locale,
  confidenceLabel,
  onSelect,
  offsetTop,
}: {
  candidate: CandidateMarket;
  selected: boolean;
  locale: WorkspaceLocale;
  confidenceLabel: string;
  onSelect: (candidate: CandidateMarket) => void;
  offsetTop?: number;
}) {
  return (
    <li
      className={offsetTop === undefined ? undefined : "candidate-row-virtual"}
      style={offsetTop === undefined ? undefined : { top: offsetTop }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(candidate)}
      >
        <span className="candidate-rank">#{candidate.rank}</span>
        <span>
          <strong>{candidateDisplayName(candidate, locale)}</strong>
          <small>
            BACI {candidate.economy.code} · {confidenceLabel}:{" "}
            {localizedConfidence(candidate.confidence.label, locale)}
          </small>
          <span className="candidate-score-bar" aria-hidden="true">
            <span style={{ width: `${candidate.score}%` }} />
          </span>
        </span>
        <span className="candidate-score">
          {candidate.score}
          <small>/100</small>
        </span>
      </button>
    </li>
  );
});

const VIRTUALIZED_LIST_THRESHOLD = 40;
const CANDIDATE_ROW_HEIGHT = 79;
const CANDIDATE_ROW_OVERSCAN = 6;
const CANDIDATE_LIST_VIEWPORT_FALLBACK = 760;

function VirtualizedCandidateList({
  candidates,
  selectedCandidateCode,
  locale,
  confidenceLabel,
  listLabel,
  onSelect,
}: {
  candidates: readonly CandidateMarket[];
  selectedCandidateCode: string | null;
  locale: WorkspaceLocale;
  confidenceLabel: string;
  listLabel: string;
  onSelect: (candidate: CandidateMarket) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    CANDIDATE_LIST_VIEWPORT_FALLBACK,
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element !== null && element.clientHeight > 0) {
      setViewportHeight(element.clientHeight);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const element = scrollRef.current;
      if (element !== null) {
        setScrollTop(element.scrollTop);
      }
    });
  }, []);

  const total = candidates.length;
  const start = Math.max(
    0,
    Math.floor(scrollTop / CANDIDATE_ROW_HEIGHT) - CANDIDATE_ROW_OVERSCAN,
  );
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / CANDIDATE_ROW_HEIGHT) +
      CANDIDATE_ROW_OVERSCAN,
  );

  const rows: number[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push(index);
  }
  const selectedIndex =
    selectedCandidateCode === null
      ? -1
      : candidates.findIndex(
          ({ economy }) => economy.code === selectedCandidateCode,
        );
  if (selectedIndex >= 0 && (selectedIndex < start || selectedIndex >= end)) {
    rows.push(selectedIndex);
  }

  return (
    <div className="candidate-scroll" ref={scrollRef} onScroll={handleScroll}>
      <ol
        aria-label={listLabel}
        className="candidate-ranking-virtual"
        style={{ height: total * CANDIDATE_ROW_HEIGHT }}
      >
        {rows.map((index) => {
          const candidate = candidates[index];
          return (
            <CandidateRankingRow
              key={candidate.economy.code}
              candidate={candidate}
              selected={candidate.economy.code === selectedCandidateCode}
              locale={locale}
              confidenceLabel={confidenceLabel}
              onSelect={onSelect}
              offsetTop={index * CANDIDATE_ROW_HEIGHT}
            />
          );
        })}
      </ol>
    </div>
  );
}

function analysisErrorStatus(
  status: number,
  code: string | null,
): AnalysisStatus {
  if (code === "ANALYSIS_RATE_LIMITED") {
    return "rateLimit";
  }
  if (code === "ANALYSIS_BUDGET_EXCEEDED") {
    return "budget";
  }
  if (code === "ANALYSIS_CAPACITY_EXCEEDED") {
    return "capacity";
  }
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

function analysisErrorCode(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    !("code" in value.error) ||
    typeof value.error.code !== "string"
  ) {
    return null;
  }
  return value.error.code;
}

function isErrorStatus(
  status: AnalysisStatus,
): status is
  | "malformed"
  | "stale"
  | "rateLimit"
  | "budget"
  | "capacity"
  | "unavailable"
  | "fatal" {
  return (
    status === "malformed" ||
    status === "stale" ||
    status === "rateLimit" ||
    status === "budget" ||
    status === "capacity" ||
    status === "unavailable" ||
    status === "fatal"
  );
}
