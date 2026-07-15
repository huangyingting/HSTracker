// Independently-worked expected literals for the Supplier Competition v1
// fixture evidence in ./evidence.ts. Every share, HHI, and quantity-coverage
// value here is computed by hand (see the exact-arithmetic worksheet in the
// PR/issue notes) rather than copied from the implementation, so these
// fixtures catch arithmetic regressions rather than merely mirroring the
// production code path.
export const SUPPLIER_COMPETITION_ACCEPTANCE_CASES = [
  {
    name: "dispersed",
    importerCode: "76",
    productCode: "010121",
    cohortSize: 4,
    finalizedPooledValueCurrentUsd: "1000000",
    supplierShares: [
      { code: "156", pooled: "250000", share: "25.000000", quantityCoverageRate: "1.000000" },
      { code: "392", pooled: "250000", share: "25.000000", quantityCoverageRate: "0.800000" },
      { code: "528", pooled: "250000", share: "25.000000", quantityCoverageRate: "1.000000" },
      { code: "842", pooled: "250000", share: "25.000000", quantityCoverageRate: "1.000000" },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "2500.000000",
      scale: 10000,
    },
    qualityWarnings: [],
    provisionalSupplierShares: [
      { code: "156", state: "RECORDED_POSITIVE", value: "60000" },
      { code: "392", state: "RECORDED_POSITIVE", value: "60000" },
      { code: "528", state: "RECORDED_POSITIVE", value: "60000" },
      { code: "842", state: "RECORDED_POSITIVE", value: "60000" },
    ],
  },
  {
    name: "concentrated",
    importerCode: "124",
    productCode: "010121",
    cohortSize: 4,
    finalizedPooledValueCurrentUsd: "1000000",
    supplierShares: [
      { code: "156", pooled: "700000", share: "70.000000", quantityCoverageRate: "1.000000" },
      { code: "392", pooled: "100000", share: "10.000000", quantityCoverageRate: "1.000000" },
      { code: "528", pooled: "100000", share: "10.000000", quantityCoverageRate: "1.000000" },
      { code: "710", pooled: "100000", share: "10.000000", quantityCoverageRate: "1.000000" },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "5200.000000",
      scale: 10000,
    },
    qualityWarnings: [],
    provisionalSupplierShares: [
      { code: "156", state: "RECORDED_POSITIVE", value: "150000" },
      { code: "528", state: "RECORDED_POSITIVE", value: "20000" },
      { code: "392", state: "NO_RECORDED_POSITIVE_FLOW", value: null },
      { code: "710", state: "NO_RECORDED_POSITIVE_FLOW", value: null },
    ],
  },
  {
    name: "single-supplier",
    importerCode: "152",
    productCode: "010121",
    cohortSize: 1,
    finalizedPooledValueCurrentUsd: "500000",
    supplierShares: [
      { code: "842", pooled: "500000", share: "100.000000", quantityCoverageRate: "1.000000" },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "10000.000000",
      scale: 10000,
    },
    qualityWarnings: [],
    provisionalSupplierShares: [
      { code: "842", state: "RECORDED_POSITIVE", value: "120000" },
    ],
  },
  {
    name: "sparse",
    importerCode: "404",
    productCode: "010121",
    cohortSize: 2,
    finalizedPooledValueCurrentUsd: "35000",
    supplierShares: [
      { code: "528", pooled: "30000", share: "85.714286", quantityCoverageRate: null },
      { code: "484", pooled: "5000", share: "14.285714", quantityCoverageRate: "0.750000" },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "7551.020408",
      scale: 10000,
    },
    qualityWarnings: ["SPARSE_FINALIZED_PERIODS", "INCOMPLETE_SUPPLIER_STRUCTURE"],
    provisionalSupplierShares: [
      { code: "484", state: "NOT_APPLICABLE", value: null },
      { code: "528", state: "NOT_APPLICABLE", value: null },
    ],
  },
  {
    name: "empty",
    importerCode: "616",
    productCode: "010121",
    cohortSize: 0,
    finalizedPooledValueCurrentUsd: "0",
    supplierShares: [],
    concentration: {
      state: "UNAVAILABLE",
      reason: "NO_POOLED_SUPPLIER_VALUE",
    },
    qualityWarnings: ["SPARSE_FINALIZED_PERIODS", "CONCENTRATION_UNAVAILABLE"],
    provisionalSupplierShares: [],
  },
  {
    name: "provisional-changing",
    importerCode: "699",
    productCode: "010121",
    cohortSize: 2,
    finalizedPooledValueCurrentUsd: "400000",
    supplierShares: [
      { code: "156", pooled: "200000", share: "50.000000", quantityCoverageRate: "1.000000" },
      { code: "528", pooled: "200000", share: "50.000000", quantityCoverageRate: "1.000000" },
    ],
    concentration: {
      state: "COMPUTED",
      herfindahlHirschmanIndex: "5000.000000",
      scale: 10000,
    },
    qualityWarnings: [],
    provisionalSupplierShares: [
      { code: "528", state: "RECORDED_POSITIVE", value: "300000" },
      { code: "842", state: "RECORDED_POSITIVE", value: "150000" },
      { code: "156", state: "NO_RECORDED_POSITIVE_FLOW", value: null },
    ],
  },
] as const;
