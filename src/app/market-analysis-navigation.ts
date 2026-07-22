"use client";

import type { MouseEvent } from "react";

import type { MarketInvestigationCandidate } from "../domain/opportunity-discovery/result";
import {
  serializeTradeAnalysisContext,
  type CandidateMarketContext,
  type TradeAnalysisLocale,
} from "./trade-analysis-context";
import { announceTradeAnalysisNavigation } from "./trade-analysis-context-events";

export type OpportunityReturnSource =
  "candidate-market" | "opportunity-discovery" | "portfolio";

export type OpportunityReturnState = Readonly<{
  source: OpportunityReturnSource;
  actionId: string;
  scrollY: number;
  listScrollTop: number | null;
  loadedPages: number;
}>;

const RETURN_STATE_KEY = "hsTrackerOpportunityReturn";
const MARKET_ANALYSIS_ENTRY_KEY = "hsTrackerMarketAnalysisEntry";

export function openMarketAnalysis(
  href: string,
  returnState: OpportunityReturnState,
  notifyTaskNavigation = true,
): void {
  window.history.replaceState(
    {
      ...historyRecord(window.history.state),
      [RETURN_STATE_KEY]: returnState,
    },
    "",
    window.location.href,
  );
  window.history.pushState({ [MARKET_ANALYSIS_ENTRY_KEY]: true }, "", href);
  if (notifyTaskNavigation) {
    announceTradeAnalysisNavigation();
  }
}

export function candidateMarketAnalysisHref({
  baseUrl,
  scope,
  candidate,
}: {
  baseUrl: string;
  scope:
    | Readonly<{
        locale: TradeAnalysisLocale;
        pin: NonNullable<CandidateMarketContext["pin"]>;
        exporterCode: string;
      }>
    | null;
  candidate: MarketInvestigationCandidate;
}): string | null {
  if (scope === null) {
    return null;
  }
  return serializeTradeAnalysisContext(baseUrl, {
    recipe: "candidate-market",
    ...scope,
    productCode: candidate.product.code,
    focusedMarketCode: candidate.market.code,
  });
}

export function openOpportunityMarketAnalysis(
  href: string,
  {
    source,
    actionId,
    listId,
    loadedPages,
  }: {
    source: Extract<
      OpportunityReturnSource,
      "opportunity-discovery" | "portfolio"
    >;
    actionId: string;
    listId: string;
    loadedPages: number;
  },
): void {
  const list = document.getElementById(listId);
  openMarketAnalysis(href, {
    source,
    actionId,
    scrollY: window.scrollY,
    listScrollTop: list?.scrollTop ?? null,
    loadedPages,
  });
}

export function shouldHandleMarketAnalysisClick(
  event: MouseEvent<HTMLAnchorElement>,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function hasOpportunityHistoryReturn(): boolean {
  return (
    historyRecord(window.history.state)[MARKET_ANALYSIS_ENTRY_KEY] === true
  );
}

export function readOpportunityReturnState(
  state: unknown,
  source: OpportunityReturnSource,
): OpportunityReturnState | null {
  const candidate = historyRecord(state)[RETURN_STATE_KEY];
  if (
    !isRecord(candidate) ||
    candidate.source !== source ||
    typeof candidate.actionId !== "string" ||
    candidate.actionId.length === 0 ||
    typeof candidate.scrollY !== "number" ||
    !Number.isFinite(candidate.scrollY) ||
    typeof candidate.loadedPages !== "number" ||
    !Number.isInteger(candidate.loadedPages) ||
    candidate.loadedPages < 1 ||
    (candidate.listScrollTop !== null &&
      (typeof candidate.listScrollTop !== "number" ||
        !Number.isFinite(candidate.listScrollTop)))
  ) {
    return null;
  }
  return {
    source,
    actionId: candidate.actionId,
    scrollY: Math.max(0, candidate.scrollY),
    loadedPages: candidate.loadedPages,
    listScrollTop:
      candidate.listScrollTop === null
        ? null
        : Math.max(0, candidate.listScrollTop),
  };
}

export function restoreOpportunityPosition(
  returnState: OpportunityReturnState,
  listElementId: string,
): void {
  window.scrollTo({ top: returnState.scrollY });
  const list = document.getElementById(listElementId);
  if (list !== null && returnState.listScrollTop !== null) {
    list.scrollTop = returnState.listScrollTop;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document
        .getElementById(returnState.actionId)
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: returnState.scrollY });
      const restoredList = document.getElementById(listElementId);
      if (restoredList !== null && returnState.listScrollTop !== null) {
        restoredList.scrollTop = returnState.listScrollTop;
      }
    });
  });
}

function historyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
