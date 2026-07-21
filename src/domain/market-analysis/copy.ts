import type { MarketAnalysisProductArea } from "./product-areas";
import type { ValidationPlanCategoryId } from "./validation-plan";

// The bilingual (English / Simplified Chinese) product-area, evidence-state,
// limitation, recovery-action, and Validation Plan copy the product and its
// presentation Modules share (spec: docs/spec/export-market-analysis-workspace.md
// §2.4 and docs/spec/export-market-analysis-workspace-ui-design.md §10, §11,
// §17). Values are fixed display strings only -- never analytical values --
// so locale switching can never change an evidence state, an identity, or a
// number. Canonical bilingual terms reuse the exact wording
// docs/spec/export-market-analysis-workspace-ui-design.md §17.1 defines.

export type MarketAnalysisLocale = "en" | "zh-Hans";

// The seven evidence-state meanings docs/spec/export-market-analysis-workspace-ui-design.md
// §11.1 enumerates. These stay distinct on purpose: they must never collapse
// into a generic ANSWERED/NOT_PROVIDED state machine (spec §5.6).
export const MARKET_ANALYSIS_EVIDENCE_STATE_KEYS = Object.freeze([
  "recordedPositive",
  "noRecordedPositiveFlow",
  "missingObservation",
  "summaryUnavailable",
  "boundedCapability",
  "outsidePublicEvidence",
  "requestFailure",
] as const);

export type MarketAnalysisEvidenceStateKey =
  (typeof MARKET_ANALYSIS_EVIDENCE_STATE_KEYS)[number];

// One limitation copy key per BOUNDED analyst-needs capability limitation
// documented in docs/spec/export-market-analysis-workspace.md §3.2 (Scope,
// Recent Momentum, Evidence Quality, and the two distinct Explore Further
// limitations). Named by product meaning, never by a traceability
// identifier, so no requirement label ever leaks into product copy.
export const MARKET_ANALYSIS_LIMITATION_KEYS = Object.freeze([
  "scopeHsClassification",
  "recentMomentumCoverage",
  "evidenceQualityCausalAttribution",
  "exploreFurtherSupplierShareChange",
  "exploreFurtherProductAdjacency",
] as const);

export type MarketAnalysisLimitationKey =
  (typeof MARKET_ANALYSIS_LIMITATION_KEYS)[number];

// The recovery actions docs/spec/export-market-analysis-workspace-ui-design.md
// §11.3 and §11.4 name.
export const MARKET_ANALYSIS_RECOVERY_ACTION_KEYS = Object.freeze([
  "changeScope",
  "backToOpportunities",
  "refreshWithCurrentEvidence",
  "narrowScope",
  "retry",
  "retryLater",
  "back",
  "retryMonthlyEvidence",
] as const);

export type MarketAnalysisRecoveryActionKey =
  (typeof MARKET_ANALYSIS_RECOVERY_ACTION_KEYS)[number];

export type MarketAnalysisCopy = Readonly<{
  productAreas: Readonly<Record<MarketAnalysisProductArea, string>>;
  evidenceStates: Readonly<Record<MarketAnalysisEvidenceStateKey, string>>;
  limitations: Readonly<Record<MarketAnalysisLimitationKey, string>>;
  recoveryActions: Readonly<Record<MarketAnalysisRecoveryActionKey, string>>;
  validationPlanCategories: Readonly<Record<ValidationPlanCategoryId, string>>;
  nextActions: Readonly<Record<ValidationPlanCategoryId, string>>;
}>;

export const MARKET_ANALYSIS_COPY: Readonly<
  Record<MarketAnalysisLocale, MarketAnalysisCopy>
> = Object.freeze({
  en: {
    productAreas: {
      snapshot: "Market Snapshot",
      demand: "Demand",
      exporterPosition: "Exporter Position",
      supplierLandscape: "Supplier Landscape",
      evidenceQuality: "Evidence Quality",
      recentMomentum: "Recent Momentum",
      exploreFurther: "Explore Further",
      validationPlan: "Validation Plan",
    },
    evidenceStates: {
      recordedPositive: "Recorded positive evidence",
      noRecordedPositiveFlow: "No recorded positive flow",
      missingObservation: "Missing observation",
      summaryUnavailable: "Summary unavailable",
      boundedCapability: "Bounded capability",
      outsidePublicEvidence: "Outside current public evidence",
      requestFailure: "Request failure",
    },
    limitations: {
      scopeHsClassification:
        "Deterministic HS12 search and explicit confirmation are supported; SKU classification and HS17/HS22 conversion are not.",
      recentMomentumCoverage:
        "EU-27 reporting markets and exact reviewed product mappings only; signal is market import momentum, not exporter-specific demand.",
      evidenceQualityCausalAttribution:
        "Present deductions and flags; do not claim causal attribution or separate price, exchange-rate, and volume effects.",
      exploreFurtherSupplierShareChange:
        "Current product has no year-by-supplier share-change result. Repeated single-year queries are evidence gathering, not a product answer.",
      exploreFurtherProductAdjacency:
        "Current evidence is a fixed exporter-importer-year bilateral product mix; no HS hierarchy, whole-market growth view, or adjacency method exists.",
    },
    recoveryActions: {
      changeScope: "Change scope",
      backToOpportunities: "Back to opportunities",
      refreshWithCurrentEvidence: "Refresh with current evidence",
      narrowScope: "Narrow scope",
      retry: "Retry",
      retryLater: "Retry later",
      back: "Back",
      retryMonthlyEvidence: "Retry monthly evidence",
    },
    validationPlanCategories: {
      QUANTITY_AND_CUSTOMS_UNIT_VALUE: "Quantity and customs unit value",
      MARKET_ACCESS_AND_REGULATION: "Market access and regulation",
      LOGISTICS_AND_LANDED_COST: "Logistics and landed cost",
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS:
        "Companies and commercial relationships",
      COMPANY_ECONOMICS_RISK_AND_FORECASTING:
        "Company economics, risk, and forecasting",
    },
    nextActions: {
      QUANTITY_AND_CUSTOMS_UNIT_VALUE:
        "Commission your own product-specific quantity and unit-value research before comparing customs unit values across suppliers.",
      MARKET_ACCESS_AND_REGULATION:
        "Consult reviewed tariff, preference, and regulatory sources for this market and HS code before assuming access.",
      LOGISTICS_AND_LANDED_COST:
        "Obtain freight, insurance, tax, and Incoterm quotes from logistics partners before estimating landed cost.",
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS:
        "Engage a licensed company-data or trade-intelligence provider to identify potential buyers and commercial relationships.",
      COMPANY_ECONOMICS_RISK_AND_FORECASTING:
        "Conduct your own company-specific feasibility, risk, and forecasting analysis with qualified advisors; this product does not provide one.",
    },
  },
  "zh-Hans": {
    productAreas: {
      snapshot: "市场概览",
      demand: "市场需求证据",
      exporterPosition: "出口方位置",
      supplierLandscape: "供应方格局",
      evidenceQuality: "证据质量",
      recentMomentum: "近期动量",
      exploreFurther: "深入探索",
      validationPlan: "商业验证计划",
    },
    evidenceStates: {
      recordedPositive: "已记录的正向证据",
      noRecordedPositiveFlow: "未记录到正向流量",
      missingObservation: "观测缺失",
      summaryUnavailable: "摘要不可用",
      boundedCapability: "受限能力",
      outsidePublicEvidence: "超出当前公开证据范围",
      requestFailure: "请求失败",
    },
    limitations: {
      scopeHsClassification:
        "支持确定性的 HS12 检索与显式确认；不支持 SKU 分类或 HS17/HS22 转换。",
      recentMomentumCoverage:
        "仅覆盖欧盟27国申报市场和经审查的精确产品映射；该信号反映市场进口动量，并非特定出口方的需求。",
      evidenceQualityCausalAttribution:
        "呈现置信度扣分与标记；不声称因果归因，也不拆分价格、汇率与数量效应。",
      exploreFurtherSupplierShareChange:
        "当前产品没有按年度的供应方份额变化结果。重复单年度查询属于证据收集，并非产品化答案。",
      exploreFurtherProductAdjacency:
        "当前证据是固定的出口方-进口方-年度双边产品结构；不存在 HS 层级、整体市场增长视图或邻近产品判定方法。",
    },
    recoveryActions: {
      changeScope: "更改范围",
      backToOpportunities: "返回市场机会",
      refreshWithCurrentEvidence: "使用当前证据刷新",
      narrowScope: "缩小范围",
      retry: "重试",
      retryLater: "稍后重试",
      back: "返回",
      retryMonthlyEvidence: "重试月度证据",
    },
    validationPlanCategories: {
      QUANTITY_AND_CUSTOMS_UNIT_VALUE: "数量与海关单位价值",
      MARKET_ACCESS_AND_REGULATION: "市场准入与监管",
      LOGISTICS_AND_LANDED_COST: "物流与到岸成本",
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS: "公司与商业关系",
      COMPANY_ECONOMICS_RISK_AND_FORECASTING: "公司经济性、风险与预测",
    },
    nextActions: {
      QUANTITY_AND_CUSTOMS_UNIT_VALUE:
        "在比较不同供应方的海关单位价值之前，请委托开展针对具体产品的数量与单位价值调研。",
      MARKET_ACCESS_AND_REGULATION:
        "在假定可进入该市场之前，请查阅经审查的关税、优惠和监管来源。",
      LOGISTICS_AND_LANDED_COST:
        "在估算到岸成本之前，请向物流合作方获取运费、保险、税费和贸易术语报价。",
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS:
        "请委托持牌的公司数据或贸易情报供应商，识别潜在买家和商业关系。",
      COMPANY_ECONOMICS_RISK_AND_FORECASTING:
        "请与具备资质的顾问一起开展公司层面的可行性、风险与预测分析；本产品不提供此类分析。",
    },
  },
});
