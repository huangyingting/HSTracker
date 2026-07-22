import type {
  TradeAnalysisContext,
  TradeAnalysisLocale,
} from "./trade-analysis-context";
import { workspaceRouteFamily } from "./workspace-route-family";

const copy = {
  en: {
    label: "Export Market Workspace journey",
    scope: "Scope",
    opportunities: "Opportunities",
    marketAnalysis: "Market Analysis",
  },
  "zh-Hans": {
    label: "出口市场工作区旅程",
    scope: "定义范围",
    opportunities: "发现机会",
    marketAnalysis: "市场分析",
  },
} as const;

type JourneyStage = "scope" | "opportunities" | "market-analysis";

export function JourneyIndicator({
  context,
  locale,
}: {
  context: TradeAnalysisContext;
  locale: TradeAnalysisLocale;
}) {
  const messages = copy[locale];
  const activeStage = journeyStage(context);
  const stages = [
    ["scope", messages.scope],
    ["opportunities", messages.opportunities],
    ["market-analysis", messages.marketAnalysis],
  ] as const satisfies readonly (readonly [JourneyStage, string])[];

  return (
    <nav className="journey-indicator" aria-label={messages.label}>
      <ol>
        {stages.map(([stage, label], index) => (
          <li key={stage} data-active={stage === activeStage}>
            <span aria-hidden="true">{index + 1}</span>
            <strong aria-current={stage === activeStage ? "step" : undefined}>
              {label}
            </strong>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function journeyStage(context: TradeAnalysisContext): JourneyStage | null {
  const routeFamily = workspaceRouteFamily(context);
  if (routeFamily === "primary-market-analysis") {
    return "market-analysis";
  }
  if (routeFamily === "primary-opportunities") {
    return "opportunities";
  }
  return routeFamily === "primary-scope" ? "scope" : null;
}
