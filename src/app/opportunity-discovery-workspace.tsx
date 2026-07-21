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
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import {
  loadMarketInvestigationPage,
  OpportunityDiscoveryClientError,
} from "./opportunity-discovery-client";
import {
  candidateMarketAnalysisHref,
  openMarketAnalysis,
  readOpportunityReturnState,
  restoreOpportunityPosition,
  shouldHandleMarketAnalysisClick,
} from "./market-analysis-navigation";
import {
  appendOpportunityPage,
  opportunityCandidateKey,
  validateOpportunityPageIdentity,
} from "./opportunity-feed-pages";
import {
  marketAnalysisActionLabel,
  opportunityTypeLabel,
} from "./opportunity-row-presentation";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  productCodeOf,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withoutPin,
  withPin,
  withProductCode,
  withRecipe,
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
    marketGap: "Unvalidated Market Gap",
    expansion: "Expansion Evidence",
    generalEvidence: "General Investigation Evidence",
    nonClaims: "What this feed does not claim",
    disclaimer: "Discovery disclaimer",
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
    marketGap: "未验证市场缺口",
    expansion: "扩张证据",
    generalEvidence: "一般调查证据",
    nonClaims: "该列表不声称的内容",
    disclaimer: "发现免责声明",
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
    };
  }, [beginCurrentManifestRequest]);

  const resetFeed = useCallback(() => {
    feedController.current?.abort();
    requestSequence.current += 1;
    setFeed(null);
    setLoadedPageCount(0);
    setPaginationStatus("idle");
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
        urlContext,
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
      const controller = new AbortController();
      feedController.current = controller;
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      setFeed(null);
      setLoadedPageCount(0);
      setPaginationStatus("idle");
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
        validateOpportunityPageIdentity(
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
          validateOpportunityPageIdentity(
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

        const baseContext: TradeAnalysisContext = {
          recipe: "opportunity-discovery",
          locale: opportunityContext.locale,
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
    [currentManifest, exporter, product],
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
      validateOpportunityPageIdentity(
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
    return candidateMarketAnalysisHref({
      baseUrl: window.location.href,
      locale,
      pin: candidateMarketPin,
      exporterCode: feed.exporter.code,
      candidate,
    });
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

          {status === "success" && feed !== null ? (
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
                        <li key={opportunityCandidateKey(candidate)}>
                          <div className="opportunity-row-summary">
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
                          </div>
                          {analysisHref === null ? null : (
                            <a
                              id={opportunityActionId(candidate)}
                              className="candidate-primary-action"
                              aria-label={marketAnalysisActionLabel(
                                candidate,
                                locale,
                              )}
                              href={analysisHref}
                              onClick={(event) => {
                                if (!shouldHandleMarketAnalysisClick(event)) {
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

              </div>

              <OpportunityBoundaries page={feed} locale={locale} />
            </>
          ) : null}
        </>
      )}
    </section>
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

function opportunityActionId(candidate: MarketInvestigationCandidate): string {
  return `analyze-opportunity-${candidate.product.code}-${candidate.market.code}`;
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
