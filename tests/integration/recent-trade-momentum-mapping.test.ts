import { describe, expect, it } from "vitest";

import {
  buildCnToHs12MappingReport,
  evaluateHs12ProductMappingAcrossEditions,
  type CnToHs12MappingEvidence,
} from "../../src/domain/recent-trade-momentum/cn-to-hs12-mapping";

const EVIDENCE: CnToHs12MappingEvidence = {
  schemaVersion: "cn-to-hs12-mapping-evidence-v1",
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
  editions: [
    {
      cnEditionYear: 2025,
      cnCodeListSha256: "1".repeat(64),
      correspondenceSha256: "2".repeat(64),
      reviewId: "synthetic-cn-2025-review",
      cn8Codes: [
        { cn8Code: "01012110", kind: "ORDINARY" },
        { cn8Code: "01012120", kind: "ORDINARY" },
        { cn8Code: "85171210", kind: "ORDINARY" },
        { cn8Code: "85171290", kind: "ORDINARY" },
        { cn8Code: "02011010", kind: "ORDINARY" },
        { cn8Code: "02011020", kind: "ORDINARY" },
        { cn8Code: "02011030", kind: "ORDINARY" },
        { cn8Code: "99999999", kind: "SPECIAL" },
      ],
      correspondences: [
        {
          cn8Code: "01012110",
          hs12Code: "010121",
          status: "EXACT_REVIEWED",
          chain: "DIRECT_EXACT",
        },
        {
          cn8Code: "01012120",
          hs12Code: "010121",
          status: "EXACT_REVIEWED",
          chain: "DIRECT_EXACT",
        },
        {
          cn8Code: "85171210",
          hs12Code: "851712",
          status: "EXACT_REVIEWED",
          chain: "DIRECT_EXACT",
        },
        {
          cn8Code: "85171290",
          hs12Code: "851712",
          status: "SPLIT",
          chain: "NON_EXACT",
        },
        {
          cn8Code: "85171290",
          hs12Code: "851713",
          status: "SPLIT",
          chain: "NON_EXACT",
        },
        {
          cn8Code: "02011010",
          hs12Code: "020110",
          status: "MERGED",
          chain: "NON_EXACT",
        },
        {
          cn8Code: "02011020",
          hs12Code: "020110",
          status: "QUALIFIED",
          chain: "NON_EXACT",
          qualified: true,
        },
        {
          cn8Code: "02011030",
          hs12Code: "020110",
          status: "UNMAPPED",
          chain: "NON_EXACT",
        },
      ],
    },
    {
      cnEditionYear: 2026,
      cnCodeListSha256: "3".repeat(64),
      correspondenceSha256: "4".repeat(64),
      reviewId: "synthetic-cn-2026-review",
      cn8Codes: [
        { cn8Code: "01012115", kind: "ORDINARY" },
        { cn8Code: "01012195", kind: "ORDINARY" },
        { cn8Code: "85171215", kind: "ORDINARY" },
        { cn8Code: "85171299", kind: "ORDINARY" },
        { cn8Code: "02011015", kind: "ORDINARY" },
        { cn8Code: "99000000", kind: "RESIDUAL" },
      ],
      correspondences: [
        {
          cn8Code: "01012115",
          hs12Code: "010121",
          status: "EXACT_REVIEWED",
          chain: "MULTI_STEP_EXACT",
        },
        {
          cn8Code: "01012195",
          hs12Code: "010121",
          status: "EXACT_REVIEWED",
          chain: "DIRECT_EXACT",
        },
        {
          cn8Code: "85171215",
          hs12Code: "851712",
          status: "EXACT_REVIEWED",
          chain: "DIRECT_EXACT",
        },
        {
          cn8Code: "85171299",
          hs12Code: "851712",
          status: "AMBIGUOUS",
          chain: "NON_EXACT",
        },
        {
          cn8Code: "85171299",
          hs12Code: "851714",
          status: "AMBIGUOUS",
          chain: "NON_EXACT",
        },
        {
          cn8Code: "02011015",
          hs12Code: "020110",
          status: "UNMAPPED",
          chain: "NON_EXACT",
        },
      ],
    },
  ],
};

describe("CN-to-HS12 exact complete-preimage mapping", () => {
  it("accepts only exact ordinary CN8 rows and rejects split, merge, qualified, unmapped, and special codes", () => {
    const report = buildCnToHs12MappingReport(EVIDENCE);

    expect(report.rowMappings).toEqual([
      {
        cnEditionYear: 2025,
        cn8Code: "01012110",
        status: "EXACT_REVIEWED",
        targets: ["010121"],
        chain: "DIRECT_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "01012120",
        status: "EXACT_REVIEWED",
        targets: ["010121"],
        chain: "DIRECT_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "02011010",
        status: "MERGED",
        targets: ["020110"],
        chain: "NON_EXACT",
        rejectionReasons: ["NON_EXACT_CORRESPONDENCE"],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "02011020",
        status: "QUALIFIED",
        targets: ["020110"],
        chain: "NON_EXACT",
        rejectionReasons: ["QUALIFIED_CORRESPONDENCE"],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "02011030",
        status: "UNMAPPED",
        targets: ["020110"],
        chain: "NON_EXACT",
        rejectionReasons: ["NON_EXACT_CORRESPONDENCE"],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "85171210",
        status: "EXACT_REVIEWED",
        targets: ["851712"],
        chain: "DIRECT_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "85171290",
        status: "SPLIT",
        targets: ["851712", "851713"],
        chain: "NON_EXACT",
        rejectionReasons: ["NON_EXACT_CORRESPONDENCE", "MULTIPLE_TARGETS"],
      },
      {
        cnEditionYear: 2025,
        cn8Code: "99999999",
        status: "NOT_APPLICABLE",
        targets: [],
        chain: "NON_EXACT",
        rejectionReasons: ["SPECIAL_SOURCE_CODE"],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "01012115",
        status: "EXACT_REVIEWED",
        targets: ["010121"],
        chain: "MULTI_STEP_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "01012195",
        status: "EXACT_REVIEWED",
        targets: ["010121"],
        chain: "DIRECT_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "02011015",
        status: "UNMAPPED",
        targets: ["020110"],
        chain: "NON_EXACT",
        rejectionReasons: ["NON_EXACT_CORRESPONDENCE"],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "85171215",
        status: "EXACT_REVIEWED",
        targets: ["851712"],
        chain: "DIRECT_EXACT",
        rejectionReasons: [],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "85171299",
        status: "AMBIGUOUS",
        targets: ["851712", "851714"],
        chain: "NON_EXACT",
        rejectionReasons: ["NON_EXACT_CORRESPONDENCE", "MULTIPLE_TARGETS"],
      },
      {
        cnEditionYear: 2026,
        cn8Code: "99000000",
        status: "NOT_APPLICABLE",
        targets: [],
        chain: "NON_EXACT",
        rejectionReasons: ["SPECIAL_SOURCE_CODE"],
      },
    ]);
  });

  it("proves complete CN8 preimages per edition and poisons a product when one touching code is ambiguous", () => {
    const report = buildCnToHs12MappingReport(EVIDENCE);

    expect(report.productMappings).toContainEqual({
      cnEditionYear: 2025,
      hs12Code: "010121",
      productStatus: "EXACT_REVIEWED",
      acceptedCn8Codes: ["01012110", "01012120"],
      rejectedTouchingCodes: [],
      correspondenceSha256: "2".repeat(64),
      reviewId: "synthetic-cn-2025-review",
      usesMultiStepExactChain: false,
    });
    expect(report.productMappings).toContainEqual({
      cnEditionYear: 2026,
      hs12Code: "010121",
      productStatus: "EXACT_REVIEWED",
      acceptedCn8Codes: ["01012115", "01012195"],
      rejectedTouchingCodes: [],
      correspondenceSha256: "4".repeat(64),
      reviewId: "synthetic-cn-2026-review",
      usesMultiStepExactChain: true,
    });
    expect(report.productMappings).toContainEqual({
      cnEditionYear: 2026,
      hs12Code: "851712",
      productStatus: "UNSUPPORTED_PRODUCT_MAPPING",
      acceptedCn8Codes: ["85171215"],
      rejectedTouchingCodes: ["85171299"],
      correspondenceSha256: "4".repeat(64),
      reviewId: "synthetic-cn-2026-review",
      usesMultiStepExactChain: false,
    });

    expect(
      evaluateHs12ProductMappingAcrossEditions(report, "010121", [2025, 2026]),
    ).toEqual({
      hs12Code: "010121",
      status: "EXACT_REVIEWED",
      acceptedPreimageByEdition: {
        2025: ["01012110", "01012120"],
        2026: ["01012115", "01012195"],
      },
      rejectedTouchingCodesByEdition: {
        2025: [],
        2026: [],
      },
      usesMultiStepExactChain: true,
    });
    expect(
      evaluateHs12ProductMappingAcrossEditions(report, "851712", [2025, 2026]),
    ).toMatchObject({
      hs12Code: "851712",
      status: "UNSUPPORTED_PRODUCT_MAPPING",
      rejectedTouchingCodesByEdition: {
        2025: ["85171290"],
        2026: ["85171299"],
      },
    });
  });
});
