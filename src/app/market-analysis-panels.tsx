"use client";

// Capability-specific Market Analysis presentation Modules (spec:
// docs/spec/export-market-analysis-workspace.md §2.1, §7;
// docs/spec/export-market-analysis-workspace-ui-design.md §9-§10, §18;
// ADR 0005; issue #68). Each exported panel below owns one stable product
// area's own information shape -- trend + summary for Demand, share
// structure + HHI for Supplier Landscape, a ledger for Evidence Quality,
// closed categories for Validation Plan -- instead of a generic
// registry/card/question mapper. Every panel starts with a deterministic
// interpretation built only from already-typed `MarketAnalysisV1` fields,
// then exposes evidence, period/basis, limitation, provenance, and (where
// one exists) a context-preserving next action. No panel recomputes a
// Candidate Market Score, CAGR, supplier share, or HHI; every numeric
// value below is read directly from the constituent Analysis Outcomes the
// Market Analysis Module already assembled.

import {
  candidateDisplayName,
  caveatLabel,
  confidenceDeductionLabel,
  formatDecimalPercent,
  formatUsd,
  formatYears,
  formattedMarketGrowth,
  formattedRecordedFoothold,
  formattedSupplierDiversity,
  localizedConfidence,
  CandidateMarketEvidence,
  type CandidateMarketScoreAuditContext,
} from "./candidate-market-evidence";
import type {
  CandidateMarket,
} from "../domain/candidate-market/result";
import type { EffectiveSourceFreshness } from "../domain/release/source-freshness";
import {
  MARKET_ANALYSIS_COPY,
  type MarketAnalysisLocale,
} from "../domain/market-analysis/copy";
import type {
  MarketAnalysisV1,
  MarketAnalysisConstituentAnalysis,
} from "../domain/market-analysis/result";
import {
  marketAnalysisDemandObservationState,
  marketAnalysisDemandSummaryState,
  marketAnalysisSupplierConcentrationState,
} from "../domain/market-analysis/result";
import {
  MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES,
} from "../domain/market-analysis/validation-plan";

const copy = {
  en: {
    interpretationJoiner: "of",
    cohortSize: "cohort size",
    componentSize: "Market Size",
    componentGrowth: "Market Growth",
    componentFoothold: "Recorded Foothold",
    componentDiversity: "Supplier Diversity",
    scoreAuditToggle: "Score audit disclosure",
    demandInterpretationAvailable:
      "Recorded imports increased from {first} to {last}; the five-year summary CAGR is {cagr}.",
    demandInterpretationDeclined:
      "Recorded imports declined from {first} to {last}; the five-year summary CAGR is {cagr}.",
    demandInterpretationUnavailable:
      "The five-year demand summary is unavailable because fewer than two Finalized Years recorded positive imports.",
    demandMeanImports: "Mean recorded world imports over the score window",
    demandFinalized: "Five Finalized Years",
    demandYear: "Year",
    demandObservation: "Observation",
    demandSummaryTitle: "Trade Trend summary",
    demandSummaryUnavailable: "Summary unavailable",
    demandNoPositiveObservations:
      "No Finalized Year recorded a positive value.",
    demandOnlyOnePositiveObservation:
      "Only one Finalized Year recorded a positive value.",
    demandFirst: "First recorded-positive year",
    demandLast: "Last recorded-positive year",
    demandSpan: "Span",
    demandSpanYears: "years",
    demandAbsoluteChange: "Absolute change",
    demandPercentChange: "Percentage change",
    demandCagr: "CAGR",
    demandProvisionalTitle: "Provisional Year context",
    demandProvisionalRule:
      "Supporting evidence only; never extends the Finalized trend and is excluded from Candidate Market Score, rank, and Data Confidence.",
    demandProvisionalNone: "No Provisional Year observation is available.",
    demandNominalUsd: "Nominal current USD",
    demandTradeTrendLink: "Open Trade Trend for this market",
    recordedPositive: "Recorded positive value",
    noRecordedPositiveFlow: "No recorded positive flow",
    missingObservation: "Missing observation",
    exporterPositionScoreWindow: "Score-window recorded foothold",
    exporterPositionScoreWindowInterpretation:
      "Over the {window} Finalized Years, {exporter} recorded a {share} share of {market}'s imports.",
    exporterPositionScoreWindowNoFlow:
      "No positive bilateral flow from {exporter} was recorded in the {window} Finalized Years.",
    exporterPositionPooled: "Pooled supplying-economy position",
    exporterPositionPooledInterpretation:
      "The selected export economy supplied {share} of pooled recorded imports and is positioned {position} among recorded supplying economies.",
    exporterPositionPooledAbsent:
      "The selected export economy recorded no pooled value among {market}'s supplying economies in the Finalized Years.",
    exporterPositionProvisional: "Provisional Year bilateral evidence",
    exporterPositionProvisionalRule:
      "Supporting evidence only; excluded from Candidate Market Score, rank, and Data Confidence.",
    exporterPositionProvisionalNoFlow:
      "No positive bilateral flow was recorded in the Provisional Year.",
    exporterPositionProvisionalNotApplicable:
      "Provisional bilateral evidence is not applicable.",
    exporterPositionValue: "Recorded bilateral value",
    exporterPositionShare: "Recorded bilateral share",
    exporterPositionBasisNote:
      "These three bases use different periods and denominators; they are not additive or interchangeable.",
    supplierLandscapeInterpretationComputed:
      "{count} recorded supplying economies pooled USD {value} over the Finalized Years; concentration (HHI) is {hhi} on the 0-10,000 scale.",
    supplierLandscapeInterpretationUnavailable:
      "{count} recorded supplying economies pooled USD {value} over the Finalized Years; concentration is unavailable because no supplying economy recorded a positive pooled value.",
    supplierLandscapeInterpretationEmpty:
      "No supplying economy recorded a positive pooled value in the Finalized Years.",
    supplierLandscapeCohort: "Complete bounded supplying-economy cohort",
    supplierLandscapeCohortBudget: "Cohort budget",
    supplierLandscapeCohortSize: "Cohort size",
    supplierLandscapePooledValue: "Finalized pooled market value",
    supplierLandscapeHhi: "Concentration (HHI)",
    supplierLandscapeHhiScale: "on a 0-10,000 scale",
    supplierLandscapeHhiUnavailable:
      "Concentration is unavailable: no supplying economy recorded a positive pooled value.",
    supplierLandscapeEconomy: "Supplying economy",
    supplierLandscapePooled: "Pooled value",
    supplierLandscapeShare: "Share",
    supplierLandscapeRecordedYears: "Recorded years",
    supplierLandscapeNoFlowYears: "No recorded flow years",
    supplierLandscapeMissingYears: "Missing years",
    supplierLandscapeQuantityCoverage: "Quantity coverage",
    supplierLandscapeQuantityUnknown: "Unknown",
    supplierLandscapeSelectedExporter: "Selected export economy",
    supplierLandscapeSelectedExporterNote:
      "positioned {position} of {count} recorded supplying economies by pooled value",
    supplierLandscapeSelectedExporterAbsent:
      "not among the recorded supplying economies",
    supplierLandscapeWarnings: "Quality warnings",
    supplierLandscapeNoWarnings: "No quality warnings",
    warningSparse: "Some Finalized Years have no recorded supplier at all.",
    warningIncomplete:
      "At least one supplying economy is missing an observation in the Finalized window.",
    warningConcentrationUnavailable: "Concentration is unavailable for this cohort.",
    supplierLandscapeProvisional: "Provisional supplier snapshot",
    supplierLandscapeProvisionalRule:
      "Supporting evidence only; never extends the Finalized supplier structure.",
    supplierLandscapeProvisionalEmpty:
      "No Provisional Year supplier evidence is available.",
    supplierLandscapeProvisionalMissing:
      "The Provisional Year market observation is missing; supplier structure was not observed.",
    supplierLandscapeProvisionalNoFlow:
      "The Provisional Year recorded no positive market flow; there is no recorded supplier structure.",
    notApplicable: "Not applicable",
    supplierLandscapeSupplierCompetitionLink:
      "Open Supplier Competition for this market",
    evidenceQualityInterpretation:
      "Data Confidence is {label} ({score}) with {deductionCount} deduction(s).",
    evidenceQualityConfidence: "Data Confidence",
    evidenceQualityDeductions: "Deductions",
    evidenceQualityNoDeductions: "No deductions",
    evidenceQualityFinalizedYears: "Observed / missing Finalized Years",
    evidenceQualityQuantityCoverage: "Quantity coverage (outside score)",
    evidenceQualityCaveats: "Caveats",
    evidenceQualityNoCaveats: "No candidate-specific caveats",
    evidenceQualityStability: "Stability",
    evidenceQualityDiscontinuity: "Product-series discontinuity years",
    evidenceQualityNoDiscontinuity: "None flagged",
    evidenceQualityReleaseRevision: "Release Revision",
    evidenceQualitySourceUpdateDate: "Source date",
    evidenceQualityFreshness: "Source Freshness Status",
    evidenceQualityDeploymentMode: "Deployment Activation Mode",
    evidenceQualityDeploymentCurrent: "Current",
    evidenceQualityDeploymentFallback: "Last Verified Resident Fallback",
    evidenceQualityPeriod: "Period and basis",
    evidenceQualityProvenance: "Constituent Analysis Identities and Dataset Package identities",
    evidenceQualityRecipe: "Recipe",
    evidenceQualityAnalysisIdentity: "Analysis Identity",
    evidenceQualityDatasetPackageIdentity: "Dataset Package identity",
    provenanceLabel: "Evidence & provenance",
    provenanceAnalysisBuild: "Analysis build",
    provenanceBaciRelease: "Constituent source release (BACI)",
    provenancePeriod: "Period",
    provenanceUnit: "Value unit",
    provenanceComparisonBasis: "Comparison basis",
    provenanceCalculationOwner: "Calculation owner",
    provenanceWarnings: "Scoped warnings / coverage",
    provenanceNoWarnings: "No scoped warning",
    provenanceFinalized: "Finalized",
    provenanceProvisional: "Provisional",
    provenanceCandidateBasis: "Complete Candidate Market Score cohort",
    provenanceDemandBasis: "Five Finalized Year market/world-import trend",
    provenanceExporterBasis:
      "Score-window foothold, pooled supplier position, and Provisional bilateral evidence",
    provenanceSupplierBasis: "Complete bounded pooled supplier cohort",
    provenanceEvidenceQualityBasis:
      "Candidate Market Score evidence-quality ledger",
    candidateMarketOwner: "Candidate Market Module",
    tradeTrendOwner: "Trade Trend Module",
    supplierCompetitionOwner: "Supplier Competition Module",
    exploreFurtherInterpretation:
      "These advanced tools audit and export the exact evidence behind this Market Analysis; they are not alternative product conclusions.",
    exploreFurtherTradeTrend: "Trade Trend",
    exploreFurtherTradeTrendCopy: "Audit annual observations and export.",
    exploreFurtherSupplierCompetition: "Supplier Competition",
    exploreFurtherSupplierCompetitionCopy:
      "Audit the complete supplier structure and export.",
    exploreFurtherTradeExplorer: "Trade Explorer",
    exploreFurtherTradeExplorerCopy: "Inspect bounded product-mix evidence.",
    exploreFurtherTradeExplorerUnavailable:
      "Trade Explorer is unavailable for this evidence version.",
    validationPlanInterpretation:
      "Validation Plan turns commercial evidence this product does not establish into five actionable work categories; it never makes a request, shows an empty chart, or offers a Coming Soon control.",
    validationPlanEstablishes: "What current evidence establishes",
    validationPlanCannotEstablish: "What it cannot establish",
    validationPlanRequiredEvidence: "Required evidence",
    validationPlanDisposition: "Disposition",
    validationPlanCandidateExtension: "Candidate extension",
    validationPlanIntentionalExclusion: "Intentional product exclusion",
    validationPlanNextAction: "Next step",
  },
  "zh-Hans": {
    interpretationJoiner: "/",
    cohortSize: "队列规模",
    componentSize: "市场规模",
    componentGrowth: "市场增长",
    componentFoothold: "已记录市场基础",
    componentDiversity: "供应方多样性",
    scoreAuditToggle: "评分审核披露",
    demandInterpretationAvailable:
      "已记录进口从 {first} 增长到 {last}；五年期汇总 CAGR 为 {cagr}。",
    demandInterpretationDeclined:
      "已记录进口从 {first} 下降到 {last}；五年期汇总 CAGR 为 {cagr}。",
    demandInterpretationUnavailable:
      "五年期需求摘要不可用，因为记录到正向进口的定稿年份少于两个。",
    demandMeanImports: "评分窗口内的平均已记录世界进口",
    demandFinalized: "五个计分定稿年份",
    demandYear: "年份",
    demandObservation: "观测值",
    demandSummaryTitle: "贸易趋势摘要",
    demandSummaryUnavailable: "摘要不可用",
    demandNoPositiveObservations: "没有定稿年份记录到正向数值。",
    demandOnlyOnePositiveObservation: "只有一个定稿年份记录到正向数值。",
    demandFirst: "首个正向记录年份",
    demandLast: "末个正向记录年份",
    demandSpan: "跨度",
    demandSpanYears: "年",
    demandAbsoluteChange: "绝对变化",
    demandPercentChange: "百分比变化",
    demandCagr: "复合年增长率",
    demandProvisionalTitle: "暂定年份背景",
    demandProvisionalRule:
      "仅作辅助证据；绝不会延伸定稿趋势，且不计入候选市场评分、排名和数据置信度。",
    demandProvisionalNone: "没有可用的暂定年份观测值。",
    demandNominalUsd: "名义当期美元",
    demandTradeTrendLink: "为该市场打开贸易趋势",
    recordedPositive: "已记录的正向数值",
    noRecordedPositiveFlow: "未记录到正向流量",
    missingObservation: "观测缺失",
    exporterPositionScoreWindow: "评分窗口内的已记录市场基础",
    exporterPositionScoreWindowInterpretation:
      "在 {window} 计分定稿年份内，{exporter} 记录到占 {market} 进口 {share} 的份额。",
    exporterPositionScoreWindowNoFlow:
      "{window} 计分定稿年份内未记录到来自 {exporter} 的正向双边流量。",
    exporterPositionPooled: "汇总供应方位置",
    exporterPositionPooledInterpretation:
      "所选出口经济体贡献了汇总已记录进口的 {share}，在已记录供应经济体中位列 {position}。",
    exporterPositionPooledAbsent:
      "在计分定稿年份内，所选出口经济体未在 {market} 的供应经济体中记录到汇总值。",
    exporterPositionProvisional: "暂定年份双边证据",
    exporterPositionProvisionalRule:
      "仅作辅助证据；不计入候选市场评分、排名和数据置信度。",
    exporterPositionProvisionalNoFlow: "暂定年份内未记录到正向双边流量。",
    exporterPositionProvisionalNotApplicable: "暂定双边证据不适用。",
    exporterPositionValue: "已记录双边价值",
    exporterPositionShare: "已记录双边份额",
    exporterPositionBasisNote:
      "这三个口径使用不同的期间和分母；它们不可相加或互换。",
    supplierLandscapeInterpretationComputed:
      "{count} 个已记录供应经济体在定稿年份内汇总了 USD {value}；集中度（HHI）在 0-10,000 量表上为 {hhi}。",
    supplierLandscapeInterpretationUnavailable:
      "{count} 个已记录供应经济体在定稿年份内汇总了 USD {value}；由于没有供应经济体记录到正向汇总值，集中度不可用。",
    supplierLandscapeInterpretationEmpty:
      "定稿年份内没有供应经济体记录到正向汇总值。",
    supplierLandscapeCohort: "完整的有界供应经济体队列",
    supplierLandscapeCohortBudget: "队列预算",
    supplierLandscapeCohortSize: "队列规模",
    supplierLandscapePooledValue: "定稿汇总市场价值",
    supplierLandscapeHhi: "集中度（HHI）",
    supplierLandscapeHhiScale: "0-10,000 量表",
    supplierLandscapeHhiUnavailable:
      "集中度不可用：没有供应经济体记录到正向汇总值。",
    supplierLandscapeEconomy: "供应经济体",
    supplierLandscapePooled: "汇总值",
    supplierLandscapeShare: "份额",
    supplierLandscapeRecordedYears: "已记录年份",
    supplierLandscapeNoFlowYears: "无记录流量年份",
    supplierLandscapeMissingYears: "缺失年份",
    supplierLandscapeQuantityCoverage: "数量覆盖率",
    supplierLandscapeQuantityUnknown: "未知",
    supplierLandscapeSelectedExporter: "所选出口经济体",
    supplierLandscapeSelectedExporterNote:
      "按汇总值在 {count} 个已记录供应经济体中位列 {position}",
    supplierLandscapeSelectedExporterAbsent: "不在已记录供应经济体之中",
    supplierLandscapeWarnings: "质量警示",
    supplierLandscapeNoWarnings: "无质量警示",
    warningSparse: "部分定稿年份完全没有已记录的供应商。",
    warningIncomplete: "至少一个供应经济体在定稿窗口内缺失观测。",
    warningConcentrationUnavailable: "此群组的集中度不可用。",
    supplierLandscapeProvisional: "暂定供应商快照",
    supplierLandscapeProvisionalRule: "仅作辅助证据；绝不会延伸定稿供应结构。",
    supplierLandscapeProvisionalEmpty: "没有可用的暂定年份供应商证据。",
    supplierLandscapeProvisionalMissing:
      "暂定年份市场观测缺失；未观测到供应方结构。",
    supplierLandscapeProvisionalNoFlow:
      "暂定年份未记录到正向市场流量；没有已记录的供应方结构。",
    notApplicable: "不适用",
    supplierLandscapeSupplierCompetitionLink: "为该市场打开供应商竞争",
    evidenceQualityInterpretation:
      "数据置信度为 {label}（{score}），共有 {deductionCount} 项扣减。",
    evidenceQualityConfidence: "数据置信度",
    evidenceQualityDeductions: "扣减项",
    evidenceQualityNoDeductions: "无扣减",
    evidenceQualityFinalizedYears: "已观测/缺失的计分定稿年份",
    evidenceQualityQuantityCoverage: "数量覆盖率（不计入评分）",
    evidenceQualityCaveats: "警示",
    evidenceQualityNoCaveats: "无候选市场特定警示",
    evidenceQualityStability: "稳定性",
    evidenceQualityDiscontinuity: "产品系列不连续年份",
    evidenceQualityNoDiscontinuity: "未标记",
    evidenceQualityReleaseRevision: "发布版本修订",
    evidenceQualitySourceUpdateDate: "来源日期",
    evidenceQualityFreshness: "来源新鲜度状态",
    evidenceQualityDeploymentMode: "部署激活模式",
    evidenceQualityDeploymentCurrent: "当前",
    evidenceQualityDeploymentFallback: "最后验证的驻留回退",
    evidenceQualityPeriod: "期间与口径",
    evidenceQualityProvenance: "构成分析标识与数据集包标识",
    evidenceQualityRecipe: "分析方法",
    evidenceQualityAnalysisIdentity: "分析标识",
    evidenceQualityDatasetPackageIdentity: "数据集包标识",
    provenanceLabel: "证据与溯源",
    provenanceAnalysisBuild: "分析构建",
    provenanceBaciRelease: "构成证据来源版本（BACI）",
    provenancePeriod: "期间",
    provenanceUnit: "价值单位",
    provenanceComparisonBasis: "比较口径",
    provenanceCalculationOwner: "计算责任模块",
    provenanceWarnings: "范围内警示 / 覆盖原因",
    provenanceNoWarnings: "无范围内警示",
    provenanceFinalized: "定稿",
    provenanceProvisional: "暂定",
    provenanceCandidateBasis: "完整候选市场评分队列",
    provenanceDemandBasis: "五个定稿年份的市场/世界进口趋势",
    provenanceExporterBasis: "评分窗口基础、汇总供应方位置与暂定双边证据",
    provenanceSupplierBasis: "完整的有界汇总供应方队列",
    provenanceEvidenceQualityBasis: "候选市场评分证据质量台账",
    candidateMarketOwner: "候选市场模块",
    tradeTrendOwner: "贸易趋势模块",
    supplierCompetitionOwner: "供应方竞争模块",
    exploreFurtherInterpretation:
      "这些高级工具用于审核并导出此市场分析背后的确切证据；它们并非替代性的产品结论。",
    exploreFurtherTradeTrend: "贸易趋势",
    exploreFurtherTradeTrendCopy: "审核年度观测值并导出。",
    exploreFurtherSupplierCompetition: "供应商竞争",
    exploreFurtherSupplierCompetitionCopy: "审核完整的供应方结构并导出。",
    exploreFurtherTradeExplorer: "贸易探索器",
    exploreFurtherTradeExplorerCopy: "查看有界的产品结构证据。",
    exploreFurtherTradeExplorerUnavailable: "此证据版本无法打开贸易探索器。",
    validationPlanInterpretation:
      "商业验证计划将本产品无法确定的商业证据转化为五个可执行的工作类别；它绝不会发起请求、显示空图表，或提供\u201c即将推出\u201d控件。",
    validationPlanEstablishes: "现有证据已确定的内容",
    validationPlanCannotEstablish: "无法确定的内容",
    validationPlanRequiredEvidence: "所需证据",
    validationPlanDisposition: "处置方式",
    validationPlanCandidateExtension: "候选扩展",
    validationPlanIntentionalExclusion: "有意的产品排除",
    validationPlanNextAction: "下一步",
  },
} as const;

function messagesFor(locale: MarketAnalysisLocale) {
  return copy[locale];
}

// ---------------------------------------------------------------------
// Market Snapshot
// ---------------------------------------------------------------------

export function MarketSnapshotPanel({
  analysis,
  locale,
  isCompared,
  comparisonFull,
  onToggleComparison,
  tradeTrendHref,
  supplierCompetitionHref,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  isCompared: boolean;
  comparisonFull: boolean;
  onToggleComparison: (candidate: CandidateMarket) => void;
  tradeTrendHref: string;
  supplierCompetitionHref: string;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const { candidate, cohortSize } = analysis.opportunity;
  const displayName = candidateDisplayName(candidate, locale);
  const interpretation =
    locale === "zh-Hans"
      ? `${displayName} 在 ${analysis.context.exporter.name} 面向 HS12 ${analysis.context.product.code} 的 ${cohortSize} 个候选市场中排名第 ${candidate.rank} 位，数据置信度为 ${localizedConfidence(candidate.confidence.label, locale)}。`
      : `${displayName} ranks ${candidate.rank} of ${cohortSize} Candidate Markets for ${analysis.context.exporter.name} in HS12 ${analysis.context.product.code}, with ${localizedConfidence(candidate.confidence.label, locale)} Data Confidence.`;

  const scoreAuditContext: CandidateMarketScoreAuditContext = {
    cohortSize: analysis.opportunity.cohortSize,
    weights: analysis.opportunity.weights,
    productSeriesDiscontinuityYears:
      analysis.evidenceQuality.productSeriesDiscontinuityYears,
    releaseRevisionSummary: analysis.evidenceQuality.releaseRevisionSummary,
    stability: analysis.evidenceQuality.stability,
    provenance: { scoreWindow: analysis.annualContext.finalizedWindow },
    query: { exporter: { name: analysis.context.exporter.name } },
  };

  return (
    <section
      className="market-analysis-area"
      aria-labelledby="market-snapshot-heading"
      id="snapshot"
    >
      <h3 id="market-snapshot-heading">{areaCopy.productAreas.snapshot}</h3>
      <p className="market-area-interpretation">{interpretation}</p>
      <dl className="market-snapshot-components">
        <div>
          <dt>{messages.componentSize}</dt>
          <dd>
            {formatUsd(candidate.components.marketSize.meanCurrentUsd)}
          </dd>
        </div>
        <div>
          <dt>{messages.componentGrowth}</dt>
          <dd>{formattedMarketGrowth(candidate) ?? messages.notApplicable}</dd>
        </div>
        <div>
          <dt>{messages.componentFoothold}</dt>
          <dd>
            {formattedRecordedFoothold(candidate) ??
              messages.noRecordedPositiveFlow}
          </dd>
        </div>
        <div>
          <dt>{messages.componentDiversity}</dt>
          <dd>
            {formattedSupplierDiversity(candidate) ?? messages.notApplicable}
          </dd>
        </div>
      </dl>
      <p>
        {messages.cohortSize}: {cohortSize}
      </p>
      <p className="market-area-disclaimer">{analysis.discoveryDisclaimer}</p>
      <p className="market-area-limitation market-score-audit-label">
        {messages.scoreAuditToggle}
      </p>
      <CandidateMarketEvidence
        candidate={candidate}
        result={scoreAuditContext}
        locale={locale}
        isCompared={isCompared}
        comparisonFull={comparisonFull}
        onToggleComparison={onToggleComparison}
        tradeTrendHref={tradeTrendHref}
        supplierCompetitionHref={supplierCompetitionHref}
        headingLevel={4}
      />
      <AreaProvenance
        analysis={analysis}
        locale={locale}
        recipes={["candidate-market-v1"]}
        comparisonBasis={messages.provenanceCandidateBasis}
        warnings={candidate.caveatCodes}
      />
    </section>
  );
}

// ---------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------

export function DemandPanel({
  analysis,
  locale,
  tradeTrendHref,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  tradeTrendHref: string;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const { demand, opportunity, annualContext } = analysis;
  const { summary } = demand;

  const interpretation =
    summary.state === "UNAVAILABLE"
      ? messages.demandInterpretationUnavailable
      : formatTemplate(
          Number(summary.absoluteChangeCurrentUsd) >= 0
            ? messages.demandInterpretationAvailable
            : messages.demandInterpretationDeclined,
          {
            first: `${summary.firstRecordedPositive.year} (USD ${summary.firstRecordedPositive.valueCurrentUsd})`,
            last: `${summary.lastRecordedPositive.year} (USD ${summary.lastRecordedPositive.valueCurrentUsd})`,
            cagr: `${summary.cagrPercent}%`,
          },
        );

  return (
    <section
      className="market-analysis-area"
      aria-labelledby="demand-heading"
      id="demand"
    >
      <h3 id="demand-heading">{areaCopy.productAreas.demand}</h3>
      <p className="market-area-interpretation">{interpretation}</p>
      <p>
        {messages.demandMeanImports}:{" "}
        {formatUsd(opportunity.candidate.components.marketSize.meanCurrentUsd)}{" "}
        · {messages.demandNominalUsd}
      </p>

      <div className="market-demand-chart" aria-hidden="true">
        {demand.finalizedObservations.map((observation) => (
          <span
            key={observation.year}
            data-evidence-state={demandObservationEvidenceState(observation)}
            style={{
              height:
                observation.state === "RECORDED_POSITIVE"
                  ? `${barHeightPercent(
                      Number(observation.valueCurrentUsd),
                      demand.finalizedObservations,
                    )}%`
                  : "4%",
            }}
          />
        ))}
      </div>

      <table aria-label={messages.demandFinalized}>
        <caption>{messages.demandFinalized}</caption>
        <thead>
          <tr>
            <th scope="col">{messages.demandYear}</th>
            <th scope="col">{messages.demandObservation}</th>
          </tr>
        </thead>
        <tbody>
          {demand.finalizedObservations.map((observation) => (
            <tr key={observation.year}>
              <th scope="row">{observation.year}</th>
              <td data-evidence-state={demandObservationEvidenceState(observation)}>
                {observation.state === "RECORDED_POSITIVE"
                  ? `${messages.recordedPositive} · USD ${observation.valueCurrentUsd}`
                  : observation.state === "NO_RECORDED_POSITIVE_FLOW"
                    ? messages.noRecordedPositiveFlow
                    : messages.missingObservation}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section
        className="market-demand-summary"
        aria-labelledby="demand-summary-heading"
      >
        <h4 id="demand-summary-heading">{messages.demandSummaryTitle}</h4>
        <div data-evidence-state={marketAnalysisDemandSummaryState(summary)}>
        {summary.state === "UNAVAILABLE" ? (
          <p>
            <strong>{messages.demandSummaryUnavailable}</strong>{" "}
            {summary.reason === "NO_RECORDED_POSITIVE_OBSERVATIONS"
              ? messages.demandNoPositiveObservations
              : messages.demandOnlyOnePositiveObservation}
          </p>
        ) : (
          <dl>
            <div>
              <dt>{messages.demandFirst}</dt>
              <dd>
                {summary.firstRecordedPositive.year} · USD{" "}
                {summary.firstRecordedPositive.valueCurrentUsd}
              </dd>
            </div>
            <div>
              <dt>{messages.demandLast}</dt>
              <dd>
                {summary.lastRecordedPositive.year} · USD{" "}
                {summary.lastRecordedPositive.valueCurrentUsd}
              </dd>
            </div>
            <div>
              <dt>{messages.demandSpan}</dt>
              <dd>
                {summary.spanYears} {messages.demandSpanYears}
              </dd>
            </div>
            <div>
              <dt>{messages.demandAbsoluteChange}</dt>
              <dd>USD {summary.absoluteChangeCurrentUsd}</dd>
            </div>
            <div>
              <dt>{messages.demandPercentChange}</dt>
              <dd>{summary.percentageChangePercent}%</dd>
            </div>
            <div>
              <dt>{messages.demandCagr}</dt>
              <dd>{summary.cagrPercent}%</dd>
            </div>
          </dl>
        )}
        </div>
      </section>

      <aside
        className="market-demand-provisional"
        aria-labelledby="demand-provisional-heading"
      >
        <h4 id="demand-provisional-heading">
          {annualContext.provisionalYear} {messages.demandProvisionalTitle}
        </h4>
        <p>{messages.demandProvisionalRule}</p>
        {demand.provisionalObservation === null ? (
          <strong>{messages.demandProvisionalNone}</strong>
        ) : demand.provisionalObservation.state === "RECORDED_POSITIVE" ? (
          <p>
            {messages.recordedPositive} · USD{" "}
            {demand.provisionalObservation.valueCurrentUsd}
          </p>
        ) : (
          <p>
            {demand.provisionalObservation.state ===
            "NO_RECORDED_POSITIVE_FLOW"
              ? messages.noRecordedPositiveFlow
              : messages.missingObservation}
          </p>
        )}
      </aside>

      <AreaProvenance
        analysis={analysis}
        locale={locale}
        recipes={["trade-trend-v1"]}
        comparisonBasis={messages.provenanceDemandBasis}
        warnings={demand.finalizedObservations
          .filter(({ state }) => state !== "RECORDED_POSITIVE")
          .map(({ year, state }) => `${year}:${state}`)}
      />
      <nav aria-label={messages.demandTradeTrendLink}>
        <a href={tradeTrendHref}>{messages.demandTradeTrendLink}</a>
      </nav>
    </section>
  );
}

function demandObservationEvidenceState(observation: {
  state: "RECORDED_POSITIVE" | "NO_RECORDED_POSITIVE_FLOW" | "MISSING_OBSERVATION";
}): string {
  return marketAnalysisDemandObservationState(
    observation as Parameters<typeof marketAnalysisDemandObservationState>[0],
  );
}

function barHeightPercent(
  value: number,
  observations: readonly { state: string; valueCurrentUsd?: string }[],
): number {
  const positiveValues = observations
    .filter(
      (observation): observation is { state: string; valueCurrentUsd: string } =>
        observation.state === "RECORDED_POSITIVE",
    )
    .map((observation) => Number(observation.valueCurrentUsd));
  const max = Math.max(...positiveValues, value);
  if (max <= 0) {
    return 4;
  }
  return Math.max(4, Math.round((value / max) * 100));
}

// ---------------------------------------------------------------------
// Exporter Position
// ---------------------------------------------------------------------

export function ExporterPositionPanel({
  analysis,
  locale,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const { exporterPosition, context, annualContext } = analysis;
  const foothold = exporterPosition.scoreWindowFoothold;
  const yearRangeLabel = `${annualContext.finalizedWindow.start}–${annualContext.finalizedWindow.end}`;

  const scoreWindowInterpretation =
    foothold.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
      ? formatTemplate(messages.exporterPositionScoreWindowNoFlow, {
          exporter: context.exporter.name,
          window: yearRangeLabel,
        })
      : formatTemplate(messages.exporterPositionScoreWindowInterpretation, {
          exporter: context.exporter.name,
          market: context.market.name,
          window: yearRangeLabel,
          share: formatDecimalPercent(foothold.share),
        });

  const pooled = exporterPosition.pooledSupplier;
  const pooledPosition = exporterPosition.pooledSupplierPosition;

  const provisional = exporterPosition.provisionalBilateral;

  return (
    <section
      className="market-analysis-area"
      aria-labelledby="exporter-position-heading"
      id="exporter-position"
    >
      <h3 id="exporter-position-heading">
        {areaCopy.productAreas.exporterPosition}
      </h3>
      <p className="market-area-interpretation">{scoreWindowInterpretation}</p>

      <section aria-labelledby="exporter-position-score-window-heading">
        <h4 id="exporter-position-score-window-heading">
          {messages.exporterPositionScoreWindow}
        </h4>
        <p data-evidence-state={foothold.bilateralFlowState === "RECORDED" ? "recordedPositive" : "noRecordedPositiveFlow"}>
          {foothold.bilateralFlowState === "RECORDED"
            ? formatDecimalPercent(foothold.share)
            : messages.noRecordedPositiveFlow}{" "}
          · {yearRangeLabel}
        </p>
      </section>

      <section aria-labelledby="exporter-position-pooled-heading">
        <h4 id="exporter-position-pooled-heading">
          {messages.exporterPositionPooled}
        </h4>
        {pooled === null ? (
          <p>
            {formatTemplate(messages.exporterPositionPooledAbsent, {
              market: context.market.name,
            })}
          </p>
        ) : (
          <p>
            {formatTemplate(messages.exporterPositionPooledInterpretation, {
              share: `${pooled.sharePercent}%`,
              position:
                pooledPosition === null
                  ? messages.notApplicable
                  : `${pooledPosition.rank} ${messages.interpretationJoiner} ${pooledPosition.cohortSize}`,
            })}{" "}
            · USD {pooled.pooledValueCurrentUsd} · {yearRangeLabel}
          </p>
        )}
      </section>

      <section aria-labelledby="exporter-position-provisional-heading">
        <h4 id="exporter-position-provisional-heading">
          {annualContext.provisionalYear}{" "}
          {messages.exporterPositionProvisional}
        </h4>
        <p>{messages.exporterPositionProvisionalRule}</p>
        {provisional.bilateralState === "NOT_APPLICABLE" ? (
          <p>{messages.exporterPositionProvisionalNotApplicable}</p>
        ) : provisional.bilateralState === "NO_RECORDED_POSITIVE_FLOW" ? (
          <p>{messages.exporterPositionProvisionalNoFlow}</p>
        ) : (
          <dl>
            <div>
              <dt>{messages.exporterPositionValue}</dt>
              <dd>
                {provisional.bilateralCurrentUsd === null
                  ? messages.notApplicable
                  : `USD ${provisional.bilateralCurrentUsd}`}
              </dd>
            </div>
            <div>
              <dt>{messages.exporterPositionShare}</dt>
              <dd>
                {provisional.recordedBilateralShare === null
                  ? messages.notApplicable
                  : formatDecimalPercent(provisional.recordedBilateralShare)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <p className="market-area-limitation">
        {messages.exporterPositionBasisNote}
      </p>
      <AreaProvenance
        analysis={analysis}
        locale={locale}
        recipes={["candidate-market-v1", "supplier-competition-v1"]}
        comparisonBasis={messages.provenanceExporterBasis}
        warnings={[
          ...analysis.opportunity.candidate.caveatCodes,
          ...analysis.supplierLandscape.qualityWarnings,
        ]}
      />
    </section>
  );
}

// ---------------------------------------------------------------------
// Supplier Landscape
// ---------------------------------------------------------------------

export function SupplierLandscapePanel({
  analysis,
  locale,
  supplierCompetitionHref,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  supplierCompetitionHref: string;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const { supplierLandscape, context, annualContext } = analysis;
  const yearRangeLabel = `${annualContext.finalizedWindow.start}–${annualContext.finalizedWindow.end}`;
  const interpretation =
    supplierLandscape.supplierShares.length === 0
      ? messages.supplierLandscapeInterpretationEmpty
      : formatTemplate(
          supplierLandscape.concentration.state === "COMPUTED"
            ? messages.supplierLandscapeInterpretationComputed
            : messages.supplierLandscapeInterpretationUnavailable,
          {
            count: supplierLandscape.supplierShares.length,
            value: supplierLandscape.finalizedPooledValueCurrentUsd,
            hhi:
              supplierLandscape.concentration.state === "COMPUTED"
                ? supplierLandscape.concentration.herfindahlHirschmanIndex
                : "",
          },
        );

  const selectedPosition = analysis.exporterPosition.pooledSupplierPosition;

  return (
    <section
      className="market-analysis-area"
      aria-labelledby="supplier-landscape-heading"
      id="supplier-landscape"
    >
      <h3 id="supplier-landscape-heading">
        {areaCopy.productAreas.supplierLandscape}
      </h3>
      <p className="market-area-interpretation">{interpretation}</p>

      <div className="market-supplier-bars" aria-hidden="true">
        {supplierLandscape.supplierShares.map((share) => (
          <span
            key={share.economy.code}
            data-selected={share.economy.code === context.exporter.code}
            style={{ width: `${share.sharePercent}%` }}
          />
        ))}
      </div>

      <p>
        {messages.supplierLandscapeSelectedExporter}: {context.exporter.name}{" "}
        {selectedPosition === null
          ? messages.supplierLandscapeSelectedExporterAbsent
          : formatTemplate(messages.supplierLandscapeSelectedExporterNote, {
              position: selectedPosition.rank,
              count: selectedPosition.cohortSize,
            })}
      </p>

      <table aria-label={messages.supplierLandscapeCohort}>
        <caption>
          {messages.supplierLandscapeCohort} · {yearRangeLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col">{messages.supplierLandscapeEconomy}</th>
            <th scope="col">{messages.supplierLandscapePooled}</th>
            <th scope="col">{messages.supplierLandscapeShare}</th>
            <th scope="col">{messages.supplierLandscapeRecordedYears}</th>
            <th scope="col">{messages.supplierLandscapeNoFlowYears}</th>
            <th scope="col">{messages.supplierLandscapeMissingYears}</th>
            <th scope="col">{messages.supplierLandscapeQuantityCoverage}</th>
          </tr>
        </thead>
        <tbody>
          {supplierLandscape.supplierShares.map((share) => (
            <tr
              key={share.economy.code}
              data-selected={share.economy.code === context.exporter.code}
            >
              <th scope="row">
                {share.economy.name} · BACI {share.economy.code}
                {share.economy.code === context.exporter.code
                  ? ` (${messages.supplierLandscapeSelectedExporter})`
                  : ""}
              </th>
              <td>USD {share.pooledValueCurrentUsd}</td>
              <td>{share.sharePercent}%</td>
              <td>{yearListOrDash(share.recordedYears, locale)}</td>
              <td>{yearListOrDash(share.noRecordedFlowYears, locale)}</td>
              <td>{yearListOrDash(share.missingYears, locale)}</td>
              <td>
                {share.quantityCoverageRate === null
                  ? messages.supplierLandscapeQuantityUnknown
                  : formatDecimalPercent(share.quantityCoverageRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="market-supplier-summary">
        <div>
          <dt>{messages.supplierLandscapeCohortBudget}</dt>
          <dd>{supplierLandscape.cohortBudget}</dd>
        </div>
        <div>
          <dt>{messages.supplierLandscapeCohortSize}</dt>
          <dd>{supplierLandscape.cohortSize}</dd>
        </div>
        <div>
          <dt>{messages.supplierLandscapePooledValue}</dt>
          <dd>USD {supplierLandscape.finalizedPooledValueCurrentUsd}</dd>
        </div>
      </dl>

      <section
        aria-labelledby="supplier-landscape-hhi-heading"
        data-evidence-state={marketAnalysisSupplierConcentrationState(
          supplierLandscape.concentration,
        )}
      >
        <h4 id="supplier-landscape-hhi-heading">{messages.supplierLandscapeHhi}</h4>
        {supplierLandscape.concentration.state === "COMPUTED" ? (
          <p>
            <strong>
              {supplierLandscape.concentration.herfindahlHirschmanIndex}
            </strong>{" "}
            {messages.supplierLandscapeHhiScale}
          </p>
        ) : (
          <p>{messages.supplierLandscapeHhiUnavailable}</p>
        )}
      </section>

      {supplierLandscape.qualityWarnings.length > 0 ? (
        <section aria-labelledby="supplier-landscape-warnings-heading">
          <h4 id="supplier-landscape-warnings-heading">
            {messages.supplierLandscapeWarnings}
          </h4>
          <ul>
            {supplierLandscape.qualityWarnings.map((code) => (
              <li key={code}>{supplierWarningText(code, messages)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <aside aria-labelledby="supplier-landscape-provisional-heading">
        <h4 id="supplier-landscape-provisional-heading">
          {annualContext.provisionalYear} {messages.supplierLandscapeProvisional}
        </h4>
        <p>{messages.supplierLandscapeProvisionalRule}</p>
        {supplierLandscape.provisionalSupplierShares.length === 0 ? (
          <strong>
            {supplierLandscape.provisionalMarketState === "MISSING_OBSERVATION"
              ? messages.supplierLandscapeProvisionalMissing
              : supplierLandscape.provisionalMarketState ===
                  "NO_RECORDED_POSITIVE_FLOW"
                ? messages.supplierLandscapeProvisionalNoFlow
                : messages.supplierLandscapeProvisionalEmpty}
          </strong>
        ) : (
          <table aria-label={messages.supplierLandscapeProvisional}>
            <thead>
              <tr>
                <th scope="col">{messages.supplierLandscapeEconomy}</th>
                <th scope="col">{messages.demandObservation}</th>
              </tr>
            </thead>
            <tbody>
              {supplierLandscape.provisionalSupplierShares.map((share) => (
                <tr key={share.economy.code}>
                  <th scope="row">
                    {share.economy.name} · BACI {share.economy.code}
                  </th>
                  <td>
                    {share.bilateralState === "RECORDED_POSITIVE"
                      ? `${messages.recordedPositive} · USD ${share.valueCurrentUsd}`
                      : share.bilateralState === "NO_RECORDED_POSITIVE_FLOW"
                        ? messages.noRecordedPositiveFlow
                        : messages.notApplicable}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </aside>

      <AreaProvenance
        analysis={analysis}
        locale={locale}
        recipes={["supplier-competition-v1"]}
        comparisonBasis={messages.provenanceSupplierBasis}
        warnings={supplierLandscape.qualityWarnings}
      />
      <nav aria-label={messages.supplierLandscapeSupplierCompetitionLink}>
        <a href={supplierCompetitionHref}>
          {messages.supplierLandscapeSupplierCompetitionLink}
        </a>
      </nav>
    </section>
  );
}

function yearListOrDash(
  years: readonly number[],
  locale: MarketAnalysisLocale,
): string {
  return years.length === 0 ? "—" : formatYears(years, locale);
}

function supplierWarningText(
  code: string,
  messages: (typeof copy)[MarketAnalysisLocale],
): string {
  if (code === "SPARSE_FINALIZED_PERIODS") {
    return messages.warningSparse;
  }
  if (code === "INCOMPLETE_SUPPLIER_STRUCTURE") {
    return messages.warningIncomplete;
  }
  return messages.warningConcentrationUnavailable;
}

// ---------------------------------------------------------------------
// Evidence Quality
// ---------------------------------------------------------------------

export function EvidenceQualityPanel({
  analysis,
  locale,
  freshness,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  freshness: EffectiveSourceFreshness | null;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  const { evidenceQuality, annualContext } = analysis;
  const finalizedYearCount =
    annualContext.finalizedWindow.end - annualContext.finalizedWindow.start + 1;

  const interpretation = formatTemplate(messages.evidenceQualityInterpretation, {
    label: localizedConfidence(evidenceQuality.confidence.label, locale),
    score: evidenceQuality.confidence.score,
    deductionCount: evidenceQuality.confidence.deductions.length,
  });

  return (
    <section
      className="market-analysis-area"
      aria-labelledby="evidence-quality-heading"
      id="evidence-quality"
    >
      <h3 id="evidence-quality-heading">{areaCopy.productAreas.evidenceQuality}</h3>
      <p className="market-area-interpretation">{interpretation}</p>

      <dl className="market-evidence-ledger">
        <div>
          <dt>{messages.evidenceQualityConfidence}</dt>
          <dd>
            {localizedConfidence(evidenceQuality.confidence.label, locale)} ·{" "}
            {evidenceQuality.confidence.score}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityDeductions}</dt>
          <dd>
            {evidenceQuality.confidence.deductions.length === 0 ? (
              messages.evidenceQualityNoDeductions
            ) : (
              <ul>
                {evidenceQuality.confidence.deductions.map((deduction) => (
                  <li key={deduction.code}>
                    {confidenceDeductionLabel(
                      deduction.code,
                      analysis.opportunity.candidate,
                      locale,
                    )}{" "}
                    -{deduction.points}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityFinalizedYears}</dt>
          <dd>
            {evidenceQuality.observedFinalizedYears.length} {messages.interpretationJoiner}{" "}
            {finalizedYearCount} ·{" "}
            {yearListOrDash(evidenceQuality.missingFinalizedYears, locale)}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityQuantityCoverage}</dt>
          <dd>
            {evidenceQuality.quantityCoverageRate === null
              ? messages.notApplicable
              : formatDecimalPercent(evidenceQuality.quantityCoverageRate)}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityCaveats}</dt>
          <dd>
            {evidenceQuality.caveatCodes.length === 0 ? (
              messages.evidenceQualityNoCaveats
            ) : (
              <ul>
                {evidenceQuality.caveatCodes.map((code) => (
                  <li key={code}>{caveatLabel(code, locale)}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityStability}</dt>
          <dd>
            {evidenceQuality.stability.threeYear.window.start}–
            {evidenceQuality.stability.threeYear.window.end}:{" "}
            {evidenceQuality.stability.threeYear.state} ·{" "}
            {evidenceQuality.stability.tenYear.window.start}–
            {evidenceQuality.stability.tenYear.window.end}:{" "}
            {evidenceQuality.stability.tenYear.state}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityDiscontinuity}</dt>
          <dd>
            {evidenceQuality.productSeriesDiscontinuityYears.length === 0
              ? messages.evidenceQualityNoDiscontinuity
              : evidenceQuality.productSeriesDiscontinuityYears.join(", ")}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityReleaseRevision}</dt>
          <dd data-revision-state={evidenceQuality.releaseRevision.state}>
            {evidenceQuality.releaseRevision.state}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualitySourceUpdateDate}</dt>
          <dd>{evidenceQuality.sourceUpdateDate}</dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityFreshness}</dt>
          <dd>{freshness === null ? messages.notApplicable : freshness.state}</dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityDeploymentMode}</dt>
          <dd>
            {freshness === null
              ? messages.notApplicable
              : freshness.deploymentActivation.mode === "CURRENT"
                ? messages.evidenceQualityDeploymentCurrent
                : messages.evidenceQualityDeploymentFallback}
          </dd>
        </div>
        <div>
          <dt>{messages.evidenceQualityPeriod}</dt>
          <dd>
            {annualContext.baciRelease} ·{" "}
            {annualContext.finalizedWindow.start}–
            {annualContext.finalizedWindow.end} ·{" "}
            {annualContext.provisionalYear} · {annualContext.valueUnit}
          </dd>
        </div>
      </dl>

      <p className="market-area-limitation">
        {areaCopy.limitations.evidenceQualityCausalAttribution}
      </p>

      <section aria-labelledby="evidence-quality-provenance-heading">
        <h4 id="evidence-quality-provenance-heading">
          {messages.evidenceQualityProvenance}
        </h4>
        <table aria-label={messages.evidenceQualityProvenance}>
          <thead>
            <tr>
              <th scope="col">{messages.evidenceQualityRecipe}</th>
              <th scope="col">{messages.evidenceQualityAnalysisIdentity}</th>
              <th scope="col">{messages.evidenceQualityDatasetPackageIdentity}</th>
            </tr>
          </thead>
          <tbody>
            {analysis.constituentAnalyses.map((constituent) => (
              <tr key={constituent.recipe}>
                <th scope="row">{constituent.recipe}</th>
                <td className="market-analysis-identity">
                  {constituent.analysisIdentity}
                </td>
                <td className="market-analysis-identity">
                  {constituent.datasetPackageIdentity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <AreaProvenance
        analysis={analysis}
        locale={locale}
        recipes={["candidate-market-v1"]}
        comparisonBasis={messages.provenanceEvidenceQualityBasis}
        warnings={evidenceQuality.caveatCodes}
      />
    </section>
  );
}

// ---------------------------------------------------------------------
// Explore Further
// ---------------------------------------------------------------------

export function ExploreFurtherPanel({
  locale,
  tradeTrendHref,
  supplierCompetitionHref,
  tradeExplorerHref,
}: {
  locale: MarketAnalysisLocale;
  tradeTrendHref: string;
  supplierCompetitionHref: string;
  tradeExplorerHref: string | null;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  return (
    <section
      className="market-analysis-area"
      aria-labelledby="explore-further-heading"
      id="explore-further"
    >
      <h3 id="explore-further-heading">{areaCopy.productAreas.exploreFurther}</h3>
      <p className="market-area-interpretation">
        {messages.exploreFurtherInterpretation}
      </p>
      <ul className="market-explore-further-links">
        <li>
          <a href={tradeTrendHref}>{messages.exploreFurtherTradeTrend}</a>
          <p>{messages.exploreFurtherTradeTrendCopy}</p>
        </li>
        <li>
          <a href={supplierCompetitionHref}>
            {messages.exploreFurtherSupplierCompetition}
          </a>
          <p>{messages.exploreFurtherSupplierCompetitionCopy}</p>
          <p className="market-area-limitation">
            {areaCopy.limitations.exploreFurtherSupplierShareChange}
          </p>
        </li>
        <li>
          {tradeExplorerHref === null ? (
            <span aria-disabled="true">
              {messages.exploreFurtherTradeExplorerUnavailable}
            </span>
          ) : (
            <a href={tradeExplorerHref}>
              {messages.exploreFurtherTradeExplorer}
            </a>
          )}
          <p>{messages.exploreFurtherTradeExplorerCopy}</p>
          <p className="market-area-limitation">
            {areaCopy.limitations.exploreFurtherProductAdjacency}
          </p>
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------
// Validation Plan
// ---------------------------------------------------------------------

export function ValidationPlanPanel({
  locale,
}: {
  locale: MarketAnalysisLocale;
}) {
  const messages = messagesFor(locale);
  const areaCopy = MARKET_ANALYSIS_COPY[locale];
  return (
    <section
      className="market-analysis-area"
      aria-labelledby="validation-plan-heading"
      id="validation-plan"
    >
      <h3 id="validation-plan-heading">{areaCopy.productAreas.validationPlan}</h3>
      <p className="market-area-interpretation">
        {messages.validationPlanInterpretation}
      </p>
      <ol className="market-validation-plan-categories">
        {MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES.map((category) => {
          const categoryCopy = areaCopy.validationPlanCategories[category.id];
          return (
            <li key={category.id} aria-labelledby={`validation-plan-${category.id}`}>
              <h4 id={`validation-plan-${category.id}`}>{categoryCopy.label}</h4>
              <dl>
                <div>
                  <dt>{messages.validationPlanEstablishes}</dt>
                  <dd>{categoryCopy.establishes}</dd>
                </div>
                <div>
                  <dt>{messages.validationPlanCannotEstablish}</dt>
                  <dd>{categoryCopy.cannotEstablish}</dd>
                </div>
                <div>
                  <dt>{messages.validationPlanRequiredEvidence}</dt>
                  <dd>{categoryCopy.requiredEvidence}</dd>
                </div>
                <div>
                  <dt>{messages.validationPlanDisposition}</dt>
                  <dd data-disposition={category.disposition}>
                    {category.disposition === "CANDIDATE_EXTENSION"
                      ? messages.validationPlanCandidateExtension
                      : messages.validationPlanIntentionalExclusion}
                  </dd>
                </div>
                <div>
                  <dt>{messages.validationPlanNextAction}</dt>
                  <dd>{categoryCopy.nextAction}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

function findConstituent(
  constituents: readonly MarketAnalysisConstituentAnalysis[],
  recipe: MarketAnalysisConstituentAnalysis["recipe"],
): MarketAnalysisConstituentAnalysis | null {
  return constituents.find((item) => item.recipe === recipe) ?? null;
}

function AreaProvenance({
  analysis,
  locale,
  recipes,
  comparisonBasis,
  warnings,
}: {
  analysis: MarketAnalysisV1;
  locale: MarketAnalysisLocale;
  recipes: readonly MarketAnalysisConstituentAnalysis["recipe"][];
  comparisonBasis: string;
  warnings: readonly string[];
}) {
  const messages = messagesFor(locale);
  const { annualContext } = analysis;
  const constituents = recipes
    .map((recipe) => findConstituent(analysis.constituentAnalyses, recipe))
    .filter(
      (
        constituent,
      ): constituent is MarketAnalysisConstituentAnalysis =>
        constituent !== null,
    );
  const period = `${annualContext.finalizedWindow.start}–${annualContext.finalizedWindow.end}`;

  return (
    <details className="market-area-provenance">
      <summary>
        {messages.provenanceLabel} · {period} · {annualContext.valueUnit} ·{" "}
        {comparisonBasis} · {recipes.join(" + ")}
      </summary>
      <div className="market-area-provenance-body">
        <p>
          <strong>{messages.provenanceAnalysisBuild}:</strong>{" "}
          <span className="market-analysis-identity">
            {analysis.context.analysisBuildId}
          </span>
        </p>
        <p>
          <strong>{messages.provenanceBaciRelease}:</strong>{" "}
          {annualContext.baciRelease}
        </p>
        <p>
          <strong>{messages.provenancePeriod}:</strong>{" "}
          {messages.provenanceFinalized} {period} ·{" "}
          {messages.provenanceProvisional} {annualContext.provisionalYear}
        </p>
        <p>
          <strong>{messages.provenanceUnit}:</strong> {annualContext.valueUnit}
        </p>
        <p>
          <strong>{messages.provenanceComparisonBasis}:</strong>{" "}
          {comparisonBasis}
        </p>
        <p>
          <strong>{messages.provenanceWarnings}:</strong>{" "}
          {warnings.length === 0
            ? messages.provenanceNoWarnings
            : warnings.join(", ")}
        </p>
        {constituents.map((constituent) => (
          <div
            className="market-area-provenance-constituent"
            key={constituent.recipe}
          >
            <strong>{constituent.recipe}</strong>
            <p>
              <strong>{messages.provenanceCalculationOwner}:</strong>{" "}
              {calculationOwner(constituent.recipe, messages)}
            </p>
            <p>
              <strong>{messages.evidenceQualityAnalysisIdentity}:</strong>{" "}
              <span className="market-analysis-identity">
                {constituent.analysisIdentity}
              </span>
            </p>
            <p>
              <strong>
                {messages.evidenceQualityDatasetPackageIdentity}:
              </strong>{" "}
              <span className="market-analysis-identity">
                {constituent.datasetPackageIdentity}
              </span>
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function calculationOwner(
  recipe: MarketAnalysisConstituentAnalysis["recipe"],
  messages: ReturnType<typeof messagesFor>,
): string {
  switch (recipe) {
    case "candidate-market-v1":
      return messages.candidateMarketOwner;
    case "trade-trend-v1":
      return messages.tradeTrendOwner;
    case "supplier-competition-v1":
      return messages.supplierCompetitionOwner;
  }
}

function formatTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
