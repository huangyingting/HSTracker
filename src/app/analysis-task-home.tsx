"use client";

import { useEffect, useState } from "react";

import { DiscoveryWorkspace } from "./discovery-workspace";
import { SupplierCompetitionWorkspace } from "./supplier-competition-workspace";
import { TradeExplorerWorkspace } from "./trade-explorer-workspace";
import { TradeTrendWorkspace } from "./trade-trend-workspace";
import {
  parseTradeAnalysisContext,
  serializeTradeAnalysisContext,
  withLocale,
  withRecipe,
} from "./trade-analysis-context";

const copy = {
  en: {
    title: "Choose an analysis task",
    candidateMarket: "Candidate Markets",
    candidateMarketDetail: "Rank markets worth deeper investigation.",
    tradeTrend: "Trade Trend",
    tradeTrendDetail: "Inspect annual import evidence for one economy.",
    supplierCompetition: "Supplier Competition",
    supplierCompetitionDetail:
      "Inspect the supplying-economy structure for one importing economy.",
    tradeExplorer: "Trade Explorer",
    tradeExplorerBadge: "Advanced",
    tradeExplorerDetail:
      "Combine approved dimensions, measures, and filters under strict budgets.",
  },
  "zh-Hans": {
    title: "选择分析任务",
    candidateMarket: "候选市场",
    candidateMarketDetail: "为深入调查排列市场优先级。",
    tradeTrend: "贸易趋势",
    tradeTrendDetail: "查看一个经济体的年度进口证据。",
    supplierCompetition: "供应商竞争",
    supplierCompetitionDetail: "查看一个进口经济体的供应经济体结构。",
    tradeExplorer: "贸易探索者",
    tradeExplorerBadge: "高级",
    tradeExplorerDetail: "在严格预算下组合已批准的维度、度量与筛选条件。",
  },
} as const;

type Locale = keyof typeof copy;
type AnalysisTask =
  | "candidate-market"
  | "trade-trend"
  | "supplier-competition"
  | "trade-explorer";

export function AnalysisTaskHome({ locale }: { locale: Locale }) {
  const [task, setTask] = useState<AnalysisTask>(() => taskFromLocation());
  const messages = copy[locale];

  useEffect(() => {
    const restoreTask = () => setTask(taskFromLocation());
    window.addEventListener("popstate", restoreTask);
    return () => window.removeEventListener("popstate", restoreTask);
  }, []);

  function selectTask(nextTask: AnalysisTask) {
    if (nextTask === task) {
      return;
    }
    const context = withLocale(
      withRecipe(parseTradeAnalysisContext(window.location.href), nextTask),
      locale,
    );
    const url = serializeTradeAnalysisContext(window.location.href, context);
    window.history.pushState(null, "", url);
    setTask(nextTask);
  }

  return (
    <>
      <nav className="analysis-task-home" aria-label={messages.title}>
        <p>{messages.title}</p>
        <div>
          <button
            type="button"
            aria-pressed={task === "candidate-market"}
            onClick={() => selectTask("candidate-market")}
          >
            <strong>{messages.candidateMarket}</strong>
            <span>{messages.candidateMarketDetail}</span>
          </button>
          <button
            type="button"
            aria-pressed={task === "trade-trend"}
            onClick={() => selectTask("trade-trend")}
          >
            <strong>{messages.tradeTrend}</strong>
            <span>{messages.tradeTrendDetail}</span>
          </button>
          <button
            type="button"
            aria-pressed={task === "supplier-competition"}
            onClick={() => selectTask("supplier-competition")}
          >
            <strong>{messages.supplierCompetition}</strong>
            <span>{messages.supplierCompetitionDetail}</span>
          </button>
          <button
            type="button"
            aria-pressed={task === "trade-explorer"}
            onClick={() => selectTask("trade-explorer")}
          >
            <strong>
              {messages.tradeExplorer}{" "}
              <span className="analysis-task-badge">{messages.tradeExplorerBadge}</span>
            </strong>
            <span>{messages.tradeExplorerDetail}</span>
          </button>
        </div>
      </nav>
      {task === "candidate-market" ? (
        <DiscoveryWorkspace locale={locale} />
      ) : task === "trade-trend" ? (
        <TradeTrendWorkspace locale={locale} />
      ) : task === "supplier-competition" ? (
        <SupplierCompetitionWorkspace locale={locale} />
      ) : (
        <TradeExplorerWorkspace locale={locale} />
      )}
    </>
  );
}

function taskFromLocation(): AnalysisTask {
  if (typeof window === "undefined") {
    return "candidate-market";
  }
  return parseTradeAnalysisContext(window.location.href).recipe;
}
