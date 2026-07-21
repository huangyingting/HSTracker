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
  MarketInvestigationCandidate,
  MarketInvestigationPage,
  OpportunityConfidence,
} from "../domain/opportunity-discovery/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { OpportunityDetailEvidence } from "../evidence/opportunity-evidence-source";
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import {
  loadMarketInvestigationPage,
  loadOpportunityDetail,
  loadRecentTradeMomentum,
  OpportunityDiscoveryClientError,
} from "./opportunity-discovery-client";
import {
  openMarketAnalysis,
  readOpportunityReturnState,
  restoreOpportunityPosition,
} from "./market-analysis-navigation";
import type { RecentTradeMomentumV1Payload } from "../domain/trade-analytics/recent-trade-momentum-v1-adapter";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  productCodeOf,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withLocale,
  withoutPin,
  withPin,
  withProductCode,
  withRecipe,
  type CandidateMarketContext,
  type TradeAnalysisContext,
} from "./trade-analysis-context";

const PAGE_LIMIT = 20;

const copy = {
  en: {
    eyebrow: "Opportunity Discovery workspace",
    title: "Start with the exporter, then browse the public candidate feed.",
    lede: "Select an export economy to load Market Investigation Candidates. Add an HS12 product only after confirming the code.",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable:
      "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
    unsupported:
      "Opportunity Discovery is not available for this current analysis release. The supporting analytical journeys remain available.",
    loading: "Loading Market Investigation Candidates…",
    refreshing: "Refreshing the current analysis release…",
    stale: "This analysis build has retired. Refresh the current context.",
    malformed:
      "These opportunity inputs are invalid. Check the export economy or product code.",
    capacity:
      "Analysis capacity is temporarily busy. The candidate feed was not loaded.",
    rateLimit:
      "Opportunity Discovery requests are temporarily limited. Wait a moment before retrying.",
    budget:
      "This Opportunity Discovery request exceeds the result size limit. Try a confirmed HS12 product projection.",
    unavailable: "The compatible opportunity index is temporarily unavailable.",
    fatal: "Opportunity Discovery could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry candidate feed",
    allProducts: "All HS12 products",
    productProjection: "Confirmed HS12 projection",
    showAllProducts: "Show all products",
    feedTitle: "Market Investigation Candidates",
    feedCount: "candidate rows in this exporter cohort",
    nextPage: "Load more candidates",
    nextPageFailed: "More candidates could not be loaded.",
    analyzeMarket: "Analyze this market",
    candidateList: "Market Investigation Candidates",
    investigationPriority: "Investigation Priority",
    marketAttractiveness: "Market Attractiveness",
    exporterFit: "Exporter Fit",
    confidence: "Data Confidence",
    coverage: "Coverage",
    observedYears: "observed finalized years",
    missingYears: "missing finalized years",
    selectedDetail: "Selected Market Investigation Candidate detail",
    evidenceDetail: "Candidate evidence detail",
    detailLoading: "Loading selected candidate detail…",
    detailUnavailable: "Selected candidate detail is temporarily unavailable.",
    marketGap: "Unvalidated Market Gap",
    expansion: "Expansion Evidence",
    generalEvidence: "General Investigation Evidence",
    axes: "Visible axes",
    components: "Component evidence",
    componentMarketSize: "Market Size",
    componentMarketGrowth: "Market Growth",
    componentExporterPresence: "Exporter Product Presence",
    componentRecordedFoothold: "Recorded Foothold",
    nonClaims: "What this feed does not claim",
    disclaimer: "Discovery disclaimer",
    adjacent: "Adjacent evidence",
    recentTradeMomentum: "Recent Trade Momentum Signal",
    recentTradeMomentumLoading: "Loading Recent Trade Momentum…",
    recentTradeMomentumUnavailable:
      "Recent Trade Momentum is not available for this market/product package.",
    recentTradeMomentumNoClaim:
      "Monthly momentum is separate context; it does not change the annual BACI opportunity score, rank, type, or confidence.",
    reportingMarket: "Reporting market",
    recentPeriod: "Recent period",
    baselinePeriod: "Baseline period",
    eurValuation: "EUR valuation",
    mappingChain: "Mapping chain",
    monthlyRevision: "Monthly revision",
    sourceDetails: "Source details",
    candidateMarket: "Open Candidate Market drill-down",
    tradeTrend: "Open Trade Trend evidence",
    supplierCompetition: "Open Supplier Competition evidence",
    tradeExplorer: "Open Trade Explorer setup",
    provenance: "Analysis source scope",
    baciRelease: "BACI Release",
    scoreWindow: "Finalized score window",
    provisionalYear: "Provisional Year",
    releaseRevision: "Release revision",
    noCandidates: "No eligible Market Investigation Candidates",
    noCandidatesBody:
      "The selected exporter and product projection are valid, but no candidate rows are available in this public feed.",
  },
  "zh-Hans": {
    eyebrow: "机会发现工作区",
    title: "先选择出口经济体，再浏览公共候选项列表。",
    lede: "选择出口经济体即可加载市场调查候选项。只有在确认 HS12 编码后才添加产品筛选。",
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
    unsupported: "当前分析发布版本不提供机会发现。辅助分析旅程仍可使用。",
    loading: "正在加载市场调查候选项…",
    refreshing: "正在刷新当前分析发布版本…",
    stale: "该分析构建已停用。请刷新当前情境。",
    malformed: "机会发现输入无效。请检查出口经济体或产品编码。",
    capacity: "分析容量暂时繁忙。尚未加载候选项列表。",
    rateLimit: "机会发现请求暂时受限。请稍候再试。",
    budget: "该机会发现请求超出结果大小限制。请尝试确认的 HS12 产品投影。",
    unavailable: "兼容的机会索引暂时不可用。",
    fatal: "无法完成机会发现。",
    refresh: "刷新当前分析",
    retry: "重试候选项列表",
    allProducts: "全部 HS12 产品",
    productProjection: "已确认 HS12 投影",
    showAllProducts: "显示全部产品",
    feedTitle: "市场调查候选项",
    feedCount: "个出口经济体队列候选行",
    nextPage: "加载更多候选项",
    nextPageFailed: "无法加载更多候选项。",
    analyzeMarket: "分析此市场",
    candidateList: "市场调查候选项",
    investigationPriority: "调查优先级",
    marketAttractiveness: "市场吸引力",
    exporterFit: "出口方匹配度",
    confidence: "数据置信度",
    coverage: "覆盖",
    observedYears: "个已观察定稿年份",
    missingYears: "个缺失定稿年份",
    selectedDetail: "所选市场调查候选项详情",
    evidenceDetail: "候选项证据详情",
    detailLoading: "正在加载所选候选项详情…",
    detailUnavailable: "所选候选项详情暂时不可用。",
    marketGap: "未验证市场缺口",
    expansion: "扩张证据",
    generalEvidence: "一般调查证据",
    axes: "可见轴",
    components: "组成证据",
    componentMarketSize: "市场规模",
    componentMarketGrowth: "市场增长",
    componentExporterPresence: "出口方产品存在",
    componentRecordedFoothold: "已记录市场基础",
    nonClaims: "该列表不声称的内容",
    disclaimer: "发现免责声明",
    adjacent: "相邻证据",
    recentTradeMomentum: "近期贸易动量信号",
    recentTradeMomentumLoading: "正在加载近期贸易动量…",
    recentTradeMomentumUnavailable: "该市场/产品包没有近期贸易动量。",
    recentTradeMomentumNoClaim:
      "月度动量只是独立情境；不会改变年度 BACI 机会评分、排名、类型或置信度。",
    reportingMarket: "报告市场",
    recentPeriod: "近期期间",
    baselinePeriod: "基准期间",
    eurValuation: "欧元估值",
    mappingChain: "映射链",
    monthlyRevision: "月度修订",
    sourceDetails: "来源详情",
    candidateMarket: "打开候选市场深入分析",
    tradeTrend: "打开贸易趋势证据",
    supplierCompetition: "打开供应商竞争证据",
    tradeExplorer: "打开贸易探索设置",
    provenance: "分析来源范围",
    baciRelease: "BACI 发布版本",
    scoreWindow: "定稿计分窗口",
    provisionalYear: "暂定年份",
    releaseRevision: "发布修订",
    noCandidates: "没有符合条件的市场调查候选项",
    noCandidatesBody:
      "所选出口经济体和产品投影有效，但该公共列表中没有候选行。",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type SelectionSource = "restore" | "explicit";
type FeedStatus =
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

export function OpportunityDiscoveryWorkspace({
  locale,
}: {
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  const requestSequence = useRef(0);
  const feedController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const momentumController = useRef<AbortController | null>(null);
  const manifestController = useRef<AbortController | null>(null);
  const feedPinnedInHistory = useRef(false);
  const restoredReturnAction = useRef<string | null>(null);
  const [controlRestorationKey, setControlRestorationKey] = useState(0);
  const [currentManifest, setCurrentManifest] =
    useState<CurrentAnalysisManifest | null>(null);
  const [currentManifestStatus, setCurrentManifestStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [exporter, setExporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [feed, setFeed] = useState<MarketInvestigationPage | null>(null);
  const [status, setStatus] = useState<FeedStatus>("idle");
  const [paginationStatus, setPaginationStatus] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(null);
  const [detail, setDetail] = useState<OpportunityDetailEvidence | null>(null);
  const [detailStatus, setDetailStatus] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const [momentum, setMomentum] = useState<RecentTradeMomentumV1Payload | null>(
    null,
  );
  const [momentumStatus, setMomentumStatus] = useState<
    "idle" | "loading" | "failed" | "unsupported"
  >("idle");

  const beginCurrentManifestRequest = useCallback((revalidate = false) => {
    manifestController.current?.abort();
    const controller = new AbortController();
    manifestController.current = controller;
    const promise = loadCurrentAnalysisManifest({
      fetcher: fetch,
      signal: controller.signal,
      revalidate,
    })
      .then((manifest) => {
        setCurrentManifest(manifest);
        setCurrentManifestStatus("ready");
        return manifest;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Current analysis manifest request failed", error);
          setCurrentManifestStatus("failed");
        }
        return null;
      })
      .finally(() => {
        if (manifestController.current === controller) {
          manifestController.current = null;
        }
      });
    return { controller, promise };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void beginCurrentManifestRequest(false).promise,
      0,
    );
    return () => {
      window.clearTimeout(timeout);
      manifestController.current?.abort();
      feedController.current?.abort();
      detailController.current?.abort();
      momentumController.current?.abort();
    };
  }, [beginCurrentManifestRequest]);

  const resetFeed = useCallback(() => {
    feedController.current?.abort();
    detailController.current?.abort();
    momentumController.current?.abort();
    requestSequence.current += 1;
    setFeed(null);
    setLoadedPageCount(0);
    setPaginationStatus("idle");
    setSelectedCandidateKey(null);
    setDetail(null);
    setDetailStatus("idle");
    setMomentum(null);
    setMomentumStatus("idle");
    setStatus("idle");
  }, []);

  const prepareForExplicitContextChange = useCallback(() => {
    if (feedPinnedInHistory.current) {
      window.history.pushState(null, "", window.location.href);
      feedPinnedInHistory.current = false;
    }
    const context = parseTradeAnalysisContext(window.location.href);
    const url = serializeTradeAnalysisContext(
      window.location.href,
      withoutPin(context),
    );
    window.history.replaceState(null, "", url);
    resetFeed();
  }, [resetFeed]);

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

  const loadFeed = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (exporter === null || currentManifest === null) {
        return;
      }
      if (currentManifest.recommendation.opportunityDiscovery === null) {
        setStatus("unavailable");
        return;
      }

      const urlContext = parseTradeAnalysisContext(window.location.href);
      const opportunityContext = withRecipe(
        withLocale(urlContext, locale),
        "opportunity-discovery",
      );
      if (opportunityContext.recipe !== "opportunity-discovery") {
        return;
      }
      const pinResolution = resolvePinnedContext(
        opportunityContext.pin,
        currentManifest,
        "opportunity-discovery",
      );
      if (pinResolution.state === "retired") {
        setStatus("stale");
        return;
      }

      const analysisBuildId =
        pinResolution.state === "retained"
          ? pinResolution.deployment.analysisBuildId
          : currentManifest.analysisBuildId;
      const productCodes = product === null ? null : [product.code];

      feedController.current?.abort();
      detailController.current?.abort();
      momentumController.current?.abort();
      const controller = new AbortController();
      feedController.current = controller;
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      setFeed(null);
      setLoadedPageCount(0);
      setPaginationStatus("idle");
      setSelectedCandidateKey(null);
      setDetail(null);
      setDetailStatus("idle");
      setMomentum(null);
      setMomentumStatus("idle");
      setStatus(mode === "refresh" ? "refreshing" : "loading");

      try {
        const firstPage = await loadMarketInvestigationPage({
          analysisBuildId,
          exporterCode: exporter.code,
          productCodes,
          limit: PAGE_LIMIT,
          cursor: null,
          fetcher: fetch,
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestSequence.current !== sequence) {
          return;
        }
        validatePageIdentity(
          firstPage,
          analysisBuildId,
          currentManifest,
          pinResolution,
        );
        const returnState = readOpportunityReturnState(
          window.history.state,
          "opportunity-discovery",
        );
        const requestedPageCount = returnState?.loadedPages ?? 1;
        let loadedPage = firstPage;
        let pageCount = 1;
        while (
          pageCount < requestedPageCount &&
          loadedPage.page.nextCursor !== null
        ) {
          const cursor = loadedPage.page.nextCursor;
          const nextPage = await loadMarketInvestigationPage({
            analysisBuildId,
            exporterCode: exporter.code,
            productCodes,
            limit: PAGE_LIMIT,
            cursor,
            fetcher: fetch,
            signal: controller.signal,
          });
          validatePageIdentity(
            nextPage,
            analysisBuildId,
            currentManifest,
            pinResolution,
          );
          loadedPage = appendOpportunityPage(loadedPage, nextPage, cursor);
          pageCount += 1;
        }
        setFeed(loadedPage);
        setLoadedPageCount(pageCount);
        setStatus(loadedPage.candidates.length === 0 ? "empty" : "success");
        const firstCandidate = loadedPage.candidates[0] ?? null;
        setSelectedCandidateKey(
          firstCandidate === null ? null : candidateKey(firstCandidate),
        );

        const baseContext: TradeAnalysisContext = {
          recipe: "opportunity-discovery",
          locale,
          pin: null,
          exportEconomyCode: exporter.code,
          productCodes,
          focusProductCode: opportunityContext.focusProductCode ?? null,
          focusedMarketCode: opportunityContext.focusedMarketCode ?? null,
        };
        const pinnedContext =
          pinResolution.state === "retained"
            ? { ...baseContext, pin: pinResolution.pin }
            : withPin(baseContext, currentManifest);
        const nextUrl = serializeTradeAnalysisContext(
          window.location.href,
          pinnedContext,
        );
        window.history.replaceState(window.history.state, "", nextUrl);
        feedPinnedInHistory.current = true;
      } catch (error) {
        if (controller.signal.aborted || requestSequence.current !== sequence) {
          return;
        }
        console.error("Opportunity Discovery feed request failed", error);
        setStatus(feedErrorStatus(error));
      } finally {
        if (feedController.current === controller) {
          feedController.current = null;
        }
      }
    },
    [currentManifest, exporter, locale, product],
  );

  useEffect(() => {
    if (currentManifest === null || exporter === null) {
      return;
    }
    const context = parseTradeAnalysisContext(window.location.href);
    if (context.recipe !== "opportunity-discovery") {
      return;
    }
    const expectedProductCode = productCodeOf(context);
    if (
      expectedProductCode !== null &&
      (product === null || product.code !== expectedProductCode)
    ) {
      return;
    }
    if (
      context.exportEconomyCode !== null &&
      context.exportEconomyCode !== exporter.code
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void loadFeed(), 0);
    return () => window.clearTimeout(timeout);
  }, [currentManifest, exporter, loadFeed, product]);

  const selectedCandidate =
    feed?.candidates.find(
      (candidate) => candidateKey(candidate) === selectedCandidateKey,
    ) ?? null;
  const candidateMarketPin =
    currentManifest === null || feed === null
      ? null
      : pinFromDeploymentWindow(
          currentManifest,
          feed.analysisBuildId,
          "candidate-market",
        );

  useLayoutEffect(() => {
    if (status !== "success") {
      return;
    }
    const returnState = readOpportunityReturnState(
      window.history.state,
      "opportunity-discovery",
    );
    if (
      returnState === null ||
      restoredReturnAction.current === returnState.actionId
    ) {
      return;
    }
    restoredReturnAction.current = returnState.actionId;
    restoreOpportunityPosition(returnState, "opportunity-list-scroll");
  }, [status]);

  useEffect(() => {
    if (selectedCandidate === null || feed === null) {
      detailController.current?.abort();
      momentumController.current?.abort();
      const resetTimeout = window.setTimeout(() => {
        setDetail(null);
        setDetailStatus("idle");
        setMomentum(null);
        setMomentumStatus("idle");
      }, 0);
      return () => window.clearTimeout(resetTimeout);
    }
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    const loadingTimeout = window.setTimeout(() => {
      setDetail(null);
      setDetailStatus("loading");
    }, 0);
    void loadOpportunityDetail({
      analysisBuildId: feed.analysisBuildId,
      exporterCode: feed.exporter.code,
      productCode: selectedCandidate.product.code,
      importerCode: selectedCandidate.market.code,
      fetcher: fetch,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setDetail(payload);
          setDetailStatus("idle");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Opportunity detail request failed", error);
          setDetailStatus("failed");
        }
      })
      .finally(() => {
        if (detailController.current === controller) {
          detailController.current = null;
        }
      });
    return () => {
      window.clearTimeout(loadingTimeout);
      controller.abort();
    };
  }, [feed, selectedCandidate]);

  useEffect(() => {
    if (
      selectedCandidate === null ||
      feed === null ||
      currentManifest === null
    ) {
      return;
    }
    momentumController.current?.abort();
    if (currentManifest.recommendation.recentTradeMomentum === null) {
      const unsupportedTimeout = window.setTimeout(() => {
        setMomentum(null);
        setMomentumStatus("unsupported");
      }, 0);
      return () => window.clearTimeout(unsupportedTimeout);
    }
    const reporterCode = iso3ToIso2(selectedCandidate.market.iso3);
    if (reporterCode === null) {
      const unsupportedTimeout = window.setTimeout(() => {
        setMomentum(null);
        setMomentumStatus("unsupported");
      }, 0);
      return () => window.clearTimeout(unsupportedTimeout);
    }
    const controller = new AbortController();
    momentumController.current = controller;
    const loadingTimeout = window.setTimeout(() => {
      setMomentum(null);
      setMomentumStatus("loading");
    }, 0);
    void loadRecentTradeMomentum({
      analysisBuildId: feed.analysisBuildId,
      reporterCode,
      productCode: selectedCandidate.product.code,
      exporterCode: feed.exporter.code,
      fetcher: fetch,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setMomentum(payload);
          setMomentumStatus("idle");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Recent Trade Momentum request failed", error);
          setMomentumStatus("failed");
        }
      })
      .finally(() => {
        if (momentumController.current === controller) {
          momentumController.current = null;
        }
      });
    return () => {
      window.clearTimeout(loadingTimeout);
      controller.abort();
    };
  }, [currentManifest, feed, selectedCandidate]);

  useLayoutEffect(() => {
    function restoreContextFromHistory() {
      resetFeed();
      setExporter(null);
      setProduct(null);
      setControlRestorationKey((current) => current + 1);
    }

    window.addEventListener("popstate", restoreContextFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreContextFromHistory);
  }, [resetFeed]);

  async function refreshCurrentAnalysis() {
    const context = parseTradeAnalysisContext(window.location.href);
    const url = serializeTradeAnalysisContext(
      window.location.href,
      withoutPin(context),
    );
    window.history.replaceState(null, "", url);
    resetFeed();
    setStatus("refreshing");
    const { promise } = beginCurrentManifestRequest(true);
    await promise;
  }

  function clearProductProjection() {
    prepareForExplicitContextChange();
    setProduct(null);
    const context = withProductCode(
      parseTradeAnalysisContext(window.location.href),
      null,
    );
    const url = serializeTradeAnalysisContext(window.location.href, context);
    window.history.replaceState(null, "", url);
    setControlRestorationKey((current) => current + 1);
  }

  function selectCandidate(candidate: MarketInvestigationCandidate) {
    setSelectedCandidateKey(candidateKey(candidate));
  }

  async function loadNextPage() {
    if (
      feed === null ||
      currentManifest === null ||
      feed.page.nextCursor === null ||
      paginationStatus === "loading"
    ) {
      return;
    }
    const cursor = feed.page.nextCursor;
    const context = parseTradeAnalysisContext(window.location.href);
    if (context.recipe !== "opportunity-discovery") {
      return;
    }
    const pinResolution = resolvePinnedContext(
      context.pin,
      currentManifest,
      "opportunity-discovery",
    );
    if (pinResolution.state === "retired") {
      setStatus("stale");
      return;
    }

    feedController.current?.abort();
    const controller = new AbortController();
    feedController.current = controller;
    setPaginationStatus("loading");
    try {
      const nextPage = await loadMarketInvestigationPage({
        analysisBuildId: feed.analysisBuildId,
        exporterCode: feed.exporter.code,
        productCodes: product === null ? null : [product.code],
        limit: PAGE_LIMIT,
        cursor,
        fetcher: fetch,
        signal: controller.signal,
      });
      validatePageIdentity(
        nextPage,
        feed.analysisBuildId,
        currentManifest,
        pinResolution,
      );
      setFeed((current) =>
        current === null
          ? current
          : appendOpportunityPage(current, nextPage, cursor),
      );
      setLoadedPageCount((current) => current + 1);
      setPaginationStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      console.error("Opportunity Discovery continuation request failed", error);
      setPaginationStatus("failed");
    } finally {
      if (feedController.current === controller) {
        feedController.current = null;
      }
    }
  }

  function marketAnalysisHref(
    candidate: MarketInvestigationCandidate,
  ): string | null {
    if (feed === null || candidateMarketPin === null) {
      return null;
    }
    const context: CandidateMarketContext = {
      recipe: "candidate-market",
      locale,
      pin: candidateMarketPin,
      exporterCode: feed.exporter.code,
      productCode: candidate.product.code,
      focusedMarketCode: candidate.market.code,
    };
    return serializeTradeAnalysisContext(window.location.href, context);
  }

  function openCandidateMarket(
    candidate: MarketInvestigationCandidate,
    href: string,
  ) {
    const list = document.getElementById("opportunity-list-scroll");
    openMarketAnalysis(href, {
      source: "opportunity-discovery",
      actionId: opportunityActionId(candidate),
      scrollY: window.scrollY,
      listScrollTop: list?.scrollTop ?? null,
      loadedPages: loadedPageCount,
    });
  }

  return (
    <section
      className="analysis-workspace opportunity-workspace"
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
      ) : currentManifest.recommendation.opportunityDiscovery === null ? (
        <div className="analysis-state analysis-error" role="status">
          <p>{messages.unsupported}</p>
        </div>
      ) : (
        <>
          <div className="analysis-controls opportunity-controls">
            <EconomyCombobox
              key={`opportunity-economy-${controlRestorationKey}`}
              analysisBuildId={currentManifest.analysisBuildId}
              locale={locale}
              onSelectionChange={handleExporterSelection}
              onRetiredBuild={refreshCurrentAnalysis}
            />
            <ProductCombobox
              key={`opportunity-product-${controlRestorationKey}`}
              productSearchBuildId={currentManifest.productSearchBuildId}
              locale={locale}
              onSelectionChange={handleProductSelection}
              onRetiredBuild={refreshCurrentAnalysis}
            />
            <div className="opportunity-scope-actions">
              <span>
                {product === null
                  ? messages.allProducts
                  : `${messages.productProjection}: ${product.code}`}
              </span>
              {product === null ? null : (
                <button type="button" onClick={clearProductProjection}>
                  {messages.showAllProducts}
                </button>
              )}
            </div>
          </div>
          <SourceScope
            manifest={currentManifest}
            result={null}
            locale={locale}
          />

          {status === "loading" || status === "refreshing" ? (
            <div className="analysis-state analysis-loading" role="status">
              <span aria-hidden="true" />
              {messages[status]}
            </div>
          ) : null}

          {isErrorStatus(status) ? (
            <div className="analysis-state analysis-error" role="alert">
              <p>{messages[status]}</p>
              {status === "stale" ? (
                <button
                  type="button"
                  onClick={() => void refreshCurrentAnalysis()}
                >
                  {messages.refresh}
                </button>
              ) : status === "rateLimit" || status === "capacity" ? (
                <button type="button" onClick={() => void loadFeed()}>
                  {messages.retry}
                </button>
              ) : null}
            </div>
          ) : null}

          {(status === "success" || status === "empty") && feed !== null ? (
            <>
              <OpportunityProvenance page={feed} locale={locale} />
              <AnalysisShareLink locale={locale} task="opportunity-discovery" />
            </>
          ) : null}

          {status === "empty" ? (
            <div className="analysis-state" role="status">
              <h3>{messages.noCandidates}</h3>
              <p>{messages.noCandidatesBody}</p>
            </div>
          ) : null}

          {status === "success" &&
          feed !== null &&
          selectedCandidate !== null ? (
            <>
              <div className="opportunity-feed">
                <section
                  className="opportunity-list"
                  aria-labelledby="opportunity-feed-title"
                >
                  <div className="candidate-heading">
                    <div>
                      <p>{messages.feedTitle}</p>
                      <h3 id="opportunity-feed-title">{feed.exporter.name}</h3>
                    </div>
                    <strong>
                      {feed.cohortSize} {messages.feedCount}
                    </strong>
                  </div>
                  <ol
                    id="opportunity-list-scroll"
                    aria-label={messages.candidateList}
                  >
                    {feed.candidates.map((candidate) => {
                      const analysisHref = marketAnalysisHref(candidate);
                      return (
                        <li key={candidateKey(candidate)}>
                          <button
                            type="button"
                            aria-pressed={
                              candidateKey(candidate) === selectedCandidateKey
                            }
                            onClick={() => selectCandidate(candidate)}
                          >
                            <span className="candidate-rank">
                              {candidate.product.code}
                            </span>
                            <span>
                              <span className="opportunity-row-identities">
                                <strong>
                                  HS12 {candidate.product.code} ·{" "}
                                  {candidate.product.descriptionEn}
                                </strong>
                                <strong>{candidate.market.name}</strong>
                              </span>
                              <small>
                                {opportunityTypeLabel(candidate, locale)}
                              </small>
                              <span className="opportunity-row-metrics">
                                <span>
                                  {messages.marketAttractiveness}{" "}
                                  {candidate.marketAttractiveness.display}
                                </span>
                                <span>
                                  {messages.exporterFit}{" "}
                                  {candidate.exporterFit.display}
                                </span>
                                <span>
                                  {messages.confidence}:{" "}
                                  {localizedConfidence(
                                    candidate.confidence,
                                    locale,
                                  )}
                                </span>
                                <span>
                                  {messages.coverage}:{" "}
                                  {candidate.observedMarketYears.length}{" "}
                                  {locale === "en" ? "observed" : "已观察"} ·{" "}
                                  {candidate.missingMarketYears.length}{" "}
                                  {locale === "en" ? "missing" : "缺失"}
                                </span>
                              </span>
                              <span
                                className="candidate-score-bar"
                                aria-hidden="true"
                              >
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
                          </button>
                          {analysisHref === null ? null : (
                            <a
                              id={opportunityActionId(candidate)}
                              className="candidate-primary-action"
                              href={analysisHref}
                              onClick={(event) => {
                                if (
                                  event.button !== 0 ||
                                  event.metaKey ||
                                  event.ctrlKey ||
                                  event.shiftKey ||
                                  event.altKey
                                ) {
                                  return;
                                }
                                event.preventDefault();
                                openCandidateMarket(candidate, analysisHref);
                              }}
                            >
                              {messages.analyzeMarket}
                              <span aria-hidden="true"> →</span>
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {feed.page.nextCursor === null ? null : (
                    <div className="opportunity-pagination">
                      <button
                        type="button"
                        disabled={paginationStatus === "loading"}
                        onClick={() => void loadNextPage()}
                      >
                        {messages.nextPage}
                      </button>
                      {paginationStatus === "failed" ? (
                        <p role="alert">{messages.nextPageFailed}</p>
                      ) : null}
                    </div>
                  )}
                </section>

                <OpportunityCandidateDetail
                  candidate={selectedCandidate}
                  page={feed}
                  detail={detail}
                  detailStatus={detailStatus}
                  momentum={momentum}
                  momentumStatus={momentumStatus}
                  locale={locale}
                />
              </div>

              <OpportunityBoundaries page={feed} locale={locale} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function OpportunityCandidateDetail({
  candidate,
  page,
  detail,
  detailStatus,
  momentum,
  momentumStatus,
  locale,
}: {
  candidate: MarketInvestigationCandidate;
  page: MarketInvestigationPage;
  detail: OpportunityDetailEvidence | null;
  detailStatus: "idle" | "loading" | "failed";
  momentum: RecentTradeMomentumV1Payload | null;
  momentumStatus: "idle" | "loading" | "failed" | "unsupported";
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  const links = adjacentLinks(candidate, locale);
  return (
    <section
      className="opportunity-detail candidate-evidence"
      aria-label={messages.selectedDetail}
    >
      <p className="evidence-kicker">
        {opportunityTypeLabel(candidate, locale)}
      </p>
      <h3>{candidate.market.name}</h3>
      <p className="evidence-identity">
        HS 2012 · {candidate.product.code} · BACI {candidate.market.code}
      </p>
      {candidate.market.identityNote === null ? null : (
        <p className="evidence-identity-note">
          {candidate.market.identityNote}
        </p>
      )}
      <p className="score-explanation">{candidate.opportunityTypeCopy}</p>
      {candidate.bilateralWording === null ? null : (
        <p className="score-explanation">{candidate.bilateralWording}</p>
      )}

      <div className="opportunity-axis-grid" aria-label={messages.axes}>
        <MetricCard
          label={messages.investigationPriority}
          value={candidate.investigationPriority.display}
        />
        <MetricCard
          label={messages.marketAttractiveness}
          value={candidate.marketAttractiveness.display}
        />
        <MetricCard
          label={messages.exporterFit}
          value={candidate.exporterFit.display}
        />
      </div>

      <div className="confidence-ledger">
        <div className="confidence-heading">
          <div>
            <p>{messages.confidence}</p>
            <h4>{localizedConfidence(candidate.confidence, locale)}</h4>
          </div>
          <strong>{candidate.confidence.score}/100</strong>
        </div>
        <div className="confidence-coverage">
          <span>
            {candidate.observedMarketYears.length} {messages.observedYears}
          </span>
          <span>
            {candidate.missingMarketYears.length} {messages.missingYears}
          </span>
        </div>
        {candidate.confidence.deductions.length === 0 ? null : (
          <ul>
            {candidate.confidence.deductions.map((deduction) => (
              <li key={deduction.code}>
                <span>{deduction.code}</span>
                <strong>-{deduction.points}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="score-inputs-wrap" aria-label={messages.components}>
        <table>
          <thead>
            <tr>
              <th>{messages.components}</th>
              <th>{messages.coverage}</th>
              <th>{messages.investigationPriority}</th>
            </tr>
          </thead>
          <tbody>
            {componentRows(candidate, locale).map((component) => (
              <tr key={component.label}>
                <th scope="row">{component.label}</th>
                <td>
                  <span className={`evidence-state ${component.stateClass}`}>
                    {component.state}
                  </span>
                </td>
                <td>{component.display}/100</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section
        className="opportunity-years"
        aria-label={messages.evidenceDetail}
      >
        <h4>{messages.evidenceDetail}</h4>
        {detailStatus === "loading" ? (
          <p>{messages.detailLoading}</p>
        ) : detailStatus === "failed" ? (
          <p>{messages.detailUnavailable}</p>
        ) : detail === null ? null : (
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>World imports</th>
                <th>Exporter flow</th>
              </tr>
            </thead>
            <tbody>
              {detail.marketYears.map((year) => (
                <tr key={year.year}>
                  <th scope="row">{year.year}</th>
                  <td>{year.worldValueKusd}</td>
                  <td>
                    {year.bilateralValueKusd ?? "No recorded positive flow"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <nav className="opportunity-adjacent" aria-label={messages.adjacent}>
        <p>{messages.adjacent}</p>
        <a href={links.candidateMarket}>{messages.candidateMarket}</a>
        <a href={links.tradeTrend}>{messages.tradeTrend}</a>
        <a href={links.supplierCompetition}>{messages.supplierCompetition}</a>
        <a href={links.tradeExplorer}>{messages.tradeExplorer}</a>
      </nav>

      <RecentTradeMomentumPanel
        candidate={candidate}
        momentum={momentum}
        status={momentumStatus}
        locale={locale}
      />

      <p className="evidence-source">
        {page.provenance.recipeVersion} · {page.provenance.resultSchemaVersion}
      </p>
    </section>
  );
}

function RecentTradeMomentumPanel({
  candidate,
  momentum,
  status,
  locale,
}: {
  candidate: MarketInvestigationCandidate;
  momentum: RecentTradeMomentumV1Payload | null;
  status: "idle" | "loading" | "failed" | "unsupported";
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <section
      className="opportunity-momentum"
      aria-label={messages.recentTradeMomentum}
    >
      <p>{messages.recentTradeMomentum}</p>
      <p className="momentum-market">{candidate.market.name}</p>
      {status === "loading" ? (
        <p>{messages.recentTradeMomentumLoading}</p>
      ) : status === "failed" ||
        status === "unsupported" ||
        momentum === null ? (
        <p>{messages.recentTradeMomentumUnavailable}</p>
      ) : (
        <>
          <dl>
            <div>
              <dt>{messages.reportingMarket}</dt>
              <dd>{momentum.reporterIso2}</dd>
            </div>
            <div>
              <dt>HS 2012</dt>
              <dd>{momentum.hs12Code}</dd>
            </div>
            <div>
              <dt>{messages.recentPeriod}</dt>
              <dd>{momentum.recentMonths.join("–")}</dd>
            </div>
            <div>
              <dt>{messages.baselinePeriod}</dt>
              <dd>{momentum.baselineMonths.join("–")}</dd>
            </div>
            <div>
              <dt>{messages.eurValuation}</dt>
              <dd>
                {momentum.recentValueEur ?? "not observed"} /{" "}
                {momentum.baselineValueEur ?? "not observed"}
              </dd>
            </div>
            <div>
              <dt>{messages.coverage}</dt>
              <dd>{momentum.coverageState}</dd>
            </div>
            <div>
              <dt>{messages.confidence}</dt>
              <dd>{momentum.confidence ?? "not signalled"}</dd>
            </div>
            <div>
              <dt>{messages.mappingChain}</dt>
              <dd>
                {momentum.confidenceReasons.includes(
                  "MULTI_STEP_EXACT_CORRESPONDENCE",
                )
                  ? "MULTI_STEP_EXACT"
                  : "DIRECT_EXACT"}
              </dd>
            </div>
            <div>
              <dt>{messages.monthlyRevision}</dt>
              <dd>{momentum.sourceVintageId}</dd>
            </div>
            <div>
              <dt>{messages.sourceDetails}</dt>
              <dd>{momentum.datasetPackageIdentity}</dd>
            </div>
          </dl>
          <p>
            {momentum.signalState ?? momentum.reasonCodes.join(", ")}
            {momentum.growthPercentDisplay === null
              ? ""
              : ` · ${momentum.growthPercentDisplay}%`}
          </p>
          <p>{messages.recentTradeMomentumNoClaim}</p>
        </>
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}/100</dd>
    </div>
  );
}

function OpportunityProvenance({
  page,
  locale,
}: {
  page: MarketInvestigationPage;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <dl
      className="analysis-context opportunity-context"
      aria-label={messages.provenance}
    >
      <div>
        <dt>{messages.baciRelease}</dt>
        <dd>{page.provenance.baciRelease}</dd>
      </div>
      <div>
        <dt>{messages.scoreWindow}</dt>
        <dd>
          {page.provenance.scoreWindow.start}–{page.provenance.scoreWindow.end}
        </dd>
      </div>
      <div>
        <dt>{messages.provisionalYear}</dt>
        <dd>{page.provenance.provisionalYear}</dd>
      </div>
      <div>
        <dt>{messages.productProjection}</dt>
        <dd>
          {page.projection.productCodes?.join(", ") ?? messages.allProducts}
        </dd>
      </div>
      <div>
        <dt>{messages.releaseRevision}</dt>
        <dd>{page.provenance.artifactBuildId}</dd>
      </div>
    </dl>
  );
}

function OpportunityBoundaries({
  page,
  locale,
}: {
  page: MarketInvestigationPage;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <section
      className="opportunity-boundaries"
      aria-labelledby="opportunity-boundaries-title"
    >
      <div>
        <p>{messages.nonClaims}</p>
        <h3 id="opportunity-boundaries-title">{messages.disclaimer}</h3>
      </div>
      <p>{page.discoveryDisclaimer}</p>
      <ul>
        {page.nonClaims.map((claim) => (
          <li key={claim}>{claim}</li>
        ))}
      </ul>
    </section>
  );
}

function adjacentLinks(
  candidate: MarketInvestigationCandidate,
  locale: WorkspaceLocale,
) {
  const drillDown = candidate.candidateMarketDrillDown;
  const candidateMarketContext: CandidateMarketContext = {
    recipe: "candidate-market",
    locale,
    productCode: drillDown.product.code,
    pin: null,
    exporterCode: drillDown.exporterCode,
    focusedMarketCode: drillDown.focusMarketCode,
  };
  return {
    candidateMarket: serializeTradeAnalysisContext("/", candidateMarketContext),
    tradeTrend: serializeTradeAnalysisContext("/", {
      recipe: "trade-trend",
      locale,
      productCode: drillDown.product.code,
      pin: null,
      importerCode: drillDown.focusMarketCode,
    }),
    supplierCompetition: serializeTradeAnalysisContext("/", {
      recipe: "supplier-competition",
      locale,
      productCode: drillDown.product.code,
      pin: null,
      importerCode: drillDown.focusMarketCode,
    }),
    tradeExplorer: serializeTradeAnalysisContext(
      "/",
      withRecipe(candidateMarketContext, "trade-explorer"),
    ),
  };
}

function appendOpportunityPage(
  current: MarketInvestigationPage,
  next: MarketInvestigationPage,
  requestedCursor: string,
): MarketInvestigationPage {
  const currentProducts = current.projection.productCodes ?? [];
  const nextProducts = next.projection.productCodes ?? [];
  if (
    next.page.requestedCursor !== requestedCursor ||
    next.analysisBuildId !== current.analysisBuildId ||
    next.exporter.code !== current.exporter.code ||
    next.cohortSize !== current.cohortSize ||
    next.provenance.artifactSha256 !== current.provenance.artifactSha256 ||
    currentProducts.length !== nextProducts.length ||
    currentProducts.some((code, index) => code !== nextProducts[index])
  ) {
    throw new TypeError(
      "Opportunity continuation does not match the loaded candidate feed.",
    );
  }
  const existingKeys = new Set(current.candidates.map(candidateKey));
  if (
    next.candidates.some((candidate) =>
      existingKeys.has(candidateKey(candidate)),
    )
  ) {
    throw new TypeError("Opportunity continuation repeats a loaded candidate.");
  }
  const candidates = [...current.candidates, ...next.candidates];
  return {
    ...current,
    page: {
      ...next.page,
      returnedCount: candidates.length,
    },
    candidates,
  };
}

function validatePageIdentity(
  page: MarketInvestigationPage,
  analysisBuildId: string,
  manifest: CurrentAnalysisManifest,
  pinResolution: ReturnType<typeof resolvePinnedContext>,
): void {
  if (page.analysisBuildId !== analysisBuildId) {
    throw new TypeError("Opportunity feed does not match the requested build.");
  }
  if (pinResolution.state === "retained") {
    if (
      page.provenance.baciRelease !== pinResolution.deployment.baciRelease ||
      page.provenance.artifactSha256 !== pinResolution.deployment.artifactSha256
    ) {
      throw new TypeError(
        "Opportunity feed does not match the retained manifest.",
      );
    }
    return;
  }
  if (
    page.provenance.recipeVersion !== "opportunity-discovery-v1" ||
    page.provenance.baciRelease !== manifest.source.baciRelease
  ) {
    throw new TypeError(
      "Opportunity feed does not match the current manifest.",
    );
  }
}

function feedErrorStatus(error: unknown): FeedStatus {
  if (error instanceof OpportunityDiscoveryClientError) {
    if (error.status === 400 || error.status === 404) {
      return "malformed";
    }
    if (error.status === 410) {
      return "stale";
    }
    if (error.status === 413) {
      return "budget";
    }
    if (error.status === 429) {
      return "rateLimit";
    }
    if (error.status === 503) {
      return "capacity";
    }
  }
  return "fatal";
}

function isErrorStatus(
  status: FeedStatus,
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

function candidateKey(candidate: MarketInvestigationCandidate): string {
  return `${candidate.product.code}:${candidate.market.code}`;
}

function opportunityActionId(candidate: MarketInvestigationCandidate): string {
  return `analyze-opportunity-${candidate.product.code}-${candidate.market.code}`;
}

function iso3ToIso2(iso3: string | null): string | null {
  if (iso3 === null) {
    return null;
  }
  const codes: Record<string, string> = {
    AUS: "AU",
    BEL: "BE",
    BRA: "BR",
    CAN: "CA",
    CHL: "CL",
    DEU: "DE",
    FRA: "FR",
    IND: "IN",
    JPN: "JP",
    KEN: "KE",
    MEX: "MX",
    NLD: "NL",
    POL: "PL",
    USA: "US",
    ZAF: "ZA",
  };
  return codes[iso3] ?? null;
}

function localizedConfidence(
  confidence: OpportunityConfidence,
  locale: WorkspaceLocale,
): string {
  if (locale === "en") {
    return confidence.label;
  }
  return confidence.label === "HIGH"
    ? "高"
    : confidence.label === "MEDIUM"
      ? "中"
      : "低";
}

function opportunityTypeLabel(
  candidate: MarketInvestigationCandidate,
  locale: WorkspaceLocale,
): string {
  const messages = copy[locale];
  if (candidate.opportunityType === "UNVALIDATED_MARKET_GAP") {
    return messages.marketGap;
  }
  if (candidate.opportunityType === "EXPANSION_EVIDENCE") {
    return messages.expansion;
  }
  return messages.generalEvidence;
}

function componentRows(
  candidate: MarketInvestigationCandidate,
  locale: WorkspaceLocale,
) {
  const messages = copy[locale];
  return [
    {
      label: messages.componentMarketSize,
      component: candidate.components.marketSize,
    },
    {
      label: messages.componentMarketGrowth,
      component: candidate.components.marketGrowth,
    },
    {
      label: messages.componentExporterPresence,
      component: candidate.components.exporterProductPresence,
    },
    {
      label: messages.componentRecordedFoothold,
      component: candidate.components.recordedFoothold,
    },
  ].map(({ label, component }) => ({
    label,
    state: component.state,
    stateClass: component.state === "COMPUTED" ? "computed" : "neutral",
    display: component.percentileDisplay,
  }));
}
