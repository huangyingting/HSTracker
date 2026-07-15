"use client";

import { useEffect, useState } from "react";

import { DiscoveryWorkspace } from "./discovery-workspace";
import { SupplierCompetitionWorkspace } from "./supplier-competition-workspace";
import { TradeTrendWorkspace } from "./trade-trend-workspace";

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
  },
  "zh-Hans": {
    title: "选择分析任务",
    candidateMarket: "候选市场",
    candidateMarketDetail: "为深入调查排列市场优先级。",
    tradeTrend: "贸易趋势",
    tradeTrendDetail: "查看一个经济体的年度进口证据。",
    supplierCompetition: "供应商竞争",
    supplierCompetitionDetail: "查看一个进口经济体的供应经济体结构。",
  },
} as const;

type Locale = keyof typeof copy;
type AnalysisTask =
  | "candidate-market"
  | "trade-trend"
  | "supplier-competition";

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
    const url = new URL(window.location.href);
    for (const parameter of [
      "exporter",
      "importer",
      "revision",
      "product",
      "market",
    ]) {
      url.searchParams.delete(parameter);
    }
    if (nextTask === "candidate-market") {
      url.searchParams.delete("task");
    } else {
      url.searchParams.set("task", nextTask);
    }
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
        </div>
      </nav>
      {task === "candidate-market" ? (
        <DiscoveryWorkspace locale={locale} />
      ) : task === "trade-trend" ? (
        <TradeTrendWorkspace locale={locale} />
      ) : (
        <SupplierCompetitionWorkspace locale={locale} />
      )}
    </>
  );
}

function taskFromLocation(): AnalysisTask {
  if (typeof window === "undefined") {
    return "candidate-market";
  }
  const task = new URL(window.location.href).searchParams.get("task");
  if (task === "trade-trend" || task === "supplier-competition") {
    return task;
  }
  return "candidate-market";
}
