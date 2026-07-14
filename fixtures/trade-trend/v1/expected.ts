export const TRADE_TREND_ACCEPTANCE_CASES = [
  {
    name: "complete with a provisional snapshot",
    importerCode: "528",
    productCode: "010121",
    summary: {
      state: "AVAILABLE",
      absoluteChangeCurrentUsd: "60000",
      percentageChangePercent: "60.000000",
      cagrPercent: "12.468265",
    },
    provisional: {
      year: 2024,
      state: "RECORDED_POSITIVE",
      valueCurrentUsd: "200000",
    },
  },
  {
    name: "sparse with no provisional snapshot",
    importerCode: "484",
    productCode: "010121",
    summary: {
      state: "AVAILABLE",
      absoluteChangeCurrentUsd: "-50000",
      percentageChangePercent: "-50.000000",
      cagrPercent: "-20.629947",
    },
    provisional: null,
  },
  {
    name: "no recorded flow",
    importerCode: "36",
    productCode: "010121",
    summary: {
      state: "UNAVAILABLE",
      reason: "NO_RECORDED_POSITIVE_OBSERVATIONS",
    },
    provisional: {
      year: 2024,
      state: "NO_RECORDED_POSITIVE_FLOW",
    },
  },
  {
    name: "unavailable trend",
    importerCode: "710",
    productCode: "010121",
    summary: {
      state: "UNAVAILABLE",
      reason: "ONLY_ONE_RECORDED_POSITIVE_OBSERVATION",
    },
    provisional: {
      year: 2024,
      state: "MISSING_OBSERVATION",
    },
  },
] as const;
