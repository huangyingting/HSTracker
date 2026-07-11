"use client";

import { useState } from "react";

import type { CandidateMarketResult } from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";

const copy = {
  en: {
    scope: "Current source scope",
    baciReleaseLabel: "BACI Release",
    sourceDateLabel: "Source date",
    candidateScoreWindow: "Candidate Market Score window",
    supportingEvidence: "Supporting evidence",
    valueBasis: "Value basis",
    nominalCurrentUsd: "Nominal current USD",
    finalizedYears: "Finalized Years",
    updated: "source updated",
    scoreWindow: "Score window",
    provisionalContext: "provisional context",
    detailsButton: "Source details",
    details: "Source details",
    latestKnown: "Latest known BACI release",
    updateInProgress: "New BACI release is being validated",
    refreshDelayed: "Data refresh delayed - showing the last validated release",
    checkOverdue:
      "Source freshness check overdue - showing the last validated release",
    serving: "Currently serving",
    detected: "Detected",
    due: "Refresh due",
    lastCheck: "Latest successful source check",
    source: "Source",
    sourceUpdated: "updated",
    license: "Etalab Open Licence 2.0.",
    documentation: "CEPII BACI documentation",
    ingestedYears: "Ingested years",
    finalizedCutoff: "Finalized cutoff",
    threeYear: "3-year window",
    fiveYear: "5-year score window",
    tenYear: "10-year window",
    provisionalYear: "Provisional Year",
    provisionalRule: "supporting evidence only - excluded from score and rank",
    analysisBuild: "Analysis build",
    productBuild: "Product-search build",
    artifact: "Artifact",
    artifactBuilt: "built",
    catalog: "Release catalog",
    scoreVersion: "Score version",
    freshnessState: "Freshness state",
    revisionComparison: "Release Revision comparison",
    noLongerEligible: "No longer eligible in this release",
    noPrevious: "No compatible prior release comparison",
    noCompatible: "No compatible prior release comparison",
    missingWindow:
      "Prior release comparison unavailable for the exact score window",
    releaseRule: "BACI Releases are never mixed in one Candidate Market Score.",
  },
  "zh-Hans": {
    scope: "当前来源范围",
    baciReleaseLabel: "BACI 发布版本",
    sourceDateLabel: "来源日期",
    candidateScoreWindow: "候选市场评分窗口",
    supportingEvidence: "辅助证据",
    valueBasis: "价值口径",
    nominalCurrentUsd: "名义当期美元",
    finalizedYears: "计分定稿年份",
    updated: "来源更新于",
    scoreWindow: "评分窗口",
    provisionalContext: "暂定年份背景",
    detailsButton: "来源详情",
    details: "来源详情",
    latestKnown: "当前已知最新 BACI 数据版",
    updateInProgress: "正在验证新的 BACI 数据版",
    refreshDelayed: "数据刷新延迟 - 当前显示最近验证通过的数据版",
    checkOverdue: "来源新鲜度检查已逾期 - 当前显示最近验证通过的数据版",
    serving: "当前提供",
    detected: "检测时间",
    due: "刷新期限",
    lastCheck: "最近一次成功来源检查",
    source: "来源",
    sourceUpdated: "更新于",
    license: "Etalab 开放许可 2.0。",
    documentation: "CEPII BACI 文档",
    ingestedYears: "已摄取年份",
    finalizedCutoff: "定稿截止年份",
    threeYear: "3 年窗口",
    fiveYear: "5 年评分窗口",
    tenYear: "10 年窗口",
    provisionalYear: "暂定年份",
    provisionalRule: "仅作辅助证据 - 不计入评分和排名",
    analysisBuild: "分析构建",
    productBuild: "产品搜索构建",
    artifact: "工件",
    artifactBuilt: "构建于",
    catalog: "发布目录",
    scoreVersion: "评分版本",
    freshnessState: "新鲜度状态",
    revisionComparison: "发布版本修订比较",
    noLongerEligible: "在此发布版本中不再符合条件",
    noPrevious: "没有兼容的先前发布版本比较",
    noCompatible: "没有兼容的先前发布版本比较",
    missingWindow: "先前发布版本比较无法覆盖完全相同的评分窗口",
    releaseRule: "一项候选市场评分绝不会混用不同的 BACI 数据版。",
  },
} as const;

type SourceScopeLocale = keyof typeof copy;

export function SourceScope({
  manifest,
  result,
  locale,
}: {
  manifest: CurrentAnalysisManifest;
  result: CandidateMarketResult | null;
  locale: SourceScopeLocale;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const messages = copy[locale];
  const { source, freshness } = manifest;
  const warning =
    freshness.state === "LATEST_KNOWN" ? null : (
      <p className="source-scope-warning" role="alert">
        <strong>{freshnessLabel(manifest, locale)}</strong>
        {freshness.state === "UPDATE_IN_PROGRESS" ? (
          <span>
            {messages.detected} {freshness.newerReleaseDetectedAt} ·{" "}
            {messages.due} {freshness.refreshDueAt}
          </span>
        ) : (
          <span>
            {messages.serving} {freshness.servedBaciRelease} ·{" "}
            {messages.lastCheck} {freshness.checkedAt}
          </span>
        )}
      </p>
    );

  return (
    <section
      className="source-scope"
      aria-label={messages.scope}
      data-freshness-state={freshness.state}
    >
      <div className="source-scope-summary">
        <div>
          <strong>
            BACI HS 2012 - {source.baciRelease} - {messages.updated}{" "}
            {formatSourceDate(source.sourceUpdateDate, locale)}
          </strong>
          <span>
            {messages.scoreWindow} {formatWindow(source.windows.score, "-")} -{" "}
            {messages.provisionalContext} {source.provisionalYear}
          </span>
        </div>
        <p className="source-freshness">
          <span aria-hidden="true" />
          {freshnessLabel(manifest, locale)}
        </p>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((current) => !current)}
        >
          {messages.detailsButton}
        </button>
      </div>
      {result === null ? null : (
        <dl className="source-scope-facts">
          <div>
            <dt>{messages.baciReleaseLabel}</dt>
          </div>
          <SourceDetail
            label={messages.sourceDateLabel}
            value={result.provenance.sourceUpdateDate}
          />
          <SourceDetail
            label={messages.candidateScoreWindow}
            value={`${messages.finalizedYears} ${formatWindow(result.provenance.scoreWindow)}`}
          />
          <SourceDetail
            label={messages.supportingEvidence}
            value={`${messages.provisionalYear} ${result.provenance.provisionalYear}`}
          />
          <SourceDetail
            label={messages.valueBasis}
            value={messages.nominalCurrentUsd}
          />
        </dl>
      )}
      {warning}
      {detailsOpen ? (
        <section className="source-details" aria-label={messages.details}>
          <p>
            {messages.source}: CEPII BACI, HS 2012, {source.baciRelease} (
            {messages.sourceUpdated} {source.sourceUpdateDate}),{" "}
            {messages.license}
          </p>
          <a href="https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html">
            {messages.documentation}
          </a>
          <dl>
            <SourceDetail
              label={messages.ingestedYears}
              value={formatWindow(source.ingestedYears)}
            />
            <SourceDetail
              label={messages.finalizedCutoff}
              value={String(source.finalizedCutoffYear)}
            />
            <SourceDetail
              label={messages.threeYear}
              value={formatWindow(source.windows.threeYear)}
            />
            <SourceDetail
              label={messages.fiveYear}
              value={formatWindow(source.windows.score)}
            />
            <SourceDetail
              label={messages.tenYear}
              value={formatWindow(source.windows.tenYear)}
            />
            <SourceDetail
              label={`${messages.provisionalYear} ${source.provisionalYear}`}
              value={`· ${messages.provisionalRule}`}
            />
            <SourceDetail
              label={messages.analysisBuild}
              value={manifest.analysisBuildId}
            />
            <SourceDetail
              label={messages.productBuild}
              value={manifest.productSearchBuildId}
            />
            <SourceDetail
              label={messages.artifact}
              value={`${source.artifact.sha256} · ${messages.artifactBuilt} ${source.artifact.builtAt}`}
            />
            <SourceDetail
              label={messages.catalog}
              value={manifest.analysisReleaseCatalogSha256}
            />
            <SourceDetail
              label={messages.scoreVersion}
              value={source.scoreVersion}
            />
            <SourceDetail
              label={messages.freshnessState}
              value={freshness.state}
            />
            <SourceDetail
              label={messages.lastCheck}
              value={freshness.checkedAt}
            />
            <SourceDetail
              label={
                result?.releaseRevisionSummary.comparisonRelease === null ||
                result === null
                  ? releaseComparisonLabel(manifest, locale)
                  : messages.revisionComparison
              }
              value={
                result?.releaseRevisionSummary.comparisonRelease === null ||
                result === null
                  ? (manifest.revisionComparison.previousBaciRelease ??
                    manifest.revisionComparison.notComparedReason ??
                    "")
                  : `${result.releaseRevisionSummary.comparisonRelease} · ${result.releaseRevisionSummary.previousArtifactSha256}`
              }
            />
            {result?.releaseRevisionSummary.noLongerEligibleCount === null ||
            result === null ? null : (
              <SourceDetail
                label={messages.noLongerEligible}
                value={String(
                  result.releaseRevisionSummary.noLongerEligibleCount,
                )}
              />
            )}
          </dl>
          <p className="source-release-rule">{messages.releaseRule}</p>
        </section>
      ) : null}
    </section>
  );
}

function SourceDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label} </dt>
      <dd>{value}</dd>
    </div>
  );
}

function freshnessLabel(
  manifest: CurrentAnalysisManifest,
  locale: SourceScopeLocale,
): string {
  const messages = copy[locale];
  return {
    LATEST_KNOWN: messages.latestKnown,
    UPDATE_IN_PROGRESS: messages.updateInProgress,
    REFRESH_DELAYED: messages.refreshDelayed,
    CHECK_OVERDUE: messages.checkOverdue,
  }[manifest.freshness.state];
}

function releaseComparisonLabel(
  manifest: CurrentAnalysisManifest,
  locale: SourceScopeLocale,
): string {
  const messages = copy[locale];
  const reason = manifest.revisionComparison.notComparedReason;
  if (reason === "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW") {
    return messages.missingWindow;
  }
  if (reason === "NO_COMPATIBLE_PREVIOUS_ARTIFACT") {
    return messages.noCompatible;
  }
  if (reason === "NO_PREVIOUS_ARTIFACT") {
    return messages.noPrevious;
  }
  return manifest.revisionComparison.previousBaciRelease ?? messages.noPrevious;
}

function formatWindow(
  window: { start: number; end: number },
  separator = "–",
): string {
  return `${window.start}${separator}${window.end}`;
}

function formatSourceDate(date: string, locale: SourceScopeLocale): string {
  const [year, month, day] = date.split("-").map(Number);
  if (locale === "zh-Hans") {
    return `${year}年${month}月${day}日`;
  }
  const monthName = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][month - 1];
  return `${day} ${monthName} ${year}`;
}
