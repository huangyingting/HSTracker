"use client";

import { useEffect, useId, useRef, useState } from "react";

import { PUBLIC_ANALYSIS_BUILD_ID } from "../domain/candidate-market/analysis-config";
import type {
  EconomyRecord,
  EconomySearchResult,
} from "../economy/economy-directory";

const copy = {
  en: {
    label: "Export economy",
    placeholder: "BACI code, ISO code, or source name",
    help: "Choose the export economy whose recorded foothold will be evaluated.",
    loading: "Searching economies…",
    failed: "Economy search is temporarily unavailable.",
    noMatch: "No economy matched that code or source name.",
    invalid: "Economy queries are limited to 100 characters.",
    retired:
      "This economy directory has retired. Refresh the current analysis.",
    refresh: "Refresh current analysis",
    selected: "Selected export economy",
  },
  "zh-Hans": {
    label: "出口经济体",
    placeholder: "BACI 编码、ISO 编码或来源名称",
    help: "选择要评估其已记录市场基础的出口经济体。",
    loading: "正在搜索经济体…",
    failed: "经济体搜索暂时不可用。",
    noMatch: "没有经济体匹配该编码或来源名称。",
    invalid: "经济体查询最多可输入 100 个字符。",
    retired: "该经济体目录已停用。请刷新当前分析。",
    refresh: "刷新当前分析",
    selected: "已选择出口经济体",
  },
} as const;

type EconomyComboboxProps = {
  locale: keyof typeof copy;
  onSelectionChange: (
    economy: EconomyRecord | null,
    source: "restore" | "explicit",
  ) => void;
};

type EconomySearchStatus =
  | "idle"
  | "loading"
  | "no-match"
  | "invalid"
  | "retired"
  | "failed";

export function EconomyCombobox({
  locale,
  onSelectionChange,
}: EconomyComboboxProps) {
  const messages = copy[locale];
  const listboxId = useId();
  const requestSequence = useRef(0);
  const explicitlyEdited = useRef(false);
  const interactiveController = useRef<AbortController | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedEconomy, setSelectedEconomy] =
    useState<EconomyRecord | null>(null);
  const [matches, setMatches] =
    useState<EconomySearchResult["matches"]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EconomySearchStatus>("idle");

  useEffect(() => {
    const exporterCode = new URL(window.location.href).searchParams.get(
      "exporter",
    );
    if (exporterCode === null || !/^\d{1,3}$/u.test(exporterCode)) {
      return;
    }

    const controller = new AbortController();
    void fetchEconomies(exporterCode, controller.signal)
      .then((result) => {
        const restored = result.matches.find(
          ({ economy }) => economy.code === exporterCode,
        )?.economy;
        if (!explicitlyEdited.current && restored !== undefined) {
          setSelectedEconomy(restored);
          onSelectionChange(restored, "restore");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const nextStatus = economySearchErrorStatus(error);
          if (nextStatus === "failed") {
            console.error("Canonical exporter restoration failed", error);
          }
          setStatus(nextStatus);
        }
      });
    return () => controller.abort();
  }, [onSelectionChange]);

  useEffect(
    () => () => {
      interactiveController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (
      selectedEconomy !== null ||
      inputValue.trim() === "" ||
      [...inputValue].length > 100
    ) {
      return;
    }

    interactiveController.current?.abort();
    const controller = new AbortController();
    interactiveController.current = controller;
    const timeout = window.setTimeout(() => {
      void loadMatches(inputValue, sequence, controller).finally(() => {
        if (interactiveController.current === controller) {
          interactiveController.current = null;
        }
      });
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (interactiveController.current === controller) {
        interactiveController.current = null;
      }
    };
  }, [inputValue, selectedEconomy]);

  async function loadMatches(
    query: string,
    sequence: number,
    controller: AbortController,
  ) {
    setStatus("loading");
    try {
      const result = await fetchEconomies(query, controller.signal);
      if (requestSequence.current !== sequence) {
        return;
      }
      setMatches(result.matches);
      setActiveIndex(-1);
      setOpen(result.matches.length > 0);
      setStatus(result.matches.length === 0 ? "no-match" : "idle");
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestSequence.current !== sequence
      ) {
        return;
      }
      const nextStatus = economySearchErrorStatus(error);
      if (nextStatus === "failed") {
        console.error("Economy search request failed", error);
      }
      setMatches([]);
      setOpen(false);
      setStatus(nextStatus);
    }
  }

  function selectEconomy(economy: EconomyRecord) {
    explicitlyEdited.current = true;
    setSelectedEconomy(economy);
    setMatches([]);
    setOpen(false);
    setActiveIndex(-1);
    setStatus("idle");
    onSelectionChange(economy, "explicit");
    const url = new URL(window.location.href);
    url.searchParams.set("exporter", economy.code);
    url.searchParams.delete("market");
    window.history.replaceState(null, "", url);
  }

  function clearSelection() {
    if (selectedEconomy === null) {
      return;
    }
    setSelectedEconomy(null);
    onSelectionChange(null, "explicit");
    const url = new URL(window.location.href);
    url.searchParams.delete("exporter");
    url.searchParams.delete("market");
    window.history.replaceState(null, "", url);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (matches.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? matches.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      selectEconomy(matches[activeIndex].economy);
    }
  }

  return (
    <div className="economy-field">
      <label htmlFor="economy-search">{messages.label}</label>
      <input
        id="economy-search"
        type="search"
        role="combobox"
        autoComplete="off"
        value={
          selectedEconomy === null
            ? inputValue
            : `${selectedEconomy.code} — ${selectedEconomy.name}`
        }
        placeholder={messages.placeholder}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={
          open && activeIndex >= 0
            ? economyOptionId(matches[activeIndex].economy.code)
            : undefined
        }
        aria-describedby="economy-search-help economy-search-status"
        onChange={(event) => {
          explicitlyEdited.current = true;
          cancelInteractiveRequest();
          clearSelection();
          const nextValue = event.target.value;
          setInputValue(nextValue);
          setMatches([]);
          setOpen(false);
          setStatus([...nextValue].length > 100 ? "invalid" : "idle");
        }}
        onFocus={() => {
          if (matches.length > 0) {
            setOpen(true);
            return;
          }
          if (selectedEconomy === null && inputValue === "") {
            const sequence = requestSequence.current + 1;
            requestSequence.current = sequence;
            interactiveController.current?.abort();
            const controller = new AbortController();
            interactiveController.current = controller;
            void loadMatches("", sequence, controller).finally(() => {
              if (interactiveController.current === controller) {
                interactiveController.current = null;
              }
            });
          }
        }}
        onBlur={() => {
          cancelInteractiveRequest();
          setOpen(false);
          setActiveIndex(-1);
          setStatus("idle");
        }}
        onKeyDown={handleKeyDown}
      />
      <p id="economy-search-help">{messages.help}</p>
      {open ? (
        <ul
          id={listboxId}
          className="economy-options"
          role="listbox"
          aria-label={messages.label}
        >
          {matches.map(({ economy, match }, index) => (
            <li
              id={economyOptionId(economy.code)}
              key={economy.code}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectEconomy(economy)}
            >
              <strong>{economy.code}</strong>
              <span>{economy.name}</span>
              <small>
                {economy.iso3 ?? "No public ISO3"}
                {match === null ? "" : ` · Matched ${match.matchedText}`}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
      <p id="economy-search-status" aria-live="polite">
        {status === "loading"
          ? messages.loading
          : status === "no-match"
            ? messages.noMatch
            : status === "invalid"
              ? messages.invalid
              : status === "retired"
                ? messages.retired
                : status === "failed"
                  ? messages.failed
                  : selectedEconomy === null
                    ? ""
                    : `${messages.selected}: ${selectedEconomy.code}`}
      </p>
      {status === "retired" ? (
        <button
          className="economy-refresh-button"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => window.location.reload()}
        >
          {messages.refresh}
        </button>
      ) : null}
    </div>
  );

  function cancelInteractiveRequest() {
    requestSequence.current += 1;
    interactiveController.current?.abort();
    interactiveController.current = null;
  }
}

async function fetchEconomies(
  query: string,
  signal: AbortSignal,
): Promise<EconomySearchResult> {
  const parameters = new URLSearchParams({ q: query });
  const response = await fetch(
    `/api/v1/analyses/${PUBLIC_ANALYSIS_BUILD_ID}/economies?${parameters}`,
    { signal },
  );
  if (!response.ok) {
    throw new EconomySearchResponseError(response.status);
  }
  return (await response.json()) as EconomySearchResult;
}

class EconomySearchResponseError extends Error {
  constructor(readonly status: number) {
    super(`Economy search returned ${status}.`);
    this.name = "EconomySearchResponseError";
  }
}

function economySearchErrorStatus(error: unknown): EconomySearchStatus {
  if (error instanceof EconomySearchResponseError) {
    if (error.status === 400) {
      return "invalid";
    }
    if (error.status === 410) {
      return "retired";
    }
  }
  return "failed";
}

function economyOptionId(code: string): string {
  return `economy-option-${code}`;
}
