"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import {
  parseTradeAnalysisContext,
  type TradeAnalysisLocale,
  type TradeAnalysisRecipe,
} from "./trade-analysis-context";

const workspaceLoading = () => (
  <div className="workspace-loading" role="status" aria-live="polite" />
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

export function ExportMarketWorkspace({
  initialRecipe,
  locale,
}: {
  initialRecipe: TradeAnalysisRecipe;
  locale: TradeAnalysisLocale;
}) {
  const [recipe, setRecipe] = useState(initialRecipe);

  useEffect(() => {
    const restoreRecipe = () =>
      setRecipe(parseTradeAnalysisContext(window.location.href).recipe);
    window.addEventListener("popstate", restoreRecipe);
    return () => window.removeEventListener("popstate", restoreRecipe);
  }, []);

  return recipe === "opportunity-discovery" ? (
    <OpportunityDiscoveryWorkspace locale={locale} />
  ) : recipe === "candidate-market" ? (
    <DiscoveryWorkspace locale={locale} />
  ) : recipe === "trade-trend" ? (
    <TradeTrendWorkspace locale={locale} />
  ) : recipe === "supplier-competition" ? (
    <SupplierCompetitionWorkspace locale={locale} />
  ) : (
    <TradeExplorerWorkspace locale={locale} />
  );
}
