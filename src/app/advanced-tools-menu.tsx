"use client";

import { useEffect, useRef, useState } from "react";

import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import {
  parseTradeAnalysisContext,
  pinFromDeploymentWindow,
  serializeTradeAnalysisContext,
  withAdvancedToolRecipe,
  type AdvancedToolRecipe,
  type TradeAnalysisContext,
  type TradeAnalysisLocale,
} from "./trade-analysis-context";

const copy = {
  en: {
    label: "Advanced tools",
    tradeTrend: "Trade Trend",
    supplierCompetition: "Supplier Competition",
    tradeExplorer: "Trade Explorer",
    loading: "Resolving deployment context…",
    unavailable: "Advanced tools are temporarily unavailable.",
  },
  "zh-Hans": {
    label: "高级工具",
    tradeTrend: "贸易趋势",
    supplierCompetition: "供应商竞争",
    tradeExplorer: "贸易探索者",
    loading: "正在解析部署情境…",
    unavailable: "高级工具暂时不可用。",
  },
} as const;

export function AdvancedToolsMenu({
  context,
  locale,
}: {
  context: TradeAnalysisContext;
  locale: TradeAnalysisLocale;
}) {
  const messages = copy[locale];
  const [open, setOpen] = useState(false);
  const [menuContext, setMenuContext] = useState(context);
  const [manifest, setManifest] = useState<CurrentAnalysisManifest | null>(null);
  const [resolution, setResolution] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const manifestController = useRef<AbortController | null>(null);
  const tools = [
    ["trade-trend", messages.tradeTrend],
    ["supplier-competition", messages.supplierCompetition],
    ["trade-explorer", messages.tradeExplorer],
  ] as const satisfies readonly (readonly [AdvancedToolRecipe, string])[];

  useEffect(
    () => () => {
      manifestController.current?.abort();
    },
    [],
  );

  function toggleMenu() {
    if (open) {
      manifestController.current?.abort();
      setOpen(false);
      return;
    }
    const nextContext = parseTradeAnalysisContext(window.location.href);
    setMenuContext(nextContext);
    setOpen(true);
    if (nextContext.pin === null) {
      setManifest(null);
      setResolution("ready");
      return;
    }
    manifestController.current?.abort();
    const controller = new AbortController();
    manifestController.current = controller;
    setManifest(null);
    setResolution("loading");
    void loadCurrentAnalysisManifest({
      fetcher: fetch,
      signal: controller.signal,
      revalidate: false,
    })
      .then((currentManifest) => {
        if (!controller.signal.aborted) {
          setManifest(currentManifest);
          setResolution("ready");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Advanced tool context resolution failed", error);
          setResolution("failed");
        }
      });
  }

  return (
    <div
      className="advanced-tools-menu"
      role="group"
      aria-label={messages.label}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="advanced-tools-links"
        onClick={toggleMenu}
      >
        {messages.label}
      </button>
      {open && resolution === "loading" ? (
        <span role="status">{messages.loading}</span>
      ) : open && resolution === "failed" ? (
        <span role="alert">{messages.unavailable}</span>
      ) : open && resolution === "ready" ? (
        <nav id="advanced-tools-links" aria-label={messages.label}>
          {tools.map(([recipe, label]) => (
            <a
              key={recipe}
              href={serializeTradeAnalysisContext(
                "/",
                translatedAdvancedContext(menuContext, recipe, manifest),
              )}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                window.history.pushState(null, "", event.currentTarget.href);
                window.dispatchEvent(
                  new PopStateEvent("popstate", {
                    state: window.history.state,
                  }),
                );
                setOpen(false);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function translatedAdvancedContext(
  context: TradeAnalysisContext,
  recipe: AdvancedToolRecipe,
  manifest: CurrentAnalysisManifest | null,
) {
  const transitioned = withAdvancedToolRecipe(context, recipe);
  if (context.pin === null || manifest === null) {
    return transitioned;
  }
  return {
    ...transitioned,
    pin:
      pinFromDeploymentWindow(
        manifest,
        context.pin.analysisBuildId,
        recipe,
      ) ?? context.pin,
  };
}
