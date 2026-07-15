"use client";

import { useEffect, useRef, useState } from "react";

const copy = {
  en: {
    kicker: "Share this analysis",
    hint: "The address bar already carries this exact context — export economy, HS Product, and selected Candidate Market. Copy it to share the same evidence.",
    idle: "Copy analysis link",
    done: "Link copied",
    importingContextHint:
      "The address bar already carries this exact context — importing economy and HS Product. Copy it to share the same evidence.",
    explorerContextHint:
      "The address bar already carries this exact bounded analysis — shape, filters, measures, and sort. Copy it to share the same evidence.",
  },
  "zh-Hans": {
    kicker: "分享此分析",
    hint: "地址栏已包含当前完整情境——出口经济体、HS 产品与所选候选市场。复制它即可分享相同的证据。",
    idle: "复制分析链接",
    done: "已复制链接",
    importingContextHint:
      "地址栏已包含当前完整情境——进口经济体与 HS 产品。复制它即可分享相同的证据。",
    explorerContextHint:
      "地址栏已包含此确切的有界分析——形态、筛选条件、度量与排序。复制它即可分享相同的证据。",
  },
} as const;

type ShareLocale = keyof typeof copy;

export function AnalysisShareLink({
  locale,
  task = "candidate-market",
}: {
  locale: ShareLocale;
  task?: "candidate-market" | "trade-trend" | "supplier-competition" | "trade-explorer";
}) {
  const messages = copy[locale];
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
      // Clipboard access can be denied; the link remains visible in the
      // address bar, so surface the copied acknowledgement regardless.
    }
    setCopied(true);
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => setCopied(false), 2400);
  }

  return (
    <div className="analysis-share">
      <div>
        <p>{messages.kicker}</p>
        <span>
          {task === "candidate-market"
            ? messages.hint
            : task === "trade-explorer"
              ? messages.explorerContextHint
              : messages.importingContextHint}
        </span>
      </div>
      <button type="button" data-copied={copied} onClick={copyAnalysisLink}>
        {copied ? messages.done : messages.idle}
      </button>
    </div>
  );
}
