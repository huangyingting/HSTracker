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
  MarketInvestigationPage,
  OpportunityConfidence,
} from "../domain/opportunity-discovery/result";
import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  confirmPortfolioProduct,
  consumeRecoveryToken,
  loadAccountSession,
  registerAccount,
  removePortfolioProduct,
  requestRecoveryToken,
  signInAccount,
  signOutAccount,
  type AccountSessionPayload,
} from "./account-client";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import {
  buildPortfolioProjection,
  candidateProjectionKey,
  type PortfolioProjectionMode,
} from "./portfolio-projection";
import { loadMarketInvestigationPage } from "./opportunity-discovery-client";
import {
  openMarketAnalysis,
  readOpportunityReturnState,
  restoreOpportunityPosition,
} from "./market-analysis-navigation";
import { ProductCombobox } from "./product-combobox";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withLocale,
  withRecipe,
  type CandidateMarketContext,
  type OpportunityDiscoveryContext,
} from "./trade-analysis-context";

const PAGE_LIMIT = 100;

const copy = {
  en: {
    loadingSession: "Checking portfolio session…",
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
    signOut: "Sign out",
    primaryExporterLabel: "Primary exporter",
    portfolioProducts: "Portfolio products",
    emptyPortfolio: "No portfolio products confirmed",
    addProductLabel: "Confirm HS12 product code",
    addProduct: "Add product to portfolio",
    addProductHint:
      "Enter an exact six-digit HS12 code, then confirm it into your operational portfolio.",
    removeProduct: "Remove",
    showComplete: "Show complete public ranking",
    showPortfolio: "Show portfolio filter",
    visibleRows: "visible rows",
    completeRows: "complete public rows",
    canonicalRank: "Canonical public rank",
    filterLabel: "Your portfolio filter",
    listLabel: "Portfolio Opportunity Candidates",
    selectedDetail: "Selected portfolio candidate detail",
    investigationPriority: "Investigation Priority",
    marketAttractiveness: "Market Attractiveness",
    exporterFit: "Exporter Fit",
    confidence: "Data Confidence",
    coverage: "Coverage",
    marketGap: "Unvalidated Market Gap",
    expansion: "Expansion Evidence",
    generalEvidence: "General Investigation Evidence",
    currentLoading: "Loading current public analysis…",
    feedLoading: "Loading current public Opportunity Index…",
    currentUnavailable:
      "The current public analysis is temporarily unavailable.",
    feedUnavailable:
      "The current public Opportunity Index could not be loaded.",
    stale:
      "This retained link points at a retired analysis build. Refresh current analysis to choose today's public index.",
    refresh: "Refresh current analysis",
    noVisibleRows: "No portfolio rows are visible.",
    noVisibleRowsBody:
      "Add a portfolio product that appears in the current public feed, or show the complete public ranking.",
    analyzeMarket: "Analyze this market",
    anonymousFallback: "Continue without signing in",
  },
  "zh-Hans": {
    loadingSession: "正在检查组合会话…",
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
    signOut: "退出登录",
    primaryExporterLabel: "主要出口方",
    portfolioProducts: "组合产品",
    emptyPortfolio: "尚未确认组合产品",
    addProductLabel: "确认 HS12 产品编码",
    addProduct: "添加产品到组合",
    addProductHint: "输入精确的六位 HS12 编码，然后确认到运营组合中。",
    removeProduct: "移除",
    showComplete: "显示完整公共排名",
    showPortfolio: "显示组合筛选",
    visibleRows: "个可见行",
    completeRows: "个完整公共行",
    canonicalRank: "公共规范排名",
    filterLabel: "您的组合筛选",
    listLabel: "组合机会候选项",
    selectedDetail: "所选组合候选项详情",
    investigationPriority: "调查优先级",
    marketAttractiveness: "市场吸引力",
    exporterFit: "出口方匹配度",
    confidence: "数据置信度",
    coverage: "覆盖",
    marketGap: "未验证市场缺口",
    expansion: "扩张证据",
    generalEvidence: "一般调查证据",
    currentLoading: "正在加载当前公共分析…",
    feedLoading: "正在加载当前公共机会索引…",
    currentUnavailable: "当前公共分析暂时不可用。",
    feedUnavailable: "无法加载当前公共机会索引。",
    stale: "该保留链接指向已停用的分析构建。刷新当前分析以选择今天的公共索引。",
    refresh: "刷新当前分析",
    noVisibleRows: "没有可见组合行。",
    noVisibleRowsBody:
      "请添加出现在当前公共列表中的组合产品，或显示完整公共排名。",
    analyzeMarket: "分析此市场",
    anonymousFallback: "不登录继续",
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

export function AccountWorkspace({
  locale,
  onSignedInChange,
  onAnonymousFallback,
}: {
  locale: AccountLocale;
  onSignedInChange: (signedIn: boolean) => void;
  onAnonymousFallback: () => void;
}) {
  const messages = copy[locale];
  const [session, setSession] = useState<AccountSessionPayload | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    void loadAccountSession()
      .then((payload) => {
        if (!cancelled) {
          setSession(payload);
          onSignedInChange(payload !== null);
          setSessionStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Account session restore failed", error);
          setSession(null);
          onSignedInChange(false);
          setSessionStatus("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onSignedInChange]);

  async function handleSignOut() {
    await signOutAccount();
    setSession(null);
    onSignedInChange(false);
    onAnonymousFallback();
  }

  if (sessionStatus === "loading") {
    return (
      <section
        className="account-panel account-panel--pending"
        aria-live="polite"
      >
        <p>{messages.loadingSession}</p>
      </section>
    );
  }

  return session === null ? (
    <AccountAuthPanel
      locale={locale}
      onAuthenticated={(payload) => {
        setSession(payload);
        onSignedInChange(true);
      }}
      onAnonymousFallback={onAnonymousFallback}
    />
  ) : (
    <SignedInPortfolioWorkspace
      locale={locale}
      session={session}
      onSessionChange={setSession}
      onSignOut={() => void handleSignOut()}
    />
  );
}

function AccountAuthPanel({
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

function SignedInPortfolioWorkspace({
  locale,
  session,
  onSessionChange,
  onSignOut,
}: {
  locale: AccountLocale;
  session: AccountSessionPayload;
  onSessionChange: (session: AccountSessionPayload) => void;
  onSignOut: () => void;
}) {
  const messages = copy[locale];
  const [manifest, setManifest] = useState<CurrentAnalysisManifest | null>(
    null,
  );
  const [feed, setFeed] = useState<MarketInvestigationPage | null>(null);
  const [status, setStatus] = useState<FeedStatus>("idle");
  const [mode, setMode] = useState<PortfolioProjectionMode>(
    opportunityPortfolioModeFromLocation,
  );
  const [portfolioProduct, setPortfolioProduct] =
    useState<ProductSearchProduct | null>(null);
  const [productControlKey, setProductControlKey] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const currentController = useRef<AbortController | null>(null);
  const feedController = useRef<AbortController | null>(null);
  const portfolioRef = useRef(session.portfolio);
  const modeRef = useRef(mode);

  useEffect(() => {
    portfolioRef.current = session.portfolio;
  }, [session.portfolio]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const loadFeed = useCallback(
    async (revalidate = false) => {
      setStatus("loading");
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
        const locationContext = parseTradeAnalysisContext(window.location.href);
        const baseContext = withRecipe(
          withLocale(locationContext, locale),
          "opportunity-discovery",
        );
        if (baseContext.recipe !== "opportunity-discovery") {
          return;
        }
        const translatedPin =
          locationContext.pin === null
            ? null
            : pinFromDeploymentWindow(
                nextManifest,
                locationContext.pin.analysisBuildId,
                "opportunity-discovery",
              );
        if (locationContext.pin !== null && translatedPin === null) {
          setStatus("stale");
          return;
        }
        const context: OpportunityDiscoveryContext = {
          ...baseContext,
          pin: translatedPin,
        };
        if (portfolioRef.current.length === 0) {
          setFeed(null);
          setSelectedKey(null);
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
        const page = await loadMarketInvestigationPage({
          analysisBuildId,
          exporterCode: session.primaryExporter,
          productCodes: null,
          limit: PAGE_LIMIT,
          cursor: null,
          fetcher: fetch,
          signal: feedRequest.signal,
        });
        setFeed(page);
        const projection = buildPortfolioProjection(
          page,
          portfolioRef.current,
          modeRef.current,
        );
        const requestedKey =
          context.focusProductCode != null && context.focusedMarketCode != null
            ? `${context.focusProductCode}:${context.focusedMarketCode}`
            : null;
        const selected =
          projection.completeRows.find(
            (row) => candidateProjectionKey(row.candidate) === requestedKey,
          ) ??
          projection.visibleRows[0] ??
          projection.completeRows[0] ??
          null;
        setSelectedKey(
          selected === null ? null : candidateProjectionKey(selected.candidate),
        );
        setStatus(projection.visibleRows.length === 0 ? "empty" : "ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Portfolio opportunity feed failed", error);
        setStatus("feed-failed");
      }
    },
    [locale, session.primaryExporter],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadFeed(false), 0);
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
      if (
        context.recipe === "opportunity-discovery" &&
        context.focusProductCode != null &&
        context.focusedMarketCode != null
      ) {
        const key = `${context.focusProductCode}:${context.focusedMarketCode}`;
        if (
          feed.candidates.some(
            (candidate) => candidateProjectionKey(candidate) === key,
          )
        ) {
          setSelectedKey(key);
        }
      }
      const returnState = readOpportunityReturnState(
        window.history.state,
        "portfolio",
      );
      if (returnState !== null) {
        restoreOpportunityPosition(returnState, "portfolio-list-scroll");
      }
    }
    window.addEventListener("popstate", restoreFocusFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreFocusFromHistory);
  }, [feed]);

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
      await loadFeed(false);
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

  function updateMode(nextMode: PortfolioProjectionMode) {
    modeRef.current = nextMode;
    setMode(nextMode);
  }

  function selectCandidate(candidate: MarketInvestigationCandidate) {
    const key = candidateProjectionKey(candidate);
    setSelectedKey(key);
  }

  function refreshCurrentAnalysis() {
    void loadFeed(true);
  }

  const projection =
    feed === null
      ? null
      : buildPortfolioProjection(feed, session.portfolio, mode);
  const selectedRow =
    projection?.completeRows.find(
      (row) => candidateProjectionKey(row.candidate) === selectedKey,
    ) ??
    projection?.visibleRows[0] ??
    null;
  const candidateMarketPin =
    manifest === null || feed === null
      ? null
      : pinFromDeploymentWindow(
          manifest,
          feed.analysisBuildId,
          "candidate-market",
        );

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
    const list = document.getElementById("portfolio-list-scroll");
    openMarketAnalysis(href, {
      source: "portfolio",
      actionId: portfolioActionId(candidate),
      scrollY: window.scrollY,
      listScrollTop: list?.scrollTop ?? null,
      loadedPages: 1,
    });
  }

  return (
    <section
      className="account-panel portfolio-workspace"
      aria-labelledby="portfolio-title"
    >
      <div className="portfolio-header">
        <div>
          <p>{messages.signedInStatus}</p>
          <h2 id="portfolio-title">{messages.workspaceTitle}</h2>
          <p>{messages.workspaceLede}</p>
        </div>
        <button type="button" onClick={onSignOut}>
          {messages.signOut}
        </button>
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
      <div className="portfolio-filter-bar" aria-label={messages.filterLabel}>
        <button
          type="button"
          aria-pressed={mode === "complete"}
          onClick={() => updateMode("complete")}
        >
          {messages.showComplete}
        </button>
        <button
          type="button"
          aria-pressed={mode === "portfolio"}
          onClick={() => updateMode("portfolio")}
        >
          {messages.showPortfolio}
        </button>
        <button type="button" onClick={refreshCurrentAnalysis}>
          {messages.refresh}
        </button>
        {projection === null ? null : (
          <span>
            {projection.visibleRows.length} {messages.visibleRows} ·{" "}
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
              {projection.visibleRows.length === 0 ? (
                <div className="analysis-state" role="status">
                  <h3>{messages.noVisibleRows}</h3>
                  <p>{messages.noVisibleRowsBody}</p>
                </div>
              ) : (
                <ol id="portfolio-list-scroll" aria-label={messages.listLabel}>
                  {projection.visibleRows.map((row) => {
                    const analysisHref = marketAnalysisHref(row.candidate);
                    return (
                      <li key={candidateProjectionKey(row.candidate)}>
                        <button
                          type="button"
                          aria-pressed={
                            candidateProjectionKey(row.candidate) ===
                            selectedKey
                          }
                          onClick={() => selectCandidate(row.candidate)}
                        >
                          <span>
                            {messages.canonicalRank} #{row.canonicalRank}
                          </span>
                          <span>
                            <span className="opportunity-row-identities">
                              <strong>
                                HS12 {row.candidate.product.code} ·{" "}
                                {row.candidate.product.descriptionEn}
                              </strong>
                              <strong>{row.candidate.market.name}</strong>
                            </span>
                            <small>
                              {portfolioOpportunityTypeLabel(
                                row.candidate,
                                locale,
                              )}
                            </small>
                            <span className="opportunity-row-metrics">
                              <span>
                                {messages.marketAttractiveness}{" "}
                                {row.candidate.marketAttractiveness.display}
                              </span>
                              <span>
                                {messages.exporterFit}{" "}
                                {row.candidate.exporterFit.display}
                              </span>
                              <span>
                                {messages.confidence}:{" "}
                                {localizedConfidence(
                                  row.candidate.confidence,
                                  locale,
                                )}
                              </span>
                              <span>
                                {messages.coverage}:{" "}
                                {row.candidate.observedMarketYears.length}{" "}
                                {locale === "en" ? "observed" : "已观察"} ·{" "}
                                {row.candidate.missingMarketYears.length}{" "}
                                {locale === "en" ? "missing" : "缺失"}
                              </span>
                            </span>
                          </span>
                          <span>
                            {messages.investigationPriority}{" "}
                            {row.candidate.investigationPriority.display}/100
                          </span>
                        </button>
                        {analysisHref === null ? null : (
                          <a
                            id={portfolioActionId(row.candidate)}
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
                              openCandidateMarket(row.candidate, analysisHref);
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
              )}
            </section>
            {selectedRow === null ? null : (
              <PortfolioCandidateDetail row={selectedRow} locale={locale} />
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function portfolioActionId(candidate: MarketInvestigationCandidate): string {
  return `analyze-portfolio-${candidate.product.code}-${candidate.market.code}`;
}

function portfolioOpportunityTypeLabel(
  candidate: MarketInvestigationCandidate,
  locale: AccountLocale,
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

function PortfolioCandidateDetail({
  row,
  locale,
}: {
  row: { canonicalRank: number; candidate: MarketInvestigationCandidate };
  locale: AccountLocale;
}) {
  const messages = copy[locale];
  return (
    <section className="portfolio-detail" aria-label={messages.selectedDetail}>
      <p>
        {messages.canonicalRank} #{row.canonicalRank}
      </p>
      <h3>{row.candidate.market.name}</h3>
      <p>
        HS 2012 · {row.candidate.product.code} · BACI{" "}
        {row.candidate.market.code}
      </p>
      <div className="opportunity-axis-grid">
        <MetricCard
          label={messages.investigationPriority}
          value={row.candidate.investigationPriority.display}
        />
        <MetricCard
          label={messages.marketAttractiveness}
          value={row.candidate.marketAttractiveness.display}
        />
        <MetricCard
          label={messages.exporterFit}
          value={row.candidate.exporterFit.display}
        />
      </div>
      <p>
        {messages.confidence}:{" "}
        {localizedConfidence(row.candidate.confidence, locale)}{" "}
        {row.candidate.confidence.score}/100
      </p>
      <p>{row.candidate.opportunityTypeCopy}</p>
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

function localizedConfidence(
  confidence: OpportunityConfidence,
  locale: AccountLocale,
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
