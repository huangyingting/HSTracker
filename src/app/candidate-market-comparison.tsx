import type {
  CandidateMarket,
  CandidateMarketResult,
} from "../domain/candidate-market/result";
import {
  candidateDisplayName,
  formatDecimalPercent,
  formatSignificant,
  formatUsd,
  localizedConfidence,
} from "./candidate-market-evidence";

const copy = {
  en: {
    region: "Candidate Market comparison",
    tray: "Comparison tray",
    table: "Compared Candidate Markets",
    candidate: "Candidate Market",
    scoreRank: "Score / rank",
    size: "Market Size (USD / year)",
    growth: "Market Growth (% / year)",
    foothold: "Recorded Foothold (% share)",
    diversity: "Supplier Diversity (index)",
    confidence: "Data Confidence",
    actions: "Actions",
    neutral: "Neutral midpoint",
    noFlow: "No recorded bilateral flow",
    noIso3: "No public ISO3",
    perYear: "/ year",
    shareUnit: "share",
    indexUnit: "index",
    remove: "Remove",
    fromComparison: "from comparison",
  },
  "zh-Hans": {
    region: "候选市场比较",
    tray: "比较栏",
    table: "已比较候选市场",
    candidate: "候选市场",
    scoreRank: "评分 / 排名",
    size: "市场规模（美元 / 年）",
    growth: "市场增长（% / 年）",
    foothold: "已记录市场基础（% 份额）",
    diversity: "供应方多样性（指数）",
    confidence: "数据置信度",
    actions: "操作",
    neutral: "中性中点",
    noFlow: "未记录双边流量",
    noIso3: "无公开 ISO3",
    perYear: "/ 年",
    shareUnit: "份额",
    indexUnit: "指数",
    remove: "从比较栏移除",
    fromComparison: "",
  },
} as const;

type ComparisonLocale = keyof typeof copy;

export function CandidateMarketComparison({
  result,
  comparedCodes,
  locale,
  onRemove,
}: {
  result: CandidateMarketResult;
  comparedCodes: readonly string[];
  locale: ComparisonLocale;
  onRemove: (code: string) => void;
}) {
  const messages = copy[locale];
  const candidates = result.candidates.filter(({ economy }) =>
    comparedCodes.includes(economy.code),
  );

  return (
    <section
      className="candidate-comparison"
      aria-label={messages.region}
    >
      <div className="comparison-heading">
        <div>
          <p>{messages.region}</p>
          <h3>
            {messages.tray} · {candidates.length}/3
          </h3>
        </div>
        <span>
          {candidates.map((candidate) => candidate.economy.name).join(" · ")}
        </span>
      </div>
      {candidates.length === 0 ? null : (
        <div className="comparison-table-wrap">
          <table aria-label={messages.table}>
            <thead>
              <tr>
                <th scope="col">{messages.candidate}</th>
                <th scope="col">{messages.scoreRank}</th>
                <th scope="col">{messages.size}</th>
                <th scope="col">{messages.growth}</th>
                <th scope="col">{messages.foothold}</th>
                <th scope="col">{messages.diversity}</th>
                <th scope="col">{messages.confidence}</th>
                <th scope="col">{messages.actions}</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <ComparisonRow
                  key={candidate.economy.code}
                  candidate={candidate}
                  locale={locale}
                  onRemove={onRemove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ComparisonRow({
  candidate,
  locale,
  onRemove,
}: {
  candidate: CandidateMarket;
  locale: ComparisonLocale;
  onRemove: (code: string) => void;
}) {
  const messages = copy[locale];
  const displayName = candidateDisplayName(candidate, locale);
  const { components } = candidate;

  return (
    <tr>
      <th scope="row">
        <strong>{displayName}</strong>
        <small>
          BACI {candidate.economy.code} ·{" "}
          {candidate.economy.iso3 ?? messages.noIso3}
        </small>
      </th>
      <td>
        {candidate.score} / #{candidate.rank}
      </td>
      <td>
        {formatUsd(components.marketSize.meanCurrentUsd)} {messages.perYear}
      </td>
      <td>
        {components.marketGrowth.state === "COMPUTED" &&
        components.marketGrowth.annualRate !== null
          ? `${formatDecimalPercent(components.marketGrowth.annualRate)} ${messages.perYear}`
          : messages.neutral}
      </td>
      <td>
        {components.recordedFoothold.bilateralFlowState ===
        "NO_RECORDED_POSITIVE_FLOW"
          ? messages.noFlow
          : `${formatDecimalPercent(components.recordedFoothold.share)} ${messages.shareUnit}`}
      </td>
      <td>
        {components.supplierDiversity.state === "COMPUTED" &&
        components.supplierDiversity.index !== null
          ? `${formatSignificant(components.supplierDiversity.index)} ${messages.indexUnit}`
          : messages.neutral}
      </td>
      <td>
        {localizedConfidence(candidate.confidence.label, locale)} ·{" "}
        {candidate.confidence.score}
      </td>
      <td>
        <button
          type="button"
          onClick={() => onRemove(candidate.economy.code)}
        >
          {messages.remove} {displayName} {messages.fromComparison}
        </button>
      </td>
    </tr>
  );
}
