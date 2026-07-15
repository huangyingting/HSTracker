"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProductSearchProduct } from "../catalog/product-catalog";
import type { SupplierCompetitionV1Payload } from "../domain/trade-analytics/supplier-competition-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import type { EconomyRecord } from "../economy/economy-directory";
import { AnalysisShareLink } from "./analysis-share-link";
import { loadCurrentAnalysisManifest } from "./current-analysis-discovery";
import { EconomyCombobox } from "./economy-combobox";
import { ProductCombobox } from "./product-combobox";
import { SourceScope } from "./source-scope";
import { SupplierCompetitionExportAction } from "./supplier-competition-export-action";
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

const copy = {
  en: {
    eyebrow: "Supplier Competition",
    title: "Inspect the complete recorded supplying-economy structure.",
    lede:
      "Select one importing economy and HS 2012 product to inspect the latest five Finalized Years.",
    analyze: "Analyze Supplier Competition",
    loadingCurrent: "Loading the current analysis release…",
    currentUnavailable:
      "The current analysis release is temporarily unavailable.",
    retryCurrent: "Retry current release",
    loading: "Loading Supplier Competition…",
    malformed:
      "These Supplier Competition inputs are invalid. Check the importing economy and HS Product.",
    stale: "This analysis build has retired. Refresh the current analysis.",
    rateLimit:
      "Supplier Competition requests are temporarily limited. Wait a moment before retrying.",
    budget:
      "This Supplier Competition request exceeds the complete-result size limit.",
    capacity:
      "Analysis capacity is temporarily busy. Supplier Competition was not loaded.",
    unavailable:
      "The compatible Supplier Competition evidence is temporarily unavailable.",
    fatal: "Supplier Competition could not be completed.",
    refresh: "Refresh current analysis",
    retry: "Retry Supplier Competition",
    companyBoundaryTitle: "Economy-level evidence only",
    companyBoundary:
      "This is public, economy-level trade evidence. It does not identify companies, buyers, shipments, Party Roles, or Commercial Relationship Assertions.",
    structure: "Complete supplier-economy structure",
    years: "Latest five Finalized Years",
    economy: "Supplying economy",
    pooled: "Pooled value (finalized years)",
    share: "Share",
    recordedYears: "Recorded years",
    noFlowYears: "No recorded flow years",
    missingYears: "Missing years",
    quantityCoverage: "Quantity coverage",
    quantityUnknown: "Unknown",
    none: "None",
    empty: "No supplying economy recorded a positive value in this window.",
    concentration: "Concentration (HHI)",
    concentrationScale: "on a 0–10,000 scale",
    concentrationUnavailable: "Concentration unavailable",
    concentrationUnavailableReason:
      "No supplying economy recorded a positive value, so concentration cannot be computed.",
    warnings: "Quality warnings",
    warningSparse: "Some finalized years have no recorded supplier at all.",
    warningIncomplete:
      "At least one supplying economy is missing observations within the finalized window.",
    warningConcentrationUnavailable:
      "Concentration is unavailable for this cohort.",
    provisional: "Provisional Year snapshot",
    provisionalRule:
      "Separate supporting evidence. It never changes the finalized shares or HHI above.",
    provisionalEmpty: "No Provisional Year supplier evidence is available.",
    provisionalState: "Provisional bilateral state",
    provisionalValue: "Provisional value",
    recordedPositive: "Recorded positive value",
    noRecordedFlow: "No recorded positive flow",
    notApplicable: "Not applicable",
    disclaimer:
      "Use this economy-level trade evidence as a discovery aid, not as a forecast or recommendation.",
  },
  "zh-Hans": {
    eyebrow: "供应商竞争",
    title: "查看完整的已记录供应经济体结构。",
    lede: "选择一个进口经济体和 HS 2012 产品，查看最近五个定稿年份。",
    analyze: "分析供应商竞争",
    loadingCurrent: "正在加载当前分析发布版本…",
    currentUnavailable: "当前分析发布版本暂时不可用。",
    retryCurrent: "重试当前发布版本",
    loading: "正在加载供应商竞争…",
    malformed: "该供应商竞争情境无效。请检查进口经济体和 HS 产品。",
    stale: "该分析构建已停用。请刷新当前分析。",
    rateLimit: "供应商竞争请求暂时受限。请稍候再试。",
    budget: "该供应商竞争请求超出完整结果大小限制。",
    capacity: "分析容量暂时繁忙。尚未加载供应商竞争。",
    unavailable: "兼容的供应商竞争证据暂时不可用。",
    fatal: "无法完成供应商竞争分析。",
    refresh: "刷新当前分析",
    retry: "重试供应商竞争",
    companyBoundaryTitle: "仅为经济体级别证据",
    companyBoundary:
      "这是公开的经济体级别贸易证据，并不识别公司、买方、货运、当事方角色或商业关系断言。",
    structure: "完整的供应经济体结构",
    years: "最近五个定稿年份",
    economy: "供应经济体",
    pooled: "汇总值（定稿年份）",
    share: "份额",
    recordedYears: "已记录年份",
    noFlowYears: "无记录流量年份",
    missingYears: "缺失年份",
    quantityCoverage: "数量覆盖率",
    quantityUnknown: "未知",
    none: "无",
    empty: "在此窗口内没有供应经济体记录正值。",
    concentration: "集中度（HHI）",
    concentrationScale: "0–10,000 量表",
    concentrationUnavailable: "集中度不可用",
    concentrationUnavailableReason:
      "没有供应经济体记录正值，因此无法计算集中度。",
    warnings: "质量提示",
    warningSparse: "部分定稿年份完全没有已记录的供应商。",
    warningIncomplete: "至少一个供应经济体在定稿窗口内缺失观测。",
    warningConcentrationUnavailable: "此群组的集中度不可用。",
    provisional: "暂定年份快照",
    provisionalRule: "单独的辅助证据，绝不会改变上方的定稿份额或 HHI。",
    provisionalEmpty: "没有可用的暂定年份供应商证据。",
    provisionalState: "暂定双边状态",
    provisionalValue: "暂定值",
    recordedPositive: "已记录的正值",
    noRecordedFlow: "没有已记录的正向流量",
    notApplicable: "不适用",
    disclaimer: "将此经济体级别贸易证据作为发现辅助，而非预测或建议。",
  },
} as const;

type WorkspaceLocale = keyof typeof copy;
type SupplierCompetitionStatus =
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

export function SupplierCompetitionWorkspace({
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
  const [result, setResult] = useState<SupplierCompetitionV1Payload | null>(
    null,
  );
  const [status, setStatus] = useState<SupplierCompetitionStatus>("idle");
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
    };
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

  const clearResult = useCallback(() => {
    analysisController.current?.abort();
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
    const pinResolution = resolvePinnedContext(
      urlPin,
      manifest,
      "supplier-competition",
    );
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
        `/api/v1/analyses/${analysisBuildId}/supplier-competitions?${parameters}`,
        { signal: controller.signal },
      );
      if (requestSequence.current !== sequence) {
        return;
      }
      if (!response.ok) {
        setStatus(
          supplierCompetitionErrorStatus(
            response.status,
            supplierCompetitionErrorCode(await response.json()),
          ),
        );
        return;
      }
      const payload =
        (await response.json()) as SupplierCompetitionV1Payload;
      // A retained execution validates against that exact retained
      // build's own BACI Release/artifact identity (from
      // manifest.deploymentWindow) rather than current's, with the same
      // rigor as the "current" check below (see issue #44 "Pinned URLs
      // within the retention window reproduce exact Analysis Identity").
      if (pinResolution.state === "retained") {
        const retainedIdentity = pinResolution.deployment;
        if (
          payload.analysisBuildId !== analysisBuildId ||
          payload.provenance.baciRelease !== retainedIdentity.baciRelease ||
          payload.provenance.artifactSha256 !==
            retainedIdentity.artifactSha256
        ) {
          throw new TypeError(
            "The Supplier Competition result does not match the discovered retained manifest.",
          );
        }
      } else if (
        payload.analysisBuildId !== analysisBuildId ||
        payload.provenance.baciRelease !== manifest.source.baciRelease ||
        payload.provenance.artifactSha256 !== manifest.source.artifact.sha256
      ) {
        throw new TypeError(
          "The Supplier Competition result does not match the discovered current manifest.",
        );
      }
      setResult(payload);
      setStatus("success");
      const baseContext = withLocale(
        withProductCode(
          withEconomyCode(
            withRecipe(
              parseTradeAnalysisContext(window.location.href),
              "supplier-competition",
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
      const url = serializeTradeAnalysisContext(window.location.href, context);
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (!controller.signal.aborted && requestSequence.current === sequence) {
        console.error("Supplier Competition workspace request failed", error);
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
      context.recipe === "supplier-competition" &&
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
      aria-labelledby="supplier-competition-workspace-title"
    >
      <div className="workspace-intro">
        <p>{messages.eyebrow}</p>
        <h2 id="supplier-competition-workspace-title">{messages.title}</h2>
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
          <SupplierCompetitionExportAction
            result={result}
            locale={locale}
            onManifestRevalidated={setManifest}
          />
          <AnalysisShareLink locale={locale} task="supplier-competition" />
          <p className="supplier-competition-company-boundary" role="note">
            <strong>{messages.companyBoundaryTitle}</strong>{" "}
            {messages.companyBoundary}
          </p>
          <SupplierCompetitionEvidence result={result} locale={locale} />
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

function SupplierCompetitionEvidence({
  result,
  locale,
}: {
  result: SupplierCompetitionV1Payload;
  locale: WorkspaceLocale;
}) {
  const messages = copy[locale];
  return (
    <div className="supplier-competition-evidence">
      <section aria-labelledby="supplier-structure-title">
        <div className="supplier-competition-heading">
          <p>{messages.eyebrow}</p>
          <h3 id="supplier-structure-title">{messages.structure}</h3>
          <span>
            {messages.years} {result.provenance.finalizedWindow.start}–
            {result.provenance.finalizedWindow.end}
          </span>
        </div>
        {result.supplierShares.length === 0 ? (
          <strong>{messages.empty}</strong>
        ) : (
          <table aria-label={messages.structure}>
            <thead>
              <tr>
                <th scope="col">{messages.economy}</th>
                <th scope="col">{messages.pooled}</th>
                <th scope="col">{messages.share}</th>
                <th scope="col">{messages.recordedYears}</th>
                <th scope="col">{messages.noFlowYears}</th>
                <th scope="col">{messages.missingYears}</th>
                <th scope="col">{messages.quantityCoverage}</th>
              </tr>
            </thead>
            <tbody>
              {result.supplierShares.map((share) => (
                <tr key={share.economy.code}>
                  <th scope="row">
                    {share.economy.name} · BACI {share.economy.code}
                  </th>
                  <td>USD {share.pooledValueCurrentUsd}</td>
                  <td>{share.sharePercent}%</td>
                  <td>{yearListText(share.recordedYears, messages.none)}</td>
                  <td>{yearListText(share.noRecordedFlowYears, messages.none)}</td>
                  <td>{yearListText(share.missingYears, messages.none)}</td>
                  <td>
                    {share.quantityCoverageRate === null
                      ? messages.quantityUnknown
                      : share.quantityCoverageRate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        className="supplier-competition-concentration"
        aria-labelledby="concentration-title"
      >
        <p>{messages.eyebrow}</p>
        <h3 id="concentration-title">{messages.concentration}</h3>
        {result.concentration.state === "COMPUTED" ? (
          <p>
            <strong>{result.concentration.herfindahlHirschmanIndex}</strong>{" "}
            {messages.concentrationScale}
          </p>
        ) : (
          <>
            <strong>{messages.concentrationUnavailable}</strong>
            <p>{messages.concentrationUnavailableReason}</p>
          </>
        )}
      </section>

      {result.qualityWarnings.length > 0 ? (
        <section
          className="supplier-competition-warnings"
          aria-labelledby="quality-warnings-title"
        >
          <p>{messages.eyebrow}</p>
          <h3 id="quality-warnings-title">{messages.warnings}</h3>
          <ul>
            {result.qualityWarnings.map((code) => (
              <li key={code}>{qualityWarningText(code, locale)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <aside
        className="supplier-competition-provisional"
        aria-labelledby="supplier-provisional-title"
      >
        <p>{messages.eyebrow}</p>
        <h3 id="supplier-provisional-title">{messages.provisional}</h3>
        <p>{messages.provisionalRule}</p>
        {result.provisionalSupplierShares.length === 0 ? (
          <strong>{messages.provisionalEmpty}</strong>
        ) : (
          <table aria-label={messages.provisional}>
            <thead>
              <tr>
                <th scope="col">{messages.economy}</th>
                <th scope="col">{messages.provisionalState}</th>
                <th scope="col">{messages.provisionalValue}</th>
              </tr>
            </thead>
            <tbody>
              {result.provisionalSupplierShares.map((share) => (
                <tr key={share.economy.code}>
                  <th scope="row">
                    {share.economy.name} · BACI {share.economy.code}
                  </th>
                  <td>{provisionalStateText(share.bilateralState, locale)}</td>
                  <td>
                    {share.valueCurrentUsd === null
                      ? "—"
                      : `USD ${share.valueCurrentUsd}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </aside>
    </div>
  );
}

function yearListText(years: readonly number[], none: string): string {
  return years.length === 0 ? none : years.join(", ");
}

function qualityWarningText(
  code: SupplierCompetitionV1Payload["qualityWarnings"][number],
  locale: WorkspaceLocale,
): string {
  const messages = copy[locale];
  if (code === "SPARSE_FINALIZED_PERIODS") {
    return messages.warningSparse;
  }
  if (code === "INCOMPLETE_SUPPLIER_STRUCTURE") {
    return messages.warningIncomplete;
  }
  return messages.warningConcentrationUnavailable;
}

function provisionalStateText(
  state: SupplierCompetitionV1Payload["provisionalSupplierShares"][number]["bilateralState"],
  locale: WorkspaceLocale,
): string {
  const messages = copy[locale];
  if (state === "RECORDED_POSITIVE") {
    return messages.recordedPositive;
  }
  if (state === "NO_RECORDED_POSITIVE_FLOW") {
    return messages.noRecordedFlow;
  }
  return messages.notApplicable;
}

function supplierCompetitionErrorCode(value: unknown): string | null {
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

function supplierCompetitionErrorStatus(
  status: number,
  code: string | null,
): SupplierCompetitionStatus {
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
  status: SupplierCompetitionStatus,
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
