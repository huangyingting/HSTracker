"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { TradeTrendV1Payload } from "../domain/trade-analytics/trade-trend-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import {
  parseTradeAnalysisContext,
  resolvePinnedContext,
  serializeTradeAnalysisContext,
  withEconomyCode,
  withLocale,
  withoutPin,
  withPin,
  withProductCode,
  withRecipe,
} from "./trade-analysis-context";
import { TradeTrendExportAction } from "./trade-trend-export-action";

const copy = {
  en: {
    eyebrow: "Trade Trend",
    title: "Inspect annual import evidence.",
    lede:
      "Select one importing economy and HS 2012 product to inspect the latest five Finalized Years.",
    analyze: "Analyze Trade Trend",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable:
      "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
    loading: "Loading the Trade Trend…",
    malformed:
      "These Trade Trend inputs are invalid. Check the importing economy and HS Product.",
    stale: "This analysis build has retired. Refresh the current analysis.",
    rateLimit:
      "Trade Trend requests are temporarily limited. Wait a moment before retrying.",
    budget:
      "This Trade Trend request exceeds the complete-result size limit.",
    capacity: "Analysis capacity is temporarily busy. The trend was not loaded.",
    unavailable: "The compatible Trade Trend evidence is temporarily unavailable.",
    fatal: "The Trade Trend could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry Trade Trend",
    finalized: "Five Finalized Years",
    year: "Year",
    observation: "Observation",
    recorded: "Recorded positive value",
    noFlow: "No recorded positive flow",
    missing: "Missing observation",
    summary: "Finalized trend summary",
    unavailableSummary: "Trend unavailable",
    noRecorded:
      "No recorded-positive observations exist in the five Finalized Years.",
    oneRecorded:
      "Only one recorded-positive observation exists in the five Finalized Years; change and CAGR are unavailable.",
    first: "First recorded positive",
    last: "Last recorded positive",
    span: "Span",
    absolute: "Absolute change",
    percent: "Percentage change",
    cagr: "CAGR",
    years: "years",
    provisional: "Provisional Year snapshot",
    provisionalRule:
      "Separate supporting evidence. It does not affect the finalized change or CAGR.",
    noProvisional: "No provisional observation is available.",
    disclaimer:
      "Use this nominal import evidence as a discovery aid, not as a forecast or recommendation.",
  },
  "zh-Hans": {
    eyebrow: "贸易趋势",
    title: "查看年度进口证据。",
    lede: "选择一个进口经济体和 HS 2012 产品，查看最近五个定稿年份。",
    analyze: "分析贸易趋势",
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
    loading: "正在加载贸易趋势…",
    malformed: "该贸易趋势情境无效。请检查进口经济体和 HS 产品。",
    stale: "该分析构建已停用。请刷新当前分析。",
    rateLimit: "贸易趋势请求暂时受限。请稍候再试。",
    budget: "该贸易趋势请求超出完整结果大小限制。",
    capacity: "分析容量暂时繁忙。尚未加载趋势。",
    unavailable: "兼容的贸易趋势证据暂时不可用。",
    fatal: "无法完成贸易趋势。",
    refresh: "刷新当前分析",
    retry: "重试贸易趋势",
    finalized: "五个定稿年份",
    year: "年份",
    observation: "观测",
    recorded: "已记录的正值",
    noFlow: "没有已记录的正向流量",
    missing: "缺失观测",
    summary: "定稿趋势摘要",
    unavailableSummary: "趋势不可用",
    noRecorded: "五个定稿年份中没有已记录的正值观测。",
    oneRecorded:
      "五个定稿年份中仅有一个已记录的正值观测；变化和 CAGR 均不可用。",
    first: "最早已记录正值",
    last: "最后已记录正值",
    span: "跨度",
    absolute: "绝对变化",
    percent: "百分比变化",
    cagr: "复合年增长率",
    years: "年",
    provisional: "暂定年份快照",
    provisionalRule: "单独的辅助证据，不影响定稿变化或 CAGR。",
    noProvisional: "没有可用的暂定观测。",
    disclaimer: "将此名义进口证据作为发现辅助，而非预测或建议。",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type TradeTrendStatus =
  | "idle"
  | "loading"
  | "success"
  | "malformed"
  | "stale"
  | "rateLimit"
  | "budget"
  | "capacity"
  | "unavailable"
  | "fatal";

export function TradeTrendWorkspace({
  locale,
}: {
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  const requestSequence = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const restorePending = useRef(true);
  const [importer, setImporter] = useState<EconomyRecord | null>(null);
  const [product, setProduct] = useState<ProductSearchProduct | null>(null);
  const [result, setResult] = useState<TradeTrendV1Payload | null>(null);
  const [status, setStatus] = useState<TradeTrendStatus>("idle");
  const [manifest, setManifest] = useState<CurrentAnalysisManifest | null>(
    null,
  );
  const [manifestStatus, setManifestStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");

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

  // The explicit refresh action for a retired pin: it discards the old
  // pin (never silently rewriting it) and revalidates the current
  // Recommended Dataset Mapping, so a subsequent Analyze click resolves a
  // fresh, distinct canonical URL and Analysis Identity.
  const recoverFromStalePin = useCallback(() => {
    const context = parseTradeAnalysisContext(window.location.href);
    const url = serializeTradeAnalysisContext(
      window.location.href,
      withoutPin(context),
    );
    window.history.replaceState(null, "", url);
    setStatus("idle");
    return loadManifest();
  }, [loadManifest]);

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
      .catch((error) => {
        if (!disposed && !controller.signal.aborted) {
          console.error("Current analysis manifest request failed", error);
          setManifestStatus("failed");
        }
      });
    return () => {
      disposed = true;
      controller.abort();
      analysisController.current?.abort();
      requestSequence.current += 1;
    };
  }, []);

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
    requestSequence.current += 1;
    setResult(null);
    setStatus("idle");
    const context = withLocale(
      parseTradeAnalysisContext(window.location.href),
      locale,
    );
    const url = serializeTradeAnalysisContext(
      window.location.href,
      withoutPin(context),
    );
    window.history.replaceState(null, "", url);
  }, [locale]);

  const analyze = useCallback(async () => {
    if (manifest === null || importer === null || product === null) {
      return;
    }
    const urlPin = parseTradeAnalysisContext(window.location.href).pin;
    const pinResolution = resolvePinnedContext(urlPin, manifest, "trade-trend");
    if (pinResolution.state === "retired") {
      setStatus("stale");
      return;
    }
    // A retained pin executes its own exact analysisBuildId rather than
    // current's, reproducing its exact deterministic payload (see issue
    // #44); "current"/"unpinned" keep querying the live manifest's build
    // exactly as before.
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
    try {
      const parameters = new URLSearchParams({
        importer: importer.code,
        product: product.code,
      });
      const response = await fetch(
        `/api/v1/analyses/${analysisBuildId}/trade-trends?${parameters}`,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        requestSequence.current !== sequence
      ) {
        return;
      }
      if (!response.ok) {
        const error = trendErrorCode(await response.json());
        if (
          controller.signal.aborted ||
          requestSequence.current !== sequence
        ) {
          return;
        }
        setStatus(
          trendErrorStatus(response.status, error),
        );
        return;
      }
      const trend = (await response.json()) as TradeTrendV1Payload;
      if (
        controller.signal.aborted ||
        requestSequence.current !== sequence
      ) {
        return;
      }
      // A retained execution validates against that exact retained
      // build's own BACI Release/artifact identity (from
      // manifest.deploymentWindow) rather than current's, with the same
      // rigor as the "current" check below (see issue #44 "Pinned URLs
      // within the retention window reproduce exact Analysis Identity").
      if (pinResolution.state === "retained") {
        const retainedIdentity = pinResolution.deployment;
        if (
          trend.analysisBuildId !== analysisBuildId ||
          trend.provenance.baciRelease !== retainedIdentity.baciRelease ||
          trend.provenance.artifactSha256 !== retainedIdentity.artifactSha256
        ) {
          throw new TypeError(
            "The Trade Trend result does not match the discovered retained manifest.",
          );
        }
      } else if (
        trend.analysisBuildId !== analysisBuildId ||
        trend.provenance.baciRelease !== manifest.source.baciRelease ||
        trend.provenance.artifactSha256 !== manifest.source.artifact.sha256
      ) {
        throw new TypeError(
          "The Trade Trend result does not match the discovered current manifest.",
        );
      }
      setResult(trend);
      setStatus("success");
      const baseContext = withLocale(
        withProductCode(
          withEconomyCode(
            withRecipe(
              parseTradeAnalysisContext(window.location.href),
              "trade-trend",
            ),
            importer.code,
          ),
          product.code,
        ),
        locale,
      );
      // A retained execution keeps its own exact pin rather than
      // re-deriving current's live pin, so the canonical URL continues to
      // name the retained build it actually reproduced.
      const context =
        pinResolution.state === "retained"
          ? { ...baseContext, pin: pinResolution.pin }
          : withPin(baseContext, manifest);
      if (
        controller.signal.aborted ||
        requestSequence.current !== sequence
      ) {
        return;
      }
      const url = serializeTradeAnalysisContext(window.location.href, context);
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (!controller.signal.aborted && requestSequence.current === sequence) {
        console.error("Trade Trend workspace request failed", error);
        setStatus("fatal");
      }
    }
  }, [importer, locale, manifest, product]);

  useEffect(() => {
    if (
      !restorePending.current ||
      importer === null ||
      product === null ||
      manifest === null
    ) {
      return;
    }
    restorePending.current = false;
    const context = parseTradeAnalysisContext(window.location.href);
    if (
      context.recipe === "trade-trend" &&
      context.importerCode === importer.code &&
      context.productCode === product.code
    ) {
      const timeout = window.setTimeout(() => void analyze(), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [analyze, importer, manifest, product]);

  return (
    <section
      className="analysis-workspace"
      id="discovery"
      tabIndex={-1}
      aria-labelledby="trade-trend-workspace-title"
    >
      <div className="workspace-intro">
        <p>{messages.eyebrow}</p>
        <h2 id="trade-trend-workspace-title">{messages.title}</h2>
        <p>{messages.lede}</p>
      </div>

      {manifest === null ? (
        <div
          className={`analysis-state ${
            manifestStatus === "failed" ? "analysis-error" : "analysis-loading"
          }`}
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
          <div className="analysis-controls">
            <EconomyCombobox
              analysisBuildId={manifest.analysisBuildId}
              locale={locale}
              role="importer"
              onSelectionChange={(economy, source) => {
                setImporter(economy);
                if (source === "explicit") {
                  restorePending.current = false;
                  clearResult();
                }
              }}
              onRetiredBuild={() => void loadManifest()}
            />
            <ProductCombobox
              productSearchBuildId={manifest.productSearchBuildId}
              locale={locale}
              onSelectionChange={(nextProduct, source) => {
                setProduct(nextProduct);
                if (source === "explicit") {
                  restorePending.current = false;
                  clearResult();
                }
              }}
              onRetiredBuild={() => void loadManifest()}
            />
            <button
              className="analyze-button"
              type="button"
              disabled={
                importer === null || product === null || status === "loading"
              }
              onClick={() => void analyze()}
            >
              {messages.analyze}
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
          <TradeTrendExportAction
            result={result}
            locale={locale}
            onManifestRevalidated={setManifest}
          />
          <AnalysisShareLink locale={locale} task="trade-trend" />
          <TradeTrendEvidence result={result} locale={locale} />
        </>
      ) : null}

      {isErrorStatus(status) ? (
        <div className="analysis-state analysis-error" role="alert">
          <p>{messages[status]}</p>
          {status === "stale" || status === "rateLimit" || status === "capacity" ? (
            <button
              type="button"
              onClick={() =>
                status === "stale" ? void recoverFromStalePin() : void analyze()
              }
            >
              {status === "stale" ? messages.refresh : messages.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="workspace-disclaimer">{messages.disclaimer}</p>
    </section>
  );
}

function TradeTrendEvidence({
  result,
  locale,
}: {
  result: TradeTrendV1Payload;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <div className="trade-trend-evidence">
      <section aria-labelledby="finalized-observations-title">
        <div className="trade-trend-heading">
          <p>{messages.eyebrow}</p>
          <h3 id="finalized-observations-title">{messages.finalized}</h3>
        </div>
        <table aria-label={messages.finalized}>
          <thead>
            <tr>
              <th scope="col">{messages.year}</th>
              <th scope="col">{messages.observation}</th>
            </tr>
          </thead>
          <tbody>
            {result.finalizedObservations.map((observation) => (
              <tr key={observation.year}>
                <th scope="row">{observation.year}</th>
                <td>{observationText(observation, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="trade-trend-summary" aria-labelledby="trade-trend-summary-title">
        <p>{messages.eyebrow}</p>
        <h3 id="trade-trend-summary-title">{messages.summary}</h3>
        {result.summary.state === "UNAVAILABLE" ? (
          <>
            <strong>{messages.unavailableSummary}</strong>
            <p>
              {result.summary.reason === "NO_RECORDED_POSITIVE_OBSERVATIONS"
                ? messages.noRecorded
                : messages.oneRecorded}
            </p>
          </>
        ) : (
          <dl>
            <TrendFact
              label={messages.first}
              value={`${result.summary.firstRecordedPositive.year} · USD ${result.summary.firstRecordedPositive.valueCurrentUsd}`}
            />
            <TrendFact
              label={messages.last}
              value={`${result.summary.lastRecordedPositive.year} · USD ${result.summary.lastRecordedPositive.valueCurrentUsd}`}
            />
            <TrendFact
              label={messages.span}
              value={`${result.summary.spanYears} ${messages.years}`}
            />
            <TrendFact
              label={messages.absolute}
              value={`USD ${result.summary.absoluteChangeCurrentUsd}`}
            />
            <TrendFact
              label={messages.percent}
              value={`${result.summary.percentageChangePercent}%`}
            />
            <TrendFact
              label={messages.cagr}
              value={`${result.summary.cagrPercent}%`}
            />
          </dl>
        )}
      </section>
      <aside className="trade-trend-provisional" aria-labelledby="provisional-title">
        <p>{messages.eyebrow}</p>
        <h3 id="provisional-title">{messages.provisional}</h3>
        <p>{messages.provisionalRule}</p>
        {result.provisionalObservation === null ? (
          <strong>{messages.noProvisional}</strong>
        ) : (
          <p>{observationText(result.provisionalObservation, locale)}</p>
        )}
      </aside>
    </div>
  );
}

function TrendFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function observationText(
  observation: TradeTrendV1Payload["finalizedObservations"][number],
  locale: WorkspaceLocale,
): string {
  const messages = copy[locale];
  if (observation.state === "RECORDED_POSITIVE") {
    return `${messages.recorded} · USD ${observation.valueCurrentUsd}`;
  }
  return observation.state === "NO_RECORDED_POSITIVE_FLOW"
    ? messages.noFlow
    : messages.missing;
}

function trendErrorCode(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    !("code" in value.error) ||
    typeof value.error.code !== "string"
  ) {
    return null;
  }
  return value.error.code;
}

function trendErrorStatus(status: number, code: string | null): TradeTrendStatus {
  if (code === "ANALYSIS_RATE_LIMITED") {
    return "rateLimit";
  }
  if (code === "ANALYSIS_BUDGET_EXCEEDED") {
    return "budget";
  }
  if (code === "ANALYSIS_CAPACITY_EXCEEDED") {
    return "capacity";
  }
  if (status === 400 || status === 404) {
    return "malformed";
  }
  if (status === 410) {
    return "stale";
  }
  if (status === 429) {
    return "capacity";
  }
  if (status === 503) {
    return "unavailable";
  }
  return "fatal";
}

function isErrorStatus(
  status: TradeTrendStatus,
): status is
  | "malformed"
  | "stale"
  | "rateLimit"
  | "budget"
  | "capacity"
  | "unavailable"
  | "fatal" {
  return (
    status === "malformed" ||
    status === "stale" ||
    status === "rateLimit" ||
    status === "budget" ||
    status === "capacity" ||
    status === "unavailable" ||
    status === "fatal"
  );
}
