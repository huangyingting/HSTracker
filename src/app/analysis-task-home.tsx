"use client";

import { useEffect, useState } from "react";

import { DiscoveryWorkspace } from "./discovery-workspace";
import { TradeTrendWorkspace } from "./trade-trend-workspace";

const copy = {
  en: {
    title: "Choose an analysis task",
    candidateMarket: "Candidate Markets",
    candidateMarketDetail: "Rank markets worth deeper investigation.",
    tradeTrend: "Trade Trend",
    tradeTrendDetail: "Inspect annual import evidence for one economy.",
  },
  "zh-Hans": {
    title: "选择分析任务",
    candidateMarket: "候选市场",
    candidateMarketDetail: "为深入调查排列市场优先级。",
    tradeTrend: "贸易趋势",
    tradeTrendDetail: "查看一个经济体的年度进口证据。",
  },
} as const;

type Locale = keyof typeof copy;
type AnalysisTask = "candidate-market" | "trade-trend";

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
      url.searchParams.set("task", "trade-trend");
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
        </div>
      </nav>
      {task === "candidate-market" ? (
        <DiscoveryWorkspace locale={locale} />
      ) : (
        <TradeTrendWorkspace locale={locale} />
      )}
    </>
  );
}

function taskFromLocation(): AnalysisTask {
  if (typeof window === "undefined") {
    return "candidate-market";
  }
  return new URL(window.location.href).searchParams.get("task") ===
    "trade-trend"
    ? "trade-trend"
    : "candidate-market";
}
