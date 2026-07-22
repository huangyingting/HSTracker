"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { AccountSessionPayload } from "./account-client";
import { JourneyIndicator } from "./journey-indicator";
import {
  parseTradeAnalysisContext,
  productCodeOf,
  serializeTradeAnalysisContext,
  withRecipe,
  type OpportunityDiscoveryContext,
  type TradeAnalysisContext,
  type TradeAnalysisLocale,
} from "./trade-analysis-context";
import {
  announceTradeAnalysisContextChange,
  announceTradeAnalysisNavigation,
  TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT,
} from "./trade-analysis-context-events";
import {
  WorkspaceScope,
  type WorkspaceScopeConfiguration,
} from "./workspace-scope";

const workspaceLoading = () => (
  <div className="workspace-loading" role="status" aria-live="polite" />
);

const AccountAuthPanel = dynamic(
  () =>
    import("./account-workspace").then((module) => module.AccountAuthPanel),
  { loading: workspaceLoading },
);
const SignedInPortfolioWorkspace = dynamic(
  () =>
    import("./account-workspace").then(
      (module) => module.SignedInPortfolioWorkspace,
    ),
  { loading: workspaceLoading },
);
const OpportunityDiscoveryWorkspace = dynamic(
  () =>
    import("./opportunity-discovery-workspace").then(
      (module) => module.OpportunityDiscoveryWorkspace,
    ),
  { loading: workspaceLoading },
);
const DiscoveryWorkspace = dynamic(
  () =>
    import("./discovery-workspace").then((module) => module.DiscoveryWorkspace),
  { loading: workspaceLoading },
);
const TradeTrendWorkspace = dynamic(
  () =>
    import("./trade-trend-workspace").then(
      (module) => module.TradeTrendWorkspace,
    ),
  { loading: workspaceLoading },
);
const SupplierCompetitionWorkspace = dynamic(
  () =>
    import("./supplier-competition-workspace").then(
      (module) => module.SupplierCompetitionWorkspace,
    ),
  { loading: workspaceLoading },
);
const TradeExplorerWorkspace = dynamic(
  () =>
    import("./trade-explorer-workspace").then(
      (module) => module.TradeExplorerWorkspace,
    ),
  { loading: workspaceLoading },
);

type PublicScopeMode = "all" | "exact";
type OpportunityScopeMode = "public" | "portfolio";
type WorkspaceScopeOwner = "candidate-market" | "opportunity-discovery";
type RegisteredWorkspaceScopes = Partial<
  Record<WorkspaceScopeOwner, WorkspaceScopeConfiguration>
>;

const copy = {
  en: {
    legend: "Product scope",
    allProducts: "Across published products",
    exactProduct: "One confirmed HS Product",
    portfolio: "My confirmed portfolio",
    setupPortfolio: "Set up portfolio",
    checkingAccount: "Checking portfolio access…",
    signInForPortfolio: "Sign in to use a confirmed portfolio",
  },
  "zh-Hans": {
    legend: "产品范围",
    allProducts: "全部已发布产品",
    exactProduct: "一个已确认的 HS 产品",
    portfolio: "我的已确认产品组合",
    setupPortfolio: "设置产品组合",
    checkingAccount: "正在检查产品组合访问状态…",
    signInForPortfolio: "登录以使用已确认产品组合",
  },
} as const;

export function ExportMarketWorkspace({
  initialContext,
  locale,
  accountSession,
  accountSessionStatus,
  onAccountSessionChange,
  pageIntroduction,
}: {
  initialContext: TradeAnalysisContext;
  locale: TradeAnalysisLocale;
  accountSession: AccountSessionPayload | null;
  accountSessionStatus: "loading" | "ready";
  onAccountSessionChange: (session: AccountSessionPayload) => void;
  pageIntroduction: ReactNode;
}) {
  const [context, setContext] = useState(initialContext);
  const [registeredScopes, setRegisteredScopes] =
    useState<RegisteredWorkspaceScopes>({});
  const [opportunityScopeMode, setOpportunityScopeMode] =
    useState<OpportunityScopeMode>(
      initialContext.recipe === "opportunity-discovery" &&
        initialContext.portfolioFilter === true
        ? "portfolio"
        : "public",
    );
  const [publicScopeMode, setPublicScopeMode] = useState<PublicScopeMode>(
    initialContext.recipe === "opportunity-discovery" &&
      productCodeOf(initialContext) !== null
      ? "exact"
      : "all",
  );
  const [accountAuthOpen, setAccountAuthOpen] = useState(false);
  const [focusExactProduct, setFocusExactProduct] = useState(false);

  useEffect(() => {
    const synchronizeContext = (event: Event) => {
      const restored = parseTradeAnalysisContext(window.location.href);
      setContext(restored);
      if (
        event.type === "popstate" &&
        restored.recipe === "opportunity-discovery"
      ) {
        setOpportunityScopeMode(
          restored.portfolioFilter === true ? "portfolio" : "public",
        );
        setPublicScopeMode(productCodeOf(restored) === null ? "all" : "exact");
      }
    };
    window.addEventListener("popstate", synchronizeContext);
    window.addEventListener(
      TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT,
      synchronizeContext,
    );
    return () => {
      window.removeEventListener("popstate", synchronizeContext);
      window.removeEventListener(
        TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT,
        synchronizeContext,
      );
    };
  }, []);

  useEffect(() => {
    if (
      accountSessionStatus !== "ready" ||
      accountSession !== null ||
      accountAuthOpen ||
      context.recipe !== "opportunity-discovery" ||
      context.portfolioFilter !== true
    ) {
      return;
    }
    const nextContext = { ...context, portfolioFilter: false };
    const href = serializeTradeAnalysisContext(
      window.location.href,
      nextContext,
    );
    window.history.replaceState(window.history.state, "", href);
    announceTradeAnalysisNavigation();
  }, [
    accountAuthOpen,
    accountSession,
    accountSessionStatus,
    context,
  ]);

  const applyOpportunityScope = useCallback(
    (
      nextContext: OpportunityDiscoveryContext,
      nextScopeMode: OpportunityScopeMode,
      nextPublicMode: PublicScopeMode | null,
    ) => {
      setOpportunityScopeMode(nextScopeMode);
      setRegisteredScopes((current) => {
        if (current["opportunity-discovery"] === undefined) {
          return current;
        }
        const next = { ...current };
        delete next["opportunity-discovery"];
        return next;
      });
      if (nextPublicMode !== null) {
        setPublicScopeMode(nextPublicMode);
      }
      setFocusExactProduct(
        nextScopeMode === "public" && nextPublicMode === "exact",
      );
      setAccountAuthOpen(false);
      setContext(nextContext);
      const href = serializeTradeAnalysisContext(
        window.location.href,
        nextContext,
      );
      window.history.pushState(null, "", href);
      announceTradeAnalysisContextChange();
    },
    [],
  );

  const selectPublicScope = useCallback(
    (mode: PublicScopeMode) => {
      const source = withRecipe(
        parseTradeAnalysisContext(window.location.href),
        "opportunity-discovery",
      );
      if (source.recipe !== "opportunity-discovery") {
        return;
      }
      applyOpportunityScope(
        {
          ...source,
          productCodes: mode === "all" ? null : source.productCodes,
          focusProductCode: mode === "all" ? null : source.focusProductCode,
          focusedMarketCode: mode === "all" ? null : source.focusedMarketCode,
          portfolioFilter: false,
        },
        "public",
        mode,
      );
    },
    [applyOpportunityScope],
  );

  const handleProductMountFocus = useCallback(() => {
    setFocusExactProduct(false);
  }, []);

  const updateRegisteredScope = useCallback(
    (
      owner: WorkspaceScopeOwner,
      configuration: WorkspaceScopeConfiguration | null,
    ) => {
      setRegisteredScopes((current) => {
        if (configuration !== null) {
          return { ...current, [owner]: configuration };
        }
        if (current[owner] === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[owner];
        return next;
      });
    },
    [],
  );
  const updateOpportunityScope = useCallback(
    (configuration: WorkspaceScopeConfiguration | null) =>
      updateRegisteredScope("opportunity-discovery", configuration),
    [updateRegisteredScope],
  );
  const updateCandidateMarketScope = useCallback(
    (configuration: WorkspaceScopeConfiguration | null) =>
      updateRegisteredScope("candidate-market", configuration),
    [updateRegisteredScope],
  );

  const showCompletePublicRanking = useCallback(() => {
    setOpportunityScopeMode("public");
    setPublicScopeMode("all");
    setFocusExactProduct(false);
    setAccountAuthOpen(false);
  }, []);

  const selectPortfolioScope = useCallback(
    (session: AccountSessionPayload) => {
      const source = withRecipe(
        parseTradeAnalysisContext(window.location.href),
        "opportunity-discovery",
      );
      if (source.recipe !== "opportunity-discovery") {
        return;
      }
      const nextContext = {
        ...source,
        exportEconomyCode: session.primaryExporter,
        productCodes: null,
        focusProductCode: null,
        focusedMarketCode: null,
        portfolioFilter: true,
      };
      applyOpportunityScope(nextContext, "portfolio", null);
    },
    [applyOpportunityScope],
  );

  const confirmExactProduct = useCallback(() => {
    setPublicScopeMode("exact");
  }, []);

  const activeScope =
    context.recipe === "candidate-market" ||
    context.recipe === "opportunity-discovery"
      ? registeredScopes[context.recipe] ?? null
      : null;
  const workspaceLead = (
    <>
      {activeScope === null ? null : <WorkspaceScope locale={locale} {...activeScope} />}
      <JourneyIndicator context={context} locale={locale} />
      {pageIntroduction}
    </>
  );

  if (context.recipe === "opportunity-discovery") {
    const messages = copy[locale];

    return (
      <>
        {workspaceLead}
        <section className="scope-mode-selector" aria-labelledby="scope-mode-title">
          <p id="scope-mode-title">{messages.legend}</p>
          <div role="group" aria-label={messages.legend}>
            <button
              type="button"
              aria-pressed={
                opportunityScopeMode === "public" && publicScopeMode === "all"
              }
              onClick={() => selectPublicScope("all")}
            >
              {messages.allProducts}
            </button>
            <button
              type="button"
              aria-pressed={
                opportunityScopeMode === "public" && publicScopeMode === "exact"
              }
              onClick={() => selectPublicScope("exact")}
            >
              {messages.exactProduct}
            </button>
            {accountSession === null ? null : (
              <button
                type="button"
                aria-pressed={opportunityScopeMode === "portfolio"}
                onClick={() => selectPortfolioScope(accountSession)}
              >
                {accountSession.portfolio.length === 0
                  ? messages.setupPortfolio
                  : messages.portfolio}
              </button>
            )}
          </div>
          {accountSessionStatus === "loading" ? (
            <small aria-live="polite">{messages.checkingAccount}</small>
          ) : accountSession === null ? (
            <button
              className="portfolio-sign-in"
              type="button"
              onClick={() => {
                setAccountAuthOpen(true);
                setOpportunityScopeMode("public");
              }}
            >
              {messages.signInForPortfolio}
            </button>
          ) : null}
        </section>

        {accountAuthOpen && accountSession === null ? (
          <AccountAuthPanel
            locale={locale}
            onAuthenticated={(session) => {
              onAccountSessionChange(session);
              selectPortfolioScope(session);
            }}
            onAnonymousFallback={() => setAccountAuthOpen(false)}
          />
        ) : opportunityScopeMode === "portfolio" ? (
          accountSessionStatus === "loading" || accountSession === null ? (
            <div
              className="analysis-workspace workspace-loading"
              id="discovery"
              role="status"
              aria-live="polite"
            />
          ) : (
            <SignedInPortfolioWorkspace
              locale={locale}
              session={accountSession}
              onSessionChange={onAccountSessionChange}
              onCompletePublicRanking={showCompletePublicRanking}
              onWorkspaceScopeChange={updateOpportunityScope}
            />
          )
        ) : (
          <OpportunityDiscoveryWorkspace
            key={publicScopeMode}
            locale={locale}
            scopeMode={publicScopeMode}
            onProductMountFocus={
              focusExactProduct ? handleProductMountFocus : undefined
            }
            onScopeModeChange={selectPublicScope}
            onExactProductConfirmed={confirmExactProduct}
            onWorkspaceScopeChange={updateOpportunityScope}
          />
        )}
      </>
    );
  }

  return (
    <>
      {workspaceLead}
      {context.recipe === "candidate-market" ? (
        <DiscoveryWorkspace
          locale={locale}
          onWorkspaceScopeChange={updateCandidateMarketScope}
        />
      ) : context.recipe === "trade-trend" ? (
        <TradeTrendWorkspace locale={locale} />
      ) : context.recipe === "supplier-competition" ? (
        <SupplierCompetitionWorkspace locale={locale} />
      ) : (
        <TradeExplorerWorkspace locale={locale} />
      )}
    </>
  );
}
