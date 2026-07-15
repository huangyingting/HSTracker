"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { TradeExplorerV1Payload } from "../domain/trade-analytics/trade-explorer-v1-adapter";
import {
  encodeTradeExplorerQuery,
  type TradeExplorerQueryFields,
} from "../domain/trade-analytics/trade-explorer-v1-query-codec";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  TRADE_EXPLORER_MAX_FILTER_CODES,
  TRADE_EXPLORER_MAX_YEARS,
  type TradeExplorerMeasure,
  type TradeExplorerShape,
} from "../domain/trade-explorer/result";
import { TRADE_EXPLORER_SHAPES } from "../domain/trade-explorer/shapes";
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withoutPin,
  withPin,
  type TradeExplorerContext,
} from "./trade-analysis-context";
import { TradeExplorerExportAction } from "./trade-explorer-export-action";

const copy = {
  en: {
    eyebrow: "Trade Explorer",
    advancedBadge: "Advanced business task",
    title: "Combine approved dimensions, measures, and filters under strict budgets.",
    lede: "Choose one allowlisted business shape, its bounded filters, and up to two approved measures. This is not a database console: there is no SQL, table, column, or raw-record input anywhere on this page.",
    shapeLegend: "Business shape",
    shapes: {
      "finalized-trend-v1": "Finalized-year trend for one market and product",
      "importing-markets-v1": "Compare importing markets for one exporter and product",
      "supplying-economies-v1": "Compare supplying economies for one importer and product",
      "product-mix-v1": "Compare products for one exporter and importer",
    } as Record<TradeExplorerShape, string>,
    dimensionsLegend: "Filters",
    exportEconomyLabel: "Export economy",
    importEconomyLabel: "Import economy",
    hsProductLabel: "HS12 product",
    yearLabel: "Finalized year",
    fixedHelp: "Exactly one BACI economy or HS12 code.",
    groupedHelp: `Up to ${TRADE_EXPLORER_MAX_FILTER_CODES} comma-separated codes -- one result row each.`,
    groupedYearHelp: `Uses the ${TRADE_EXPLORER_MAX_YEARS} most recent finalized years automatically.`,
    yearHelp: "One finalized year, four digits.",
    measuresLegend: "Measures",
    measureValue: "Trade value (current USD)",
    measureCount: "Recorded flow count",
    sortLegend: "Sort",
    sortKeyLabel: "Sort by",
    sortDirectionLabel: "Direction",
    ascending: "Ascending",
    descending: "Descending",
    analyze: "Analyze Trade Explorer",
    cancel: "Cancel",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable: "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
    loading: "Loading Trade Explorer…",
    malformed: "This combination is not allowed. Check the shape, filters, measures, and sort.",
    stale: "This analysis build has retired. Refresh the current analysis.",
    rateLimit: "Trade Explorer requests are temporarily limited. Wait a moment before retrying.",
    budget: "This request exceeds a Trade Explorer budget. Narrow the years, codes, or result size.",
    capacity: "Analysis capacity is temporarily busy. Trade Explorer was not loaded.",
    incompatible:
      "This analysis build does not provide compatible Trade Explorer capabilities. Refresh the current analysis or use a supported analysis build.",
    unavailable: "The compatible Trade Explorer evidence is temporarily unavailable.",
    fatal: "Trade Explorer could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry Trade Explorer",
    boundaryTitle: "No SQL, storage, or raw records",
    boundary: "Every field above is a public semantic vocabulary term from an allowlisted business shape. There is no SQL, table name, column name, expression, or raw-record input anywhere in Trade Explorer.",
    resultsTitle: "Result",
    columnDimension: "Dimension",
    columnValue: "Trade value (current USD)",
    columnCount: "Recorded flow count",
    columnState: "Observation state",
    totalRow: "Total",
    recordedPositive: "Recorded positive",
    noRecordedFlow: "No recorded positive flow",
    missingObservation: "Missing observation",
    empty: "This exact combination has no enumerable evidence.",
    warningsTitle: "Quality warnings",
    warningSparse: "No row in this result recorded a positive value.",
    warningIncomplete: "At least one requested row has no recorded observation at all.",
    budgetTitle: "Budget",
    budgetRows: "Result rows",
    budgetScan: "Scan rows",
    budgetBytes: "Result bytes",
    disclaimer: "Use this bounded evidence as a discovery aid, not as a forecast or recommendation.",
  },
  "zh-Hans": {
    eyebrow: "贸易探索者",
    advancedBadge: "高级业务任务",
    title: "在严格预算下组合已批准的维度、度量与筛选条件。",
    lede: "选择一个已列入白名单的业务形态、其有界筛选条件，以及最多两个已批准的度量。这不是数据库控制台：本页任何位置都没有 SQL、表、列或原始记录输入。",
    shapeLegend: "业务形态",
    shapes: {
      "finalized-trend-v1": "一个市场与产品的定稿年份趋势",
      "importing-markets-v1": "比较一个出口方与产品的进口市场",
      "supplying-economies-v1": "比较一个进口方与产品的供应经济体",
      "product-mix-v1": "比较一个出口方与进口方的产品",
    } as Record<TradeExplorerShape, string>,
    dimensionsLegend: "筛选条件",
    exportEconomyLabel: "出口经济体",
    importEconomyLabel: "进口经济体",
    hsProductLabel: "HS12 产品",
    yearLabel: "定稿年份",
    fixedHelp: "恰好一个 BACI 经济体或 HS12 编码。",
    groupedHelp: `最多 ${TRADE_EXPLORER_MAX_FILTER_CODES} 个逗号分隔的编码——每个生成一行结果。`,
    groupedYearHelp: `自动使用最近 ${TRADE_EXPLORER_MAX_YEARS} 个定稿年份。`,
    yearHelp: "一个定稿年份，四位数字。",
    measuresLegend: "度量",
    measureValue: "贸易额（现价美元）",
    measureCount: "已记录流量计数",
    sortLegend: "排序",
    sortKeyLabel: "排序依据",
    sortDirectionLabel: "方向",
    ascending: "升序",
    descending: "降序",
    analyze: "分析贸易探索者",
    cancel: "取消",
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
    loading: "正在加载贸易探索者…",
    malformed: "此组合不被允许。请检查形态、筛选条件、度量与排序。",
    stale: "该分析构建已停用。请刷新当前分析。",
    rateLimit: "贸易探索者请求暂时受限。请稍候再试。",
    budget: "该请求超出贸易探索者的预算。请缩小年份、编码或结果规模。",
    capacity: "分析容量暂时繁忙。尚未加载贸易探索者。",
    incompatible:
      "此分析构建未提供兼容的贸易探索者能力。请刷新当前分析或使用受支持的分析构建。",
    unavailable: "兼容的贸易探索者证据暂时不可用。",
    fatal: "无法完成贸易探索者分析。",
    refresh: "刷新当前分析",
    retry: "重试贸易探索者",
    boundaryTitle: "没有 SQL、存储或原始记录",
    boundary: "上面的每个字段都来自一个已列入白名单业务形态的公开语义词汇。贸易探索者中任何位置都没有 SQL、表名、列名、表达式或原始记录输入。",
    resultsTitle: "结果",
    columnDimension: "维度",
    columnValue: "贸易额（现价美元）",
    columnCount: "已记录流量计数",
    columnState: "观测状态",
    totalRow: "合计",
    recordedPositive: "已记录正值",
    noRecordedFlow: "没有已记录的正向流量",
    missingObservation: "缺失观测",
    empty: "该确切组合没有可枚举的证据。",
    warningsTitle: "质量提示",
    warningSparse: "此结果中没有任何一行记录正值。",
    warningIncomplete: "至少一个所请求的行完全没有记录观测。",
    budgetTitle: "预算",
    budgetRows: "结果行数",
    budgetScan: "扫描行数",
    budgetBytes: "结果字节数",
    disclaimer: "将此有界证据作为发现辅助，而非预测或建议。",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type TradeExplorerStatus =
  | "idle"
  | "loading"
  | "success"
  | "malformed"
  | "stale"
  | "rateLimit"
  | "budget"
  | "capacity"
  | "incompatible"
  | "unavailable"
  | "fatal";

type TradeExplorerDraft = Pick<
  TradeExplorerContext,
  | "shape"
  | "measures"
  | "years"
  | "exportEconomy"
  | "importEconomy"
  | "hsProduct"
  | "sort"
>;

const SORT_DIRECTIONS = ["asc", "desc"] as const;

export function TradeExplorerWorkspace({ locale }: { locale: WorkspaceLocale }) {
  const messages = copy[locale];
  const requestSequence = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const restorePending = useRef(true);
  const analyzedInputsInHistory = useRef(false);

  const [shape, setShape] = useState<TradeExplorerShape | null>(
    () => initialTradeExplorerFields().shape,
  );
  const [measures, setMeasures] = useState<readonly TradeExplorerMeasure[]>(
    () => initialTradeExplorerFields().measures,
  );
  const [exportEconomyText, setExportEconomyText] = useState(
    () => initialTradeExplorerFields().exportEconomy.join(", "),
  );
  const [importEconomyText, setImportEconomyText] = useState(
    () => initialTradeExplorerFields().importEconomy.join(", "),
  );
  const [hsProductText, setHsProductText] = useState(
    () => initialTradeExplorerFields().hsProduct.join(", "),
  );
  const [yearText, setYearText] = useState(() => {
    const years = initialTradeExplorerFields().years;
    return years.join(", ");
  });
  const [sortKey, setSortKey] = useState(
    () => initialTradeExplorerFields().sort?.key ?? "",
  );
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
    () => initialTradeExplorerFields().sort?.direction ?? "asc",
  );

  const [result, setResult] = useState<TradeExplorerV1Payload | null>(null);
  const [status, setStatus] = useState<TradeExplorerStatus>("idle");
  const [manifest, setManifest] = useState<CurrentAnalysisManifest | null>(null);
  const [manifestStatus, setManifestStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  const definition = shape === null
    ? null
    : TRADE_EXPLORER_SHAPES.find((candidate) => candidate.shape === shape) ?? null;
  const groupedDimension = definition?.groupedDimension ?? null;

  const loadManifest = useCallback(async () => {
    const controller = new AbortController();
    setManifestStatus("loading");
    try {
      const current = await loadCurrentAnalysisManifest({
        fetcher: fetch,
        signal: controller.signal,
        revalidate: false,
      });
      setManifest(current);
      setManifestStatus("ready");
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Current analysis manifest request failed", error);
        setManifestStatus("failed");
      }
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    void loadCurrentAnalysisManifest({
      fetcher: fetch,
      signal: controller.signal,
      revalidate: false,
    })
      .then((current) => {
        if (!disposed) {
          setManifest(current);
          setManifestStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!disposed && !controller.signal.aborted) {
          console.error("Current analysis manifest request failed", error);
          setManifestStatus("failed");
        }
      });
    return () => {
      disposed = true;
      controller.abort();
      analysisController.current?.abort();
    };
  }, []);

  const recoverFromStalePin = useCallback(() => {
    const context = parseTradeAnalysisContext(window.location.href);
    const url = serializeTradeAnalysisContext(window.location.href, withoutPin(context));
    window.history.replaceState(null, "", url);
    setStatus("idle");
    return loadManifest();
  }, [loadManifest]);

  const writeContext = useCallback(
    (
      pin: TradeExplorerContext["pin"],
      overrides: Partial<TradeExplorerDraft> = {},
    ) => {
      const draft: TradeExplorerDraft = {
        shape,
        measures,
        years: splitYears(yearText),
        exportEconomy: splitCodes(exportEconomyText),
        importEconomy: splitCodes(importEconomyText),
        hsProduct: splitCodes(hsProductText),
        sort:
          sortKey === ""
            ? null
            : {
                key: sortKey as NonNullable<TradeExplorerContext["sort"]>["key"],
                direction: sortDirection,
              },
        ...overrides,
      };
      const context: TradeExplorerContext = {
        recipe: "trade-explorer",
        locale,
        pin,
        ...draft,
      };
      const url = serializeTradeAnalysisContext(window.location.href, context);
      window.history.replaceState(null, "", url);
    },
    [exportEconomyText, hsProductText, importEconomyText, locale, measures, shape, sortDirection, sortKey, yearText],
  );

  const clearResult = useCallback(
    (overrides: Partial<TradeExplorerDraft> = {}) => {
      analysisController.current?.abort();
      requestSequence.current += 1;
      if (analyzedInputsInHistory.current) {
        window.history.pushState(null, "", window.location.href);
        analyzedInputsInHistory.current = false;
      }
      restorePending.current = false;
      setResult(null);
      setStatus("idle");
      writeContext(null, overrides);
    },
    [writeContext],
  );

  const analyze = useCallback(async () => {
    if (manifest === null || shape === null || definition === null || measures.length === 0) {
      return;
    }
    const urlPin = parseTradeAnalysisContext(window.location.href).pin;
    const pinResolution = resolvePinnedContext(urlPin, manifest, "trade-explorer");
    if (pinResolution.state === "retired") {
      setStatus("stale");
      return;
    }
    const analysisBuildId =
      pinResolution.state === "retained"
        ? pinResolution.deployment.analysisBuildId
        : manifest.analysisBuildId;

    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setResult(null);
    setStatus("loading");

    const query: TradeExplorerQueryFields = {
      shape,
      dimensions: [definition.groupedDimension],
      measures,
      filters: {
        year: {
          mode: "list" as const,
          years: splitYears(yearText),
        },
        exportEconomy: splitCodes(exportEconomyText),
        importEconomy: splitCodes(importEconomyText),
        hsProduct: splitCodes(hsProductText),
      },
      sort:
        sortKey === ""
          ? null
          : {
              key: sortKey as NonNullable<
                TradeExplorerQueryFields["sort"]
              >["key"],
              direction: sortDirection,
            },
    };
    const queryString = encodeTradeExplorerQuery(query).toString();

    try {
      const response = await fetch(
        `/api/v1/analyses/${analysisBuildId}/trade-explorer?${queryString}`,
        {
          signal: controller.signal,
        },
      );
      if (requestSequence.current !== sequence) {
        return;
      }
      if (!response.ok) {
        setStatus(tradeExplorerErrorStatus(response.status, await response.json()));
        return;
      }
      const payload = (await response.json()) as TradeExplorerV1Payload;
      if (
        pinResolution.state === "retained"
          ? payload.analysisBuildId !== analysisBuildId ||
            payload.provenance.baciRelease !== pinResolution.deployment.baciRelease ||
            payload.provenance.artifactSha256 !== pinResolution.deployment.artifactSha256
          : payload.analysisBuildId !== analysisBuildId ||
            payload.provenance.baciRelease !== manifest.source.baciRelease ||
            payload.provenance.artifactSha256 !== manifest.source.artifact.sha256
      ) {
        throw new TypeError(
          "The Trade Explorer result does not match the discovered manifest.",
        );
      }
      setResult(payload);
      setStatus("success");
      analyzedInputsInHistory.current = true;
      const pin =
        pinResolution.state === "retained" ? pinResolution.pin : pinFromCurrentManifest(manifest);
      writeContext(pin);
    } catch (error) {
      if (!controller.signal.aborted && requestSequence.current === sequence) {
        console.error("Trade Explorer workspace request failed", error);
        setStatus("fatal");
      }
    }
  }, [definition, exportEconomyText, hsProductText, importEconomyText, manifest, measures, shape, sortDirection, sortKey, writeContext, yearText]);

  // Restoration itself happens once, synchronously, in each field's own
  // lazy useState initializer above (initialTradeExplorerFields), so this
  // effect only ever decides whether to auto-trigger analyze() once the
  // manifest is ready -- it never calls setState directly itself.
  useEffect(() => {
    if (!restorePending.current || manifest === null) {
      return;
    }
    restorePending.current = false;
    if (
      shape !== null &&
      measures.length > 0 &&
      splitCodes(exportEconomyText).length > 0 &&
      splitCodes(importEconomyText).length > 0 &&
      splitCodes(hsProductText).length > 0
    ) {
      const timeout = window.setTimeout(() => void analyze(), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [analyze, exportEconomyText, hsProductText, importEconomyText, manifest, measures, shape]);

  useLayoutEffect(() => {
    function restoreContextFromHistory() {
      const context = parseTradeAnalysisContext(window.location.href);
      if (context.recipe !== "trade-explorer") {
        return;
      }
      analysisController.current?.abort();
      requestSequence.current += 1;
      analyzedInputsInHistory.current = false;
      restorePending.current = true;
      setShape(context.shape);
      setMeasures(context.measures);
      setExportEconomyText(context.exportEconomy.join(", "));
      setImportEconomyText(context.importEconomy.join(", "));
      setHsProductText(context.hsProduct.join(", "));
      setYearText(context.years.join(", "));
      setSortKey(context.sort?.key ?? "");
      setSortDirection(context.sort?.direction ?? "asc");
      setResult(null);
      setStatus("idle");
    }

    window.addEventListener("popstate", restoreContextFromHistory);
    return () =>
      window.removeEventListener("popstate", restoreContextFromHistory);
  }, []);

  const sortableKeys: readonly string[] = [
    ...(groupedDimension === null ? [] : [groupedDimension]),
    ...measures,
  ];

  const canAnalyze =
    shape !== null &&
    measures.length > 0 &&
    splitCodes(exportEconomyText).length > 0 &&
    splitCodes(importEconomyText).length > 0 &&
    splitCodes(hsProductText).length > 0 &&
    status !== "loading";

  return (
    <section
      className="analysis-workspace trade-explorer-workspace"
      id="discovery"
      tabIndex={-1}
      aria-labelledby="trade-explorer-workspace-title"
    >
      <div className="workspace-intro">
        <p>
          {messages.eyebrow} <span className="trade-explorer-badge">{messages.advancedBadge}</span>
        </p>
        <h2 id="trade-explorer-workspace-title">{messages.title}</h2>
        <p>{messages.lede}</p>
      </div>

      {manifest === null ? (
        <div
          className={`analysis-state ${manifestStatus === "failed" ? "analysis-error" : "analysis-loading"}`}
          role={manifestStatus === "failed" ? "alert" : "status"}
        >
          {manifestStatus === "failed" ? (
            <>
              <p>{messages.currentUnavailable}</p>
              <button type="button" onClick={() => void loadManifest()}>
                {messages.retryCurrent}
              </button>
            </>
          ) : (
            <>
              <span aria-hidden="true" />
              {messages.loadingCurrent}
            </>
          )}
        </div>
      ) : (
        <>
          <fieldset className="trade-explorer-fieldset">
            <legend>{messages.shapeLegend}</legend>
            {TRADE_EXPLORER_SHAPES.map((candidate) => (
              <label key={candidate.shape} className="trade-explorer-radio">
                <input
                  type="radio"
                  name="trade-explorer-shape"
                  value={candidate.shape}
                  checked={shape === candidate.shape}
                  onChange={() => {
                    setShape(candidate.shape);
                    setSortKey("");
                    const clearsHiddenYear =
                      candidate.groupedDimension === "YEAR";
                    if (clearsHiddenYear) {
                      setYearText("");
                    }
                    clearResult({
                      shape: candidate.shape,
                      sort: null,
                      ...(clearsHiddenYear ? { years: [] } : {}),
                    });
                  }}
                />
                {messages.shapes[candidate.shape]}
              </label>
            ))}
          </fieldset>

          {definition !== null ? (
            <fieldset className="trade-explorer-fieldset">
              <legend>{messages.dimensionsLegend}</legend>
              <div className="trade-explorer-field">
                <label htmlFor="trade-explorer-export-economy">
                  {messages.exportEconomyLabel}
                </label>
                <input
                  id="trade-explorer-export-economy"
                  type="text"
                  inputMode="numeric"
                  aria-describedby="trade-explorer-export-economy-help"
                  value={exportEconomyText}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setExportEconomyText(nextText);
                    clearResult({ exportEconomy: splitCodes(nextText) });
                  }}
                />
                <p id="trade-explorer-export-economy-help">
                  {groupedDimension === "EXPORT_ECONOMY" ? messages.groupedHelp : messages.fixedHelp}
                </p>
              </div>
              <div className="trade-explorer-field">
                <label htmlFor="trade-explorer-import-economy">
                  {messages.importEconomyLabel}
                </label>
                <input
                  id="trade-explorer-import-economy"
                  type="text"
                  inputMode="numeric"
                  aria-describedby="trade-explorer-import-economy-help"
                  value={importEconomyText}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setImportEconomyText(nextText);
                    clearResult({ importEconomy: splitCodes(nextText) });
                  }}
                />
                <p id="trade-explorer-import-economy-help">
                  {groupedDimension === "IMPORT_ECONOMY" ? messages.groupedHelp : messages.fixedHelp}
                </p>
              </div>
              <div className="trade-explorer-field">
                <label htmlFor="trade-explorer-hs-product">{messages.hsProductLabel}</label>
                <input
                  id="trade-explorer-hs-product"
                  type="text"
                  aria-describedby="trade-explorer-hs-product-help"
                  value={hsProductText}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setHsProductText(nextText);
                    clearResult({ hsProduct: splitCodes(nextText) });
                  }}
                />
                <p id="trade-explorer-hs-product-help">
                  {groupedDimension === "HS_PRODUCT" ? messages.groupedHelp : messages.fixedHelp}
                </p>
              </div>
              {groupedDimension !== "YEAR" ? (
                <div className="trade-explorer-field">
                  <label htmlFor="trade-explorer-year">{messages.yearLabel}</label>
                  <input
                    id="trade-explorer-year"
                    type="text"
                    inputMode="numeric"
                    aria-describedby="trade-explorer-year-help"
                    value={yearText}
                    onChange={(event) => {
                      const nextText = event.target.value;
                      setYearText(nextText);
                      clearResult({
                        years: splitYears(nextText),
                      });
                    }}
                  />
                  <p id="trade-explorer-year-help">{messages.yearHelp}</p>
                </div>
              ) : (
                <p className="trade-explorer-year-note">{messages.groupedYearHelp}</p>
              )}
            </fieldset>
          ) : null}

          <fieldset className="trade-explorer-fieldset">
            <legend>{messages.measuresLegend}</legend>
            <label className="trade-explorer-checkbox">
              <input
                type="checkbox"
                checked={measures.includes("TRADE_VALUE_USD")}
                onChange={() => {
                  const nextMeasures = toggledMeasure(
                    measures,
                    "TRADE_VALUE_USD",
                  );
                  const removesActiveSort =
                    sortKey === "TRADE_VALUE_USD" &&
                    !nextMeasures.includes("TRADE_VALUE_USD");
                  setMeasures(nextMeasures);
                  if (removesActiveSort) {
                    setSortKey("");
                  }
                  clearResult({
                    measures: nextMeasures,
                    ...(removesActiveSort ? { sort: null } : {}),
                  });
                }}
              />
              {messages.measureValue}
            </label>
            <label className="trade-explorer-checkbox">
              <input
                type="checkbox"
                checked={measures.includes("RECORDED_FLOW_COUNT")}
                onChange={() => {
                  const nextMeasures = toggledMeasure(
                    measures,
                    "RECORDED_FLOW_COUNT",
                  );
                  const removesActiveSort =
                    sortKey === "RECORDED_FLOW_COUNT" &&
                    !nextMeasures.includes("RECORDED_FLOW_COUNT");
                  setMeasures(nextMeasures);
                  if (removesActiveSort) {
                    setSortKey("");
                  }
                  clearResult({
                    measures: nextMeasures,
                    ...(removesActiveSort ? { sort: null } : {}),
                  });
                }}
              />
              {messages.measureCount}
            </label>
          </fieldset>

          {definition !== null ? (
            <fieldset className="trade-explorer-fieldset">
              <legend>{messages.sortLegend}</legend>
              <div className="trade-explorer-field">
                <label htmlFor="trade-explorer-sort-key">{messages.sortKeyLabel}</label>
                <select
                  id="trade-explorer-sort-key"
                  value={sortKey}
                  onChange={(event) => {
                    const nextKey = event.target.value;
                    setSortKey(nextKey);
                    clearResult({
                      sort:
                        nextKey === ""
                          ? null
                          : {
                              key: nextKey as NonNullable<
                                TradeExplorerContext["sort"]
                              >["key"],
                              direction: sortDirection,
                            },
                    });
                  }}
                >
                  <option value="">{messages.sortKeyLabel}</option>
                  {sortableKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="trade-explorer-field">
                <label htmlFor="trade-explorer-sort-direction">
                  {messages.sortDirectionLabel}
                </label>
                <select
                  id="trade-explorer-sort-direction"
                  value={sortDirection}
                  onChange={(event) => {
                    const nextDirection = event.target.value as "asc" | "desc";
                    setSortDirection(nextDirection);
                    clearResult({
                      sort:
                        sortKey === ""
                          ? null
                          : {
                              key: sortKey as NonNullable<
                                TradeExplorerContext["sort"]
                              >["key"],
                              direction: nextDirection,
                            },
                    });
                  }}
                >
                  {SORT_DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {direction === "asc" ? messages.ascending : messages.descending}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
          ) : null}

          <div className="analysis-controls">
            <button
              className="analyze-button"
              type="button"
              disabled={!canAnalyze}
              onClick={() => void analyze()}
            >
              {messages.analyze}
            </button>
            <button
              type="button"
              disabled={status !== "loading"}
              onClick={() => {
                analysisController.current?.abort();
                setStatus("idle");
              }}
            >
              {messages.cancel}
            </button>
          </div>
          <SourceScope manifest={manifest} result={null} locale={locale} />
        </>
      )}

      {status === "loading" ? (
        <div className="analysis-state analysis-loading" role="status">
          <span aria-hidden="true" />
          {messages.loading}
        </div>
      ) : null}

      {status === "success" && result !== null ? (
        <>
          <TradeExplorerExportAction result={result} locale={locale} onManifestRevalidated={setManifest} />
          <AnalysisShareLink locale={locale} task="trade-explorer" />
          <p className="trade-explorer-boundary" role="note">
            <strong>{messages.boundaryTitle}</strong> {messages.boundary}
          </p>
          <TradeExplorerEvidence result={result} locale={locale} />
        </>
      ) : null}

      {isErrorStatus(status) ? (
        <div className="analysis-state analysis-error" role="alert">
          <p>{messages[status]}</p>
          {status === "stale" || status === "rateLimit" || status === "capacity" ? (
            <button
              type="button"
              onClick={() => (status === "stale" ? void recoverFromStalePin() : void analyze())}
            >
              {status === "stale" ? messages.refresh : messages.retry}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_TRADE_EXPLORER_CONTEXT: TradeExplorerContext = {
  recipe: "trade-explorer",
  locale: "en",
  pin: null,
  shape: null,
  measures: [],
  years: [],
  exportEconomy: [],
  importEconomy: [],
  hsProduct: [],
  sort: null,
};

function pinFromCurrentManifest(
  manifest: CurrentAnalysisManifest,
): TradeExplorerContext["pin"] {
  return withPin(EMPTY_TRADE_EXPLORER_CONTEXT, manifest).pin;
}

/**
 * The Trade Explorer fields to hydrate every field's own lazy `useState`
 * initializer from -- called once per field on first render, entirely
 * synchronously, so restoring a canonical Trade Explorer URL never needs
 * an effect that calls setState directly (see the restore effect above).
 * Absent a browser `window` (server render) or a non-trade-explorer
 * canonical context, this is simply the empty Trade Explorer context.
 */
function initialTradeExplorerFields(): TradeExplorerContext {
  if (typeof window === "undefined") {
    return EMPTY_TRADE_EXPLORER_CONTEXT;
  }
  const context = parseTradeAnalysisContext(window.location.href);
  return context.recipe === "trade-explorer" ? context : EMPTY_TRADE_EXPLORER_CONTEXT;
}

function toggledMeasure(
  measures: readonly TradeExplorerMeasure[],
  measure: TradeExplorerMeasure,
): readonly TradeExplorerMeasure[] {
  return measures.includes(measure)
    ? measures.filter((value) => value !== measure)
    : [...measures, measure];
}

function splitYears(value: string): readonly number[] {
  return splitCodes(value).map(Number);
}

function TradeExplorerEvidence({
  result,
  locale,
}: {
  result: TradeExplorerV1Payload;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  const wantsValue = result.query.measures.includes("TRADE_VALUE_USD");
  const wantsCount = result.query.measures.includes("RECORDED_FLOW_COUNT");

  return (
    <section className="trade-explorer-evidence" aria-label={messages.resultsTitle}>
      <h3>{messages.resultsTitle}</h3>
      {result.rows.length === 0 ? (
        <p>{messages.empty}</p>
      ) : (
        <table aria-label={messages.resultsTitle}>
          <thead>
            <tr>
              <th scope="col">{messages.columnDimension}</th>
              <th scope="col">{messages.columnState}</th>
              {wantsValue ? <th scope="col">{messages.columnValue}</th> : null}
              {wantsCount ? <th scope="col">{messages.columnCount}</th> : null}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                <th scope="row">{dimensionValueLabel(row.dimensionValue)}</th>
                <td>{observationStateLabel(row.state, messages)}</td>
                {wantsValue ? <td>{row.tradeValueUsd ?? "—"}</td> : null}
                {wantsCount ? <td>{row.recordedFlowCount ?? "—"}</td> : null}
              </tr>
            ))}
            {result.totalRow !== null ? (
              <tr>
                <th scope="row">{messages.totalRow}</th>
                <td />
                {wantsValue ? <td>{result.totalRow.tradeValueUsd ?? "—"}</td> : null}
                {wantsCount ? <td>{result.totalRow.recordedFlowCount ?? "—"}</td> : null}
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {result.qualityWarnings.length > 0 ? (
        <div className="trade-explorer-warnings">
          <p>{messages.warningsTitle}</p>
          <ul>
            {result.qualityWarnings.map((warning) => (
              <li key={warning}>
                {warning === "SPARSE_COHORT" ? messages.warningSparse : messages.warningIncomplete}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="trade-explorer-budget">
        <p>{messages.budgetTitle}</p>
        <div>
          <dt>{messages.budgetRows}</dt>
          <dd>
            {result.budget.actual.resultRows} / {result.budget.accepted.maxResultRows}
          </dd>
        </div>
        <div>
          <dt>{messages.budgetScan}</dt>
          <dd>
            {result.budget.actual.scanRows} / {result.budget.accepted.maxScanRows}
          </dd>
        </div>
        <div>
          <dt>{messages.budgetBytes}</dt>
          <dd>
            {result.budget.actual.resultBytes} / {result.budget.accepted.maxResultBytes}
          </dd>
        </div>
      </dl>
      <p className="trade-explorer-disclaimer">{messages.disclaimer}</p>
    </section>
  );
}

function dimensionValueLabel(
  dimensionValue: TradeExplorerV1Payload["rows"][number]["dimensionValue"],
): string {
  if (dimensionValue.dimension === "YEAR") {
    return String(dimensionValue.year);
  }
  if (dimensionValue.dimension === "HS_PRODUCT") {
    return `${dimensionValue.product.code} — ${dimensionValue.product.descriptionEn}`;
  }
  return `${dimensionValue.economy.code} — ${dimensionValue.economy.name}`;
}

function observationStateLabel(
  state: "RECORDED_POSITIVE" | "NO_RECORDED_POSITIVE_FLOW" | "MISSING_OBSERVATION",
  messages: (typeof copy)[WorkspaceLocale],
): string {
  if (state === "RECORDED_POSITIVE") {
    return messages.recordedPositive;
  }
  return state === "NO_RECORDED_POSITIVE_FLOW" ? messages.noRecordedFlow : messages.missingObservation;
}

function splitCodes(text: string): readonly string[] {
  return text
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function isErrorStatus(
  status: TradeExplorerStatus,
): status is Exclude<TradeExplorerStatus, "idle" | "loading" | "success"> {
  return (
    status === "malformed" ||
    status === "stale" ||
    status === "rateLimit" ||
    status === "budget" ||
    status === "capacity" ||
    status === "incompatible" ||
    status === "unavailable" ||
    status === "fatal"
  );
}

function tradeExplorerErrorStatus(
  httpStatus: number,
  body: { error?: { code?: string } },
): TradeExplorerStatus {
  const code = body.error?.code;
  if (httpStatus === 429) {
    return "rateLimit";
  }
  if (httpStatus === 413) {
    return "budget";
  }
  if (httpStatus === 503) {
    if (code === "ANALYSIS_CAPACITY_EXCEEDED") {
      return "capacity";
    }
    return code === "NO_COMPATIBLE_DATASET_PACKAGE"
      ? "incompatible"
      : "unavailable";
  }
  if (httpStatus === 410) {
    return "stale";
  }
  return httpStatus >= 400 && httpStatus < 500 ? "malformed" : "fatal";
}
