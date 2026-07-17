import type { AlertEvent } from "../store/model";

export type AlertMessageLocale = "en" | "zh-Hans";

export type BilingualText = Readonly<Record<AlertMessageLocale, string>>;

export interface RenderedAlertMessage {
  readonly subject: BilingualText;
  readonly body: BilingualText;
  readonly metadata: Readonly<Record<string, string>>;
}

export const COVERAGE_STATE_COPY_EN = {
  SUPPORTED:
    "Recent momentum available for this Eurostat reporting market and exact HS 2012 mapping.",
  SUPPORTED_NO_SIGNAL:
    "Eurostat coverage exists, but the fixed momentum recipe does not have sufficient comparable evidence.",
  NOT_OBSERVED:
    "No eligible detailed observation was published for one or more required months. This is unknown, not zero trade.",
  SUPPRESSED_OR_REALLOCATED:
    "Some detailed trade was confidential or reallocated by the source, so no HS 2012 product signal is calculated.",
  UNSUPPORTED_PRODUCT_MAPPING:
    "This product cannot be mapped exactly and completely from the applicable source classifications to HS 2012.",
  UNSUPPORTED_MARKET:
    "Recent momentum is not available for this reporting market in the Eurostat pilot.",
  SOURCE_UNAVAILABLE:
    "Recent momentum is temporarily unavailable. Annual BACI evidence is unchanged.",
} as const;

type CoverageState = keyof typeof COVERAGE_STATE_COPY_EN;

const COVERAGE_STATE_COPY_ZH: Record<CoverageState, string> = {
  SUPPORTED: "该 Eurostat 报告市场和精确 HS 2012 映射提供近期动量。",
  SUPPORTED_NO_SIGNAL:
    "Eurostat 覆盖存在，但固定动量规则没有足够的可比证据。",
  NOT_OBSERVED:
    "一个或多个所需月份未发布符合条件的详细观测。这表示未知，而不是零贸易。",
  SUPPRESSED_OR_REALLOCATED:
    "来源对部分详细贸易作了保密或重分配处理，因此不计算 HS 2012 产品信号。",
  UNSUPPORTED_PRODUCT_MAPPING:
    "该产品无法从适用的来源分类精确且完整地映射到 HS 2012。",
  UNSUPPORTED_MARKET: "Eurostat 试点不提供该报告市场的近期动量。",
  SOURCE_UNAVAILABLE: "近期动量暂时不可用。年度 BACI 证据不变。",
};

const signalLabels = {
  RISING_FAST: { en: "Rising fast", "zh-Hans": "快速上升" },
  RISING: { en: "Rising", "zh-Hans": "上升" },
  BROADLY_STABLE: { en: "Broadly stable", "zh-Hans": "大体稳定" },
  FALLING: { en: "Falling", "zh-Hans": "下降" },
  FALLING_FAST: { en: "Falling fast", "zh-Hans": "快速下降" },
} as const satisfies Record<string, BilingualText>;

export function renderAlertMessage(event: AlertEvent): RenderedAlertMessage {
  if (event.kind.toString().startsWith("REVISION_")) {
    return renderRevisionMessage(event);
  }
  return renderMomentumMessage(event);
}

function renderMomentumMessage(event: AlertEvent): RenderedAlertMessage {
  const detail = event.detail as Record<string, unknown>;
  const coverageState = coverageStateFrom(detail.coverageState);
  const signalState = stringOrNull(detail.signalState);
  const growthPercentDisplay = stringOrNull(detail.growthPercentDisplay);
  const recentMonths = stringArray(detail.recentMonths);
  const baselineMonths = stringArray(detail.baselineMonths);
  const comparisonEn = `${formatMonthRange(recentMonths, "en")} vs ${formatMonthRange(
    baselineMonths,
    "en",
  )}`;
  const comparisonZh = `${formatMonthRange(
    recentMonths,
    "zh-Hans",
  )} vs ${formatMonthRange(baselineMonths, "zh-Hans")}`;
  const reporter = localizedName(detail.reportingEconomyName, {
    en: stringOrNull(detail.reportingEconomyIso2) ?? "Reporting market",
    "zh-Hans": stringOrNull(detail.reportingEconomyIso2) ?? "报告市场",
  });
  const hsRevisionLabel = stringOrNull(detail.hsRevisionLabel) ?? "HS 2012";
  const hs12Code = stringOrNull(detail.hs12Code) ?? "unknown";
  const coverage = stringOrNull(detail.coverage) ??
    `${numberOrDefault(detail.recordedHistoryMonths, 0)}/${numberOrDefault(
      detail.expectedHistoryMonths,
      24,
    )} months recorded`;
  const updateState = stringOrNull(detail.updateState) ?? "preliminary";
  const valueCurrency = stringOrNull(detail.valueCurrency) ?? "EUR";
  const direction = signalState === null
    ? { en: "No directional signal", "zh-Hans": "无方向性信号" }
    : signalLabel(signalState);
  const directionWithRate = growthPercentDisplay === null
    ? direction
    : {
        en: `${direction.en} (${growthPercentDisplay})`,
        "zh-Hans": `${direction["zh-Hans"]}（${growthPercentDisplay}）`,
      };
  const source = stringOrNull(detail.source) ?? "Eurostat Comext";
  const sourceLine =
    "Source: Eurostat Comext. Total recorded imports from identified partners; " +
    "not specific to the selected exporter and excluded from BACI scores and ranks.";

  const enLines = [
    "Recent trade momentum - Eurostat coverage",
    `${reporter.en} imports, ${hsRevisionLabel} ${hs12Code}`,
    `${comparisonEn}: ${directionWithRate.en}`,
    ...claimSafeDirectionLines(signalState, "en"),
    `Current ${valueCurrency} - ${updateState} - ${coverage}`,
    sourceLine,
    COVERAGE_STATE_COPY_EN[coverageState],
    ...sourceDetailLines(detail, event, "en"),
  ];
  const zhLines = [
    "近期贸易动量 - Eurostat 覆盖",
    `${reporter["zh-Hans"]}进口，${hsRevisionLabel} ${hs12Code}`,
    `${comparisonZh}：${directionWithRate["zh-Hans"]}`,
    ...claimSafeDirectionLines(signalState, "zh-Hans"),
    `当前 ${valueCurrency} - ${updateState} - ${coverage}`,
    "来源：Eurostat Comext。来自已识别伙伴的进口记录总额；不是所选出口方专属，且不纳入 BACI 分数和排名。",
    COVERAGE_STATE_COPY_ZH[coverageState],
    ...sourceDetailLines(detail, event, "zh-Hans"),
  ];

  return {
    subject: {
      en: "Recent trade momentum - Eurostat coverage",
      "zh-Hans": "近期贸易动量 - Eurostat 覆盖",
    },
    body: { en: enLines.join("\n"), "zh-Hans": zhLines.join("\n") },
    metadata: {
      eventId: event.id,
      eventKind: event.kind.toString(),
      packageId: event.packageId ?? "",
      source,
    },
  };
}

function renderRevisionMessage(event: AlertEvent): RenderedAlertMessage {
  const detail = event.detail as Record<string, unknown>;
  const kind = event.kind.toString();
  const originalAlertId = stringOrNull(detail.originalAlertEventId) ??
    event.priorEventId ??
    "unknown-original-alert";
  const oldPackageId = stringOrNull(detail.oldPackageId) ??
    event.supersededPackageId ??
    "unknown-old-package";
  const newPackageId = stringOrNull(detail.newPackageId) ??
    event.packageId ??
    "unknown-new-package";
  const oldState = stringOrNull(detail.oldState) ?? "unknown";
  const newState = stringOrNull(detail.newState) ?? "unknown";
  const oldRate = stringOrNull(detail.oldGrowthRateDecimal) ?? "unavailable";
  const newRate = stringOrNull(detail.newGrowthRateDecimal) ?? "unavailable";
  const affected = affectedPeriods(detail.affectedPeriods);
  const report = stringOrNull(detail.revisionReportSha256) ?? "not provided";
  const verb = revisionVerb(kind);

  const enLines = [
    `${verb.en} for original alert ${originalAlertId}.`,
    `Original alert: ${originalAlertId}.`,
    `Previous package identity: ${oldPackageId}.`,
    `New package identity: ${newPackageId}.`,
    `Previous state/rate: ${oldState} / ${oldRate}.`,
    `New state/rate: ${newState} / ${newRate}.`,
    `Affected periods: ${affected.en}.`,
    `Revision report: ${report}.`,
    "The source revised the underlying data; this does not say the earlier computation was erroneous.",
  ];
  const zhLines = [
    `${verb["zh-Hans"]}，原始提醒 ${originalAlertId}。`,
    `原始提醒：${originalAlertId}。`,
    `旧包身份：${oldPackageId}。`,
    `新包身份：${newPackageId}。`,
    `旧状态/比率：${oldState} / ${oldRate}。`,
    `新状态/比率：${newState} / ${newRate}。`,
    `受影响期间：${affected["zh-Hans"]}。`,
    `修订报告：${report}。`,
    "来源修订了底层数据；这并不表示较早计算是错误的。",
  ];

  return {
    subject: {
      en: `${verb.en} - original alert ${originalAlertId}`,
      "zh-Hans": `${verb["zh-Hans"]} - 原始提醒 ${originalAlertId}`,
    },
    body: { en: enLines.join("\n"), "zh-Hans": zhLines.join("\n") },
    metadata: {
      eventId: event.id,
      eventKind: kind,
      packageId: newPackageId,
      supersededPackageId: oldPackageId,
      originalAlertId,
    },
  };
}

function sourceDetailLines(
  detail: Record<string, unknown>,
  event: AlertEvent,
  locale: AlertMessageLocale,
): string[] {
  const labels = locale === "en"
    ? {
        source: "Source",
        reporter: "Reporting economy",
        months: "Exact comparison months",
        extraction: "Source extraction",
        newest: "Newest eligible month",
        cn: "CN editions and mapping status",
        valuation: "Value/currency/border valuation",
        revision: "Update/revision state",
        coverage: "Coverage",
        excluded: "Excluded confidential/special treatment",
        identity: "Package/recipe identity",
        attribution: "Attribution",
        candidate: "Pinned candidate context",
        baci: "Annual BACI context",
      }
    : {
        source: "来源",
        reporter: "报告经济体",
        months: "精确比较月份",
        extraction: "来源提取",
        newest: "最新符合条件月份",
        cn: "CN 版本和映射状态",
        valuation: "价值/币种/边境估价",
        revision: "更新/修订状态",
        coverage: "覆盖",
        excluded: "已排除的保密/特殊处理",
        identity: "包/规则身份",
        attribution: "署名",
        candidate: "固定候选项情境",
        baci: "年度 BACI 情境",
      };
  const reporter = localizedName(detail.reportingEconomyName, {
    en: stringOrNull(detail.reportingEconomyIso2) ?? "not provided",
    "zh-Hans": stringOrNull(detail.reportingEconomyIso2) ?? "未提供",
  });
  const recentMonths = stringArray(detail.recentMonths);
  const baselineMonths = stringArray(detail.baselineMonths);
  return [
    `${labels.source}: ${stringOrNull(detail.source) ?? "Eurostat Comext"}`,
    `${labels.reporter}: ${reporter[locale]} (${stringOrNull(detail.reportingEconomyIso2) ?? "n/a"})`,
    `${labels.months}: ${formatMonthRange(recentMonths, locale)} vs ${formatMonthRange(
      baselineMonths,
      locale,
    )}`,
    `${labels.extraction}: ${stringOrNull(detail.sourceExtraction) ?? "not provided"}`,
    `${labels.newest}: ${stringOrNull(detail.newestEligibleMonth) ?? event.cutoffMonth ?? "not provided"}`,
    `${labels.cn}: ${stringOrNull(detail.cnEditions) ?? "not provided"}; ${stringOrNull(detail.mappingStatus) ?? "not provided"}`,
    `${labels.valuation}: ${stringOrNull(detail.borderValuation) ?? "current EUR imports"}`,
    `${labels.revision}: ${stringOrNull(detail.revisionState) ?? "initial package"}`,
    `${labels.coverage}: ${stringOrNull(detail.coverage) ?? "not provided"}`,
    `${labels.excluded}: ${stringOrNull(detail.excludedTreatment) ?? "not provided"}`,
    `${labels.identity}: ${stringOrNull(detail.packageIdentity) ?? event.packageId ?? "not provided"} / ${stringOrNull(detail.recipeIdentity) ?? event.recipeId ?? "not provided"}`,
    `${labels.attribution}: ${stringOrNull(detail.attribution) ?? "Eurostat Comext"}`,
    `${labels.candidate}: ${stringOrNull(detail.candidateContextUrl) ?? "not provided"}`,
    `${labels.baci}: ${stringOrNull(detail.annualBaciContextUrl) ?? "not provided"}`,
  ];
}

function coverageStateFrom(value: unknown): CoverageState {
  if (typeof value === "string" && value in COVERAGE_STATE_COPY_EN) {
    return value as CoverageState;
  }
  return "SOURCE_UNAVAILABLE";
}

function signalLabel(state: string): BilingualText {
  if (state in signalLabels) {
    return signalLabels[state as keyof typeof signalLabels];
  }
  return { en: state, "zh-Hans": state };
}

function claimSafeDirectionLines(
  state: string | null,
  locale: AlertMessageLocale,
): string[] {
  if (state === "RISING" || state === "RISING_FAST") {
    return [
      locale === "en"
        ? "Recorded nominal imports rose in this source comparison."
        : "本来源比较中记录的名义进口额上升。",
    ];
  }
  if (state === "FALLING" || state === "FALLING_FAST") {
    return [
      locale === "en"
        ? "Recorded nominal imports fell in this source comparison."
        : "本来源比较中记录的名义进口额下降。",
    ];
  }
  return [];
}

function localizedName(value: unknown, fallback: BilingualText): BilingualText {
  if (typeof value !== "object" || value === null) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return {
    en: stringOrNull(record.en) ?? fallback.en,
    "zh-Hans": stringOrNull(record["zh-Hans"]) ?? fallback["zh-Hans"],
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatMonthRange(
  months: readonly string[],
  locale: AlertMessageLocale,
): string {
  if (months.length === 0) {
    return locale === "en" ? "not provided" : "未提供";
  }
  const first = formatMonth(months[0]!, locale);
  const last = formatMonth(months[months.length - 1]!, locale);
  return first === last ? first : `${first}-${last}`;
}

function formatMonth(month: string, locale: AlertMessageLocale): string {
  const match = /^(?<year>\d{4})-(?<month>\d{2})$/u.exec(month);
  if (!match?.groups) {
    return month;
  }
  const year = match.groups.year;
  const monthIndex = Number(match.groups.month) - 1;
  if (locale === "zh-Hans") {
    return `${year}年${monthIndex + 1}月`;
  }
  const labels = [
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
  ];
  return `${labels[monthIndex] ?? match.groups.month} ${year}`;
}

function revisionVerb(kind: string): BilingualText {
  if (kind === "REVISION_RETRACTION") {
    return {
      en: "Source revision retraction",
      "zh-Hans": "来源修订撤回提醒",
    };
  }
  if (kind === "REVISION_REINSTATEMENT") {
    return {
      en: "Source revision reinstatement",
      "zh-Hans": "来源修订恢复提醒",
    };
  }
  return {
    en: "Source revision update",
    "zh-Hans": "来源修订更新",
  };
}

function affectedPeriods(value: unknown): BilingualText {
  if (typeof value !== "object" || value === null) {
    return { en: "not provided", "zh-Hans": "未提供" };
  }
  const record = value as Record<string, unknown>;
  const recent = stringArray(record.recentMonths);
  const baseline = stringArray(record.baselineMonths);
  const cutoffMonth = stringOrNull(record.cutoffMonth) ?? "not provided";
  return {
    en: `${formatMonthRange(recent, "en")} vs ${formatMonthRange(
      baseline,
      "en",
    )}; cutoff ${cutoffMonth}`,
    "zh-Hans": `${formatMonthRange(recent, "zh-Hans")} vs ${formatMonthRange(
      baseline,
      "zh-Hans",
    )}；截止 ${cutoffMonth}`,
  };
}
