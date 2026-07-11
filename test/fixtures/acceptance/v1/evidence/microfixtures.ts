import type {
  CmsV1Inputs,
  MarketYearEvidence,
} from "../../../../../src/evidence/trade-evidence-source";
import {
  ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_RELEASE,
} from "../metadata";

type MicroCandidate = {
  code: string;
  values: readonly [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ];
  selectedExporterShareBps?: number;
  alternativeSupplierShares?: readonly string[];
};

function makeInput(
  analysisBuildId: string,
  candidates: readonly MicroCandidate[],
): CmsV1Inputs {
  const marketYears = candidates.flatMap((candidate) =>
    candidate.values.flatMap((worldValueKusd, index): MarketYearEvidence[] => {
      if (worldValueKusd === null) {
        return [];
      }

      const selectedExporterShareBps =
        candidate.selectedExporterShareBps ?? 0;
      const alternativeSupplierShares =
        candidate.alternativeSupplierShares ?? ["1.00"];
      const selectedExporter =
        selectedExporterShareBps === 0
          ? ({ state: "NO_RECORDED_POSITIVE_FLOW" } as const)
          : ({
              state: "RECORDED",
              valueKusd: (
                (BigInt(worldValueKusd) *
                  BigInt(selectedExporterShareBps)) /
                10000n
              ).toString(),
            } as const);
      const sourceFlowCount =
        alternativeSupplierShares.length +
        (selectedExporter.state === "RECORDED" ? 1 : 0);

      return [
        {
          year: 2019 + index,
          candidateMarket: {
            code: candidate.code,
            name: `Fixture economy ${candidate.code}`,
            iso3: null,
            identityNote: null,
          },
          worldValueKusd,
          selectedExporter,
          alternativeSupplierShares,
          sourceFlowCount,
          quantityPresentCount: sourceFlowCount,
        },
      ];
    }),
  );

  return {
    analysisBuildId,
    analysisReleaseCatalogSha256:
      ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
    artifact: {
      buildId: "acceptance-fixtures-v1-contract-artifact",
      ...ACCEPTANCE_FIXTURE_ARTIFACT,
    },
    release: ACCEPTANCE_FIXTURE_RELEASE,
    exporter: {
      code: "156",
      name: "China",
      iso3: "CHN",
      identityNote: null,
    },
    product: {
      hsRevision: "HS12",
      code: "010121",
      descriptionEn: "Horses: live, pure-bred breeding animals",
    },
    marketYears,
    provisionalMarketYears: [],
    productYearTotals: Array.from({ length: 12 }, (_, index) => ({
      year: 2012 + index,
      worldValueKusd: "10000",
    })),
  };
}

const componentPoolOne = makeInput("micro-component-pool-one", [
  {
    code: "101",
    values: ["1000", "1000", "1000", "1000", "1000"],
  },
]);

const componentAllEqual = makeInput(
  "micro-component-all-equal",
  ["101", "102", "103", "104"].map((code) => ({
    code,
    values: ["1000", "1000", "1000", "1000", "1000"],
  })),
);

const componentHalfDisplay = makeInput(
  "micro-component-half-display",
  ["1000", "2000", "3000", "4000"].map((value, index) => ({
    code: String(101 + index),
    values: [value, value, value, value, value],
  })),
);

const growthBothNeutralReasons = makeInput(
  "micro-growth-both-neutral-reasons",
  [
    {
      code: "101",
      values: ["300", "400", null, null, null],
    },
  ],
);

const diversityZero = makeInput("micro-diversity-zero", [
  {
    code: "101",
    values: ["1000", "1000", "1000", "1000", "1000"],
    alternativeSupplierShares: ["1.00"],
  },
]);

const diversityNeutral = makeInput("micro-diversity-neutral", [
  {
    code: "101",
    values: ["1000", "1000", "1000", "1000", "1000"],
    selectedExporterShareBps: 10000,
    alternativeSupplierShares: [],
  },
]);

const extremeGrowth = makeInput("micro-extreme-growth", [
  {
    code: "101",
    values: ["1000", "2000", "4000", "8000", "16000"],
    selectedExporterShareBps: 1000,
  },
]);

const dominantSize = makeInput("micro-dominant-size", [
  {
    code: "101",
    values: ["10000", "10000", "10000", "10000", "10000"],
    selectedExporterShareBps: 1000,
  },
  {
    code: "102",
    values: ["1000", "1000", "1000", "1000", "1000"],
    selectedExporterShareBps: 1000,
  },
]);

const noExporterHistory = makeInput(
  "micro-no-exporter-history",
  ["1000", "2000", "3000"].map((value, index) => ({
    code: String(101 + index),
    values: [value, value, value, value, value],
  })),
);

const stabilityLow = makeInput(
  "micro-stability-low",
  Array.from({ length: 10 }, (_, index) => ({
    code: String(101 + index),
    values: [
      String((10 - index) * 100000),
      null,
      String((index + 1) * 1000),
      null,
      null,
    ],
    selectedExporterShareBps: 1000,
  })),
);

const primaryThresholdRanks = [1, 9, 7, 9, 1, 3, 5, 3, 5, 7] as const;
const alternateThresholdRanks = [1, 9, 3, 9, 3, 7, 5, 1, 7, 5] as const;
const stabilityThreshold = makeInput(
  "micro-stability-threshold",
  primaryThresholdRanks.map((primaryRank, index) => {
    const alternateRank = alternateThresholdRanks[index]!;
    const primaryMean = (11 - primaryRank) * 100000;
    const alternateValue = (11 - alternateRank) * 1000;

    return {
      code: String(101 + index),
      values: [
        String(2 * primaryMean - alternateValue),
        null,
        String(alternateValue),
        null,
        null,
      ],
      selectedExporterShareBps: 1000,
    };
  }),
);

const stabilitySmall = makeInput(
  "micro-stability-small",
  Array.from({ length: 9 }, (_, index) => {
    const value = String((index + 1) * 1000);
    return {
      code: String(101 + index),
      values: [value, value, value, value, value],
      selectedExporterShareBps: 1000,
    };
  }),
);

const oneCandidate = makeInput("micro-one-candidate", [
  {
    code: "101",
    values: ["1000", "1000", "1000", "1000", "1000"],
    selectedExporterShareBps: 1000,
  },
]);

const confidenceFloor = makeInput("micro-confidence-floor", [
  {
    code: "490",
    values: ["300", "400", null, null, null],
    alternativeSupplierShares: [],
  },
]);

const invalidWorldZero = makeInput("micro-invalid-world-zero", [
  {
    code: "101",
    values: ["0", "1000", null, null, null],
  },
]);

const invalidRecordedBilateralZero = makeInput(
  "micro-invalid-recorded-bilateral-zero",
  [
    {
      code: "101",
      values: ["1000", "1000", "1000", "1000", "1000"],
      selectedExporterShareBps: 1,
    },
  ],
);

export const MICRO_FIXTURE_INPUTS: ReadonlyMap<string, CmsV1Inputs> = new Map([
  [componentPoolOne.analysisBuildId, componentPoolOne],
  [componentAllEqual.analysisBuildId, componentAllEqual],
  [componentHalfDisplay.analysisBuildId, componentHalfDisplay],
  [growthBothNeutralReasons.analysisBuildId, growthBothNeutralReasons],
  [diversityZero.analysisBuildId, diversityZero],
  [diversityNeutral.analysisBuildId, diversityNeutral],
  [extremeGrowth.analysisBuildId, extremeGrowth],
  [dominantSize.analysisBuildId, dominantSize],
  [noExporterHistory.analysisBuildId, noExporterHistory],
  [stabilityLow.analysisBuildId, stabilityLow],
  [stabilityThreshold.analysisBuildId, stabilityThreshold],
  [stabilitySmall.analysisBuildId, stabilitySmall],
  [oneCandidate.analysisBuildId, oneCandidate],
  [confidenceFloor.analysisBuildId, confidenceFloor],
  [invalidWorldZero.analysisBuildId, invalidWorldZero],
  [
    invalidRecordedBilateralZero.analysisBuildId,
    invalidRecordedBilateralZero,
  ],
]);
