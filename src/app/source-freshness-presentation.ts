import type { SourceFreshnessState } from "../domain/release/source-freshness-states";
import type { TradeAnalysisLocale } from "./trade-analysis-context";

const labels = {
  en: {
    LATEST_KNOWN: "Latest known BACI release",
    UPDATE_IN_PROGRESS: "New BACI release is being validated",
    REFRESH_DELAYED:
      "Data refresh delayed - showing the last validated release",
    CHECK_OVERDUE:
      "Source freshness check overdue - showing the last validated release",
  },
  "zh-Hans": {
    LATEST_KNOWN: "当前已知最新 BACI 数据版",
    UPDATE_IN_PROGRESS: "正在验证新的 BACI 数据版",
    REFRESH_DELAYED: "数据刷新延迟 - 当前显示最近验证通过的数据版",
    CHECK_OVERDUE: "来源新鲜度检查已逾期 - 当前显示最近验证通过的数据版",
  },
} as const;

export function localizedSourceFreshness(
  state: SourceFreshnessState,
  locale: TradeAnalysisLocale,
): string {
  return labels[locale][state];
}
