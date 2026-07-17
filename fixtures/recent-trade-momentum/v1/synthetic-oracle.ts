import type {
  RecentTradeMomentumSourceRow,
  RecentTradeMomentumSourceVintage,
} from "../../../scripts/release/recent-trade-momentum-package";

const MONTHS_25 = [
  "2024-03",
  "2024-04",
  "2024-05",
  "2024-06",
  "2024-07",
  "2024-08",
  "2024-09",
  "2024-10",
  "2024-11",
  "2024-12",
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
] as const;

const ELIGIBLE_MONTHS = MONTHS_25.slice(0, 24);
const BE_MISSING_MONTHS = new Set(["2024-03", "2024-04", "2024-05", "2024-06"]);

export const EXPECTED_RECENT_TRADE_MOMENTUM_ANALYTICAL_ROWS_JSON = `{
  "momentum": [
    {
      "reporter_id": 2,
      "reporter_iso2": "BE",
      "hs12_code": "010121",
      "cutoff_month": "2026-02",
      "recent_value_eur": "250000",
      "baseline_value_eur": "250000",
      "growth_rate_decimal": "0.000000000000",
      "growth_percent_display": "+0.0",
      "signal_state": "BROADLY_STABLE",
      "coverage_state": "SUPPORTED",
      "confidence": "MEDIUM",
      "recorded_history_months": 20,
      "expected_history_months": 24,
      "reason_codes": "",
      "confidence_reasons": "RECORDED_HISTORY_20_TO_23,MULTI_STEP_EXACT_CORRESPONDENCE"
    },
    {
      "reporter_id": 2,
      "reporter_iso2": "BE",
      "hs12_code": "020110",
      "cutoff_month": "2026-02",
      "recent_value_eur": null,
      "baseline_value_eur": null,
      "growth_rate_decimal": null,
      "growth_percent_display": null,
      "signal_state": null,
      "coverage_state": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence": null,
      "recorded_history_months": 0,
      "expected_history_months": 24,
      "reason_codes": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence_reasons": ""
    },
    {
      "reporter_id": 2,
      "reporter_iso2": "BE",
      "hs12_code": "851712",
      "cutoff_month": "2026-02",
      "recent_value_eur": null,
      "baseline_value_eur": null,
      "growth_rate_decimal": null,
      "growth_percent_display": null,
      "signal_state": null,
      "coverage_state": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence": null,
      "recorded_history_months": 0,
      "expected_history_months": 24,
      "reason_codes": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence_reasons": ""
    },
    {
      "reporter_id": 1,
      "reporter_iso2": "DE",
      "hs12_code": "010121",
      "cutoff_month": "2026-02",
      "recent_value_eur": "1249999",
      "baseline_value_eur": "1000000",
      "growth_rate_decimal": "0.249999000000",
      "growth_percent_display": "+25.0",
      "signal_state": "RISING",
      "coverage_state": "SUPPORTED",
      "confidence": "MEDIUM",
      "recorded_history_months": 24,
      "expected_history_months": 24,
      "reason_codes": "",
      "confidence_reasons": "PRELIMINARY_COMPARISON_MONTH,MULTI_STEP_EXACT_CORRESPONDENCE"
    },
    {
      "reporter_id": 1,
      "reporter_iso2": "DE",
      "hs12_code": "020110",
      "cutoff_month": "2026-02",
      "recent_value_eur": null,
      "baseline_value_eur": null,
      "growth_rate_decimal": null,
      "growth_percent_display": null,
      "signal_state": null,
      "coverage_state": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence": null,
      "recorded_history_months": 0,
      "expected_history_months": 24,
      "reason_codes": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence_reasons": ""
    },
    {
      "reporter_id": 1,
      "reporter_iso2": "DE",
      "hs12_code": "851712",
      "cutoff_month": "2026-02",
      "recent_value_eur": null,
      "baseline_value_eur": null,
      "growth_rate_decimal": null,
      "growth_percent_display": null,
      "signal_state": null,
      "coverage_state": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence": null,
      "recorded_history_months": 0,
      "expected_history_months": 24,
      "reason_codes": "UNSUPPORTED_PRODUCT_MAPPING",
      "confidence_reasons": ""
    }
  ]
}
`;

const mappingEvidence: RecentTradeMomentumSourceVintage["mappingEvidence"] = {
  schemaVersion: "cn-to-hs12-mapping-evidence-v1",
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
  editions: [
    {
      cnEditionYear: 2025,
      cnCodeListSha256: "1".repeat(64),
      correspondenceSha256: "2".repeat(64),
      reviewId: "recent-trade-momentum-fixtures-v1-cn-2025",
      cn8Codes: [
        { cn8Code: "01012110", kind: "ORDINARY" },
        { cn8Code: "01012120", kind: "ORDINARY" },
        { cn8Code: "85171210", kind: "ORDINARY" },
        { cn8Code: "85171290", kind: "ORDINARY" },
        { cn8Code: "02011010", kind: "ORDINARY" },
        { cn8Code: "02011020", kind: "ORDINARY" },
      ],
      correspondences: [
        { cn8Code: "01012110", hs12Code: "010121", status: "EXACT_REVIEWED", chain: "DIRECT_EXACT" },
        { cn8Code: "01012120", hs12Code: "010121", status: "EXACT_REVIEWED", chain: "DIRECT_EXACT" },
        { cn8Code: "85171210", hs12Code: "851712", status: "EXACT_REVIEWED", chain: "DIRECT_EXACT" },
        { cn8Code: "85171290", hs12Code: "851712", status: "SPLIT", chain: "NON_EXACT" },
        { cn8Code: "85171290", hs12Code: "851713", status: "SPLIT", chain: "NON_EXACT" },
        { cn8Code: "02011010", hs12Code: "020110", status: "MERGED", chain: "NON_EXACT" },
        { cn8Code: "02011020", hs12Code: "020110", status: "QUALIFIED", chain: "NON_EXACT", qualified: true },
      ],
    },
    {
      cnEditionYear: 2026,
      cnCodeListSha256: "3".repeat(64),
      correspondenceSha256: "4".repeat(64),
      reviewId: "recent-trade-momentum-fixtures-v1-cn-2026",
      cn8Codes: [
        { cn8Code: "01012115", kind: "ORDINARY" },
        { cn8Code: "01012195", kind: "ORDINARY" },
        { cn8Code: "85171215", kind: "ORDINARY" },
        { cn8Code: "85171299", kind: "ORDINARY" },
        { cn8Code: "02011015", kind: "ORDINARY" },
      ],
      correspondences: [
        { cn8Code: "01012115", hs12Code: "010121", status: "EXACT_REVIEWED", chain: "MULTI_STEP_EXACT" },
        { cn8Code: "01012195", hs12Code: "010121", status: "EXACT_REVIEWED", chain: "DIRECT_EXACT" },
        { cn8Code: "85171215", hs12Code: "851712", status: "EXACT_REVIEWED", chain: "DIRECT_EXACT" },
        { cn8Code: "85171299", hs12Code: "851712", status: "AMBIGUOUS", chain: "NON_EXACT" },
        { cn8Code: "85171299", hs12Code: "851714", status: "AMBIGUOUS", chain: "NON_EXACT" },
        { cn8Code: "02011015", hs12Code: "020110", status: "UNMAPPED", chain: "NON_EXACT" },
      ],
    },
  ],
};

const reporters = [
  { reporterId: 1, sourceCode: "DE", iso2: "DE", iso3: "DEU", displayName: "Germany", validFrom: "2024-01", validTo: null },
  { reporterId: 2, sourceCode: "BE", iso2: "BE", iso3: "BEL", displayName: "Belgium", validFrom: "2024-01", validTo: null },
] as const;

const partners = [
  { partnerId: 1, sourceCode: "US", iso2: "US", iso3: "USA", kind: "INDIVIDUAL", validFrom: "2024-01", validTo: null },
  { partnerId: 2, sourceCode: "CN", iso2: "CN", iso3: "CHN", kind: "INDIVIDUAL", validFrom: "2024-01", validTo: null },
  { partnerId: 3, sourceCode: "WORLD", iso2: null, iso3: null, kind: "AGGREGATE", validFrom: "2024-01", validTo: null },
  { partnerId: 4, sourceCode: "SECRET", iso2: null, iso3: null, kind: "CONFIDENTIAL", validFrom: "2024-01", validTo: null },
] as const;

export const recentTradeMomentumFixtureVintageA: RecentTradeMomentumSourceVintage = {
  schemaVersion: "recent-trade-momentum-fixtures-v1",
  sourceVintageId: "recent-trade-momentum-fixtures-v1-a",
  extractionTimestamp: "2026-07-17T00:00:00.000Z",
  sourceMetadataVersion: "synthetic-eurostat-comext-metadata-v1",
  sourceUrl: "https://example.test/eurostat-comext-synthetic-a.csv",
  sourceObjects: [
    {
      objectId: "recent-trade-momentum-fixtures-v1-a-source",
      url: "https://example.test/eurostat-comext-synthetic-a.csv",
      content: "synthetic source vintage a",
    },
  ],
  referenceMonths: MONTHS_25,
  eligibleCompleteMonths: ELIGIBLE_MONTHS,
  reporters,
  partners,
  hs12Products: ["010121", "020110", "851712"],
  mappingEvidence,
  rows: buildVintageARows(),
};

export const recentTradeMomentumFixtureVintageAReordered: RecentTradeMomentumSourceVintage = {
  ...recentTradeMomentumFixtureVintageA,
  sourceVintageId: "recent-trade-momentum-fixtures-v1-a-reordered",
  sourceObjects: [
    {
      objectId: "recent-trade-momentum-fixtures-v1-a-reordered-source",
      url: "https://example.test/eurostat-comext-synthetic-a-reordered.csv",
      content: "synthetic source vintage a reordered",
    },
  ],
  rows: [...recentTradeMomentumFixtureVintageA.rows].reverse(),
};

export const recentTradeMomentumFixtureVintageB: RecentTradeMomentumSourceVintage = {
  ...recentTradeMomentumFixtureVintageA,
  sourceVintageId: "recent-trade-momentum-fixtures-v1-b",
  extractionTimestamp: "2026-08-17T00:00:00.000Z",
  sourceObjects: [
    {
      objectId: "recent-trade-momentum-fixtures-v1-b-source",
      url: "https://example.test/eurostat-comext-synthetic-b.csv",
      content: "synthetic source vintage b",
    },
  ],
  rows: buildVintageBRows(),
};

function buildVintageARows(): RecentTradeMomentumSourceRow[] {
  const rows: RecentTradeMomentumSourceRow[] = [];
  for (const month of ELIGIBLE_MONTHS) {
    rows.push(...identifiedRows("DE", month, deValue(month)));
    rows.push(worldRow("DE", month, deValue(month)));
    if (!BE_MISSING_MONTHS.has(month)) {
      rows.push(...identifiedRows("BE", month, beValue(month)));
      rows.push(worldRow("BE", month, beValue(month)));
    }
  }
  rows.push(unsupportedRow("DE", "2026-01", "85171215", 10_000));
  rows.push(unsupportedRow("DE", "2026-01", "85171299", 10_000));
  rows.push(unsupportedRow("BE", "2025-01", "02011010", 9_999, "SECRET"));
  return rows;
}

function buildVintageBRows(): RecentTradeMomentumSourceRow[] {
  const rows = buildVintageARows().filter(
    (row) =>
      !(row.reporterSourceCode === "BE" &&
        row.referenceMonth === "2026-02" &&
        row.partnerSourceCode === "CN" &&
      row.cn8Code === "01012195"),
  );
  const valueChange = rows.find(
    (row) =>
      row.reporterSourceCode === "DE" &&
      row.referenceMonth === "2026-01" &&
      row.partnerSourceCode === "CN" &&
      row.cn8Code === "01012195",
  );
  if (valueChange !== undefined) {
    rows[rows.indexOf(valueChange)] = {
      ...valueChange,
      valueEur: valueChange.valueEur + 100_000,
    };
  }
  const stateChange = rows.find(
    (row) =>
      row.reporterSourceCode === "DE" &&
      row.referenceMonth === "2026-02" &&
      row.partnerSourceCode === "US" &&
      row.cn8Code === "01012115",
  );
  if (stateChange !== undefined) {
    rows[rows.indexOf(stateChange)] = {
      ...stateChange,
      updateState: "FINAL_BY_SOURCE_SCHEDULE",
    };
  }
  rows.push(sourceRow("BE", "2024-03", "US", "01012110", 100_000));
  return rows;
}

function deValue(month: string): number {
  if (month === "2024-12") return 330_000;
  if (month === "2025-01") return 330_000;
  if (month === "2025-02") return 340_000;
  if (month === "2025-12") return 416_666;
  if (month === "2026-01") return 416_666;
  if (month === "2026-02") return 416_667;
  return 100_000;
}

function beValue(month: string): number {
  if (month === "2024-12") return 80_000;
  if (month === "2025-01") return 80_000;
  if (month === "2025-02") return 90_000;
  if (month === "2025-12") return 200_000;
  if (month === "2026-01") return 25_000;
  if (month === "2026-02") return 25_000;
  return 100_000;
}

function identifiedRows(
  reporterSourceCode: "BE" | "DE",
  referenceMonth: string,
  valueEur: number,
): RecentTradeMomentumSourceRow[] {
  const [primaryCn8, secondaryCn8] = cnCodes(referenceMonth);
  const usValue = Math.floor(valueEur * 0.6);
  const cnValue = valueEur - usValue;
  return [
    sourceRow(reporterSourceCode, referenceMonth, "US", primaryCn8, usValue),
    sourceRow(reporterSourceCode, referenceMonth, "CN", secondaryCn8, cnValue),
  ];
}

function worldRow(
  reporterSourceCode: "BE" | "DE",
  referenceMonth: string,
  valueEur: number,
): RecentTradeMomentumSourceRow {
  const [primaryCn8] = cnCodes(referenceMonth);
  return sourceRow(reporterSourceCode, referenceMonth, "WORLD", primaryCn8, valueEur, "WORLD_TOTAL");
}

function unsupportedRow(
  reporterSourceCode: "BE" | "DE",
  referenceMonth: string,
  cn8Code: string,
  valueEur: number,
  partnerSourceCode: "US" | "CN" | "SECRET" = "US",
): RecentTradeMomentumSourceRow {
  return sourceRow(reporterSourceCode, referenceMonth, partnerSourceCode, cn8Code, valueEur, partnerSourceCode === "SECRET" ? "CONFIDENTIAL" : "NONE");
}

function sourceRow(
  reporterSourceCode: "BE" | "DE",
  referenceMonth: string,
  partnerSourceCode: "US" | "CN" | "WORLD" | "SECRET",
  cn8Code: string,
  valueEur: number,
  sourceSpecialCode: RecentTradeMomentumSourceRow["sourceSpecialCode"] = "NONE",
): RecentTradeMomentumSourceRow {
  return {
    referenceMonth,
    reporterSourceCode,
    partnerSourceCode,
    flow: "IMPORT",
    cnEditionYear: referenceMonth.startsWith("2026-") ? 2026 : 2025,
    cn8Code,
    valueEur,
    sourceSpecialCode,
    updateState:
      reporterSourceCode === "DE" && referenceMonth === "2026-02" && partnerSourceCode === "US"
        ? "PRELIMINARY"
        : "FINAL_BY_SOURCE_SCHEDULE",
  };
}

function cnCodes(referenceMonth: string): readonly [string, string] {
  return referenceMonth.startsWith("2026-")
    ? ["01012115", "01012195"]
    : ["01012110", "01012120"];
}
