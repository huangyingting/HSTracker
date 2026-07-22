"use client";

import { useState } from "react";

import type { PublicDeploymentActivation } from "../domain/release/deployment-activation";
import type { SourceFreshnessState } from "../domain/release/source-freshness-states";
import { AnalysisLinkCopyButton } from "./analysis-share-link";
import { localizedSourceFreshness } from "./source-freshness-presentation";

const copy = {
  en: {
    title: "Workspace scope",
    exporter: "Export economy",
    product: "Product scope",
    market: "Candidate Market",
    allProducts: "All published HS Products",
    portfolio: "Confirmed portfolio",
    deployment: "Deployment state",
    current: "Current",
    retained: "Retained",
    retired: "Retired",
    activation: "Deployment activation mode",
    currentActivation: "Current",
    fallbackActivation: "Last Verified Resident Fallback",
    baciRelease: "BACI Release",
    finalizedWindow: "Finalized window",
    provisionalYear: "Provisional Year",
    freshness: "Source Freshness Status",
    retainedFreshness: "Not reported for retained evidence",
    retiredEvidence: "Unavailable for retired context",
    viewScope: "View scope",
    hideScope: "Hide scope",
    changeScope: "Change scope",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    sourceDetails: "Source details",
    analysisIdentity: "Analysis Identity",
    datasetPackage: "Dataset Package",
  },
  "zh-Hans": {
    title: "工作区范围",
    exporter: "出口经济体",
    product: "产品范围",
    market: "候选市场",
    allProducts: "全部已发布 HS 产品",
    portfolio: "已确认产品组合",
    deployment: "部署状态",
    current: "当前",
    retained: "保留",
    retired: "已停用",
    activation: "部署激活模式",
    currentActivation: "当前",
    fallbackActivation: "上次验证的驻留回退",
    baciRelease: "BACI 发布版本",
    finalizedWindow: "定稿窗口",
    provisionalYear: "暂定年份",
    freshness: "来源新鲜度状态",
    retainedFreshness: "保留证据未报告此状态",
    retiredEvidence: "已停用情境不可用",
    viewScope: "查看范围",
    hideScope: "收起范围",
    changeScope: "更改范围",
    copyLink: "复制链接",
    linkCopied: "已复制链接",
    sourceDetails: "来源详情",
    analysisIdentity: "分析身份",
    datasetPackage: "数据集包",
  },
} as const;

type WorkspaceScopeLocale = keyof typeof copy;

export type WorkspaceProductScope =
  | Readonly<{ mode: "all" }>
  | Readonly<{
      mode: "exact";
      revision: string;
      code: string;
      descriptionEn: string;
      descriptionZhHans: string;
    }>
  | Readonly<{ mode: "portfolio"; codes: readonly string[] }>;

export function WorkspaceScope({
  locale,
  exporter,
  product,
  market,
  deploymentState,
  deploymentActivation,
  baciRelease,
  finalizedWindow,
  provisionalYear,
  freshnessState,
  analysisIdentity,
  datasetPackageIdentity,
  canCopyLink = false,
  onChangeScope,
  onSourceDetails,
}: {
  locale: WorkspaceScopeLocale;
  exporter: Readonly<{ code: string; name: string }>;
  product: WorkspaceProductScope;
  market?: Readonly<{ code: string; name: string }> | null;
  deploymentState: "current" | "retained" | "retired";
  deploymentActivation: PublicDeploymentActivation;
  baciRelease: string | null;
  finalizedWindow: Readonly<{ start: number; end: number }> | null;
  provisionalYear: number | null;
  freshnessState: SourceFreshnessState | null;
  analysisIdentity?: string;
  datasetPackageIdentity?: string;
  canCopyLink?: boolean;
  onChangeScope: () => void;
  onSourceDetails?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const messages = copy[locale];
  const deploymentLabel =
    deploymentState === "current"
      ? messages.current
      : deploymentState === "retained"
        ? messages.retained
        : messages.retired;
  const activationLabel =
    deploymentActivation.mode === "CURRENT"
      ? messages.currentActivation
      : [
          messages.fallbackActivation,
          deploymentActivation.fallbackReason,
        ]
        .filter((value) => value !== null)
          .join(" · ");
  const unavailable = messages.retiredEvidence;
  return (
    <section
      className="workspace-scope"
      aria-label={messages.title}
      data-deployment-state={deploymentState}
      data-freshness-state={freshnessState ?? undefined}
      data-details-open={detailsOpen || undefined}
    >
      <h3>{messages.title}</h3>
      <div className="workspace-scope-summary">
        <p>
          <strong>{exporter.code}</strong>
          <span>{productScopeSummary(product, messages)}</span>
          <span data-warning={deploymentState === "retired" || undefined}>
            {deploymentLabel}
          </span>
        </p>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((current) => !current)}
        >
          {detailsOpen ? messages.hideScope : messages.viewScope}
        </button>
      </div>
      <dl data-expanded={detailsOpen}>
        <ScopeFact
          label={messages.exporter}
          value={`${exporter.code} · ${exporter.name}`}
        />
        <div className="workspace-scope-product">
          <dt>{messages.product}</dt>
          <dd>{productScopeValue(product, messages)}</dd>
        </div>
        {market == null ? null : (
          <ScopeFact
            label={messages.market}
            value={`${market.code} · ${market.name}`}
          />
        )}
        <ScopeFact
          label={messages.deployment}
          value={deploymentLabel}
        />
        <ScopeFact label={messages.activation} value={activationLabel} />
        <ScopeFact
          label={messages.baciRelease}
          value={baciRelease ?? unavailable}
        />
        <ScopeFact
          label={messages.finalizedWindow}
          value={
            finalizedWindow === null
              ? unavailable
              : `${finalizedWindow.start}–${finalizedWindow.end}`
          }
        />
        <ScopeFact
          label={messages.provisionalYear}
          value={
            provisionalYear === null ? unavailable : String(provisionalYear)
          }
        />
        <ScopeFact
          label={messages.freshness}
          value={
            freshnessState === null
              ? deploymentState === "retired"
                ? unavailable
                : messages.retainedFreshness
              : localizedSourceFreshness(freshnessState, locale)
          }
        />
        {analysisIdentity === undefined ? null : (
          <ScopeFact
            label={messages.analysisIdentity}
            value={analysisIdentity}
          />
        )}
        {datasetPackageIdentity === undefined ? null : (
          <ScopeFact
            label={messages.datasetPackage}
            value={datasetPackageIdentity}
          />
        )}
      </dl>
      <div className="workspace-scope-actions">
        <button type="button" onClick={onChangeScope}>
          {messages.changeScope}
        </button>
        {canCopyLink ? (
          <AnalysisLinkCopyButton
            idleLabel={messages.copyLink}
            doneLabel={messages.linkCopied}
          />
        ) : null}
        {onSourceDetails === undefined ? null : (
          <button type="button" onClick={onSourceDetails}>
            {messages.sourceDetails}
          </button>
        )}
      </div>
    </section>
  );
}

function productScopeSummary(
  product: WorkspaceProductScope,
  messages: (typeof copy)[WorkspaceScopeLocale],
): string {
  if (product.mode === "all") {
    return messages.allProducts;
  }
  if (product.mode === "portfolio") {
    return `${messages.portfolio} · ${product.codes.join(", ")}`;
  }
  return `${product.revision} · ${product.code}`;
}

function productScopeValue(
  product: WorkspaceProductScope,
  messages: (typeof copy)[WorkspaceScopeLocale],
) {
  if (product.mode === "all") {
    return messages.allProducts;
  }
  if (product.mode === "portfolio") {
    return `${messages.portfolio} · ${product.codes.join(", ")}`;
  }
  return (
    <>
      <strong>
        {product.revision} · {product.code}
      </strong>
      <span>{product.descriptionEn}</span>
      <span lang="zh-Hans">{product.descriptionZhHans}</span>
    </>
  );
}

function ScopeFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
