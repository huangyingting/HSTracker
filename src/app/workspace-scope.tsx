import type { SourceFreshnessState } from "../domain/release/source-freshness-states";
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
    baciRelease: "BACI Release",
    finalizedWindow: "Finalized window",
    provisionalYear: "Provisional Year",
    freshness: "Source Freshness Status",
    retainedFreshness: "Not reported for retained evidence",
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
    baciRelease: "BACI 发布版本",
    finalizedWindow: "定稿窗口",
    provisionalYear: "暂定年份",
    freshness: "来源新鲜度状态",
    retainedFreshness: "保留证据未报告此状态",
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
  baciRelease,
  finalizedWindow,
  provisionalYear,
  freshnessState,
  analysisIdentity,
  datasetPackageIdentity,
}: {
  locale: WorkspaceScopeLocale;
  exporter: Readonly<{ code: string; name: string }>;
  product: WorkspaceProductScope;
  market?: Readonly<{ code: string; name: string }> | null;
  deploymentState: "current" | "retained";
  baciRelease: string;
  finalizedWindow: Readonly<{ start: number; end: number }>;
  provisionalYear: number;
  freshnessState: SourceFreshnessState | null;
  analysisIdentity?: string;
  datasetPackageIdentity?: string;
}) {
  const messages = copy[locale];
  return (
    <section
      className="workspace-scope"
      aria-label={messages.title}
      data-deployment-state={deploymentState}
      data-freshness-state={freshnessState ?? undefined}
    >
      <h3>{messages.title}</h3>
      <dl>
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
          value={
            deploymentState === "current"
              ? messages.current
              : messages.retained
          }
        />
        <ScopeFact label={messages.baciRelease} value={baciRelease} />
        <ScopeFact
          label={messages.finalizedWindow}
          value={`${finalizedWindow.start}–${finalizedWindow.end}`}
        />
        <ScopeFact
          label={messages.provisionalYear}
          value={String(provisionalYear)}
        />
        <ScopeFact
          label={messages.freshness}
          value={
            freshnessState === null
              ? messages.retainedFreshness
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
    </section>
  );
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
