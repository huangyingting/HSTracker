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

export type MarketAnalysisValidationPlanCopy = Readonly<{
  label: string;
  establishes: string;
  cannotEstablish: string;
  requiredEvidence: string;
  nextAction: string;
}>;

export type MarketAnalysisCopy = Readonly<{
  productAreas: Readonly<Record<MarketAnalysisProductArea, string>>;
  evidenceStates: Readonly<Record<MarketAnalysisEvidenceStateKey, string>>;
  limitations: Readonly<Record<MarketAnalysisLimitationKey, string>>;
  recoveryActions: Readonly<Record<MarketAnalysisRecoveryActionKey, string>>;
  validationPlanCategories: Readonly<
    Record<ValidationPlanCategoryId, MarketAnalysisValidationPlanCopy>
  >;
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
      QUANTITY_AND_CUSTOMS_UNIT_VALUE: {
        label: "Quantity and customs unit value",
        establishes:
          "Market Analysis shows recorded nominal trade values, finalized-period demand, supplier structure, and whether quantity evidence is present.",
        cannotEstablish:
          "It cannot establish comparable physical quantities or customs unit values when units are missing, mixed, or not reviewed for this product.",
        requiredEvidence:
          "Reviewed product-specific customs quantities, declared units, and customs values aligned by reporter, partner, and period.",
        nextAction:
          "Commission your own product-specific quantity and unit-value research before comparing customs unit values across suppliers.",
      },
      MARKET_ACCESS_AND_REGULATION: {
        label: "Market access and regulation",
        establishes:
          "Market Analysis shows recorded trade evidence and missing or no-flow states for the exact market and HS12 Product, including the selected export economy's public position.",
        cannotEstablish:
          "It cannot establish tariff rates, preference eligibility, taxes, standards, licensing requirements, or regulatory permission to sell.",
        requiredEvidence:
          "Current reviewed tariff, preference, customs, standards, licensing, and regulatory evidence for the exact exporter-market-product context.",
        nextAction:
          "Consult reviewed tariff, preference, and regulatory sources for this market and HS code before assuming access.",
      },
      LOGISTICS_AND_LANDED_COST: {
        label: "Logistics and landed cost",
        establishes:
          "Market Analysis shows recorded trade values and the economy-level supplier geography serving the selected market.",
        cannotEstablish:
          "It cannot establish shipment routes, transit time, freight, insurance, handling, tax, Incoterm, or final landed cost.",
        requiredEvidence:
          "Current route-specific freight, insurance, handling, duty, tax, Incoterm, and transit evidence for the intended shipment.",
        nextAction:
          "Obtain freight, insurance, tax, and Incoterm quotes from logistics partners before estimating landed cost.",
      },
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS: {
        label: "Companies and commercial relationships",
        establishes:
          "Market Analysis shows economy-level supplier structure and the selected export economy's recorded public-trade position.",
        cannotEstablish:
          "It cannot identify buyers, Source Party Mentions, Legal Entities, brands, decision-makers, or ongoing commercial relationships.",
        requiredEvidence:
          "Source-attributed and access-controlled Company Trade Context with party roles, entity resolution, relationship evidence, and time scope.",
        nextAction:
          "Engage a licensed company-data or trade-intelligence provider to identify potential buyers and commercial relationships.",
      },
      COMPANY_ECONOMICS_RISK_AND_FORECASTING: {
        label: "Company economics, risk, and forecasting",
        establishes:
          "Market Analysis shows historical public-trade indicators, evidence limitations, uncertainty, and reproducible source provenance.",
        cannotEstablish:
          "It cannot predict sales, profit, company fit, future demand, or investment success, and it is not a recommendation.",
        requiredEvidence:
          "Company-specific capacity, cost, price, channel, financing, risk, and scenario assumptions assessed with qualified commercial advice.",
        nextAction:
          "Conduct your own company-specific feasibility, risk, and forecasting analysis with qualified advisors; this product does not provide one.",
      },
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
      QUANTITY_AND_CUSTOMS_UNIT_VALUE: {
        label: "数量与海关单位价值",
        establishes:
          "市场分析展示已记录的名义贸易额、最终年度需求、供应方结构，以及数量证据是否存在。",
        cannotEstablish:
          "当该产品的计量单位缺失、混用或未经审查时，无法确定可比的实物数量或海关单位价值。",
        requiredEvidence:
          "需要按申报方、伙伴方和期间对齐，并经审查的产品级海关数量、申报计量单位和海关价值证据。",
        nextAction:
          "在比较不同供应方的海关单位价值之前，请委托开展针对具体产品的数量与单位价值调研。",
      },
      MARKET_ACCESS_AND_REGULATION: {
        label: "市场准入与监管",
        establishes:
          "市场分析展示精确市场和 HS12 产品的已记录贸易证据、缺失或无流量状态，以及所选出口经济体的公开位置。",
        cannotEstablish:
          "无法确定关税税率、优惠资格、税费、标准、许可要求或产品销售的监管许可。",
        requiredEvidence:
          "需要针对精确出口方、市场和产品情境的最新且经审查的关税、优惠、海关、标准、许可和监管证据。",
        nextAction:
          "在假定可进入该市场之前，请查阅经审查的关税、优惠和监管来源。",
      },
      LOGISTICS_AND_LANDED_COST: {
        label: "物流与到岸成本",
        establishes:
          "市场分析展示已记录的贸易额，以及服务所选市场的经济体层级供应方地理分布。",
        cannotEstablish:
          "无法确定运输路线、运输时间、运费、保险、操作费、税费、贸易术语或最终到岸成本。",
        requiredEvidence:
          "需要针对预定运输的最新路线级运费、保险、操作费、关税、税费、贸易术语和运输时间证据。",
        nextAction:
          "在估算到岸成本之前，请向物流合作方获取运费、保险、税费和贸易术语报价。",
      },
      COMPANIES_AND_COMMERCIAL_RELATIONSHIPS: {
        label: "公司与商业关系",
        establishes:
          "市场分析展示经济体层级的供应方结构，以及所选出口经济体在公开贸易记录中的位置。",
        cannotEstablish:
          "无法识别买家、来源方提及、法律实体、品牌、决策者或持续的商业关系。",
        requiredEvidence:
          "需要具有来源归属和访问控制的公司贸易情境，包括方角色、实体解析、关系证据和时间范围。",
        nextAction:
          "请委托持牌的公司数据或贸易情报供应商，识别潜在买家和商业关系。",
      },
      COMPANY_ECONOMICS_RISK_AND_FORECASTING: {
        label: "公司经济性、风险与预测",
        establishes:
          "市场分析展示历史公开贸易指标、证据局限、不确定性和可复现的来源溯源。",
        cannotEstablish:
          "无法预测销售、利润、公司适配性、未来需求或投资成功，也不构成建议。",
        requiredEvidence:
          "需要在合格商业顾问协助下评估公司特定的产能、成本、价格、渠道、融资、风险和情景假设。",
        nextAction:
          "请与具备资质的顾问一起开展公司层面的可行性、风险与预测分析；本产品不提供此类分析。",
      },
    },
  },
});
