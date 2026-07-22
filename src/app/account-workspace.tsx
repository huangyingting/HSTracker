"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  MarketInvestigationCandidate,
} from "../domain/opportunity-discovery/result";
import { marketInvestigationCandidateKey } from "../domain/opportunity-discovery/candidate-identity";
import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { OpportunityDiscoveryV1Payload } from "../domain/trade-analytics/opportunity-discovery-v1-adapter";
import {
  confirmPortfolioProduct,
  consumeRecoveryToken,
  registerAccount,
  removePortfolioProduct,
  requestRecoveryToken,
  signInAccount,
  type AccountSessionPayload,
} from "./account-client";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import {
  buildPortfolioProjection,
  type PortfolioProjectionMode,
} from "./portfolio-projection";
import { loadMarketInvestigationPage } from "./opportunity-discovery-client";
import {
  candidateMarketAnalysisHref,
  openOpportunityMarketAnalysis,
  readOpportunityReturnState,
  restoreOpportunityPosition,
} from "./market-analysis-navigation";
import { OpportunityCandidateRow } from "./opportunity-candidate-row";
import { OpportunityExportAction } from "./opportunity-export-action";
import {
  loadCompleteOpportunityFeed,
  validateOpportunityPageIdentity,
} from "./opportunity-feed-pages";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withRecipe,
  type OpportunityDiscoveryContext,
} from "./trade-analysis-context";
import { announceTradeAnalysisContextChange } from "./trade-analysis-context-events";
import { WorkspaceScope } from "./workspace-scope";

const PAGE_LIMIT = 100;

const copy = {
  en: {
    authEyebrow: "Analyst account",
    authTitle: "Restore your exporter and product portfolio.",
    authBody:
      "Sign in to project the immutable public Opportunity Index into your saved portfolio workspace. Anonymous analysts can keep using the public workspace below.",
    signIn: "Sign in",
    createAccount: "Create account",
    recovery: "Account recovery",
    email: "Work email",
    password: "Password",
    displayName: "Display name",
    primaryExporter: "Primary export economy",
    signInSubmit: "Open portfolio workspace",
    registerSubmit: "Create portfolio workspace",
    recoverySubmit: "Issue recovery token",
    recoveryConsumeSubmit: "Set new password",
    recoveryToken: "Recovery token",
    newPassword: "New password",
    recoveryIssued: "Recovery token issued for this fixture/dev session:",
    authFailed: "The account request could not be completed.",
    signedInStatus: "Signed-in portfolio workspace",
    workspaceTitle: "Your portfolio opportunity workspace",
    workspaceLede:
      "The public Opportunity Index is read live for your primary exporter. Portfolio products only filter which rows are visible; canonical public ranks and scores never change.",
    primaryExporterLabel: "Primary exporter",
    portfolioProducts: "Portfolio products",
    emptyPortfolio: "No portfolio products confirmed",
    addProduct: "Add product to portfolio",
    addProductHint:
      "Enter an exact six-digit HS12 code, then confirm it into your operational portfolio.",
    removeProduct: "Remove",
    showComplete: "Show complete public ranking",
    showPortfolio: "Show portfolio filter",
    visibleRows: "visible rows",
    completeRows: "complete public rows",
    canonicalRank: "Canonical public rank",
    orderingExplanation:
      "Filtered from the canonical public Investigation Priority order. Portfolio products never rerank or recompute public evidence.",
    filterLabel: "Your portfolio filter",
    listLabel: "Portfolio Opportunity Candidates",
    currentLoading: "Loading current public analysis…",
    feedLoading: "Loading current public Opportunity Index…",
    currentUnavailable:
      "The current public analysis is temporarily unavailable.",
    feedUnavailable:
      "The current public Opportunity Index could not be loaded.",
    stale:
      "This retained link points at a retired analysis build. Refresh current analysis to choose today's public index.",
    refresh: "Refresh with current evidence",
    noVisibleRows: "No portfolio rows are visible.",
    noVisibleRowsBody:
      "Add a portfolio product that appears in the current public feed, or show the complete public ranking.",
    anonymousFallback: "Continue without signing in",
    discoverPortfolio: "Discover portfolio opportunities",
    discoverPortfolioRequirement:
      "Confirm at least one HS12 product before discovering portfolio opportunities.",
  },
  "zh-Hans": {
    authEyebrow: "分析师账户",
    authTitle: "恢复您的出口方与产品组合。",
    authBody:
      "登录后可把不可变的公共机会索引投影到已保存的组合工作区。未登录分析师仍可使用下方公共工作区。",
    signIn: "登录",
    createAccount: "创建账户",
    recovery: "账户恢复",
    email: "工作邮箱",
    password: "密码",
    displayName: "显示名称",
    primaryExporter: "主要出口经济体",
    signInSubmit: "打开组合工作区",
    registerSubmit: "创建组合工作区",
    recoverySubmit: "签发恢复令牌",
    recoveryConsumeSubmit: "设置新密码",
    recoveryToken: "恢复令牌",
    newPassword: "新密码",
    recoveryIssued: "本测试/开发会话的恢复令牌：",
    authFailed: "无法完成账户请求。",
    signedInStatus: "已登录组合工作区",
    workspaceTitle: "您的组合机会工作区",
    workspaceLede:
      "系统会按您的主要出口方实时读取公共机会索引。组合产品只筛选可见行；公共规范排名和分数不会改变。",
    primaryExporterLabel: "主要出口方",
    portfolioProducts: "组合产品",
    emptyPortfolio: "尚未确认组合产品",
    addProduct: "添加产品到组合",
    addProductHint: "输入精确的六位 HS12 编码，然后确认到运营组合中。",
    removeProduct: "移除",
    showComplete: "显示完整公共排名",
    showPortfolio: "显示组合筛选",
    visibleRows: "个可见行",
    completeRows: "个完整公共行",
    canonicalRank: "公共规范排名",
    orderingExplanation:
      "从公共规范调查优先级顺序中筛选。产品组合绝不会重新排名或重新计算公共证据。",
    filterLabel: "您的组合筛选",
    listLabel: "组合机会候选项",
    currentLoading: "正在加载当前公共分析…",
    feedLoading: "正在加载当前公共机会索引…",
    currentUnavailable: "当前公共分析暂时不可用。",
    feedUnavailable: "无法加载当前公共机会索引。",
    stale: "该保留链接指向已停用的分析构建。刷新当前分析以选择今天的公共索引。",
    refresh: "使用当前证据刷新",
    noVisibleRows: "没有可见组合行。",
    noVisibleRowsBody:
      "请添加出现在当前公共列表中的组合产品，或显示完整公共排名。",
    anonymousFallback: "不登录继续",
    discoverPortfolio: "发现产品组合机会",
    discoverPortfolioRequirement:
      "请至少确认一个 HS12 产品后再发现产品组合机会。",
  },
} as const;

type AccountLocale = keyof typeof copy;
type AuthMode = "sign-in" | "register" | "recovery";
type FeedStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "stale"
  | "current-failed"
  | "feed-failed";

function opportunityPortfolioModeFromLocation(): PortfolioProjectionMode {
  if (typeof window === "undefined") {
    return "complete";
  }
  const context = parseTradeAnalysisContext(window.location.href);
  return context.recipe === "opportunity-discovery" &&
    context.portfolioFilter === true
    ? "portfolio"
    : "complete";
}

export function AccountAuthPanel({
  locale,
  onAuthenticated,
  onAnonymousFallback,
}: {
  locale: AccountLocale;
  onAuthenticated: (session: AccountSessionPayload) => void;
  onAnonymousFallback: () => void;
}) {
  const messages = copy[locale];
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [primaryExporter, setPrimaryExporter] = useState("156");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [issuedRecovery, setIssuedRecovery] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "failed">(
    "idle",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      if (mode === "register") {
        onAuthenticated(
          await registerAccount({
            email,
            password,
            displayName,
            primaryExportEconomy: primaryExporter,
          }),
        );
        return;
      }
      if (mode === "recovery") {
        if (token.trim().length === 0) {
          const recovery = await requestRecoveryToken({ email });
          setIssuedRecovery({
            token: recovery.recoveryToken,
            expiresAt: recovery.expiresAt,
          });
          setToken(recovery.recoveryToken);
        } else {
          await consumeRecoveryToken({ token, newPassword });
          setMode("sign-in");
        }
        setStatus("idle");
        return;
      }
      onAuthenticated(await signInAccount({ email, password }));
    } catch (error) {
      console.error("Account form failed", error);
      setStatus("failed");
    }
  }

  return (
    <section
      className="account-panel account-auth"
      id="discovery"
      tabIndex={-1}
      aria-labelledby="account-auth-title"
    >
      <div className="account-copy">
        <p>{messages.authEyebrow}</p>
        <h2 id="account-auth-title">{messages.authTitle}</h2>
        <p>{messages.authBody}</p>
      </div>
      <div className="account-auth-card">
        <div
          className="account-mode-tabs"
          role="group"
          aria-label={messages.authEyebrow}
        >
          <button
            type="button"
            aria-pressed={mode === "sign-in"}
            onClick={() => setMode("sign-in")}
          >
            {messages.signIn}
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => setMode("register")}
          >
            {messages.createAccount}
          </button>
          <button
            type="button"
            aria-pressed={mode === "recovery"}
            onClick={() => setMode("recovery")}
          >
            {messages.recovery}
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {messages.email}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {mode === "recovery" && issuedRecovery !== null ? (
            <p className="recovery-token">
              {messages.recoveryIssued} <strong>{issuedRecovery.token}</strong>
            </p>
          ) : null}
          {mode === "recovery" ? (
            <>
              <label>
                {messages.recoveryToken}
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
              <label>
                {messages.newPassword}
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label>
              {messages.password}
              <input
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {mode === "register" ? (
            <>
              <label>
                {messages.displayName}
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                {messages.primaryExporter}
                <input
                  value={primaryExporter}
                  onChange={(event) => setPrimaryExporter(event.target.value)}
                />
              </label>
            </>
          ) : null}
          {status === "failed" ? (
            <p className="account-error" role="alert">
              {messages.authFailed}
            </p>
          ) : null}
          <div className="account-form-actions">
            <button type="submit" disabled={status === "submitting"}>
              {mode === "register"
                ? messages.registerSubmit
                : mode === "recovery" && token.trim().length > 0
                  ? messages.recoveryConsumeSubmit
                  : mode === "recovery"
                    ? messages.recoverySubmit
                    : messages.signInSubmit}
            </button>
            <button type="button" onClick={onAnonymousFallback}>
              {messages.anonymousFallback}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export function SignedInPortfolioWorkspace({
  locale,
  session,
  onSessionChange,
}: {
  locale: AccountLocale;
  session: AccountSessionPayload;
  onSessionChange: (session: AccountSessionPayload) => void;
}) {
  const messages = copy[locale];
  const [manifest, setManifest] = useState<CurrentAnalysisManifest | null>(
    null,
  );
  const [feed, setFeed] = useState<OpportunityDiscoveryV1Payload | null>(null);
  const [feedDeploymentState, setFeedDeploymentState] = useState<
    "current" | "retained" | null
  >(null);
  const [status, setStatus] = useState<FeedStatus>("idle");
  const [mode, setMode] = useState<PortfolioProjectionMode>(
    opportunityPortfolioModeFromLocation,
  );
  const [portfolioProduct, setPortfolioProduct] =
    useState<ProductSearchProduct | null>(null);
  const [productControlKey, setProductControlKey] = useState(0);
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);
  const currentController = useRef<AbortController | null>(null);
  const feedController = useRef<AbortController | null>(null);
  const portfolioRef = useRef(session.portfolio);
  const modeRef = useRef(mode);
  const loadedPageCountRef = useRef(0);
  const restoredReturnAction = useRef<string | null>(null);

  useEffect(() => {
    portfolioRef.current = session.portfolio;
  }, [session.portfolio]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const loadFeed = useCallback(
    async (revalidate = false, discover = true) => {
      setStatus(discover ? "loading" : "idle");
      currentController.current?.abort();
      feedController.current?.abort();
      const current = new AbortController();
      currentController.current = current;
      try {
        const nextManifest = await loadCurrentAnalysisManifest({
          fetcher: fetch,
          signal: current.signal,
          revalidate,
        });
        setManifest(nextManifest);
        if (!discover) {
          setFeed(null);
          setFeedDeploymentState(null);
          loadedPageCountRef.current = 0;
          setStatus(
            portfolioRef.current.length === 0 ? "empty" : "idle",
          );
          return;
        }
        const locationContext = parseTradeAnalysisContext(window.location.href);
        const baseContext = withRecipe(
          locationContext,
          "opportunity-discovery",
        );
        if (baseContext.recipe !== "opportunity-discovery") {
          return;
        }
        const requestedPinResolution = resolvePinnedContext(
          locationContext.pin,
          nextManifest,
          "opportunity-discovery",
        );
        if (!revalidate && requestedPinResolution.state === "retired") {
          setStatus("stale");
          return;
        }
        const requestedPinState = requestedPinResolution.state;
        const context: OpportunityDiscoveryContext = {
          ...baseContext,
          pin: revalidate ? null : locationContext.pin,
        };
        if (portfolioRef.current.length === 0) {
          setFeed(null);
          setFeedDeploymentState(null);
          loadedPageCountRef.current = 0;
          setStatus("empty");
          return;
        }
        const pinResolution = resolvePinnedContext(
          context.pin,
          nextManifest,
          "opportunity-discovery",
        );
        if (pinResolution.state === "retired") {
          setStatus("stale");
          return;
        }
        const analysisBuildId =
          pinResolution.state === "retained"
            ? pinResolution.deployment.analysisBuildId
            : nextManifest.analysisBuildId;
        const feedRequest = new AbortController();
        feedController.current = feedRequest;
        let page = await loadMarketInvestigationPage({
          analysisBuildId,
          exporterCode: session.primaryExporter,
          productCodes: null,
          limit: PAGE_LIMIT,
          cursor: null,
          fetcher: fetch,
          signal: feedRequest.signal,
        });
        validateOpportunityPageIdentity(
          page,
          analysisBuildId,
          nextManifest,
          pinResolution,
        );
        page = await loadCompleteOpportunityFeed({
          page,
          fetcher: fetch,
          signal: feedRequest.signal,
        });
        loadedPageCountRef.current = Math.max(
          1,
          Math.ceil(page.candidates.length / PAGE_LIMIT),
        );
        setFeed(page);
        setFeedDeploymentState(
          pinResolution.state === "retained" ? "retained" : "current",
        );
        const projection = buildPortfolioProjection(
          page,
          portfolioRef.current,
          modeRef.current,
        );
        setStatus(projection.scopeRows.length === 0 ? "empty" : "ready");
        const servedPin =
          pinResolution.state === "retained"
            ? pinResolution.pin
            : pinFromDeploymentWindow(
                nextManifest,
                nextManifest.analysisBuildId,
                "opportunity-discovery",
              );
        if (servedPin === null) {
          setStatus("current-failed");
          return;
        }
        const servedUrl = serializeTradeAnalysisContext(
          window.location.href,
          {
            ...baseContext,
            pin: servedPin,
            exportEconomyCode: session.primaryExporter,
            portfolioFilter: modeRef.current === "portfolio",
          },
        );
        if (revalidate && requestedPinState !== "current") {
          const currentUrl = servedUrl;
          window.history.pushState(null, "", currentUrl);
          window.dispatchEvent(
            new PopStateEvent("popstate", { state: window.history.state }),
          );
        } else {
          window.history.replaceState(window.history.state, "", servedUrl);
          announceTradeAnalysisContextChange();
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Portfolio opportunity feed failed", error);
        setStatus("feed-failed");
      }
    },
    [session.primaryExporter],
  );

  useEffect(() => {
    const context = parseTradeAnalysisContext(window.location.href);
    const restoreSubmittedScope = context.pin !== null;
    const timeout = window.setTimeout(
      () => void loadFeed(false, restoreSubmittedScope),
      0,
    );
    return () => {
      window.clearTimeout(timeout);
      currentController.current?.abort();
      feedController.current?.abort();
    };
  }, [loadFeed]);

  useLayoutEffect(() => {
    function restoreFocusFromHistory() {
      if (feed === null) {
        return;
      }
      const context = parseTradeAnalysisContext(window.location.href);
      if (context.recipe === "opportunity-discovery") {
        const nextMode =
          context.portfolioFilter === true ? "portfolio" : "complete";
        modeRef.current = nextMode;
        setMode(nextMode);
      }
      const returnState = readOpportunityReturnState(
        window.history.state,
        "portfolio",
      );
      if (
        returnState !== null &&
        restoredReturnAction.current !== returnState.actionId
      ) {
        restoredReturnAction.current = returnState.actionId;
        restoreOpportunityPosition(returnState, "portfolio-list-scroll");
        return;
      }
      const requestedBuildId =
        context.pin?.analysisBuildId ?? feed.analysisBuildId;
      if (requestedBuildId !== feed.analysisBuildId) {
        void loadFeed(false);
      }
    }
    restoreFocusFromHistory();
    window.addEventListener("popstate", restoreFocusFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreFocusFromHistory);
  }, [feed, loadFeed]);

  async function addProduct() {
    if (portfolioProduct === null) {
      return;
    }
    const portfolio = await confirmPortfolioProduct({
      hsRevision: portfolioProduct.hsRevision,
      code: portfolioProduct.code,
    });
    portfolioRef.current = portfolio;
    onSessionChange({ ...session, portfolio });
    updateMode("portfolio");
    setPortfolioProduct(null);
    setProductControlKey((current) => current + 1);
    if (feed === null) {
      setStatus("idle");
    }
  }

  async function removeProduct(code: string) {
    const portfolio = await removePortfolioProduct({
      hsRevision: "HS12",
      code,
    });
    portfolioRef.current = portfolio;
    onSessionChange({ ...session, portfolio });
    updateMode("portfolio");
  }

  function updateMode(
    nextMode: PortfolioProjectionMode,
    navigation: "push" | "replace" = "replace",
  ) {
    modeRef.current = nextMode;
    setMode(nextMode);
    const context = withRecipe(
      parseTradeAnalysisContext(window.location.href),
      "opportunity-discovery",
    );
    if (context.recipe === "opportunity-discovery") {
      const url = serializeTradeAnalysisContext(window.location.href, {
        ...context,
        exportEconomyCode: session.primaryExporter,
        portfolioFilter: nextMode === "portfolio",
      });
      if (navigation === "push") {
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(window.history.state, "", url);
      }
      announceTradeAnalysisContextChange();
    }
  }

  function refreshCurrentAnalysis() {
    void loadFeed(true);
  }

  function discoverPortfolioOpportunities() {
    updateMode("portfolio");
    void loadFeed(false, true);
  }

  const projection =
    feed === null
      ? null
      : buildPortfolioProjection(feed, session.portfolio, mode);
  const candidateMarketPin =
    manifest === null || feed === null
      ? null
      : pinFromDeploymentWindow(
          manifest,
          feed.analysisBuildId,
          "candidate-market",
        );
  const candidateMarketNavigationScope =
    feed === null || candidateMarketPin === null
      ? null
      : {
          locale,
          pin: candidateMarketPin,
          exporterCode: feed.exporter.code,
        };

  return (
    <section
      className="analysis-workspace opportunity-workspace portfolio-workspace"
      id="discovery"
      tabIndex={-1}
      aria-labelledby="portfolio-title"
    >
      <div className="portfolio-header">
        <div>
          <p>{messages.signedInStatus}</p>
          <h2 id="portfolio-title">{messages.workspaceTitle}</h2>
          <p>{messages.workspaceLede}</p>
        </div>
      </div>
      <dl className="portfolio-account-summary">
        <div>
          <dt>{messages.primaryExporterLabel}</dt>
          <dd>
            {messages.primaryExporterLabel}: {session.primaryExporter}
          </dd>
        </div>
        <div>
          <dt>{messages.portfolioProducts}</dt>
          <dd>
            {session.portfolio.length === 0
              ? messages.emptyPortfolio
              : `${messages.portfolioProducts}: ${session.portfolio
                  .map(({ product }) => product.code)
                  .join(", ")}`}
          </dd>
        </div>
      </dl>
      {manifest === null ||
      (status !== "stale" &&
        (feed === null || feedDeploymentState === null)) ? null : (
        <WorkspaceScope
          locale={locale}
          exporter={
            feed?.exporter ?? {
              code: session.primaryExporter,
              name: session.primaryExporter,
            }
          }
          product={{
            mode: "portfolio",
            codes: session.portfolio.map(({ product }) => product.code),
          }}
          deploymentState={
            status === "stale"
              ? "retired"
              : (feedDeploymentState ?? "current")
          }
          deploymentActivation={manifest.freshness.deploymentActivation}
          baciRelease={
            status === "stale"
              ? null
              : (feed?.provenance.baciRelease ??
                manifest.source.baciRelease)
          }
          finalizedWindow={
            status === "stale"
              ? null
              : (feed?.provenance.scoreWindow ??
                manifest.source.windows.score)
          }
          provisionalYear={
            status === "stale"
              ? null
              : (feed?.provenance.provisionalYear ??
                manifest.source.provisionalYear)
          }
          freshnessState={
            status !== "stale" && feedDeploymentState === "current"
              ? manifest.freshness.state
              : null
          }
          analysisIdentity={
            status === "stale" ? undefined : feed?.analysisIdentity
          }
          datasetPackageIdentity={
            status === "stale" ? undefined : feed?.datasetPackageIdentity
          }
          canCopyLink={feed !== null || status === "stale"}
          onChangeScope={() =>
            document
              .querySelector<HTMLElement>(
                ".portfolio-product-tools [role=\"combobox\"]",
              )
              ?.focus()
          }
          onSourceDetails={
            status !== "stale" && feedDeploymentState === "current"
              ? () => setSourceDetailsOpen(true)
              : undefined
          }
        />
      )}
      {manifest !== null &&
      status !== "stale" &&
      feedDeploymentState === "current" ? (
        <SourceScope
          manifest={manifest}
          result={null}
          locale={locale}
          detailsOpen={sourceDetailsOpen}
          onDetailsOpenChange={setSourceDetailsOpen}
        />
      ) : null}
      <div className="portfolio-product-tools">
        {manifest === null ? null : (
          <ProductCombobox
            key={`portfolio-product-${productControlKey}`}
            productSearchBuildId={manifest.productSearchBuildId}
            locale={locale}
            syncUrl={false}
            onSelectionChange={(nextProduct) =>
              setPortfolioProduct(nextProduct)
            }
            onRetiredBuild={refreshCurrentAnalysis}
          />
        )}
        <button
          type="button"
          disabled={portfolioProduct === null}
          onClick={() => void addProduct()}
        >
          {messages.addProduct}
        </button>
        <small>{messages.addProductHint}</small>
        {session.portfolio.map(({ product }) => (
          <button
            type="button"
            className="portfolio-chip"
            key={`${product.hsRevision}:${product.code}`}
            onClick={() => void removeProduct(product.code)}
          >
            {messages.removeProduct} {product.code}
          </button>
        ))}
      </div>
      <div className="analysis-submit">
        <button
          className="analyze-button"
          type="button"
          aria-describedby="portfolio-discovery-requirement"
          disabled={
            session.portfolio.length === 0 ||
            status === "loading" ||
            status === "stale"
          }
          onClick={discoverPortfolioOpportunities}
        >
          {messages.discoverPortfolio}
        </button>
        <small id="portfolio-discovery-requirement">
          {messages.discoverPortfolioRequirement}
        </small>
      </div>
      <div className="portfolio-filter-bar" aria-label={messages.filterLabel}>
        <button
          type="button"
          aria-pressed={mode === "complete"}
          onClick={() => updateMode("complete", "push")}
        >
          {messages.showComplete}
        </button>
        <button
          type="button"
          aria-pressed={mode === "portfolio"}
          onClick={() => updateMode("portfolio", "push")}
        >
          {messages.showPortfolio}
        </button>
        <button type="button" onClick={refreshCurrentAnalysis}>
          {messages.refresh}
        </button>
        {projection === null ? null : (
          <span>
            {projection.scopeRows.length} {messages.visibleRows} ·{" "}
            {projection.completeRows.length} {messages.completeRows}
          </span>
        )}
      </div>
      {status === "loading" ? (
        <div className="analysis-state analysis-loading" role="status">
          <span aria-hidden="true" />
          {manifest === null ? messages.currentLoading : messages.feedLoading}
        </div>
      ) : status === "current-failed" ||
        status === "feed-failed" ||
        status === "stale" ? (
        <div className="analysis-state analysis-error" role="alert">
          <p>
            {status === "stale"
              ? messages.stale
              : status === "current-failed"
                ? messages.currentUnavailable
                : messages.feedUnavailable}
          </p>
          <button type="button" onClick={() => void loadFeed(true)}>
            {messages.refresh}
          </button>
        </div>
      ) : status === "empty" && feed === null ? (
        <div className="analysis-state" role="status">
          <h3>{messages.emptyPortfolio}</h3>
          <p>{messages.addProductHint}</p>
        </div>
      ) : null}
      {projection !== null && feed !== null ? (
        <>
          <div className="portfolio-feed">
            <section
              className="portfolio-list"
              aria-labelledby="portfolio-candidates-title"
            >
              <div className="candidate-heading">
                <div>
                  <p>{messages.filterLabel}</p>
                  <h3 id="portfolio-candidates-title">{feed.exporter.name}</h3>
                </div>
                <strong>{feed.provenance.baciRelease}</strong>
              </div>
              <p className="opportunity-ordering">
                {messages.orderingExplanation}
              </p>
              {projection.scopeRows.length === 0 ? (
                <div className="analysis-state" role="status">
                  <h3>{messages.noVisibleRows}</h3>
                  <p>{messages.noVisibleRowsBody}</p>
                </div>
              ) : (
                <ol id="portfolio-list-scroll" aria-label={messages.listLabel}>
                  {projection.scopeRows.map((row) => {
                    const analysisHref = candidateMarketAnalysisHref({
                      baseUrl: window.location.href,
                      scope: candidateMarketNavigationScope,
                      candidate: row.candidate,
                    });
                    return (
                      <OpportunityCandidateRow
                        key={marketInvestigationCandidateKey(row.candidate)}
                        candidate={row.candidate}
                        locale={locale}
                        leading={`${messages.canonicalRank} #${row.canonicalRank}`}
                        summaryClassName="portfolio-row-summary"
                        actionId={portfolioActionId(row.candidate)}
                        href={analysisHref}
                        onOpen={() => {
                          if (analysisHref !== null) {
                            openOpportunityMarketAnalysis(analysisHref, {
                              source: "portfolio",
                              actionId: portfolioActionId(row.candidate),
                              listId: "portfolio-list-scroll",
                              loadedPages: loadedPageCountRef.current,
                            });
                          }
                        }}
                      />
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
          <OpportunityExportAction
            page={feed}
            candidateKeys={projection.scopeRows.map((row) =>
              marketInvestigationCandidateKey(row.candidate),
            )}
            scope="portfolio"
            locale={locale}
          />
        </>
      ) : null}
    </section>
  );
}

function portfolioActionId(candidate: MarketInvestigationCandidate): string {
  return `analyze-portfolio-${candidate.product.code}-${candidate.market.code}`;
}
