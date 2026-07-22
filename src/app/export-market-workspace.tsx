"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import type { AccountSessionPayload } from "./account-client";
import {
  parseTradeAnalysisContext,
  productCodeOf,
  serializeTradeAnalysisContext,
  withRecipe,
  type TradeAnalysisContext,
  type TradeAnalysisLocale,
} from "./trade-analysis-context";
import {
  announceTradeAnalysisContextChange,
  TRADE_ANALYSIS_CONTEXT_CHANGED_EVENT,
} from "./trade-analysis-context-events";

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

const copy = {
  en: {
    legend: "Product scope",
    allProducts: "Across published products",
    exactProduct: "One confirmed HS Product",
    portfolio: "My confirmed portfolio",
    checkingAccount: "Checking portfolio access…",
    signInForPortfolio: "Sign in to use a confirmed portfolio",
  },
  "zh-Hans": {
    legend: "产品范围",
    allProducts: "全部已发布产品",
    exactProduct: "一个已确认的 HS 产品",
    portfolio: "我的已确认产品组合",
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
}: {
  initialContext: TradeAnalysisContext;
  locale: TradeAnalysisLocale;
  accountSession: AccountSessionPayload | null;
  accountSessionStatus: "loading" | "ready";
  onAccountSessionChange: (session: AccountSessionPayload) => void;
}) {
  const [context, setContext] = useState(initialContext);
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

  useEffect(() => {
    const synchronizeContext = () => {
      const restored = parseTradeAnalysisContext(window.location.href);
      setContext(restored);
      if (restored.recipe === "opportunity-discovery") {
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
    announceTradeAnalysisContextChange();
  }, [
    accountAuthOpen,
    accountSession,
    accountSessionStatus,
    context,
  ]);

  const selectPublicScope = useCallback((mode: PublicScopeMode) => {
    const source = withRecipe(
      parseTradeAnalysisContext(window.location.href),
      "opportunity-discovery",
    );
    if (source.recipe !== "opportunity-discovery") {
      return;
    }
    const nextContext = {
      ...source,
      productCodes: mode === "all" ? null : source.productCodes,
      focusProductCode: mode === "all" ? null : source.focusProductCode,
      focusedMarketCode: mode === "all" ? null : source.focusedMarketCode,
      portfolioFilter: false,
    };
    const href = serializeTradeAnalysisContext(
      window.location.href,
      nextContext,
    );
    setOpportunityScopeMode("public");
    setPublicScopeMode(mode);
    setAccountAuthOpen(false);
    setContext(nextContext);
    window.history.pushState(null, "", href);
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
    if (mode === "exact") {
      window.setTimeout(() => {
        document
          .querySelector<HTMLInputElement>(
            ".opportunity-controls .product-discovery [role=\"combobox\"]",
          )
          ?.focus();
      }, 0);
    }
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
      const href = serializeTradeAnalysisContext(
        window.location.href,
        nextContext,
      );
      setOpportunityScopeMode("portfolio");
      setAccountAuthOpen(false);
      setContext(nextContext);
      window.history.pushState(null, "", href);
      announceTradeAnalysisContextChange();
    },
    [],
  );

  const confirmExactProduct = useCallback(() => {
    setPublicScopeMode("exact");
  }, []);

  if (context.recipe === "opportunity-discovery") {
    const messages = copy[locale];

    return (
      <>
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
                {messages.portfolio}
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
          accountSessionStatus === "loading" ? (
            <div
              className="analysis-workspace workspace-loading"
              id="discovery"
              role="status"
              aria-live="polite"
            />
          ) : accountSession === null ? (
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
            />
          )
        ) : (
          <OpportunityDiscoveryWorkspace
            key={publicScopeMode}
            locale={locale}
            scopeMode={publicScopeMode}
            onScopeModeChange={selectPublicScope}
            onExactProductConfirmed={confirmExactProduct}
          />
        )}
      </>
    );
  }

  return context.recipe === "candidate-market" ? (
    <DiscoveryWorkspace locale={locale} />
  ) : context.recipe === "trade-trend" ? (
    <TradeTrendWorkspace locale={locale} />
  ) : context.recipe === "supplier-competition" ? (
    <SupplierCompetitionWorkspace locale={locale} />
  ) : (
    <TradeExplorerWorkspace locale={locale} />
  );
}
