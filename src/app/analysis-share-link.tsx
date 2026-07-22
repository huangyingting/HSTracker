"use client";

import { memo, useEffect, useRef, useState } from "react";

const copy = {
  en: {
    kicker: "Share this analysis",
    hint: "The address bar already carries this exact context — export economy, HS Product, and selected Candidate Market. Copy it to share the same evidence.",
    idle: "Copy analysis link",
    marketAnalysisIdle: "Copy Market Analysis link",
    done: "Link copied",
    marketAnalysisHint:
      "Copy the canonical link for this exact Market Analysis context.",
    importingContextHint:
      "The address bar already carries this exact context — importing economy and HS Product. Copy it to share the same evidence.",
    explorerContextHint:
      "The address bar already carries this exact bounded analysis — shape, filters, measures, and sort. Copy it to share the same evidence.",
    opportunityContextHint:
      "The address bar already carries this exact Opportunity Discovery context — export economy and any confirmed HS12 projection. Copy it to share the same public evidence.",
  },
  "zh-Hans": {
    kicker: "分享此分析",
    hint: "地址栏已包含当前完整情境——出口经济体、HS 产品与所选候选市场。复制它即可分享相同的证据。",
    idle: "复制分析链接",
    marketAnalysisIdle: "复制市场分析链接",
    done: "已复制链接",
    marketAnalysisHint: "复制此确切市场分析情境的规范链接。",
    importingContextHint:
      "地址栏已包含当前完整情境——进口经济体与 HS 产品。复制它即可分享相同的证据。",
    explorerContextHint:
      "地址栏已包含此确切的有界分析——形态、筛选条件、度量与排序。复制它即可分享相同的证据。",
    opportunityContextHint:
      "地址栏已包含此确切的机会发现情境——出口经济体与任何已确认 HS12 投影。复制它即可分享相同的公共证据。",
  },
} as const;

type ShareLocale = keyof typeof copy;

export const AnalysisShareLink = memo(function AnalysisShareLink({
  locale,
  task = "candidate-market",
}: {
  locale: ShareLocale;
  task?:
    | "opportunity-discovery"
    | "candidate-market"
    | "market-analysis"
    | "trade-trend"
    | "supplier-competition"
    | "trade-explorer";
}) {
  const messages = copy[locale];
  return (
    <div className="analysis-share">
      <div>
        <p>{messages.kicker}</p>
        <span>
          {task === "candidate-market"
            ? messages.hint
            : task === "market-analysis"
              ? messages.marketAnalysisHint
            : task === "opportunity-discovery"
              ? messages.opportunityContextHint
            : task === "trade-explorer"
              ? messages.explorerContextHint
              : messages.importingContextHint}
        </span>
      </div>
      <AnalysisLinkCopyButton
        idleLabel={
          task === "market-analysis"
            ? messages.marketAnalysisIdle
            : messages.idle
        }
        doneLabel={messages.done}
      />
    </div>
  );
});

export const AnalysisLinkCopyButton = memo(function AnalysisLinkCopyButton({
  idleLabel,
  doneLabel,
}: {
  idleLabel: string;
  doneLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  async function copyAnalysisLink() {
    const href = window.location.href;
    try {
      await navigator.clipboard?.writeText(href);
    } catch {
      // Clipboard access can be denied; the canonical link remains in the
      // address bar, so keep the same acknowledgement contract.
    }
    setCopied(true);
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => setCopied(false), 2400);
  }

  return (
    <button type="button" data-copied={copied} onClick={copyAnalysisLink}>
      {copied ? doneLabel : idleLabel}
    </button>
  );
});
