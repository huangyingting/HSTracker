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
import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { OpportunityDiscoveryV1Payload } from "../domain/trade-analytics/opportunity-discovery-v1-adapter";
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
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import {
  buildPortfolioProjection,
  candidateProjectionKey,
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
  appendOpportunityPage,
  validateOpportunityPageIdentity,
} from "./opportunity-feed-pages";
import { ProductCombobox } from "./product-combobox";
import { localizedSourceFreshness } from "./source-freshness-presentation";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withRecipe,
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
    analysisScope: "Portfolio analysis scope",
    analysisIdentity: "Analysis Identity",
    datasetPackage: "Dataset Package",
    deploymentState: "Deployment state",
    currentDeployment: "Current deployment",
    retainedDeployment: "Retained deployment",
    baciRelease: "BACI release",
    finalizedPeriod: "Finalized score period",
    provisionalPeriod: "Provisional context",
    provisionalOnly: "supporting evidence only",
    sourceFreshness: "Current source freshness",
    retainedFreshness: "Not reported for retained evidence",
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
    analysisScope: "组合分析范围",
    analysisIdentity: "分析身份",
    datasetPackage: "数据集包",
    deploymentState: "部署状态",
    currentDeployment: "当前部署",
    retainedDeployment: "保留部署",
    baciRelease: "BACI 发布版本",
    finalizedPeriod: "定稿评分期间",
    provisionalPeriod: "暂定年份背景",
    provisionalOnly: "仅作辅助证据",
    sourceFreshness: "当前来源新鲜度",
    retainedFreshness: "保留证据未报告此状态",
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
    const context = parseTradeAnalysisContext(window.location.href);
    if (
      context.recipe === "opportunity-discovery" &&
      context.portfolioFilter === true
    ) {
      const url = serializeTradeAnalysisContext(window.location.href, {
        ...context,
        portfolioFilter: false,
      });
      window.history.replaceState(null, "", url);
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    }
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
  const currentController = useRef<AbortController | null>(null);
  const feedController = useRef<AbortController | null>(null);
  const portfolioRef = useRef(session.portfolio);
  const modeRef = useRef(mode);
  const loadedPageCountRef = useRef(0);

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
          locationContext,
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
        if (
          !revalidate &&
          locationContext.pin !== null &&
          translatedPin === null
        ) {
          setStatus("stale");
          return;
        }
        const requestedPinState =
          translatedPin === null
            ? locationContext.pin === null
              ? "current"
              : "retired"
            : resolvePinnedContext(
                translatedPin,
                nextManifest,
                "opportunity-discovery",
              ).state;
        const context: OpportunityDiscoveryContext = {
          ...baseContext,
          pin: revalidate ? null : translatedPin,
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
        let loadedPages = 1;
        const requestedCursors = new Set<string>();
        while (page.page.nextCursor !== null) {
          const cursor = page.page.nextCursor;
          if (requestedCursors.has(cursor)) {
            throw new TypeError(
              "Portfolio opportunity pagination repeated a cursor.",
            );
          }
          requestedCursors.add(cursor);
          const nextPage = await loadMarketInvestigationPage({
            analysisBuildId,
            exporterCode: session.primaryExporter,
            productCodes: null,
            limit: PAGE_LIMIT,
            cursor,
            fetcher: fetch,
            signal: feedRequest.signal,
          });
          validateOpportunityPageIdentity(
            nextPage,
            analysisBuildId,
            nextManifest,
            pinResolution,
          );
          page = appendOpportunityPage(page, nextPage, cursor);
          loadedPages += 1;
        }
        loadedPageCountRef.current = loadedPages;
        setFeed(page);
        setFeedDeploymentState(
          pinResolution.state === "retained" ? "retained" : "current",
        );
        const projection = buildPortfolioProjection(
          page,
          portfolioRef.current,
          modeRef.current,
        );
        setStatus(projection.visibleRows.length === 0 ? "empty" : "ready");
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
      const returnState = readOpportunityReturnState(
        window.history.state,
        "portfolio",
      );
      if (returnState !== null) {
        restoreOpportunityPosition(returnState, "portfolio-list-scroll");
        return;
      }
      const requestedBuildId =
        context.pin?.analysisBuildId ?? manifest?.analysisBuildId ?? null;
      if (
        requestedBuildId !== null &&
        requestedBuildId !== feed.analysisBuildId
      ) {
        void loadFeed(false);
      }
    }
    window.addEventListener("popstate", restoreFocusFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreFocusFromHistory);
  }, [feed, loadFeed, manifest]);

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
      window.history.replaceState(window.history.state, "", url);
    }
  }

  function refreshCurrentAnalysis() {
    void loadFeed(true);
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

  function marketAnalysisHref(
    candidate: MarketInvestigationCandidate,
  ): string | null {
    if (feed === null || candidateMarketPin === null) {
      return null;
    }
    return candidateMarketAnalysisHref({
      baseUrl: window.location.href,
      scope: {
        locale,
        pin: candidateMarketPin,
        exporterCode: feed.exporter.code,
      },
      candidate,
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
      {manifest === null ||
      feed === null ||
      feedDeploymentState === null ? null : (
        <PortfolioAnalysisScope
          manifest={manifest}
          feed={feed}
          locale={locale}
          deploymentState={feedDeploymentState}
        />
      )}
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
        {feed === null ? null : <AnalysisShareLink locale={locale} />}
        {projection === null ? null : (
          <span>
            {projection.visibleRows.length} {messages.visibleRows} ·{" "}
            {projection.completeRows.length} {messages.completeRows}
          </span>
        )}
      </div>
      {feed === null || projection === null ? null : (
        <OpportunityExportAction
          page={feed}
          candidateKeys={projection.visibleRows.map((row) =>
            candidateProjectionKey(row.candidate),
          )}
          scope="portfolio"
          locale={locale}
        />
      )}
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
                      <OpportunityCandidateRow
                        key={candidateProjectionKey(row.candidate)}
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
        </>
      ) : null}
    </section>
  );
}

function portfolioActionId(candidate: MarketInvestigationCandidate): string {
  return `analyze-portfolio-${candidate.product.code}-${candidate.market.code}`;
}

function PortfolioAnalysisScope({
  manifest,
  feed,
  locale,
  deploymentState,
}: {
  manifest: CurrentAnalysisManifest;
  feed: OpportunityDiscoveryV1Payload;
  locale: AccountLocale;
  deploymentState: "current" | "retained";
}) {
  const messages = copy[locale];
  const isCurrent =
    deploymentState === "current" &&
    feed.analysisBuildId === manifest.analysisBuildId &&
    feed.provenance.baciRelease === manifest.source.baciRelease;
  return (
    <section
      className="portfolio-analysis-scope"
      aria-label={messages.analysisScope}
      data-deployment-state={isCurrent ? "current" : "retained"}
      data-freshness-state={isCurrent ? manifest.freshness.state : undefined}
    >
      <h3>{messages.analysisScope}</h3>
      <dl>
        <div>
          <dt>{messages.deploymentState}</dt>
          <dd>
            {isCurrent
              ? messages.currentDeployment
              : messages.retainedDeployment}
          </dd>
        </div>
        <div>
          <dt>{messages.analysisIdentity}</dt>
          <dd>{feed.analysisIdentity}</dd>
        </div>
        <div>
          <dt>{messages.datasetPackage}</dt>
          <dd>{feed.datasetPackageIdentity}</dd>
        </div>
        <div>
          <dt>{messages.baciRelease}</dt>
          <dd>{feed.provenance.baciRelease}</dd>
        </div>
        <div>
          <dt>{messages.finalizedPeriod}</dt>
          <dd>
            {feed.provenance.scoreWindow.start}–
            {feed.provenance.scoreWindow.end}
          </dd>
        </div>
        <div>
          <dt>{messages.provisionalPeriod}</dt>
          <dd>
            {feed.provenance.provisionalYear} · {messages.provisionalOnly}
          </dd>
        </div>
        <div>
          <dt>{messages.sourceFreshness}</dt>
          <dd>
            {isCurrent
              ? localizedSourceFreshness(manifest.freshness.state, locale)
              : messages.retainedFreshness}
          </dd>
        </div>
      </dl>
    </section>
  );
}
