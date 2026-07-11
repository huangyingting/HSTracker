import type {
  CandidateMarket,
  CandidateMarketResult,
  CaveatCode,
  ConfidenceDeductionCode,
  StabilityEvidence,
} from "../domain/candidate-market/result";

const copy = {
  en: {
    selectedEvidence: "Selected Candidate Market evidence",
    baciCode: "BACI",
    noIso3: "No public ISO3",
    code490Display: "Other Asia, n.e.s. (Taiwan proxy)",
    score: "Candidate Market Score",
    rank: "Rank",
    rankJoin: "of",
    relativeComposite:
      "Relative composite of the four fixed-weight evidence components; not a forecast, probability, or recommendation.",
    formulaLabel: "cms-v1 audit view",
    formula:
      "30% Market Size + 25% Market Growth + 25% Recorded Foothold + 20% Supplier Diversity",
    rounding: "Rounded half-up to the displayed integer score",
    hiddenPrecision: "Intermediate weighted decimals are not displayed.",
    sharedRank: "Equal displayed integer scores share a competition rank.",
    scoreInputs: "Candidate Market Score inputs",
    component: "Component",
    rawEvidence: "Raw evidence",
    state: "State",
    percentile: "Percentile",
    observedCohort: "of observed cohort",
    neutralStanding: "Assigned midpoint 50 · not ranked",
    weight: "Weight",
    computed: "Computed",
    neutral: "Neutral midpoint",
    notComputed: "Not computed",
    perYear: "/ year",
    shareUnit: "share",
    indexUnit: "index",
    size: "Market Size",
    sizePeriod: "Mean recorded world imports",
    growth: "Market Growth",
    growthPeriod: "Log-linear nominal growth",
    foothold: "Recorded Foothold",
    footholdPeriod: "Selected export economy's recorded share",
    diversity: "Supplier Diversity",
    diversityPeriod: "Mean alternative-supplier diversity",
    noRecordedFlow: "No recorded bilateral flow in the score window",
    growthInsufficient: "Fewer than 3 observed Finalized Years",
    growthBelowMateriality:
      "Mean imports are below the USD 500K materiality threshold",
    diversityUnknown:
      "No observed year has a computable alternative-supplier structure",
    neutralGrowth:
      "Neutral midpoint 50 assigned; growth direction is unsupported.",
    neutralDiversity:
      "Neutral midpoint 50 assigned; supplier structure is unknown.",
    confidence: "Data Confidence",
    separateFromRank: "Separate from rank",
    confidenceQuestion:
      "How complete and stable is the evidence behind this Candidate Market Score?",
    noDeductions: "No deductions",
    sparseCap: "Sparse-evidence cap applied",
    finalizedObserved: "Finalized Years observed",
    quantityCompleteness: "Quantity completeness",
    separateFromConfidence: "Separate from Data Confidence",
    quantityCoverage: "Quantity coverage",
    quantityNotScored: "Quantity availability is not used by cms-v1.",
    stabilityCaveats: "Stability and caveats",
    robustnessChecks: "Robustness checks",
    stability: "stability",
    notFlagged: "Not flagged",
    lowStability: "Low window stability",
    stabilityNotEstimated: "Stability not estimated - small common cohort",
    commonCandidates: "common Candidate Markets",
    noCaveats: "No candidate-specific caveats",
    noDiscontinuity: "No HS Product series discontinuity flagged",
    discontinuity: "Possible discontinuity or exceptional global shock",
    unavailable: "Not available",
    provisionalSnapshot: "Provisional Year snapshot",
    supportingOnly: "Supporting evidence only",
    provisionalExcluded:
      "Excluded from Candidate Market Score, rank, and Data Confidence.",
    worldImports: "World imports",
    recordedBilateral: "Recorded bilateral",
    recordedShare: "Recorded share",
    noProvisionalFlow: "No recorded positive flow in the Provisional Year data",
    noProvisionalBilateralFlow:
      "No recorded positive flow in the Provisional Year",
    finalizedEvidenceThrough: "Finalized Year evidence through",
    releaseRevision: "Release Revision",
    releaseRevisionKicker: "Between BACI releases",
    releaseRevisionExplanation:
      "Release Revision means evidence changed between BACI releases, not historical growth.",
    noPreviousRevision: "No compatible prior release comparison",
    incompatibleRevision: "No compatible prior release comparison",
    missingRevisionWindow:
      "The prior release artifact cannot cover this exact score window.",
    materialRevision: "Changed materially since",
    belowRevisionThreshold: "No material revision flag",
    newlyEligible: "Newly eligible in this release",
    previousReleaseScore: "Previous-release recomputed score",
    scoreChange: "Score change",
    previousRankPercentile: "Previous-release recomputed rank percentile",
    rankPercentileChange: "Rank-percentile change",
    comparisonRelease: "Comparison release",
    noLongerEligible: "No longer eligible in this release",
    addToComparison: "Add",
    removeFromComparison: "Remove",
    toComparison: "to comparison",
    fromComparison: "from comparison",
  },
  "zh-Hans": {
    selectedEvidence: "所选候选市场证据",
    baciCode: "BACI",
    noIso3: "无公开 ISO3",
    code490Display: "Other Asia, n.e.s.（台湾代理）",
    score: "候选市场评分",
    rank: "排名",
    rankJoin: "/",
    relativeComposite: "四项固定权重证据的相对综合值；并非预测、概率或建议。",
    formulaLabel: "cms-v1 审核视图",
    formula:
      "30% 市场规模 + 25% 市场增长 + 25% 已记录市场基础 + 20% 供应方多样性",
    rounding: "按四舍五入显示整数评分",
    hiddenPrecision: "不显示中间加权小数。",
    sharedRank: "相同的显示整数评分共享一个竞争排名。",
    scoreInputs: "候选市场评分输入",
    component: "组成项",
    rawEvidence: "原始证据",
    state: "状态",
    percentile: "百分位",
    observedCohort: "观察队列",
    neutralStanding: "分配中点 50 · 未参与排名",
    weight: "权重",
    computed: "已计算",
    neutral: "中性中点",
    notComputed: "未计算",
    perYear: "/ 年",
    shareUnit: "份额",
    indexUnit: "指数",
    size: "市场规模",
    sizePeriod: "已记录世界进口额均值",
    growth: "市场增长",
    growthPeriod: "对数线性名义增长",
    foothold: "已记录市场基础",
    footholdPeriod: "所选出口经济体的已记录份额",
    diversity: "供应方多样性",
    diversityPeriod: "替代供应方多样性均值",
    noRecordedFlow: "计分窗口内未记录双边流量",
    growthInsufficient: "观察到的计分定稿年份少于 3 年",
    growthBelowMateriality: "进口均值低于 50 万美元实质性阈值",
    diversityUnknown: "没有观察年份具备可计算的替代供应方结构",
    neutralGrowth: "分配中性中点 50；增长方向缺乏支持。",
    neutralDiversity: "分配中性中点 50；供应方结构未知。",
    confidence: "数据置信度",
    separateFromRank: "独立于排名",
    confidenceQuestion: "该候选市场评分背后的证据有多完整和稳定？",
    noDeductions: "无扣减",
    sparseCap: "已应用稀疏证据上限",
    finalizedObserved: "个计分定稿年份有记录",
    quantityCompleteness: "数量完整性",
    separateFromConfidence: "独立于数据置信度",
    quantityCoverage: "数量覆盖率",
    quantityNotScored: "cms-v1 不使用数量可用性。",
    stabilityCaveats: "稳定性与注意事项",
    robustnessChecks: "稳健性检查",
    stability: "稳定性",
    notFlagged: "未标记",
    lowStability: "窗口稳定性低",
    stabilityNotEstimated: "稳定性未估计——共同队列较小",
    commonCandidates: "个共同候选市场",
    noCaveats: "无候选市场特定注意事项",
    noDiscontinuity: "未标记 HS 产品序列不连续",
    discontinuity: "可能存在不连续或异常全球冲击",
    unavailable: "不可用",
    provisionalSnapshot: "暂定年份快照",
    supportingOnly: "仅作辅助证据",
    provisionalExcluded: "不计入候选市场评分、排名和数据置信度。",
    worldImports: "世界进口额",
    recordedBilateral: "已记录双边流量",
    recordedShare: "已记录份额",
    noProvisionalFlow: "暂定年份数据中未记录正向流量",
    noProvisionalBilateralFlow: "暂定年份未记录双边正向流量",
    finalizedEvidenceThrough: "计分定稿证据截至",
    releaseRevision: "发布版本修订",
    releaseRevisionKicker: "BACI 数据版之间",
    releaseRevisionExplanation:
      "发布版本修订表示证据在 BACI 数据版之间发生变化，而非历史增长。",
    noPreviousRevision: "没有兼容的先前发布版本比较",
    incompatibleRevision: "没有兼容的先前发布版本比较",
    missingRevisionWindow: "先前发布版本工件无法覆盖完全相同的评分窗口。",
    materialRevision: "自以下版本以来发生实质性变化",
    belowRevisionThreshold: "无实质性修订标记",
    newlyEligible: "在此发布版本中新进入符合条件队列",
    previousReleaseScore: "先前发布版本重算评分",
    scoreChange: "评分变化",
    previousRankPercentile: "先前发布版本重算排名百分位",
    rankPercentileChange: "排名百分位变化",
    comparisonRelease: "比较发布版本",
    noLongerEligible: "在此发布版本中不再符合条件",
    addToComparison: "将",
    removeFromComparison: "从比较栏移除",
    toComparison: "加入比较栏",
    fromComparison: "",
  },
} as const;

type EvidenceLocale = keyof typeof copy;

type CandidateMarketEvidenceProps = {
  candidate: CandidateMarket;
  result: CandidateMarketResult;
  locale: EvidenceLocale;
  isCompared: boolean;
  comparisonFull: boolean;
  onToggleComparison: (candidate: CandidateMarket) => void;
};

type ScoreInput = {
  label: string;
  raw: string;
  period: string;
  state: "COMPUTED" | "NEUTRAL";
  percentile: number;
  weight: number;
  interpretation: string;
};

export function CandidateMarketEvidence({
  candidate,
  result,
  locale,
  isCompared,
  comparisonFull,
  onToggleComparison,
}: CandidateMarketEvidenceProps) {
  const messages = copy[locale];
  const scoreInputs = buildScoreInputs(candidate, result, locale);
  const displayName = candidateDisplayName(candidate, locale);
  const finalizedYearCount =
    result.provenance.scoreWindow.end - result.provenance.scoreWindow.start + 1;

  return (
    <section
      className="candidate-evidence"
      aria-label={messages.selectedEvidence}
    >
      <p className="evidence-kicker">{messages.selectedEvidence}</p>
      <h3>{displayName}</h3>
      <p className="evidence-identity">
        {messages.baciCode} {candidate.economy.code} ·{" "}
        {candidate.economy.iso3 ?? messages.noIso3}
      </p>
      {candidate.economy.identityNote === null ? null : (
        <aside className="evidence-identity-note">
          {candidate.economy.identityNote}
        </aside>
      )}
      <div className="evidence-summary">
        <strong>
          {messages.score} {candidate.score}
        </strong>
        <span>
          {messages.rank} {candidate.rank} {messages.rankJoin}{" "}
          {result.cohortSize}
        </span>
        <span>
          {messages.confidence}:{" "}
          {localizedConfidence(candidate.confidence.label, locale)}{" "}
          {candidate.confidence.score}
        </span>
      </div>
      <p className="score-explanation">{messages.relativeComposite}</p>

      <section className="formula-banner" aria-label={messages.formulaLabel}>
        <div>
          <p>{messages.formulaLabel}</p>
          <strong>{messages.formula}</strong>
        </div>
        <span>{messages.rounding}</span>
      </section>

      <div className="score-inputs-wrap">
        <table aria-label={messages.scoreInputs}>
          <thead>
            <tr>
              <th scope="col">{messages.component}</th>
              <th scope="col">{messages.rawEvidence}</th>
              <th scope="col">{messages.state}</th>
              <th scope="col">{messages.percentile}</th>
              <th scope="col">{messages.weight}</th>
            </tr>
          </thead>
          <tbody>
            {scoreInputs.map((input) => (
              <tr key={input.label} data-state={input.state}>
                <th scope="row">{input.label}</th>
                <td>
                  <strong>{input.raw}</strong>
                  <small>{input.period}</small>
                  <small className="score-interpretation">
                    {input.interpretation}
                  </small>
                </td>
                <td>
                  <span
                    className={`evidence-state ${input.state.toLowerCase()}`}
                  >
                    {input.state === "COMPUTED"
                      ? messages.computed
                      : messages.neutral}
                  </span>
                </td>
                <td
                  aria-label={
                    input.state === "NEUTRAL"
                      ? messages.neutralStanding
                      : `${messages.percentile} ${input.percentile}`
                  }
                >
                  {input.state === "NEUTRAL" ? (
                    <strong>{messages.neutralStanding}</strong>
                  ) : (
                    <>
                      <small>{messages.percentile}</small>{" "}
                      <strong>{input.percentile}</strong>
                      <small>{messages.observedCohort}</small>
                    </>
                  )}
                </td>
                <td>
                  <strong>{input.weight}%</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="score-audit-note">
        {messages.hiddenPrecision} {messages.sharedRank}
      </p>

      <section className="confidence-ledger" aria-label={messages.confidence}>
        <div className="confidence-heading">
          <div>
            <p>{messages.separateFromRank}</p>
            <h4>{messages.confidence}</h4>
          </div>
          <strong>
            {localizedConfidence(candidate.confidence.label, locale)} ·{" "}
            {candidate.confidence.score}
          </strong>
        </div>
        <p>{messages.confidenceQuestion}</p>
        <ul>
          {candidate.confidence.deductions.length === 0 &&
          !candidate.confidence.sparseEvidenceCapApplied ? (
            <li>
              <span>{messages.noDeductions}</span>
              <strong>100</strong>
            </li>
          ) : (
            candidate.confidence.deductions.map((deduction) => (
              <li key={deduction.code}>
                <span>
                  {confidenceDeductionLabel(deduction.code, candidate, locale)}
                </span>
                <strong>-{deduction.points}</strong>
              </li>
            ))
          )}
          {candidate.confidence.sparseEvidenceCapApplied ? (
            <li>
              <span>{messages.sparseCap}</span>
              <strong>40</strong>
            </li>
          ) : null}
        </ul>
        <p className="confidence-coverage">
          <strong>
            {candidate.observedScoreYears.length} {messages.rankJoin}{" "}
            {finalizedYearCount} {messages.finalizedObserved}
          </strong>
        </p>
      </section>

      <section
        className="quantity-completeness"
        aria-label={messages.quantityCompleteness}
      >
        <div>
          <p>{messages.separateFromConfidence}</p>
          <strong>
            {messages.quantityCoverage}{" "}
            {formatOptionalPercent(candidate.quantityCoverageRate, messages)}
          </strong>
        </div>
        <small>{messages.quantityNotScored}</small>
      </section>

      <StabilityAndCaveats
        candidate={candidate}
        result={result}
        locale={locale}
      />

      <ProvisionalEvidence candidate={candidate} locale={locale} />

      <ReleaseRevisionEvidence
        candidate={candidate}
        result={result}
        locale={locale}
      />

      <footer className="evidence-actions">
        <button
          type="button"
          aria-pressed={isCompared}
          disabled={comparisonFull && !isCompared}
          onClick={() => onToggleComparison(candidate)}
        >
          {isCompared
            ? `${messages.removeFromComparison} ${displayName} ${messages.fromComparison}`.trim()
            : `${messages.addToComparison} ${displayName} ${messages.toComparison}`}
        </button>
      </footer>

      <p className="evidence-source">
        {result.query.exporter.name} · HS 2012 ·{" "}
        {messages.finalizedEvidenceThrough}{" "}
        {candidate.latestFinalizedObservedYear}
      </p>
    </section>
  );
}

function ReleaseRevisionEvidence({
  candidate,
  result,
  locale,
}: {
  candidate: CandidateMarket;
  result: CandidateMarketResult;
  locale: EvidenceLocale;
}) {
  const messages = copy[locale];
  const revision = candidate.releaseRevision;
  const summary = result.releaseRevisionSummary;
  const stateLabel =
    revision.state === "MATERIAL_CHANGE"
      ? `${messages.materialRevision} ${summary.comparisonRelease ?? ""}`.trim()
      : revision.state === "BELOW_THRESHOLD"
        ? messages.belowRevisionThreshold
        : revision.state === "NEWLY_ELIGIBLE"
          ? messages.newlyEligible
          : notComparedLabel(summary.notComparedReason, locale);

  return (
    <section
      className="release-revision"
      aria-label={messages.releaseRevision}
      data-revision-state={revision.state}
    >
      <div>
        <p>{messages.releaseRevisionKicker}</p>
        <h4>{messages.releaseRevision}</h4>
        <strong>{stateLabel}</strong>
      </div>
      {summary.comparisonRelease === null ? null : (
        <p>
          {messages.comparisonRelease}: {summary.comparisonRelease}
        </p>
      )}
      {summary.noLongerEligibleCount === null ? null : (
        <p>
          {messages.noLongerEligible}: {summary.noLongerEligibleCount}
        </p>
      )}
      {revision.state === "BELOW_THRESHOLD" ||
      revision.state === "MATERIAL_CHANGE" ? (
        <dl>
          <div>
            <dt>{messages.previousReleaseScore} </dt>
            <dd>{revision.previousReleaseRecomputedScore}</dd>
          </div>
          <div>
            <dt>{messages.scoreChange} </dt>
            <dd>{formatSignedNumber(revision.scoreChange)}</dd>
          </div>
          <div>
            <dt>{messages.previousRankPercentile} </dt>
            <dd>{revision.previousReleaseRecomputedRankPercentile}</dd>
          </div>
          <div>
            <dt>{messages.rankPercentileChange} </dt>
            <dd>{formatSignedNumber(revision.rankPercentileChange)}</dd>
          </div>
        </dl>
      ) : null}
      <p>{messages.releaseRevisionExplanation}</p>
    </section>
  );
}

function notComparedLabel(
  reason: CandidateMarketResult["releaseRevisionSummary"]["notComparedReason"],
  locale: EvidenceLocale,
): string {
  const messages = copy[locale];
  if (reason === "PREVIOUS_ARTIFACT_MISSING_SCORE_WINDOW") {
    return messages.missingRevisionWindow;
  }
  if (reason === "NO_COMPATIBLE_PREVIOUS_ARTIFACT") {
    return messages.incompatibleRevision;
  }
  return messages.noPreviousRevision;
}

function formatSignedNumber(value: number | string | null): string {
  if (value === null) {
    return "—";
  }
  return Number(value) > 0 ? `+${value}` : String(value);
}

function StabilityAndCaveats({
  candidate,
  result,
  locale,
}: {
  candidate: CandidateMarket;
  result: CandidateMarketResult;
  locale: EvidenceLocale;
}) {
  const messages = copy[locale];
  return (
    <section
      className="stability-caveats"
      aria-label={messages.stabilityCaveats}
    >
      <div>
        <p>{messages.robustnessChecks}</p>
        <h4>{messages.stabilityCaveats}</h4>
      </div>
      <dl>
        <StabilityRow evidence={result.stability.threeYear} locale={locale} />
        <StabilityRow evidence={result.stability.tenYear} locale={locale} />
      </dl>
      <ul>
        {candidate.caveatCodes.length === 0 ? (
          <li>{messages.noCaveats}</li>
        ) : (
          candidate.caveatCodes.map((code) => (
            <li key={code}>{caveatLabel(code, locale)}</li>
          ))
        )}
        <li>
          {result.productSeriesDiscontinuityYears.length === 0
            ? messages.noDiscontinuity
            : `${messages.discontinuity}: ${result.productSeriesDiscontinuityYears.join(", ")}`}
        </li>
      </ul>
    </section>
  );
}

function StabilityRow({
  evidence,
  locale,
}: {
  evidence: StabilityEvidence;
  locale: EvidenceLocale;
}) {
  const messages = copy[locale];
  const state = {
    NOT_FLAGGED: messages.notFlagged,
    LOW: messages.lowStability,
    NOT_ESTIMATED_SMALL_COMMON_COHORT: messages.stabilityNotEstimated,
  }[evidence.state];
  return (
    <div>
      <dt>
        {evidence.window.start}–{evidence.window.end} {messages.stability}
      </dt>
      <dd>
        <strong>
          {state}
          {evidence.rankCorrelation === null
            ? ""
            : ` · ${evidence.rankCorrelation}`}
        </strong>
        <span>
          {evidence.commonCandidateCount} {messages.commonCandidates}
        </span>
      </dd>
    </div>
  );
}

function ProvisionalEvidence({
  candidate,
  locale,
}: {
  candidate: CandidateMarket;
  locale: EvidenceLocale;
}) {
  const messages = copy[locale];
  const evidence = candidate.provisionalEvidence;
  const label = `${evidence.year} ${messages.provisionalSnapshot}`;

  return (
    <section className="provisional-evidence" aria-label={label}>
      <div>
        <p>{label}</p>
        <h4>
          {evidence.marketState === "RECORDED"
            ? messages.supportingOnly
            : messages.noProvisionalFlow}
        </h4>
        <span>{messages.provisionalExcluded}</span>
      </div>
      {evidence.marketState === "RECORDED" ? (
        <dl>
          <div>
            <dt>{messages.worldImports}</dt>
            <dd>{formatUsd(evidence.marketImportCurrentUsd)}</dd>
          </div>
          <div>
            <dt>{messages.recordedBilateral}</dt>
            <dd>
              {evidence.bilateralState === "RECORDED"
                ? formatUsd(evidence.bilateralCurrentUsd)
                : messages.noProvisionalBilateralFlow}
            </dd>
          </div>
          <div>
            <dt>{messages.recordedShare}</dt>
            <dd>
              {evidence.recordedBilateralShare === null
                ? messages.unavailable
                : `${formatDecimalPercent(evidence.recordedBilateralShare)} ${messages.shareUnit}`}
            </dd>
          </div>
          <div>
            <dt>{messages.quantityCoverage}</dt>
            <dd>
              {formatOptionalPercent(evidence.quantityCoverageRate, messages)}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function buildScoreInputs(
  candidate: CandidateMarket,
  result: CandidateMarketResult,
  locale: EvidenceLocale,
): readonly ScoreInput[] {
  const messages = copy[locale];
  const { components } = candidate;
  const weights = result.weights;
  const growthValue = formattedMarketGrowth(candidate);
  const footholdValue = formattedRecordedFoothold(candidate);
  const diversityValue = formattedSupplierDiversity(candidate);

  return [
    {
      label: messages.size,
      raw: `${formatUsd(components.marketSize.meanCurrentUsd)} ${messages.perYear}`,
      period: `${messages.sizePeriod} · ${formatYears(components.marketSize.yearsUsed, locale)}`,
      state: components.marketSize.state,
      percentile: components.marketSize.percentile,
      weight: weights.marketSize,
      interpretation: componentInterpretation(
        "SIZE",
        components.marketSize.percentile,
        components.marketSize.state,
        locale,
      ),
    },
    {
      label: messages.growth,
      raw:
        growthValue !== null
          ? `${growthValue} ${messages.perYear}`
          : messages.notComputed,
      period:
        components.marketGrowth.state === "COMPUTED"
          ? `${messages.growthPeriod} · ${formatYears(components.marketGrowth.yearsUsed, locale)}`
          : `${growthReasonLabel(candidate, locale)} · ${formatYears(candidate.observedScoreYears, locale)}`,
      state: components.marketGrowth.state,
      percentile: components.marketGrowth.percentile,
      weight: weights.marketGrowth,
      interpretation: componentInterpretation(
        "GROWTH",
        components.marketGrowth.percentile,
        components.marketGrowth.state,
        locale,
      ),
    },
    {
      label: messages.foothold,
      raw:
        footholdValue === null
          ? messages.noRecordedFlow
          : `${footholdValue} ${messages.shareUnit}`,
      period: `${messages.footholdPeriod} · ${formatYearRange(candidate.observedScoreYears)}`,
      state: components.recordedFoothold.state,
      percentile: components.recordedFoothold.percentile,
      weight: weights.recordedFoothold,
      interpretation: componentInterpretation(
        "FOOTHOLD",
        components.recordedFoothold.percentile,
        components.recordedFoothold.state,
        locale,
      ),
    },
    {
      label: messages.diversity,
      raw:
        diversityValue !== null
          ? `${diversityValue} ${messages.indexUnit}`
          : messages.notComputed,
      period:
        components.supplierDiversity.state === "COMPUTED"
          ? `${messages.diversityPeriod} · ${formatYears(components.supplierDiversity.yearsUsed, locale)}`
          : messages.diversityUnknown,
      state: components.supplierDiversity.state,
      percentile: components.supplierDiversity.percentile,
      weight: weights.supplierDiversity,
      interpretation: componentInterpretation(
        "DIVERSITY",
        components.supplierDiversity.percentile,
        components.supplierDiversity.state,
        locale,
      ),
    },
  ];
}

function componentInterpretation(
  component: "SIZE" | "GROWTH" | "FOOTHOLD" | "DIVERSITY",
  percentile: number,
  state: "COMPUTED" | "NEUTRAL",
  locale: EvidenceLocale,
): string {
  if (state === "NEUTRAL") {
    if (component === "GROWTH") {
      return copy[locale].neutralGrowth;
    }
    if (component === "DIVERSITY") {
      return copy[locale].neutralDiversity;
    }
    return locale === "en"
      ? "Neutral midpoint 50 assigned because this evidence was not computed."
      : "由于该证据未计算，因此分配中性中点 50。";
  }

  const standing = relativeStanding(percentile);

  if (locale === "zh-Hans") {
    return {
      MOST: "高于大多数观察候选市场。",
      ABOVE_MIDPOINT: "高于观察队列中点。",
      NEAR_MIDPOINT: "接近观察队列中点。",
      BELOW_MIDPOINT: "低于观察队列中点。",
    }[standing];
  }

  if (component === "SIZE" && standing === "MOST") {
    return "Larger than most observed Candidate Markets.";
  }
  const subject = {
    SIZE: "observed import scale",
    GROWTH: "observed nominal growth",
    FOOTHOLD: "recorded exporter foothold",
    DIVERSITY: "alternative-supplier diversity",
  }[component];
  return {
    MOST: `Above most observed Candidate Markets for ${subject}.`,
    ABOVE_MIDPOINT: `Above the cohort midpoint for ${subject}.`,
    NEAR_MIDPOINT: `Near the cohort midpoint for ${subject}.`,
    BELOW_MIDPOINT: `Below the cohort midpoint for ${subject}.`,
  }[standing];
}

function relativeStanding(
  percentile: number,
): "MOST" | "ABOVE_MIDPOINT" | "NEAR_MIDPOINT" | "BELOW_MIDPOINT" {
  if (percentile >= 75) {
    return "MOST";
  }
  if (percentile >= 60) {
    return "ABOVE_MIDPOINT";
  }
  if (percentile >= 40) {
    return "NEAR_MIDPOINT";
  }
  return "BELOW_MIDPOINT";
}

function confidenceDeductionLabel(
  code: ConfidenceDeductionCode,
  candidate: CandidateMarket,
  locale: EvidenceLocale,
): string {
  const labels = {
    en: {
      MISSING_SCORE_WINDOW_YEARS: `${candidate.missingScoreYears.length} missing score-window years`,
      MISSING_CUTOFF_YEAR_EVIDENCE: "Missing finalized-cutoff evidence",
      SMALL_BASE: "Small observed import base",
      UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE:
        "Unknown alternative-supplier structure",
      POSSIBLE_PRODUCT_SERIES_DISCONTINUITY:
        "Possible discontinuity or exceptional global shock",
      LOW_WINDOW_STABILITY: "Low rank stability across score windows",
      SMALL_CANDIDATE_COHORT: "Small Candidate Market cohort",
      NO_EXPORTER_PRODUCT_HISTORY:
        "No recorded export-economy HS Product history",
      IDENTITY_PROXY: "Source identity proxy",
    },
    "zh-Hans": {
      MISSING_SCORE_WINDOW_YEARS: `缺少 ${candidate.missingScoreYears.length} 个计分窗口年份`,
      MISSING_CUTOFF_YEAR_EVIDENCE: "缺少定稿截止年份证据",
      SMALL_BASE: "观察进口基数较小",
      UNKNOWN_ALTERNATIVE_SUPPLIER_STRUCTURE: "替代供应方结构未知",
      POSSIBLE_PRODUCT_SERIES_DISCONTINUITY: "可能存在不连续或异常全球冲击",
      LOW_WINDOW_STABILITY: "不同计分窗口的排名稳定性低",
      SMALL_CANDIDATE_COHORT: "候选市场队列较小",
      NO_EXPORTER_PRODUCT_HISTORY: "未记录出口经济体的 HS 产品历史",
      IDENTITY_PROXY: "来源身份代理",
    },
  } as const;
  return labels[locale][code];
}

function caveatLabel(code: CaveatCode, locale: EvidenceLocale): string {
  const labels = {
    en: {
      NO_RECORDED_POSITIVE_FLOW:
        "No recorded bilateral flow in the score window",
      IDENTITY_PROXY: "Source identity proxy",
      EXTREME_NOMINAL_GROWTH: "Extreme nominal growth",
      DOMINANT_SIZE_OUTLIER: "Dominant Market Size outlier",
      POSSIBLE_PRODUCT_SERIES_DISCONTINUITY:
        "Possible discontinuity or exceptional global shock",
      LOW_WINDOW_STABILITY: "Low window stability",
      STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT:
        "Stability not estimated - small common cohort",
    },
    "zh-Hans": {
      NO_RECORDED_POSITIVE_FLOW: "计分窗口内未记录双边流量",
      IDENTITY_PROXY: "来源身份代理",
      EXTREME_NOMINAL_GROWTH: "名义增长极端",
      DOMINANT_SIZE_OUTLIER: "市场规模显著离群",
      POSSIBLE_PRODUCT_SERIES_DISCONTINUITY: "可能存在不连续或异常全球冲击",
      LOW_WINDOW_STABILITY: "窗口稳定性低",
      STABILITY_NOT_ESTIMATED_SMALL_COMMON_COHORT: "稳定性未估计——共同队列较小",
    },
  } as const;
  return labels[locale][code];
}

function growthReasonLabel(
  candidate: CandidateMarket,
  locale: EvidenceLocale,
): string {
  const messages = copy[locale];
  const reasons = candidate.components.marketGrowth.reasonCodes.map((code) =>
    code === "INSUFFICIENT_OBSERVED_YEARS"
      ? messages.growthInsufficient
      : messages.growthBelowMateriality,
  );
  return reasons.join(" · ");
}

export function localizedConfidence(
  label: CandidateMarket["confidence"]["label"],
  locale: EvidenceLocale,
): string {
  if (locale === "en") {
    return label;
  }
  return {
    HIGH: "高",
    MEDIUM: "中",
    LOW: "低",
  }[label];
}

export function candidateDisplayName(
  candidate: CandidateMarket,
  locale: EvidenceLocale,
): string {
  return candidate.economy.code === "490"
    ? copy[locale].code490Display
    : candidate.economy.name;
}

export function formatUsd(value: string | null): string {
  if (value === null) {
    return copy.en.unavailable;
  }
  const amount = Number(value);
  if (amount >= 1_000_000_000) {
    return `USD ${formatSignificant(amount / 1_000_000_000)}B`;
  }
  if (amount >= 1_000_000) {
    return `USD ${formatSignificant(amount / 1_000_000)}M`;
  }
  if (amount >= 1_000) {
    return `USD ${formatSignificant(amount / 1_000)}K`;
  }
  return `USD ${formatSignificant(amount)}`;
}

export function formatDecimalPercent(value: string): string {
  return `${formatSignificant(Number(value) * 100)}%`;
}

export function formattedMarketGrowth(
  candidate: CandidateMarket,
): string | null {
  const growth = candidate.components.marketGrowth;
  return growth.state === "COMPUTED" && growth.annualRate !== null
    ? formatDecimalPercent(growth.annualRate)
    : null;
}

export function formattedRecordedFoothold(
  candidate: CandidateMarket,
): string | null {
  const foothold = candidate.components.recordedFoothold;
  return foothold.bilateralFlowState === "NO_RECORDED_POSITIVE_FLOW"
    ? null
    : formatDecimalPercent(foothold.share);
}

export function formattedSupplierDiversity(
  candidate: CandidateMarket,
): string | null {
  const diversity = candidate.components.supplierDiversity;
  return diversity.state === "COMPUTED" && diversity.index !== null
    ? formatSignificant(diversity.index)
    : null;
}

function formatOptionalPercent(
  value: string | null,
  messages: (typeof copy)[EvidenceLocale],
): string {
  return value === null ? messages.unavailable : formatDecimalPercent(value);
}

export function formatSignificant(value: string | number): string {
  return Number(value).toPrecision(3);
}

function formatYears(years: readonly number[], locale: EvidenceLocale): string {
  if (locale === "zh-Hans") {
    return `${formatYearRange(years)}（${years.length} 年）`;
  }
  return `${formatYearRange(years)} (${years.length} ${
    years.length === 1 ? "year" : "years"
  })`;
}

function formatYearRange(years: readonly number[]): string {
  if (years.length === 0) {
    return copy.en.unavailable;
  }
  if (years.length === 1) {
    return String(years[0]);
  }
  const isContiguous = years.every(
    (year, index) => index === 0 || year === years[index - 1]! + 1,
  );
  if (!isContiguous) {
    return years.join(", ");
  }
  return `${years[0]}–${years.at(-1)}`;
}
