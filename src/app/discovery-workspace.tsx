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
import {
  candidateDisplayName,
  formatDecimalPercent,
  formatUsd,
} from "./candidate-market-evidence";
import { CandidateMarketExportAction } from "./candidate-market-export-action";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { localizedDataConfidence as localizedConfidence } from "./data-confidence-presentation";
import { EconomyCombobox } from "./economy-combobox";
import {
  loadMarketAnalysis,
  MarketAnalysisClientError,
} from "./market-analysis-client";
import {
  marketAnalysisStatusFromError,
  MarketAnalysisView,
  type MarketAnalysisStatus,
} from "./market-analysis-view";
import {
  hasOpportunityHistoryReturn,
  openMarketAnalysis,
  readOpportunityReturnState,
  restoreOpportunityPosition,
  shouldHandleMarketAnalysisClick,
} from "./market-analysis-navigation";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withEconomyCode,
  withPin,
  withProductCode,
  withRecipe,
  type CandidateMarketContext,
  type TradeAnalysisContextPin,
  type TradeAnalysisRecipe,
} from "./trade-analysis-context";
import { announceTradeAnalysisContextChange } from "./trade-analysis-context-events";
import type { WorkspaceScopeConfiguration } from "./workspace-scope";

const copy = {
  en: {
    eyebrow: "Candidate Market workspace",
    title: "Define the analysis inputs.",
    lede: "Select an export economy and HS 2012 product, then load the complete canonical ranking.",
    analyze: "Discover Candidate Markets",
    analyzeRequirement:
      "Select an export economy and one exact Product Catalog result. Free text is not an analytical input.",
    loading: "Loading the complete Candidate Market result…",
    refreshing: "Revalidating the current analysis release…",
    ranked: "Ranked Candidate Markets",
    orderingExplanation:
      "Ordered by canonical Candidate Market rank. Presentation never re-sorts or recomputes this evidence.",
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
    candidateMarketScore: "Candidate Market Score",
    rank: "Rank",
    of: "of",
    marketSize: "Market Size",
    marketGrowth: "Market Growth",
    recordedFoothold: "Recorded Foothold",
    supplierDiversity: "Supplier Diversity",
    perYear: "/year",
    neutral: "Neutral",
    emptyTitle: "No eligible Candidate Markets",
    emptyBody:
      "The selected context is valid, but no market has sufficient evidence in the finalized score window.",
    validEmpty: "This is a valid empty evidence result, not a temporary failure.",
    applicableFinalizedWindow: "Applicable Finalized window",
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
    refresh: "Refresh with current evidence",
    retry: "Retry complete analysis",
    disclaimer:
      "Use this workspace as a discovery aid rather than a recommendation. Validate customers, competition, regulation, logistics, and margins separately.",
    candidates: "Candidate Markets",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable:
      "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
    analyzeMarket: "Analyze this market",
  },
  "zh-Hans": {
    eyebrow: "候选市场工作区",
    title: "定义分析输入。",
    lede: "选择出口经济体和 HS 2012 产品，然后加载完整的规范排名。",
    analyze: "发现候选市场",
    analyzeRequirement:
      "请选择出口经济体和一个精确的产品目录结果。自由文本不是分析输入。",
    loading: "正在加载完整的候选市场结果…",
    refreshing: "正在重新验证当前分析发布版本…",
    ranked: "候选市场排名",
    orderingExplanation:
      "按规范候选市场排名排序。界面绝不会重新排序或重新计算这些证据。",
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
    candidateMarketScore: "候选市场评分",
    rank: "排名",
    of: "/",
    marketSize: "市场规模",
    marketGrowth: "市场增长",
    recordedFoothold: "已记录市场基础",
    supplierDiversity: "供应商多样性",
    perYear: "/年",
    neutral: "中性",
    emptyTitle: "没有符合条件的候选市场",
    emptyBody: "所选输入有效，但计分定稿窗口内没有候选市场具备足够证据。",
    validEmpty: "这是有效的空证据结果，并非暂时故障。",
    applicableFinalizedWindow: "适用的定稿窗口",
    malformed: "该分析情境无效。请检查所选出口经济体和产品。",
    stale: "该分析构建已停用。请刷新当前测试情境。",
    rateLimit: "候选市场请求暂时受限。请稍候再试。",
    budget:
      "该候选市场请求超出完整结果大小限制。请选择其他出口经济体或 HS 产品。",
    capacity: "分析容量暂时繁忙。尚未加载完整结果。",
    unavailable: "兼容的分析工件暂时不可用。",
    fatal: "无法完成分析。",
    refresh: "使用当前证据刷新",
    retry: "重试完整分析",
    disclaimer:
      "这是发现辅助工具，而非建议。请另行验证客户、竞争、法规、物流和利润。",
    candidates: "个候选市场",
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
    analyzeMarket: "分析此市场",
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

type LoadedCandidateMarketResult = Readonly<{
  result: CandidateMarketResult;
  navigationPin: TradeAnalysisContextPin;
}>;

export function DiscoveryWorkspace({
  locale,
  onWorkspaceScopeChange,
}: {
  locale: WorkspaceLocale;
  onWorkspaceScopeChange: (
    scope: WorkspaceScopeConfiguration | null,
  ) => void;
}) {
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
  const scopeControlsRef = useRef<HTMLDivElement>(null);
  const pendingMarketAnalysisFocusRef = useRef(false);
  const pendingScopeFocusRef = useRef(false);
  const [controlRestorationKey, setControlRestorationKey] = useState(0);
  const [exporter, setExporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [loadedCandidateResult, setLoadedCandidateResult] =
    useState<LoadedCandidateMarketResult | null>(null);
  const result = loadedCandidateResult?.result ?? null;
  const [selectedCandidateCode, setSelectedCandidateCode] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysisV1 | null>(
    null,
  );
  const [marketAnalysisStatus, setMarketAnalysisStatus] =
    useState<MarketAnalysisStatus>("loading");
  const [marketAnalysisRetryAfterSeconds, setMarketAnalysisRetryAfterSeconds] =
    useState<number | null>(null);
  const [resolvedAnalysisBuildId, setResolvedAnalysisBuildId] = useState<
    string | null
  >(null);
  const [resolvedAnalysisManifest, setResolvedAnalysisManifest] =
    useState<CurrentAnalysisManifest | null>(null);
  const [currentManifest, setCurrentManifest] =
    useState<CurrentAnalysisManifest | null>(null);
  const [currentManifestStatus, setCurrentManifestStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);

  const clearMarketAnalysisResult = useCallback(() => {
    marketAnalysisController.current?.abort();
    marketAnalysisController.current = null;
    marketAnalysisRequestSequence.current += 1;
    pendingMarketAnalysisFocusRef.current = false;
    setMarketAnalysis(null);
    setMarketAnalysisStatus("loading");
    setMarketAnalysisRetryAfterSeconds(null);
  }, []);

  const resetMarketAnalysisState = useCallback(() => {
    clearMarketAnalysisResult();
    resolvedAnalysisBuildIdRef.current = null;
    setResolvedAnalysisBuildId(null);
    setResolvedAnalysisManifest(null);
  }, [clearMarketAnalysisResult]);

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

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    resetMarketAnalysisState();
    setLoadedCandidateResult(null);
    setSelectedCandidateCode(null);
    setStatus("idle");
    const context = parseTradeAnalysisContext(window.location.href);
    const nextContext: CandidateMarketContext =
      context.recipe === "candidate-market"
        ? { ...context, locale, focusedMarketCode: null }
        : {
            recipe: "candidate-market",
            locale,
            productCode: null,
            pin: null,
            exporterCode: null,
            focusedMarketCode: null,
          };
    const url = serializeTradeAnalysisContext(
      window.location.href,
      nextContext,
    );
    window.history.replaceState(null, "", url);
  }, [locale, resetMarketAnalysisState]);

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
      setMarketAnalysisRetryAfterSeconds(null);
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
        setMarketAnalysisRetryAfterSeconds(null);
      } catch (error) {
        if (
          controller.signal.aborted ||
          marketAnalysisRequestSequence.current !== sequence
        ) {
          return;
        }
        console.error("Market Analysis request failed", error);
        const nextStatus = marketAnalysisStatusFromError(error);
        setMarketAnalysisStatus(nextStatus);
        setMarketAnalysisRetryAfterSeconds(
          nextStatus === "rateLimit" &&
            error instanceof MarketAnalysisClientError
            ? error.retryAfterSeconds
            : null,
        );
      }
    },
    [exporter, product],
  );

  // Focus transfer must happen after React commits the terminal heading
  // to the DOM, not synchronously inside the fetch callback above: the
  // loading/success/error branches each mount their own <h2>, so the ref
  // only points at the newly rendered heading once this effect runs
  // (spec docs/spec/export-market-analysis-workspace-ui-design.md §16,
  // "Explicit Analyze moves focus...background changes do not steal
  // focus").
  useLayoutEffect(() => {
    if (
      marketAnalysisStatus !== "loading" &&
      pendingMarketAnalysisFocusRef.current
    ) {
      pendingMarketAnalysisFocusRef.current = false;
      marketAnalysisHeadingRef.current?.focus();
    }
  }, [marketAnalysisStatus]);

  useLayoutEffect(() => {
    if (
      selectedCandidateCode === null &&
      pendingScopeFocusRef.current
    ) {
      pendingScopeFocusRef.current = false;
      scopeControlsRef.current
        ?.querySelector<HTMLInputElement>('[role="combobox"]')
        ?.focus();
    }
  }, [selectedCandidateCode]);

  const analyzeCandidateMarkets = useCallback(async (
    refreshedManifest?: CurrentAnalysisManifest,
  ) => {
    const manifest = refreshedManifest ?? currentManifest;
    if (exporter === null || product === null || manifest === null) {
      return;
    }

    const urlPin = parseTradeAnalysisContext(window.location.href).pin;
    const pinResolution =
      refreshedManifest === undefined
        ? resolvePinnedContext(urlPin, manifest, "candidate-market")
        : ({ state: "unpinned" } as const);
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
        : manifest.analysisBuildId;

    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    analyzedInputsInHistory.current = true;
    setLoadedCandidateResult(null);
    setResolvedAnalysisManifest(null);
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
          manifest.source.baciRelease ||
        completeResult.provenance.artifactSha256 !==
          manifest.source.artifact.sha256
      ) {
        throw new TypeError(
          "The analysis result does not match the discovered current manifest.",
        );
      }

      const navigationPin = pinFromDeploymentWindow(
        manifest,
        analysisBuildId,
        "candidate-market",
      );
      if (navigationPin === null) {
        throw new TypeError(
          "Candidate Market result has no matching navigation pin.",
        );
      }
      setLoadedCandidateResult({ result: completeResult, navigationPin });
      resolvedAnalysisBuildIdRef.current = analysisBuildId;
      setResolvedAnalysisBuildId(analysisBuildId);
      setResolvedAnalysisManifest(manifest);

      const priorContext = parseTradeAnalysisContext(window.location.href);
      const requestedCandidateCode =
        priorContext.recipe === "candidate-market"
          ? priorContext.focusedMarketCode
          : null;
      const initialCandidate =
        requestedCandidateCode === null
          ? null
          : (completeResult.candidates.find(
              ({ economy }) => economy.code === requestedCandidateCode,
            ) ?? null);
      setSelectedCandidateCode(initialCandidate?.economy.code ?? null);
      setStatus(
        completeResult.candidates.length === 0 ? "empty" : "success",
      );
      if (initialCandidate !== null) {
        void loadMarketAnalysisForCandidate(
          initialCandidate.economy.code,
          hasOpportunityHistoryReturn(),
        );
      }
      const nextContext = withEconomyCode(
        withProductCode(
          withRecipe(priorContext, "candidate-market"),
          product.code,
        ),
        exporter.code,
      );
      if (nextContext.recipe === "candidate-market") {
        const baseContext: CandidateMarketContext = {
          ...nextContext,
          focusedMarketCode: initialCandidate?.economy.code ?? null,
        };
        // A retained execution keeps its own exact pin rather than
        // re-deriving current's live pin, so the canonical URL continues
        // to name the retained build it actually reproduced.
        const pinnedContext =
          pinResolution.state === "retained"
            ? { ...baseContext, pin: pinResolution.pin }
            : withPin(baseContext, manifest);
        const url = serializeTradeAnalysisContext(
          window.location.href,
          pinnedContext,
        );
        if (refreshedManifest === undefined) {
          window.history.replaceState(window.history.state, "", url);
        } else {
          window.history.pushState(null, "", url);
        }
        announceTradeAnalysisContextChange();
      }
    } catch (error) {
      if (controller.signal.aborted || requestSequence.current !== sequence) {
        return;
      }
      console.error("Candidate Market workspace request failed", error);
      setStatus("fatal");
    }
  }, [
    currentManifest,
    exporter,
    loadMarketAnalysisForCandidate,
    product,
  ]);

  const recoverRetiredAnalysis = useCallback(async () => {
    analysisController.current?.abort();
    marketAnalysisController.current?.abort();
    setStatus("refreshing");
    const { controller, promise } = beginCurrentManifestRequest(true);
    const discovered = await promise;
    if (controller.signal.aborted || discovered === null) {
      if (!controller.signal.aborted) {
        setStatus("stale");
      }
      return;
    }
    await analyzeCandidateMarkets(discovered);
  }, [analyzeCandidateMarkets, beginCurrentManifestRequest]);

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
    function restoreContextFromHistory(event: PopStateEvent) {
      const context = parseTradeAnalysisContext(window.location.href);
      const pinResolution =
        currentManifest !== null && context.recipe === "candidate-market"
          ? resolvePinnedContext(
              context.pin,
              currentManifest,
              "candidate-market",
            )
          : null;
      const contextAnalysisBuildId =
        pinResolution === null || pinResolution.state === "retired"
          ? null
          : pinResolution.state === "retained"
            ? pinResolution.deployment.analysisBuildId
            : currentManifest?.analysisBuildId ?? null;
      const matchesLoadedContext =
        result !== null &&
        context.recipe === "candidate-market" &&
        context.exporterCode === result.query.exporter.code &&
        context.productCode === result.query.product.code &&
        contextAnalysisBuildId === result.analysisBuildId;

      if (matchesLoadedContext) {
        const requestedCandidateCode =
          context.recipe === "candidate-market"
            ? context.focusedMarketCode
            : null;
        if (requestedCandidateCode === null) {
          setSelectedCandidateCode(null);
          clearMarketAnalysisResult();
          const returnState = readOpportunityReturnState(
            event.state,
            "candidate-market",
          );
          if (returnState !== null) {
            restoreOpportunityPosition(
              returnState,
              "candidate-market-list-scroll",
            );
          }
        } else if (
          result.candidates.some(
            ({ economy }) => economy.code === requestedCandidateCode,
          )
        ) {
          setSelectedCandidateCode(requestedCandidateCode);
          void loadMarketAnalysisForCandidate(requestedCandidateCode, false);
        }
        return;
      }

      analysisController.current?.abort();
      requestSequence.current += 1;
      analyzedInputsInHistory.current = false;
      canonicalRestorePending.current = true;
      resetMarketAnalysisState();
      setExporter(null);
      setProduct(null);
      setLoadedCandidateResult(null);
      setSelectedCandidateCode(null);
      setStatus("idle");
      setControlRestorationKey((current) => current + 1);
    }

    window.addEventListener("popstate", restoreContextFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreContextFromHistory);
  }, [
    clearMarketAnalysisResult,
    currentManifest,
    loadMarketAnalysisForCandidate,
    resetMarketAnalysisState,
    result,
  ]);

  const selectCandidateMarket = useCallback(
    (candidate: CandidateMarket, href: string) => {
      setSelectedCandidateCode(candidate.economy.code);
      void loadMarketAnalysisForCandidate(candidate.economy.code, true);
      const list = document.getElementById("candidate-market-list-scroll");
      openMarketAnalysis(
        href,
        {
          source: "candidate-market",
          actionId: candidateMarketActionId(candidate.economy.code),
          scrollY: window.scrollY,
          listScrollTop: list?.scrollTop ?? null,
          loadedPages: 1,
        },
        false,
      );
      announceTradeAnalysisContextChange();
    },
    [loadMarketAnalysisForCandidate],
  );

  const selectedCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === selectedCandidateCode,
    ) ?? null;
  const changeScope = useCallback(() => {
    if (selectedCandidateCode === null) {
      scopeControlsRef.current
        ?.querySelector<HTMLInputElement>('[role="combobox"]')
        ?.focus();
      return;
    }
    pendingScopeFocusRef.current = true;
    setSelectedCandidateCode(null);
    clearMarketAnalysisResult();
    const context = parseTradeAnalysisContext(window.location.href);
    if (context.recipe === "candidate-market") {
      const url = serializeTradeAnalysisContext(window.location.href, {
        ...context,
        focusedMarketCode: null,
      });
      window.history.replaceState(window.history.state, "", url);
      announceTradeAnalysisContextChange();
    }
  }, [clearMarketAnalysisResult, selectedCandidateCode]);

  // The evidence panel is an expensive subtree. Selecting a candidate updates
  // the ranking highlight urgently (so the click paints immediately) while the
  // panel re-renders from a deferred code, keeping interaction-to-next-paint
  // low without changing what the user ultimately sees.
  const deferredSelectedCandidateCode = useDeferredValue(selectedCandidateCode);
  const evidenceCandidate =
    result?.candidates.find(
      ({ economy }) => economy.code === deferredSelectedCandidateCode,
    ) ?? selectedCandidate;
  const resolvedDeploymentState =
    currentManifest === null || resolvedAnalysisBuildId === null
      ? null
      : currentManifest.analysisBuildId === resolvedAnalysisBuildId
        ? "current"
        : currentManifest.deploymentWindow.some(
              ({ analysisBuildId }) =>
                analysisBuildId === resolvedAnalysisBuildId,
            )
          ? "retained"
          : "retired";
  const resolvedNavigationPin = (recipe: TradeAnalysisRecipe) =>
    resolvedAnalysisManifest === null || resolvedAnalysisBuildId === null
      ? null
      : pinFromDeploymentWindow(
          resolvedAnalysisManifest,
          resolvedAnalysisBuildId,
          recipe,
        );
  const tradeExplorerNavigationPin = resolvedNavigationPin("trade-explorer");
  const recentMomentumDatasetPackageIdentity =
    resolvedAnalysisManifest?.deploymentWindow.find(
      ({ analysisBuildId }) => analysisBuildId === resolvedAnalysisBuildId,
    )?.recommendation.recentTradeMomentum?.datasetPackageIdentity ?? null;

  useEffect(() => {
    if (
      currentManifest === null ||
      exporter === null ||
      product === null
    ) {
      onWorkspaceScopeChange(null);
      return;
    }
    onWorkspaceScopeChange({
      exporter,
      product: {
        mode: "exact",
        revision: product.hsRevision,
        code: product.code,
        descriptionEn: product.sourceDescriptionEn,
        descriptionZhHans: product.auxiliaryDescriptionZhHans,
      },
      market: selectedCandidate?.economy ?? null,
      deploymentState:
        status === "stale"
          ? "retired"
          : resolvedDeploymentState === "retained"
            ? "retained"
            : "current",
      deploymentActivation: currentManifest.freshness.deploymentActivation,
      baciRelease:
        status === "stale"
          ? null
          : (result?.provenance.baciRelease ??
            currentManifest.source.baciRelease),
      finalizedWindow:
        status === "stale"
          ? null
          : (result?.provenance.scoreWindow ??
            currentManifest.source.windows.score),
      provisionalYear:
        status === "stale"
          ? null
          : (result?.provenance.provisionalYear ??
            currentManifest.source.provisionalYear),
      freshnessState:
        status === "stale" || resolvedDeploymentState === "retained"
          ? null
          : currentManifest.freshness.state,
      canCopyLink:
        status === "success" || status === "empty" || status === "stale",
      onChangeScope: changeScope,
      onSourceDetails:
        status === "stale" ? undefined : () => setSourceDetailsOpen(true),
    });
  }, [
    changeScope,
    currentManifest,
    exporter,
    onWorkspaceScopeChange,
    product,
    resolvedDeploymentState,
    result,
    selectedCandidate,
    status,
  ]);

  return (
    <section
      className="analysis-workspace"
      id="discovery"
      tabIndex={-1}
      aria-labelledby={
        selectedCandidate === null ? "workspace-title" : undefined
      }
    >
      {selectedCandidate === null ? (
        <div className="workspace-intro">
          <p>{messages.eyebrow}</p>
          <h2 id="workspace-title">{messages.title}</h2>
          <p>{messages.lede}</p>
        </div>
      ) : null}

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
          {selectedCandidate === null ? (
            <div ref={scopeControlsRef} className="analysis-controls">
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
              <div className="analysis-submit">
                <button
                  className="analyze-button"
                  type="button"
                  aria-describedby="candidate-analysis-requirement"
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
                <small id="candidate-analysis-requirement">
                  {messages.analyzeRequirement}
                </small>
              </div>
            </div>
          ) : null}
          {status === "stale" ? null : (
            <SourceScope
              manifest={currentManifest}
              result={result}
              locale={locale}
              detailsOpen={sourceDetailsOpen}
              onDetailsOpenChange={setSourceDetailsOpen}
            />
          )}
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
          <CandidateMarketExportAction
            result={result}
            locale={locale}
            onManifestRevalidated={setCurrentManifest}
          />
        ) : null}

        {status === "success" &&
        loadedCandidateResult !== null &&
        product !== null ? (
          <>
            <div
              className="candidate-workspace"
              data-analysis-open={selectedCandidate !== null}
            >
              {selectedCandidate === null ? (
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
                    {loadedCandidateResult.result.cohortSize}{" "}
                    {messages.candidates}
                  </strong>
                </div>
                <p className="opportunity-ordering">
                  {messages.orderingExplanation}
                </p>
                {loadedCandidateResult.result.candidates.length >
                VIRTUALIZED_LIST_THRESHOLD ? (
                  <VirtualizedCandidateList
                    result={loadedCandidateResult.result}
                    selectedCandidateCode={selectedCandidateCode}
                    locale={locale}
                    confidenceLabel={messages.confidence}
                    listLabel={messages.candidateList}
                    analyzeLabel={messages.analyzeMarket}
                    navigationPin={loadedCandidateResult.navigationPin}
                    onSelect={selectCandidateMarket}
                  />
                ) : (
                  <ol aria-label={messages.candidateList}>
                    {loadedCandidateResult.result.candidates.map((candidate) => (
                      <CandidateRankingRow
                        key={candidate.economy.code}
                        candidate={candidate}
                        selected={
                          candidate.economy.code === selectedCandidateCode
                        }
                        locale={locale}
                        confidenceLabel={messages.confidence}
                        cohortSize={loadedCandidateResult.result.cohortSize}
                        analyzeLabel={messages.analyzeMarket}
                        href={fixedProductMarketAnalysisHref(
                          loadedCandidateResult.result,
                          candidate,
                          locale,
                          loadedCandidateResult.navigationPin,
                        )}
                        onSelect={selectCandidateMarket}
                      />
                    ))}
                  </ol>
                )}
                </section>
              ) : null}

              {selectedCandidate !== null && evidenceCandidate !== null ? (
                <MarketAnalysisView
                  status={
                    resolvedDeploymentState === "retired"
                      ? "retired"
                      : marketAnalysisStatus
                  }
                  analysis={marketAnalysis}
                  locale={locale}
                  freshness={resolvedAnalysisManifest?.freshness ?? null}
                  onRetry={() =>
                    void loadMarketAnalysisForCandidate(
                      evidenceCandidate.economy.code,
                      false,
                    )
                  }
                  onRefreshCurrent={() => void recoverRetiredAnalysis()}
                  retryAfterSeconds={marketAnalysisRetryAfterSeconds}
                  requestedAnalysisBuildId={resolvedAnalysisBuildId}
                  headingRef={marketAnalysisHeadingRef}
                  opportunityHref={
                    serializeTradeAnalysisContext("/", {
                      recipe: "candidate-market",
                      locale,
                      pin: loadedCandidateResult.navigationPin,
                      exporterCode:
                        loadedCandidateResult.result.query.exporter.code,
                      productCode:
                        loadedCandidateResult.result.query.product.code,
                      focusedMarketCode: null,
                    })
                  }
                  onBackToOpportunities={(event) => {
                    if (hasOpportunityHistoryReturn()) {
                      event.preventDefault();
                      window.history.back();
                    }
                  }}
                  deploymentState={
                    resolvedDeploymentState === "current"
                      ? "current"
                      : "retained"
                  }
                  productDescription={
                    locale === "en"
                      ? product.sourceDescriptionEn
                      : product.auxiliaryDescriptionZhHans
                  }
                  tradeTrendHref={serializeTradeAnalysisContext("/", {
                    recipe: "trade-trend",
                    locale,
                    importerCode: evidenceCandidate.economy.code,
                    productCode: loadedCandidateResult.result.query.product.code,
                    // An undeclared retained target keeps the source pin so
                    // the destination fails closed on its package mismatch
                    // instead of silently executing unpinned Current data.
                    pin:
                      resolvedNavigationPin("trade-trend") ??
                      loadedCandidateResult.navigationPin,
                  })}
                  supplierCompetitionHref={serializeTradeAnalysisContext("/", {
                    recipe: "supplier-competition",
                    locale,
                    importerCode: evidenceCandidate.economy.code,
                    productCode: loadedCandidateResult.result.query.product.code,
                    pin:
                      resolvedNavigationPin("supplier-competition") ??
                      loadedCandidateResult.navigationPin,
                  })}
                  tradeExplorerHref={
                    tradeExplorerNavigationPin === null
                      ? null
                      : serializeTradeAnalysisContext("/", {
                          recipe: "trade-explorer",
                          locale,
                          pin: tradeExplorerNavigationPin,
                          shape: "product-mix-v1",
                          measures: ["TRADE_VALUE_USD"],
                          years: [
                            loadedCandidateResult.result.provenance.scoreWindow
                              .end,
                          ],
                          exportEconomy: [
                            loadedCandidateResult.result.query.exporter.code,
                          ],
                          importEconomy: [evidenceCandidate.economy.code],
                          hsProduct: [
                            loadedCandidateResult.result.query.product.code,
                          ],
                          sort: null,
                        })
                  }
                  recentMomentumDatasetPackageIdentity={
                    recentMomentumDatasetPackageIdentity
                  }
                />
              ) : null}
            </div>
          </>
        ) : null}

        {status === "empty" ? (
          <div className="analysis-state" role="status">
            <h3>{messages.emptyTitle}</h3>
            <p>{messages.emptyBody}</p>
            <p>{messages.validEmpty}</p>
            {result === null ? null : (
              <p>
                {messages.applicableFinalizedWindow}:{" "}
                {result.provenance.scoreWindow.start}–
                {result.provenance.scoreWindow.end}
              </p>
            )}
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
  cohortSize,
  analyzeLabel,
  href,
  onSelect,
  offsetTop,
}: {
  candidate: CandidateMarket;
  selected: boolean;
  locale: WorkspaceLocale;
  confidenceLabel: string;
  cohortSize: number;
  analyzeLabel: string;
  href: string;
  onSelect: (candidate: CandidateMarket, href: string) => void;
  offsetTop?: number;
}) {
  const messages = copy[locale];
  const growth = candidate.components.marketGrowth;
  const diversity = candidate.components.supplierDiversity;
  return (
    <li
      className={offsetTop === undefined ? undefined : "candidate-row-virtual"}
      style={offsetTop === undefined ? undefined : { top: offsetTop }}
    >
      <div
        className="candidate-row-content"
        data-selected={selected}
      >
        <span className="candidate-rank">#{candidate.rank}</span>
        <span>
          <strong>{candidateDisplayName(candidate, locale)}</strong>
          <small className="candidate-order-summary">
            {messages.candidateMarketScore} {candidate.score} · {messages.rank}{" "}
            {candidate.rank} {messages.of} {cohortSize}
          </small>
          <span className="candidate-order-components">
            <span>
              {messages.marketSize}{" "}
              {formatUsd(candidate.components.marketSize.meanCurrentUsd)}
              {messages.perYear}
            </span>
            <span>
              {messages.marketGrowth}{" "}
              {growth.state === "COMPUTED" && growth.annualRate !== null
                ? formatDecimalPercent(growth.annualRate)
                : messages.neutral}
            </span>
            <span>
              {messages.recordedFoothold}{" "}
              {formatDecimalPercent(candidate.components.recordedFoothold.share)}
            </span>
            <span>
              {messages.supplierDiversity}{" "}
              {diversity.state === "COMPUTED" && diversity.index !== null
                ? Number(diversity.index).toLocaleString(locale)
                : messages.neutral}
            </span>
          </span>
          <small>
            BACI {candidate.economy.code} · {confidenceLabel}:{" "}
            {localizedConfidence(candidate.confidence.label, locale)}
          </small>
          <a
            className="candidate-analyze-action"
            id={candidateMarketActionId(candidate.economy.code)}
            href={href}
            onClick={(event) => {
              if (!shouldHandleMarketAnalysisClick(event)) {
                return;
              }
              event.preventDefault();
              onSelect(candidate, href);
            }}
          >
            {analyzeLabel}: {candidateDisplayName(candidate, locale)}
            <span aria-hidden="true"> →</span>
          </a>
          <span className="candidate-score-bar" aria-hidden="true">
            <span style={{ width: `${candidate.score}%` }} />
          </span>
        </span>
        <span className="candidate-score">
          {candidate.score}
          <small>/100</small>
        </span>
      </div>
    </li>
  );
});

const VIRTUALIZED_LIST_THRESHOLD = 40;
const CANDIDATE_ROW_HEIGHT = 168;
const CANDIDATE_ROW_OVERSCAN = 6;
const CANDIDATE_LIST_VIEWPORT_FALLBACK = 760;

function VirtualizedCandidateList({
  result,
  selectedCandidateCode,
  locale,
  confidenceLabel,
  listLabel,
  analyzeLabel,
  navigationPin,
  onSelect,
}: {
  result: CandidateMarketResult;
  selectedCandidateCode: string | null;
  locale: WorkspaceLocale;
  confidenceLabel: string;
  listLabel: string;
  analyzeLabel: string;
  navigationPin: TradeAnalysisContextPin;
  onSelect: (candidate: CandidateMarket, href: string) => void;
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

  const candidates = result.candidates;
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
    <div
      className="candidate-scroll"
      id="candidate-market-list-scroll"
      ref={scrollRef}
      onScroll={handleScroll}
    >
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
              cohortSize={result.cohortSize}
              analyzeLabel={analyzeLabel}
              href={fixedProductMarketAnalysisHref(
                result,
                candidate,
                locale,
                navigationPin,
              )}
              onSelect={onSelect}
              offsetTop={index * CANDIDATE_ROW_HEIGHT}
            />
          );
        })}
      </ol>
    </div>
  );
}

function fixedProductMarketAnalysisHref(
  result: CandidateMarketResult,
  candidate: CandidateMarket,
  locale: WorkspaceLocale,
  pin: TradeAnalysisContextPin,
): string {
  return serializeTradeAnalysisContext("/", {
    recipe: "candidate-market",
    locale,
    pin,
    exporterCode: result.query.exporter.code,
    productCode: result.query.product.code,
    focusedMarketCode: candidate.economy.code,
  });
}

function candidateMarketActionId(economyCode: string): string {
  return `analyze-candidate-market-${economyCode}`;
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
